import { createHash, randomUUID } from 'node:crypto';
import { ConflictError, assertTransition } from '../core/state-machine.js';
export { ConflictError } from '../core/state-machine.js';
import type { DraftContent, Idea, Post, PublishResult, Settings, TelegramButton, Version } from '../core/types.js';
import type { Database, Queryable } from './database.js';

interface PostRow { id: string; user_id: string; idea_id: string|null; status: Post['status']; scheduled_at: Date|string; current_version: number; approved_version: number|null; created_at: Date|string; updated_at: Date|string; failure: string|null }
interface VersionRow { id: string; user_id: string; post_id: string; version: number; content: DraftContent; text: string; fingerprint: string; instruction: string|null; created_at: Date|string }
interface IdeaRow { id: string; user_id: string; title: string; category: string; audience: string; angle: string; hook_idea: string; pillar: Idea['pillar']; format: string; series: string|null; priority: number; freshness: number; used: boolean; created_at: Date|string }
export interface Job { id: string; userId: string; type: string; payload: Record<string,unknown>; attempts: number; leaseToken: string }
export interface OutboxMessage { id: string; userId: string; text: string; buttons: TelegramButton[][]; postId: string|null; version: number|null; attempts: number; leaseToken: string }
const iso = (value: Date|string) => new Date(value).toISOString();
const post = (r: PostRow): Post => ({ id:r.id, userId:r.user_id, ideaId:r.idea_id, status:r.status, scheduledAt:iso(r.scheduled_at), currentVersion:r.current_version, approvedVersion:r.approved_version, createdAt:iso(r.created_at), updatedAt:iso(r.updated_at), failure:r.failure });
const version = (r: VersionRow): Version => ({ id:r.id, userId:r.user_id, postId:r.post_id, version:r.version, content:r.content, text:r.text, fingerprint:r.fingerprint, instruction:r.instruction, createdAt:iso(r.created_at) });
const idea = (r: IdeaRow): Idea => ({ id:r.id, userId:r.user_id, title:r.title, category:r.category, audience:r.audience, angle:r.angle, hookIdea:r.hook_idea, pillar:r.pillar, format:r.format, series:r.series, priority:r.priority, freshness:r.freshness, used:r.used, createdAt:iso(r.created_at) });
const now = () => new Date().toISOString();
function validDate(date: string): string { if (!Number.isFinite(Date.parse(date))) throw new ConflictError('Geçersiz tarih.'); return iso(date); }

export class Repository {
  constructor(readonly db: Database) {}
  async ensureUser(telegramId: string): Promise<string> {
    const r = await this.db.query<{id:string}>('INSERT INTO users(id,telegram_user_id) VALUES($1,$2) ON CONFLICT(telegram_user_id) DO UPDATE SET telegram_user_id=EXCLUDED.telegram_user_id RETURNING id', [randomUUID(),telegramId]);
    return r.rows[0]!.id;
  }
  async getSettings(userId: string): Promise<Settings|null> {
    const r = await this.db.query<{settings:Settings}>('SELECT settings FROM system_settings WHERE user_id=$1',[userId]); return r.rows[0]?.settings ?? null;
  }
  async saveSettings(userId: string, settings: Settings): Promise<void> {
    await this.db.query('INSERT INTO system_settings(user_id,settings) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()',[userId,JSON.stringify(settings)]);
  }
  async addIdeas(userId: string, ideas: Omit<Idea,'id'|'userId'|'used'|'createdAt'>[]): Promise<Idea[]> {
    return this.db.transaction(async tx => {
      const added: Idea[] = [];
      for (const i of ideas) {
        const r = await tx.query<IdeaRow>('INSERT INTO content_ideas(id,user_id,title,category,audience,angle,hook_idea,pillar,format,series,priority,freshness) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(user_id,title,angle) DO NOTHING RETURNING *',[randomUUID(),userId,i.title,i.category,i.audience,i.angle,i.hookIdea,i.pillar,i.format,i.series,i.priority,i.freshness]);
        if (r.rows[0]) added.push(idea(r.rows[0]));
      }
      return added;
    });
  }
  async listIdeas(userId: string, unusedOnly = true): Promise<Idea[]> {
    const r = await this.db.query<IdeaRow>('SELECT * FROM content_ideas WHERE user_id=$1 AND ($2=false OR used=false) ORDER BY priority DESC,created_at,id',[userId,unusedOnly]); return r.rows.map(idea);
  }
  async claimIdea(userId: string, ideaId: string): Promise<boolean> {
    return (await this.db.query('UPDATE content_ideas SET used=true WHERE user_id=$1 AND id=$2 AND used=false',[userId,ideaId])).rowCount === 1;
  }
  async createPost(userId: string, scheduledAt: string, ideaId: string|null, slotKey: string): Promise<Post> {
    return this.db.transaction(async tx => {
      const id = randomUUID();
      await tx.query('INSERT INTO post_drafts(id,user_id,idea_id,scheduled_at) VALUES($1,$2,$3,$4)',[id,userId,ideaId,validDate(scheduledAt)]);
      const slot = await tx.query<{post_id:string}>('INSERT INTO content_calendar(id,user_id,post_id,slot_key,scheduled_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,slot_key) DO NOTHING RETURNING post_id',[randomUUID(),userId,id,slotKey,scheduledAt]);
      if (!slot.rowCount) await tx.query('DELETE FROM post_drafts WHERE user_id=$1 AND id=$2',[userId,id]);
      const r = await tx.query<PostRow>('SELECT p.* FROM post_drafts p JOIN content_calendar c ON c.user_id=p.user_id AND c.post_id=p.id WHERE c.user_id=$1 AND c.slot_key=$2',[userId,slotKey]);
      return post(r.rows[0]!);
    });
  }
  async getPost(userId: string, postId: string): Promise<Post|null> { return this.readPost(this.db,userId,postId); }
  private async readPost(tx: Queryable,userId:string,postId:string,lock=false): Promise<Post|null> {
    const r = await tx.query<PostRow>(`SELECT * FROM post_drafts WHERE user_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[userId,postId]); return r.rows[0] ? post(r.rows[0]) : null;
  }
  private async requirePost(tx: Queryable,userId:string,postId:string,expectedVersion?:number): Promise<Post> {
    const p = await this.readPost(tx,userId,postId,true);
    if (!p) throw new ConflictError('Gönderi bulunamadı.');
    if (expectedVersion !== undefined && p.currentVersion !== expectedVersion) throw new ConflictError('Bu taslak eski sürüm. Lütfen son taslak üzerinden işlem yapın.');
    return p;
  }
  async listPosts(userId:string,limit=100): Promise<Post[]> {
    const r = await this.db.query<PostRow>('SELECT * FROM post_drafts WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT $2',[userId,limit]); return r.rows.map(post);
  }
  async getVersion(userId:string,postId:string,v:number): Promise<Version|null> {
    const r = await this.db.query<VersionRow>('SELECT * FROM post_versions WHERE user_id=$1 AND post_id=$2 AND version=$3',[userId,postId,v]); return r.rows[0]?version(r.rows[0]):null;
  }
  async latestVersion(userId:string,postId:string): Promise<Version|null> {
    const r = await this.db.query<VersionRow>('SELECT v.* FROM post_versions v JOIN post_drafts p ON p.user_id=v.user_id AND p.id=v.post_id AND p.current_version=v.version WHERE p.user_id=$1 AND p.id=$2',[userId,postId]); return r.rows[0]?version(r.rows[0]):null;
  }
  async history(userId:string,limit=100): Promise<Version[]> {
    const r = await this.db.query<VersionRow>("SELECT v.* FROM post_versions v JOIN post_drafts p ON p.user_id=v.user_id AND p.id=v.post_id AND p.current_version=v.version WHERE v.user_id=$1 AND p.status<>'cancelled' ORDER BY v.created_at DESC,v.id LIMIT $2",[userId,limit]); return r.rows.map(version);
  }
  async saveDraft(userId:string,postId:string,expectedVersion:number,content:DraftContent,instruction:string|null=null): Promise<Version> {
    const text = content.blocks.map(b=>b.text).join('\n\n');
    if (!text.trim() || text.length>3000 || new Set(content.blocks.map(b=>b.id)).size!==content.blocks.length) throw new ConflictError('Taslak metni geçersiz veya LinkedIn sınırını aşıyor.');
    return this.db.transaction(async tx => {
      const p = await this.requirePost(tx,userId,postId,expectedVersion);
      assertTransition(p.status,'waiting_approval');
      if (!['idea','draft','waiting_approval','revision_requested'].includes(p.status)) throw new ConflictError('Bu durumda revizyon yapılamaz.');
      const next = expectedVersion+1;
      const fingerprint = createHash('sha256').update(text.toLocaleLowerCase('tr').replace(/\s+/g,' ').trim()).digest('hex');
      const r = await tx.query<VersionRow>('INSERT INTO post_versions(id,user_id,post_id,version,content,text,fingerprint,instruction) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[randomUUID(),userId,postId,next,JSON.stringify(content),text,fingerprint,instruction]);
      await tx.query("UPDATE post_drafts SET current_version=$3,approved_version=NULL,status='waiting_approval',failure=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[userId,postId,next]);
      return version(r.rows[0]!);
    });
  }
  async approve(userId:string,postId:string,v:number,telegramUpdateId:string): Promise<Post> {
    return this.db.transaction(async tx => {
      const p = await this.requirePost(tx,userId,postId,v);
      const prior = await tx.query<{post_id:string;version:number}>('SELECT post_id,version FROM approvals WHERE user_id=$1 AND telegram_update_id=$2',[userId,telegramUpdateId]);
      if (prior.rows[0]) {
        if (prior.rows[0].post_id!==postId || prior.rows[0].version!==v) throw new ConflictError('Onay işlemi farklı bir taslak için kullanılmış.');
        return p;
      }
      assertTransition(p.status,'approved');
      if (p.status!=='waiting_approval') throw new ConflictError('Yalnız onay bekleyen taslak onaylanabilir.');
      await tx.query('INSERT INTO approvals(id,user_id,post_id,version,telegram_update_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),userId,postId,v,telegramUpdateId]);
      await tx.query("UPDATE post_drafts SET approved_version=$3,status='approved',updated_at=now() WHERE user_id=$1 AND id=$2",[userId,postId,v]);
      await this.addJob(tx,userId,'publish',{postId,version:v},p.scheduledAt,`publish:${postId}:${v}:approval:${telegramUpdateId}`);
      return (await this.readPost(tx,userId,postId))!;
    });
  }
  async cancel(userId:string,postId:string,expectedVersion:number): Promise<Post> {
    return this.db.transaction(async tx => {
      const p = await this.requirePost(tx,userId,postId,expectedVersion); assertTransition(p.status,'cancelled');
      await tx.query("UPDATE post_drafts SET status='cancelled',approved_version=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[userId,postId]);
      return (await this.readPost(tx,userId,postId))!;
    });
  }
  async postpone(userId:string,postId:string,expectedVersion:number,scheduledAt:string): Promise<Post> {
    validDate(scheduledAt);
    if (Date.parse(scheduledAt)<=Date.now()) throw new ConflictError('Erteleme zamanı gelecekte olmalıdır.');
    return this.db.transaction(async tx => {
      const p = await this.requirePost(tx,userId,postId,expectedVersion); assertTransition(p.status,'postponed');
      await tx.query("UPDATE post_drafts SET status='postponed',approved_version=NULL,scheduled_at=$3,updated_at=now() WHERE user_id=$1 AND id=$2",[userId,postId,scheduledAt]);
      await tx.query('UPDATE content_calendar SET scheduled_at=$3 WHERE user_id=$1 AND post_id=$2',[userId,postId,scheduledAt]);
      await this.addJob(tx,userId,'resume',{postId,scheduledAt},scheduledAt,`resume:${postId}:${scheduledAt}`);
      return (await this.readPost(tx,userId,postId))!;
    });
  }
  async resumePost(userId:string,postId:string,scheduledAt?:string): Promise<Post|null> {
    return this.db.transaction(async tx => {
      const p = await this.requirePost(tx,userId,postId);
      if (p.status!=='postponed' || Date.parse(p.scheduledAt)>Date.now() || (scheduledAt && iso(scheduledAt)!==p.scheduledAt)) return null;
      assertTransition(p.status,'waiting_approval');
      await tx.query("UPDATE post_drafts SET status='waiting_approval',updated_at=now() WHERE user_id=$1 AND id=$2",[userId,postId]);
      return (await this.readPost(tx,userId,postId))!;
    });
  }
  async beginPublish(userId:string,postId:string,v:number): Promise<{post:Post;version:Version;attemptId:string}|null> {
    return this.db.transaction(async tx => {
      const p = await this.readPost(tx,userId,postId,true);
      if (!p || p.status!=='approved' || p.currentVersion!==v || p.approvedVersion!==v || Date.parse(p.scheduledAt)>Date.now()) return null;
      const approved = await tx.query('SELECT 1 FROM approvals WHERE user_id=$1 AND post_id=$2 AND version=$3',[userId,postId,v]);
      if (!approved.rowCount) return null;
      const r = await tx.query<VersionRow>('SELECT * FROM post_versions WHERE user_id=$1 AND post_id=$2 AND version=$3',[userId,postId,v]);
      if (!r.rows[0]) throw new ConflictError('Onaylı sürüm bulunamadı.');
      const attemptId = randomUUID();
      await tx.query("INSERT INTO publish_attempts(id,user_id,post_id,version,outcome) VALUES($1,$2,$3,$4,'started')",[attemptId,userId,postId,v]);
      await tx.query("UPDATE post_drafts SET status='publishing',failure=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[userId,postId]);
      return {post:{...p,status:'publishing'},version:version(r.rows[0]),attemptId};
    });
  }
  async completePublish(userId:string,postId:string,attemptId:string,result:PublishResult): Promise<void> {
    await this.db.transaction(async tx => {
      const p = await this.requirePost(tx,userId,postId);
      const attempt = await tx.query<{outcome:string;version:number}>('SELECT outcome,version FROM publish_attempts WHERE user_id=$1 AND post_id=$2 AND id=$3 FOR UPDATE',[userId,postId,attemptId]);
      if (p.status==='published' && attempt.rows[0]?.outcome==='succeeded') return;
      if (p.status!=='publishing' || attempt.rows[0]?.outcome!=='started' || attempt.rows[0].version!==p.approvedVersion) throw new ConflictError('Yayın sonucu eski veya belirsiz bir denemeye ait.');
      assertTransition(p.status,'published');
      await tx.query('INSERT INTO published_posts(id,user_id,post_id,version,linkedin_urn,url) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),userId,postId,p.approvedVersion,result.urn,result.url]);
      await tx.query("UPDATE publish_attempts SET outcome='succeeded',finished_at=now() WHERE user_id=$1 AND id=$2",[userId,attemptId]);
      await tx.query("UPDATE post_drafts SET status='published',failure=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[userId,postId]);
      await this.addOutbox(tx,userId,`✅ LinkedIn gönderisi yayınlandı.\n\nGönderi URL:\n${result.url}`,[],null,null,`published:${postId}`);
    });
  }
  async failPublish(userId:string,postId:string,attemptId:string,reason:string,uncertain:boolean,retryAt?:string): Promise<void> {
    await this.db.transaction(async tx => {
      const p = await this.requirePost(tx,userId,postId);
      const a = await tx.query<{outcome:string}>('SELECT outcome FROM publish_attempts WHERE user_id=$1 AND post_id=$2 AND id=$3 FOR UPDATE',[userId,postId,attemptId]);
      if (p.status!=='publishing' || a.rows[0]?.outcome!=='started') return;
      const count = await tx.query<{n:string}>('SELECT count(*)::text AS n FROM publish_attempts WHERE user_id=$1 AND post_id=$2',[userId,postId]);
      const retry = !uncertain && retryAt && Number(count.rows[0]!.n)<3;
      const status = uncertain?'publish_uncertain':retry?'approved':'failed';
      assertTransition(p.status,status);
      await tx.query('UPDATE publish_attempts SET outcome=$3,reason=$4,finished_at=now() WHERE user_id=$1 AND id=$2',[userId,attemptId,uncertain?'uncertain':'definite_failure',reason]);
      await tx.query('UPDATE post_drafts SET status=$3,failure=$4,updated_at=now() WHERE user_id=$1 AND id=$2',[userId,postId,status,reason]);
      if (retry) await this.addJob(tx,userId,'publish',{postId,version:p.approvedVersion},validDate(retryAt!),`publish:${postId}:${p.approvedVersion}:retry:${attemptId}`);
      const text = uncertain ? `⚠️ LinkedIn paylaşımının sonucu belirsiz. Aynı gönderinin iki kez yayınlanmasını önlemek için tekrar deneme durduruldu. LinkedIn hesabınızı kontrol edip yönetim API'si üzerinden uzlaştırın.\nSebep: ${reason}` : `❌ LinkedIn paylaşımı başarısız oldu.\nSebep: ${reason}${retry?'\nGüvenli tekrar deneme planlandı.':''}`;
      const buttons: TelegramButton[][] = !uncertain && !retry ? [[{text:'Tekrar dene',callback_data:`retry:${postId}:${p.currentVersion}`}]] : [];
      await this.addOutbox(tx,userId,text,buttons,postId,p.currentVersion,`publish-error:${attemptId}`);
    });
  }
  async retryPublish(userId:string,postId:string,v:number): Promise<Post> {
    return this.db.transaction(async tx => {
      const p = await this.requirePost(tx,userId,postId,v);
      if (p.status!=='failed' || p.approvedVersion!==v) throw new ConflictError('Bu gönderi güvenli tekrar denemeye uygun değil.');
      const approval = await tx.query('SELECT 1 FROM approvals WHERE user_id=$1 AND post_id=$2 AND version=$3',[userId,postId,v]);
      if (!approval.rowCount) throw new ConflictError('Bu sürüm için insan onayı bulunamadı.');
      await tx.query("UPDATE post_drafts SET status='approved',failure=NULL,updated_at=now() WHERE user_id=$1 AND id=$2",[userId,postId]);
      await this.addJob(tx,userId,'publish',{postId,version:v},now(),`publish:${postId}:${v}:manual-retry:${randomUUID()}`);
      return (await this.readPost(tx,userId,postId))!;
    });
  }
  async recoverStalePublishing(beforeIso:string): Promise<number> {
    return this.db.transaction(async tx => {
      const r = await tx.query<PostRow>("SELECT * FROM post_drafts WHERE status='publishing' AND updated_at<$1 FOR UPDATE SKIP LOCKED",[validDate(beforeIso)]);
      for (const row of r.rows) {
        await tx.query("UPDATE post_drafts SET status='publish_uncertain',failure='Worker interrupted while publishing',updated_at=now() WHERE user_id=$1 AND id=$2",[row.user_id,row.id]);
        await tx.query("UPDATE publish_attempts SET outcome='uncertain',reason='Worker interrupted while publishing',finished_at=now() WHERE user_id=$1 AND post_id=$2 AND outcome='started'",[row.user_id,row.id]);
        await this.addOutbox(tx,row.user_id,'⚠️ Yayın sırasında worker kesildi. LinkedIn sonucu belirsiz; otomatik tekrar deneme engellendi. LinkedIn hesabınızı kontrol ederek gönderiyi uzlaştırın.',[],null,null,`publish-recovery:${row.id}`);
      }
      return r.rowCount;
    });
  }
  private async addJob(tx:Queryable,userId:string,type:string,payload:Record<string,unknown>,runAt:string,dedupeKey:string): Promise<void> {
    await tx.query('INSERT INTO jobs(id,user_id,type,payload,run_at,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,dedupe_key) DO NOTHING',[randomUUID(),userId,type,JSON.stringify(payload),validDate(runAt),dedupeKey]);
  }
  async enqueueJob(userId:string,type:string,payload:Record<string,unknown>,runAt:string,dedupeKey:string): Promise<void> { await this.addJob(this.db,userId,type,payload,runAt,dedupeKey); }
  async claimJobs(workerId:string,limit=10,leaseSeconds=120,userId?:string): Promise<Job[]> {
    return this.db.transaction(async tx => {
      // One active business operation per tenant. Locking users fences claims across worker processes.
      const tenants = await tx.query<{id:string}>(`SELECT u.id FROM users u
        WHERE ($1::uuid IS NULL OR u.id=$1)
          AND EXISTS(SELECT 1 FROM jobs j WHERE j.user_id=u.id AND ((j.status='pending' AND j.run_at<=now()) OR (j.status='running' AND j.locked_until<now())))
          AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.user_id=u.id AND j.status='running' AND j.locked_until>=now())
        ORDER BY u.created_at,u.id LIMIT $2 FOR UPDATE SKIP LOCKED`,[userId??null,Math.min(100,Math.max(1,limit))]);
      const jobs: Job[] = [];
      for (const tenant of tenants.rows) {
        // Fresh READ COMMITTED statement after acquiring the tenant lock closes snapshot/lock races.
        const active = await tx.query("SELECT 1 FROM jobs WHERE user_id=$1 AND status='running' AND locked_until>=now() LIMIT 1",[tenant.id]);
        if (active.rowCount) continue;
        const r = await tx.query<{id:string;user_id:string;type:string;payload:Record<string,unknown>;attempts:number;lease_token:string}>(`WITH ready AS (
          SELECT j.id FROM jobs j WHERE j.user_id=$1
            AND ((j.status='pending' AND j.run_at<=now()) OR (j.status='running' AND j.locked_until<now()))
            AND (j.type<>'telegram' OR NOT EXISTS(SELECT 1 FROM jobs earlier WHERE earlier.user_id=j.user_id AND earlier.type='telegram' AND earlier.status IN ('pending','running') AND earlier.queue_order<j.queue_order))
          ORDER BY CASE WHEN j.type='telegram' THEN 0 ELSE 1 END,j.run_at,j.queue_order LIMIT 1 FOR UPDATE SKIP LOCKED
        ) UPDATE jobs j SET status='running',attempts=attempts+1,locked_by=$2,lease_token=$3,
          locked_until=now()+($4::integer * interval '1 second'),updated_at=now()
          FROM ready WHERE j.id=ready.id RETURNING j.*`,[tenant.id,workerId,randomUUID(),Math.max(1,leaseSeconds)]);
        if (r.rows[0]) { const r0=r.rows[0]; jobs.push({id:r0.id,userId:r0.user_id,type:r0.type,payload:r0.payload,attempts:r0.attempts,leaseToken:r0.lease_token}); }
      }
      return jobs;
    });
  }
  async completeJob(id:string,leaseToken:string): Promise<boolean> {
    return (await this.db.query("UPDATE jobs SET status='done',lease_token=NULL,locked_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND locked_until>now()",[id,leaseToken])).rowCount===1;
  }
  async failJob(id:string,leaseToken:string,error:string,retryAt?:string): Promise<boolean> {
    return (await this.db.query("UPDATE jobs SET status=$3,run_at=$4,last_error=$5,lease_token=NULL,locked_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND locked_until>now()",[id,leaseToken,retryAt?'pending':'failed',retryAt?validDate(retryAt):now(),error])).rowCount===1;
  }
  private async addOutbox(tx:Queryable,userId:string,text:string,buttons:TelegramButton[][],postId:string|null,v:number|null,dedupeKey:string): Promise<void> {
    await tx.query('INSERT INTO outbox(id,user_id,text,buttons,post_id,version,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,dedupe_key) DO NOTHING',[randomUUID(),userId,text,JSON.stringify(buttons),postId,v,dedupeKey]);
  }
  async enqueueOutbox(userId:string,text:string,buttons:TelegramButton[][]=[],postId?:string,v?:number,dedupeKey:string=randomUUID()): Promise<void> {
    if ((postId===undefined)!==(v===undefined)) throw new ConflictError('Mesaj bağlamı gönderi ve sürüm gerektirir.');
    await this.addOutbox(this.db,userId,text,buttons,postId??null,v??null,dedupeKey);
  }
  async claimOutbox(workerId:string,limit=10,leaseSeconds=120,userId?:string): Promise<OutboxMessage[]> {
    const r = await this.db.query<{id:string;user_id:string;text:string;buttons:TelegramButton[][];post_id:string|null;version:number|null;attempts:number;lease_token:string}>(`WITH ready AS (
      SELECT id FROM outbox WHERE ($5::uuid IS NULL OR user_id=$5) AND ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<now()))
      ORDER BY run_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE outbox o SET status='running',attempts=attempts+1,locked_by=$2,lease_token=$3,locked_until=now()+($4::integer * interval '1 second'),updated_at=now()
    FROM ready WHERE o.id=ready.id RETURNING o.*`,[Math.min(100,Math.max(1,limit)),workerId,randomUUID(),Math.max(1,leaseSeconds),userId??null]);
    return r.rows.map(r=>({id:r.id,userId:r.user_id,text:r.text,buttons:r.buttons,postId:r.post_id,version:r.version,attempts:r.attempts,leaseToken:r.lease_token}));
  }
  async completeOutbox(id:string,leaseToken:string,messageId:number): Promise<boolean> {
    return this.db.transaction(async tx => {
      const r = await tx.query<{user_id:string;post_id:string|null;version:number|null}>("UPDATE outbox SET status='done',message_id=$3,lease_token=NULL,locked_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND locked_until>now() RETURNING user_id,post_id,version",[id,leaseToken,messageId]);
      const item = r.rows[0]; if (!item) return false;
      if (item.post_id && item.version!==null) {
        await tx.query('INSERT INTO telegram_messages(user_id,message_id,post_id,version) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,message_id) DO NOTHING',[item.user_id,messageId,item.post_id,item.version]);
        // Old notifications remain reply-addressable, but may not replace the current active version.
        await tx.query(`INSERT INTO telegram_sessions(user_id,post_id,version)
          SELECT user_id,id,current_version FROM post_drafts WHERE user_id=$1 AND id=$2 AND current_version=$3 AND status='waiting_approval'
          ON CONFLICT(user_id) DO UPDATE SET post_id=EXCLUDED.post_id,version=EXCLUDED.version,updated_at=now()`,[item.user_id,item.post_id,item.version]);
      }
      return true;
    });
  }
  async failOutbox(id:string,leaseToken:string,error:string,retryAt:string): Promise<boolean> {
    return (await this.db.query("UPDATE outbox SET status=CASE WHEN attempts>=10 THEN 'failed' ELSE 'pending' END,run_at=$3,last_error=$4,lease_token=NULL,locked_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND locked_until>now()",[id,leaseToken,validDate(retryAt),error])).rowCount===1;
  }
  async acceptTelegramUpdate(userId:string,updateId:string,payload:Record<string,unknown>): Promise<boolean> {
    return this.db.transaction(async tx => {
      const r = await tx.query('INSERT INTO telegram_inbox(user_id,update_id,payload) VALUES($1,$2,$3) ON CONFLICT(user_id,update_id) DO NOTHING',[userId,updateId,JSON.stringify(payload)]);
      if (!r.rowCount) return false;
      const record = (value:unknown):Record<string,unknown> => value!==null && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
      const callback=record(payload.callback_query); const message=record(payload.message);
      const callbackMessage=record(callback.message); const reply=record(message.reply_to_message);
      const messageId=callbackMessage.message_id ?? reply.message_id;
      let target:{postId:string;version:number}|null=null;
      if (messageId!==undefined) {
        const mapped=await tx.query<{post_id:string;version:number}>('SELECT post_id,version FROM telegram_messages WHERE user_id=$1 AND message_id=$2',[userId,messageId]);
        if (mapped.rows[0]) target={postId:mapped.rows[0].post_id,version:mapped.rows[0].version};
      } else {
        const active=await tx.query<{post_id:string;version:number}>("SELECT s.post_id,s.version FROM telegram_sessions s JOIN post_drafts p ON p.user_id=s.user_id AND p.id=s.post_id AND p.current_version=s.version WHERE s.user_id=$1 AND p.status IN ('waiting_approval','failed','postponed','approved')",[userId]);
        if (active.rows[0]) target={postId:active.rows[0].post_id,version:active.rows[0].version};
      }
      // Bind at receipt, not at execution: an old approval must never attach itself to a newer draft.
      await this.addJob(tx,userId,'telegram',{updateId,update:payload,target,targetCaptured:true},now(),`telegram:${updateId}`);
      return true;
    });
  }
  async recordInteraction(userId:string,postId:string|null,instruction:string): Promise<void> {
    await this.db.query('INSERT INTO telegram_interactions(id,user_id,post_id,instruction) VALUES($1,$2,$3,$4)',[randomUUID(),userId,postId,instruction]);
  }
  async conversation(userId:string,postId:string,limit=12): Promise<string[]> {
    const r = await this.db.query<{instruction:string}>('SELECT instruction FROM telegram_interactions WHERE user_id=$1 AND post_id=$2 ORDER BY created_at DESC,id LIMIT $3',[userId,postId,limit]); return r.rows.map(r=>r.instruction).reverse();
  }
  async resolveMessage(userId:string,messageId:number): Promise<{postId:string;version:number}|null> {
    const r = await this.db.query<{post_id:string;version:number}>('SELECT post_id,version FROM telegram_messages WHERE user_id=$1 AND message_id=$2',[userId,messageId]); return r.rows[0]?{postId:r.rows[0].post_id,version:r.rows[0].version}:null;
  }
  async activeDraft(userId:string): Promise<{postId:string;version:number}|null> {
    const r = await this.db.query<{post_id:string;version:number}>("SELECT s.post_id,s.version FROM telegram_sessions s JOIN post_drafts p ON p.user_id=s.user_id AND p.id=s.post_id AND p.current_version=s.version WHERE s.user_id=$1 AND p.status IN ('waiting_approval','failed','postponed','approved')",[userId]);
    return r.rows[0]?{postId:r.rows[0].post_id,version:r.rows[0].version}:null;
  }
}
