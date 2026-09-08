import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import { Repository } from '../src/db/repository.js';
import type { DraftContent } from '../src/core/types.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `brand_engine_test_${randomUUID().replaceAll('-', '')}`;
const content: DraftContent = {
  blocks: [
    { id: 'hook', kind: 'hook', text: 'Web siteniz ziyaretçiye sonraki adımı gösteriyor mu?' },
    { id: 'body', kind: 'body', text: 'Formdaki her alanın amacını sorgulayın. Müşterinin çözmek istediği problemi anlaşılır biçimde anlatın.' },
    { id: 'cta', kind: 'cta', text: 'Sizin sitenizde en belirsiz adım hangisi?' },
  ],
  topic: 'Landing page netliği', category: 'CRO', audience: 'KOBİ sahipleri', format: 'educational',
  pillar: 'education', series: null, sourceIds: [],
  scores: { hook: 85, value: 85, originality: 85, readability: 90, brandFit: 90, leadPotential: 70, authenticity: 90, overall: 87 },
};

// Opt-in integration suite: its random schema is the only data this suite creates or drops.
// CI supplies PostgreSQL 17 through TEST_DATABASE_URL; ordinary offline test runs skip it.
describe.skipIf(!databaseUrl)('Real PostgreSQL concurrency (requires TEST_DATABASE_URL)', () => {
  let admin: PgDatabase | undefined;
  let leftDb: PgDatabase | undefined;
  let rightDb: PgDatabase | undefined;
  let left: Repository;
  let right: Repository;
  let schemaCreated = false;

  beforeAll(async () => {
    admin = new PgDatabase(databaseUrl!);
    // The identifier is generated locally from a UUID and contains only [a-z0-9_].
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const isolatedUrl = new URL(databaseUrl!);
    const previousOptions = isolatedUrl.searchParams.get('options');
    isolatedUrl.searchParams.set('options', `${previousOptions ? `${previousOptions} ` : ''}-csearch_path=${schema}`);
    leftDb = new PgDatabase(isolatedUrl.toString());
    rightDb = new PgDatabase(isolatedUrl.toString());
    // Simulate API and worker booting together against two independent connection pools.
    await Promise.all([migrate(leftDb), migrate(rightDb)]);
    left = new Repository(leftDb);
    right = new Repository(rightDb);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([leftDb?.close(), rightDb?.close()]);
    try {
      if (schemaCreated) await admin!.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally { await admin?.close(); }
  }, 30_000);

  async function newUser(): Promise<string> { return left.ensureUser(`postgres-test-${randomUUID()}`); }
  async function newDraft(userId: string) {
    const post = await left.createPost(userId, new Date(Date.now() - 60_000).toISOString(), null, randomUUID());
    await left.saveDraft(userId, post.id, 0, structuredClone(content));
    return post;
  }

  it('uses distinct PostgreSQL backends and applies concurrent migrations once', async () => {
    const [a, b] = await Promise.all([
      leftDb!.query<{ pid: number; schema: string }>('SELECT pg_backend_pid() AS pid,current_schema() AS schema'),
      rightDb!.query<{ pid: number; schema: string }>('SELECT pg_backend_pid() AS pid,current_schema() AS schema'),
    ]);
    expect(a.rows[0]!.pid).not.toBe(b.rows[0]!.pid);
    expect(a.rows[0]!.schema).toBe(schema);
    expect(b.rows[0]!.schema).toBe(schema);
    const migrations = await leftDb!.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    expect(migrations.rows.map(row => row.name)).toContain('001_initial.sql');
    expect(new Set(migrations.rows.map(row => row.name)).size).toBe(migrations.rowCount);
  });

  it('racing duplicate approvals create one approval and exactly one publisher may start', async () => {
    const userId = await newUser();
    const post = await newDraft(userId);
    const updateId = randomUUID();
    const approved = await Promise.all([
      left.approve(userId, post.id, 1, updateId),
      right.approve(userId, post.id, 1, updateId),
    ]);
    expect(approved.every(item => item.approvedVersion === 1)).toBe(true);
    const starts = await Promise.all([
      left.beginPublish(userId, post.id, 1),
      right.beginPublish(userId, post.id, 1),
    ]);
    const winner = starts.find(item => item !== null)!;
    expect(starts.filter(item => item !== null)).toHaveLength(1);
    const approvals = await leftDb!.query('SELECT id FROM approvals WHERE user_id=$1 AND post_id=$2', [userId, post.id]);
    const attempts = await leftDb!.query('SELECT id FROM publish_attempts WHERE user_id=$1 AND post_id=$2', [userId, post.id]);
    expect(approvals.rowCount).toBe(1);
    expect(attempts.rowCount).toBe(1);
    await right.completePublish(userId, post.id, winner.attemptId, { urn: `urn:li:share:${randomUUID()}`, url: 'https://www.linkedin.com/feed/update/test/' });
    expect(await left.beginPublish(userId, post.id, 1)).toBeNull();
    expect((await left.getPost(userId, post.id))?.status).toBe('published');
  });

  it('different concurrent approval commands cannot both authorize a waiting draft', async () => {
    const userId = await newUser();
    const post = await newDraft(userId);
    const approvals = await Promise.allSettled([
      left.approve(userId, post.id, 1, randomUUID()),
      right.approve(userId, post.id, 1, randomUUID()),
    ]);
    expect(approvals.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(approvals.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await leftDb!.query('SELECT id FROM approvals WHERE user_id=$1 AND post_id=$2', [userId, post.id])).rowCount).toBe(1);
  });

  it('concurrent revisions preserve one immutable successor and reject the stale edit', async () => {
    const userId = await newUser();
    const post = await newDraft(userId);
    const revisions = await Promise.allSettled([
      left.saveDraft(userId, post.id, 1, { ...content, blocks: content.blocks.slice(0, 2) }, 'CTA çıkar'),
      right.saveDraft(userId, post.id, 1, { ...content, blocks: [{ id: 'hook', kind: 'hook', text: 'Sitenizin sonraki adımı açık mı?' }, ...content.blocks.slice(1)] }, 'Girişi kısalt'),
    ]);
    expect(revisions.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(revisions.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await left.getPost(userId, post.id))?.currentVersion).toBe(2);
    expect((await right.getVersion(userId, post.id, 1))!.text).toContain('Sizin sitenizde');
    await expect(left.approve(userId, post.id, 1, randomUUID())).rejects.toThrow('eski sürüm');
  });

  it('concurrent worker pools claim only one business job per tenant', async () => {
    // Repeat with fresh tenants to exercise acquisition timing rather than a shared serial connection.
    for (let round = 0; round < 8; round++) {
      const userId = await newUser();
      await left.enqueueJob(userId, 'test', { order: 1 }, new Date().toISOString(), randomUUID());
      await left.enqueueJob(userId, 'test', { order: 2 }, new Date().toISOString(), randomUUID());
      const claims = await Promise.all([
        left.claimJobs(`left-${round}`, 10, 120, userId),
        right.claimJobs(`right-${round}`, 10, 120, userId),
      ]);
      const first = claims.flat();
      expect(first).toHaveLength(1);
      expect(await right.claimJobs('blocked', 1, 120, userId)).toHaveLength(0);
      expect(await left.completeJob(first[0]!.id, first[0]!.leaseToken)).toBe(true);
      const next = await right.claimJobs('next', 1, 120, userId);
      expect(next).toHaveLength(1);
      expect(next[0]!.id).not.toBe(first[0]!.id);
      await right.completeJob(next[0]!.id, next[0]!.leaseToken);
    }
  });

  it('a locked tenant is skipped while a different tenant can make progress', async () => {
    const userId = await newUser();
    const other = await newUser();
    await left.enqueueJob(userId, 'test', {}, new Date().toISOString(), randomUUID());
    await left.enqueueJob(other, 'test', {}, new Date().toISOString(), randomUUID());
    let acquired!: () => void;
    let release!: () => void;
    const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; });
    const releasePromise = new Promise<void>(resolve => { release = resolve; });
    const holder = leftDb!.transaction(async tx => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      acquired();
      await releasePromise;
    });
    await acquiredPromise;
    try {
      expect(await right.claimJobs('locked', 1, 120, userId)).toHaveLength(0);
      const otherJob = await right.claimJobs('other-tenant', 1, 120, other);
      expect(otherJob).toHaveLength(1);
      expect(otherJob[0]!.userId).toBe(other);
      await right.completeJob(otherJob[0]!.id, otherJob[0]!.leaseToken);
    } finally { release(); await holder; }
    expect(await right.claimJobs('unlocked', 1, 120, userId)).toHaveLength(1);
  });

  it('simultaneous delivery of one Telegram update persists one inbox row and one bound job', async () => {
    const userId = await newUser();
    const post = await newDraft(userId);
    await left.enqueueOutbox(userId, 'Taslak', [], post.id, 1, randomUUID());
    const notification = (await left.claimOutbox('notifier', 1, 120, userId))[0]!;
    await left.completeOutbox(notification.id, notification.leaseToken, 77);
    const updateId = randomUUID();
    const update = { message: { text: 'onayla', reply_to_message: { message_id: 77 } } };
    const outcomes = await Promise.all([
      left.acceptTelegramUpdate(userId, updateId, update),
      right.acceptTelegramUpdate(userId, updateId, update),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const inbox = await leftDb!.query('SELECT update_id FROM telegram_inbox WHERE user_id=$1 AND update_id=$2', [userId, updateId]);
    const jobs = await rightDb!.query<{ payload: unknown }>('SELECT payload FROM jobs WHERE user_id=$1 AND dedupe_key=$2', [userId, `telegram:${updateId}`]);
    expect(inbox.rowCount).toBe(1);
    expect(jobs.rowCount).toBe(1);
    expect(jobs.rows[0]!.payload).toMatchObject({ targetCaptured: true, target: { postId: post.id, version: 1 } });
  });

  it('PostgreSQL enforces tenant ownership, immutable versions and cancelled lifecycle', async () => {
    const userId = await newUser();
    const other = await newUser();
    const post = await newDraft(userId);
    await expect(rightDb!.query(
      'INSERT INTO post_versions(id,user_id,post_id,version,content,text,fingerprint) VALUES($1,$2,$3,1,$4,$5,$6)',
      [randomUUID(), other, post.id, JSON.stringify(content), 'foreign content', 'foreign-fingerprint'],
    )).rejects.toThrow();
    await expect(rightDb!.query('UPDATE post_versions SET text=$3 WHERE user_id=$1 AND post_id=$2', [userId, post.id, 'tampered'])).rejects.toThrow('Immutable');
    await left.cancel(userId, post.id, 1);
    await expect(rightDb!.query("UPDATE post_drafts SET status='waiting_approval' WHERE user_id=$1 AND id=$2", [userId, post.id])).rejects.toThrow('Invalid post lifecycle');
    expect(await right.beginPublish(userId, post.id, 1)).toBeNull();
  });
});
