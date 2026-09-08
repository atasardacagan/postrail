import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { DateTime } from 'luxon';
import { PGliteDatabase } from '../src/db/pglite.js';
import { createRuntime } from '../src/runtime.js';
import { loadEnv } from '../src/core/config.js';
import { MockLinkedIn, MockTelegram } from '../src/integrations/mocks.js';

// Deliberate, nonfunctional fixture identities. Never read live provider credentials.
const runtime = await createRuntime(loadEnv({ NODE_ENV: 'test', APP_MODE: 'offline', ADMIN_API_TOKEN: 'showcase-fixture-admin-not-a-secret-01', TELEGRAM_ALLOWED_USER_ID: '123456', TELEGRAM_WEBHOOK_SECRET: 'showcase-fixture-webhook-not-a-secret', LOG_LEVEL: 'silent' }), new PGliteDatabase());
try {
  const { engine, telegram, linkedin } = runtime;
  assert(telegram instanceof MockTelegram && linkedin instanceof MockLinkedIn);
  const defaults = await engine.settings();
  const local = DateTime.now().setZone(defaults.timezone);
  await engine.repo.saveSettings(engine.userId, { ...defaults, postingDays: [local.weekday], postingTimes: [local.toFormat('HH:mm')], ctaFrequency: 1 });
  const drain = async () => { await engine.runJobs(30); await engine.flushOutbox(30); };
  await engine.tick(); await drain();
  const post = (await engine.repo.listPosts(engine.userId))[0]!;
  assert.equal(post.status, 'waiting_approval');
  let updateId = 0;
  const steps: Array<{ title: string; instruction: string | null; version: number; status: string; text: string; blocks: unknown; publishCalls: number }> = [];
  const capture = async (title: string, instruction: string | null) => {
    const version = (await engine.repo.latestVersion(engine.userId, post.id))!;
    const current = (await engine.repo.getPost(engine.userId, post.id))!;
    steps.push({ title, instruction, version: version.version, status: current.status, text: version.text, blocks: version.content.blocks, publishCalls: linkedin.published.length });
    return version;
  };
  const send = async (text: string) => {
    await engine.receive({ update_id: ++updateId, message: { message_id: 100 + updateId, from: { id: 123456 }, chat: { id: 123456, type: 'private' }, text } });
    await drain();
  };
  const v1 = await capture('A draft arrives for review', null);
  assert(v1.content.blocks.some(block => block.kind === 'cta'));
  await send('girişi daha kısa ve vurucu yap');
  const v2 = await capture('Only the opening changes', 'girişi daha kısa ve vurucu yap');
  assert.deepEqual(v2.content.blocks.filter(block => block.kind !== 'hook'), v1.content.blocks.filter(block => block.kind !== 'hook'));
  await send('CTA’yı çıkar');
  const v3 = await capture('Remove the CTA. Keep the rest.', 'CTA’yı çıkar');
  assert.deepEqual(v3.content.blocks, v2.content.blocks.filter(block => block.kind !== 'cta'));
  assert.equal(linkedin.published.length, 0);
  await send('onayla');
  await capture('The approved version is published', 'onayla');
  assert.equal(linkedin.published.length, 1);
  assert.equal(linkedin.published[0]!.text, v3.text);
  assert.equal(steps.at(-1)!.status, 'published');
  const result = { project: 'Postrail', recordedAt: new Date().toISOString(), mode: 'offline', provenance: 'Real application and PostgreSQL-compatible PGlite migrations; fixture writer, Telegram and LinkedIn adapters. Scheduler slot accelerated to the current minute. No live provider call or real social post.', defaultSchedule: { days: defaults.postingDays, times: defaults.postingTimes, timezone: defaults.timezone }, steps, summary: { versions: 3, publishCalls: linkedin.published.length, telegramMessages: telegram.messages.length, approvedVersion: 3 } };
  await mkdir('assets/demo', { recursive: true });
  await writeFile('assets/demo/run.json', `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write('PASS: showcase data captured from the real offline workflow. Three versions, one explicitly approved fixture publication.\n');
} finally { await runtime.app.close(); await runtime.db.close(); }
