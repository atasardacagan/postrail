import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGliteDatabase } from '../src/db/pglite.js';
import { migrate } from '../src/db/migrate.js';
import { Repository } from '../src/db/repository.js';
import type { DraftContent } from '../src/core/types.js';

const content: DraftContent = {
  blocks:[{id:'hook',kind:'hook',text:'Web siteniz ziyaretçiye sıradaki adımı söylüyor mu?'},{id:'body',kind:'body',text:'Bir landing page tasarlarken ziyaretçinin çözmek istediği problemi görünür kılın. Formdaki her alanın amacını sorgulayın.'},{id:'cta',kind:'cta',text:'Sizin sitenizde en belirsiz adım hangisi?'}],
  topic:'Landing page netliği',category:'CRO',audience:'KOBİ sahipleri',format:'educational',pillar:'education',series:null,sourceIds:[],
  scores:{hook:85,value:85,originality:85,readability:90,brandFit:90,leadPotential:70,authenticity:90,overall:87},
};
let db:PGliteDatabase; let repo:Repository; let user:string; let other:string;
async function draft(slot:string=randomUUID()) {
  const p=await repo.createPost(user,new Date(Date.now()-60_000).toISOString(),null,slot);
  await repo.saveDraft(user,p.id,0,structuredClone(content));
  return p;
}
beforeAll(async()=>{ db=new PGliteDatabase(); await migrate(db); repo=new Repository(db); user=await repo.ensureUser('100'); other=await repo.ensureUser('200'); },30_000);
afterAll(async()=>{ await db?.close(); });

describe('Database invariants and tenant isolation',()=>{
  it('migration is repeatable and users retain IDs',async()=>{ await migrate(db); expect(await repo.ensureUser('100')).toBe(user); });
  it('calendar slots are unique and idempotent',async()=>{
    const a=await draft('calendar-test'); const b=await repo.createPost(user,new Date().toISOString(),null,'calendar-test');
    expect(b.id).toBe(a.id); expect(b.currentVersion).toBe(1);
    const c=await repo.createPost(other,new Date().toISOString(),null,'calendar-test'); expect(c.id).not.toBe(a.id);
  });
  it('blocks cross-tenant read, write and foreign-key ownership',async()=>{
    const p=await draft(); expect(await repo.getPost(other,p.id)).toBeNull(); expect(await repo.latestVersion(other,p.id)).toBeNull();
    await expect(repo.saveDraft(other,p.id,1,content)).rejects.toThrow('bulunamadı');
    await expect(repo.approve(other,p.id,1,'bad')).rejects.toThrow('bulunamadı');
    await expect(db.query('INSERT INTO post_versions(id,user_id,post_id,version,content,text,fingerprint) VALUES($1,$2,$3,1,$4,$5,$6)',[randomUUID(),other,p.id,JSON.stringify(content),'x','x'])).rejects.toThrow();
  });
  it('version rows are immutable and stale edits fail',async()=>{
    const p=await draft(); const first=await repo.getVersion(user,p.id,1);
    await expect(db.query('UPDATE post_versions SET text=$1 WHERE id=$2',['tampered',first!.id])).rejects.toThrow('Immutable');
    await repo.saveDraft(user,p.id,1,{...content,blocks:content.blocks.slice(0,2)},'CTA çıkar');
    await expect(repo.saveDraft(user,p.id,1,content,'stale')).rejects.toThrow('eski sürüm');
    expect((await repo.getVersion(user,p.id,1))!.text).toContain('Sizin sitenizde');
    expect((await repo.latestVersion(user,p.id))!.text).not.toContain('Sizin sitenizde');
  });
  it('enforces current approved version even on direct database write',async()=>{
    const p=await draft(); await repo.saveDraft(user,p.id,1,content);
    await expect(db.query("UPDATE post_drafts SET status='approved',approved_version=1 WHERE user_id=$1 AND id=$2",[user,p.id])).rejects.toThrow();
    await expect(db.query("UPDATE post_drafts SET status='approved' WHERE user_id=$1 AND id=$2",[user,p.id])).rejects.toThrow();
  });
});

describe('Approval and publish transaction safety',()=>{
  it('cannot publish without explicit approval; publishes only current approved version',async()=>{
    const p=await draft(); expect(await repo.beginPublish(user,p.id,1)).toBeNull();
    await repo.saveDraft(user,p.id,1,{...content,blocks:content.blocks.slice(0,2)},'CTA çıkar');
    await expect(repo.approve(user,p.id,1,'old')).rejects.toThrow('eski sürüm');
    await repo.approve(user,p.id,2,randomUUID());
    expect(await repo.beginPublish(user,p.id,1)).toBeNull();
    const started=await repo.beginPublish(user,p.id,2); expect(started?.version.text).not.toContain('Sizin sitenizde');
    expect(await repo.beginPublish(user,p.id,2)).toBeNull();
    await repo.completePublish(user,p.id,started!.attemptId,{urn:`urn:li:share:${randomUUID()}`,url:'https://www.linkedin.com/feed/update/example'});
    await repo.completePublish(user,p.id,started!.attemptId,{urn:'ignored',url:'ignored'});
    expect((await repo.getPost(user,p.id))?.status).toBe('published');
    const count=await db.query<{n:number}>('SELECT count(*)::integer n FROM published_posts WHERE user_id=$1 AND post_id=$2',[user,p.id]); expect(count.rows[0]!.n).toBe(1);
    const notice=await db.query('SELECT 1 FROM outbox WHERE user_id=$1 AND dedupe_key=$2',[user,`published:${p.id}`]); expect(notice.rowCount).toBe(1);
  });
  it('cannot forge approval by changing only post state',async()=>{
    const p=await draft(); await db.query("UPDATE post_drafts SET status='approved',approved_version=1 WHERE user_id=$1 AND id=$2",[user,p.id]);
    expect(await repo.beginPublish(user,p.id,1)).toBeNull();
  });
  it('duplicate approval creates a single job and cannot revive cancelled post',async()=>{
    const p=await draft(); const update=randomUUID(); await repo.approve(user,p.id,1,update); await repo.approve(user,p.id,1,update);
    const count=await db.query<{n:number}>('SELECT count(*)::integer n FROM jobs WHERE user_id=$1 AND dedupe_key=$2',[user,`publish:${p.id}:1:approval:${update}`]); expect(count.rows[0]!.n).toBe(1);
    await repo.cancel(user,p.id,1); await repo.approve(user,p.id,1,update); expect((await repo.getPost(user,p.id))?.status).toBe('cancelled'); expect(await repo.beginPublish(user,p.id,1)).toBeNull();
  });
  it('postponement invalidates approval and stale schedule cannot resume',async()=>{
    const p=await draft(); await repo.approve(user,p.id,1,randomUUID());
    const future=new Date(Date.now()+3_600_000).toISOString(); await repo.postpone(user,p.id,1,future);
    expect((await repo.getPost(user,p.id))?.approvedVersion).toBeNull();
    expect(await repo.beginPublish(user,p.id,1)).toBeNull(); expect(await repo.resumePost(user,p.id,future)).toBeNull();
    await db.query('UPDATE post_drafts SET scheduled_at=$3 WHERE user_id=$1 AND id=$2',[user,p.id,new Date(Date.now()-60_000).toISOString()]);
    expect(await repo.resumePost(user,p.id,future)).toBeNull();
    expect((await repo.resumePost(user,p.id))?.status).toBe('waiting_approval');
    expect(await repo.beginPublish(user,p.id,1)).toBeNull();
  });
  it('definite failures preserve approved content and allow explicit safe retry',async()=>{
    const p=await draft(); await repo.approve(user,p.id,1,randomUUID()); const a=(await repo.beginPublish(user,p.id,1))!;
    await repo.failPublish(user,p.id,a.attemptId,'Rate limit',false);
    expect((await repo.getPost(user,p.id))?.status).toBe('failed');
    await repo.retryPublish(user,p.id,1); const b=(await repo.beginPublish(user,p.id,1))!; expect(b.version.id).toBe(a.version.id);
    expect(b.attemptId).not.toBe(a.attemptId);
    await repo.failPublish(user,p.id,b.attemptId,'Rejected',false);
  });
  it('timeout permanently blocks automatic or manual retry and retains immutable content',async()=>{
    const p=await draft(); await repo.approve(user,p.id,1,randomUUID()); const a=(await repo.beginPublish(user,p.id,1))!;
    await repo.failPublish(user,p.id,a.attemptId,'Socket timeout',true,new Date().toISOString());
    expect((await repo.getPost(user,p.id))?.status).toBe('publish_uncertain'); expect(await repo.beginPublish(user,p.id,1)).toBeNull();
    await expect(repo.retryPublish(user,p.id,1)).rejects.toThrow('uygun değil');
  });
  it('crashed worker recovery never republishes',async()=>{
    const p=await draft(); await repo.approve(user,p.id,1,randomUUID()); await repo.beginPublish(user,p.id,1);
    await db.query("UPDATE post_drafts SET updated_at=now()-interval '1 hour' WHERE user_id=$1 AND id=$2",[user,p.id]);
    expect(await repo.recoverStalePublishing(new Date(Date.now()-600_000).toISOString())).toBeGreaterThan(0);
    expect((await repo.getPost(user,p.id))?.status).toBe('publish_uncertain'); expect(await repo.beginPublish(user,p.id,1)).toBeNull();
  });
});

describe('Durable inbox, jobs and notification fencing',()=>{
  it('deduplicates Telegram updates and atomically creates job',async()=>{
    const update=randomUUID(); expect(await repo.acceptTelegramUpdate(user,update,{message:{text:'onayla'}})).toBe(true);
    expect(await repo.acceptTelegramUpdate(user,update,{message:{text:'onayla'}})).toBe(false);
    const r=await db.query<{payload:Record<string,unknown>}>('SELECT payload FROM jobs WHERE user_id=$1 AND dedupe_key=$2',[user,`telegram:${update}`]); expect(r.rowCount).toBe(1); expect(r.rows[0]!.payload.update).toEqual({message:{text:'onayla'}});
  });
  it('stale worker cannot acknowledge a reclaimed job',async()=>{
    await db.query("UPDATE jobs SET status='done'"); await repo.enqueueJob(user,'test',{hello:'world'},new Date().toISOString(),randomUUID());
    const first=(await repo.claimJobs('first',1,120))[0]!;
    await db.query("UPDATE jobs SET locked_until=now()-interval '1 second' WHERE id=$1",[first.id]);
    const second=(await repo.claimJobs('second',1,120))[0]!; expect(second.id).toBe(first.id); expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(await repo.completeJob(first.id,first.leaseToken)).toBe(false);
    expect(await repo.failJob(first.id,first.leaseToken,'late',new Date().toISOString())).toBe(false);
    expect(await repo.completeJob(second.id,second.leaseToken)).toBe(true);
  });
  it('outbox acknowledgement records tenant-scoped reply context and stale versions cannot approve',async()=>{
    await db.query("UPDATE outbox SET status='done'"); const p=await draft();
    await repo.enqueueOutbox(user,'Taslak',[],p.id,1,`draft:${p.id}:1`); await repo.enqueueOutbox(user,'duplicate',[],p.id,1,`draft:${p.id}:1`);
    const messages=await repo.claimOutbox('sender'); expect(messages).toHaveLength(1);
    expect(await repo.completeOutbox(messages[0]!.id,messages[0]!.leaseToken,12345)).toBe(true);
    expect(await repo.resolveMessage(user,12345)).toEqual({postId:p.id,version:1}); expect(await repo.resolveMessage(other,12345)).toBeNull();
    expect(await repo.activeDraft(user)).toEqual({postId:p.id,version:1});
    await repo.saveDraft(user,p.id,1,content); expect(await repo.activeDraft(user)).toBeNull();
    await expect(repo.approve(user,p.id,1,randomUUID())).rejects.toThrow('eski sürüm');
  });
});

describe('Receipt-time approval binding and multi-worker ordering',()=>{
  async function visibleDraft() {
    await db.query("UPDATE outbox SET status='done'");
    const p=await draft(); await repo.enqueueOutbox(user,'Taslak',[],p.id,1,`visible:${p.id}`);
    const msg=(await repo.claimOutbox('notifier',1,120,user))[0]!;
    const messageId=Math.floor(Math.random()*1_000_000)+20_000;
    await repo.completeOutbox(msg.id,msg.leaseToken,messageId); return {p,messageId};
  }
  it('freezes an unqualified approval to the version visible at receipt',async()=>{
    const {p}=await visibleDraft(); const update=randomUUID(); await repo.acceptTelegramUpdate(user,update,{message:{text:'onayla'}});
    await repo.saveDraft(user,p.id,1,{...content,blocks:content.blocks.slice(0,2)});
    const stored=await db.query<{payload:{targetCaptured:boolean;target:{postId:string;version:number}}}>('SELECT payload FROM jobs WHERE user_id=$1 AND dedupe_key=$2',[user,`telegram:${update}`]);
    expect(stored.rows[0]!.payload).toMatchObject({targetCaptured:true,target:{postId:p.id,version:1}});
    await expect(repo.approve(user,p.id,stored.rows[0]!.payload.target.version,update)).rejects.toThrow('eski sürüm');
  });
  it('captures a missing target as null so queued approval cannot bind a future post',async()=>{
    await db.query('DELETE FROM telegram_sessions WHERE user_id=$1',[user]);
    const update=randomUUID(); await repo.acceptTelegramUpdate(user,update,{message:{text:'onayla'}});
    await visibleDraft();
    const stored=await db.query<{payload:unknown}>('SELECT payload FROM jobs WHERE user_id=$1 AND dedupe_key=$2',[user,`telegram:${update}`]);
    expect(stored.rows[0]!.payload).toMatchObject({targetCaptured:true,target:null});
  });
  it('resolves reply context at receipt and never substitutes another tenant or active post',async()=>{
    const {p,messageId}=await visibleDraft(); await visibleDraft(); const update=randomUUID();
    await repo.acceptTelegramUpdate(user,update,{message:{text:'onayla',reply_to_message:{message_id:messageId}}});
    const stored=await db.query<{payload:unknown}>('SELECT payload FROM jobs WHERE user_id=$1 AND dedupe_key=$2',[user,`telegram:${update}`]);
    expect(stored.rows[0]!.payload).toMatchObject({target:{postId:p.id,version:1},targetCaptured:true});
    const wrong=randomUUID(); await repo.acceptTelegramUpdate(other,wrong,{message:{text:'onayla',reply_to_message:{message_id:messageId}}});
    const wrongStored=await db.query<{payload:unknown}>('SELECT payload FROM jobs WHERE user_id=$1 AND dedupe_key=$2',[other,`telegram:${wrong}`]);
    expect(wrongStored.rows[0]!.payload).toMatchObject({target:null,targetCaptured:true});
  });
  it('only one worker may run a tenant business job while another tenant progresses',async()=>{
    await db.query("UPDATE jobs SET status='done'");
    await repo.enqueueJob(user,'test',{},new Date().toISOString(),randomUUID()); await repo.enqueueJob(user,'test',{},new Date().toISOString(),randomUUID());
    await repo.enqueueJob(other,'test',{},new Date().toISOString(),randomUUID());
    const simultaneous=await Promise.all([repo.claimJobs('one',10,120,user),repo.claimJobs('two',10,120,user)]);
    expect(simultaneous.flat()).toHaveLength(1);
    const active=simultaneous.flat()[0]!;
    const foreign=(await repo.claimJobs('other-tenant',10,120,other))[0]!; expect(foreign.userId).toBe(other);
    expect(await repo.claimJobs('third',1,120,user)).toHaveLength(0);
    await repo.completeJob(active.id,active.leaseToken); expect(await repo.claimJobs('next',1,120,user)).toHaveLength(1);
    await db.query("UPDATE jobs SET status='done'");
  });
  it('later Telegram command waits for earlier retry even while unrelated jobs can run',async()=>{
    await db.query("UPDATE jobs SET status='done'");
    await repo.enqueueJob(user,'telegram',{order:1},new Date().toISOString(),randomUUID());
    await repo.enqueueJob(user,'telegram',{order:2},new Date().toISOString(),randomUUID());
    await repo.enqueueJob(user,'backlog',{},new Date().toISOString(),randomUUID());
    const first=(await repo.claimJobs('a',1,120,user))[0]!; expect(first.payload.order).toBe(1);
    await repo.failJob(first.id,first.leaseToken,'retry',new Date(Date.now()+60_000).toISOString());
    const backlog=(await repo.claimJobs('b',1,120,user))[0]!; expect(backlog.type).toBe('backlog'); await repo.completeJob(backlog.id,backlog.leaseToken);
    expect(await repo.claimJobs('c',1,120,user)).toHaveLength(0);
    await db.query("UPDATE jobs SET run_at=now()-interval '1 second' WHERE id=$1",[first.id]);
    const retry=(await repo.claimJobs('d',1,120,user))[0]!; expect(retry.id).toBe(first.id); await repo.completeJob(retry.id,retry.leaseToken);
    const second=(await repo.claimJobs('e',1,120,user))[0]!; expect(second.payload.order).toBe(2); await repo.completeJob(second.id,second.leaseToken);
  });
  it('tenant-filtered outbox claims leave other users notifications untouched',async()=>{
    await db.query("UPDATE outbox SET status='done'"); await repo.enqueueOutbox(other,'Other tenant'); await repo.enqueueOutbox(user,'Our tenant');
    const ours=await repo.claimOutbox('ours',10,120,user); expect(ours).toHaveLength(1); expect(ours[0]!.text).toBe('Our tenant');
    const foreign=await repo.claimOutbox('foreign',10,120,other); expect(foreign).toHaveLength(1); expect(foreign[0]!.text).toBe('Other tenant');
    await db.query("UPDATE outbox SET status='done'");
  });
});

describe('Reschedule and bounded retry regressions',()=>{
  it('new approval after postponement creates a new job for the same immutable version',async()=>{
    const p=await draft(); await repo.approve(user,p.id,1,randomUUID());
    await repo.postpone(user,p.id,1,new Date(Date.now()+60_000).toISOString());
    await db.query("UPDATE post_drafts SET scheduled_at=now()-interval '1 second' WHERE user_id=$1 AND id=$2",[user,p.id]);
    await repo.resumePost(user,p.id); const update=randomUUID(); await repo.approve(user,p.id,1,update);
    const jobs=await db.query<{n:number}>("SELECT count(*)::integer n FROM jobs WHERE user_id=$1 AND type='publish' AND payload->>'postId'=$2",[user,p.id]); expect(jobs.rows[0]!.n).toBe(2);
    expect(await repo.beginPublish(user,p.id,1)).not.toBeNull();
  });
  it('repeated definitive rate limits stop auto retry after three provider attempts',async()=>{
    const p=await draft(); await repo.approve(user,p.id,1,randomUUID());
    for (let n=1;n<=3;n++) {
      const started=(await repo.beginPublish(user,p.id,1))!; expect(started).not.toBeNull();
      await repo.failPublish(user,p.id,started.attemptId,'Rate limit',false,new Date(Date.now()+60_000).toISOString());
      expect((await repo.getPost(user,p.id))?.status).toBe(n===3?'failed':'approved');
    }
    expect(await repo.beginPublish(user,p.id,1)).toBeNull();
  });
  it('retry failure notification preserves button-to-version mapping',async()=>{
    await db.query("UPDATE outbox SET status='done'"); const p=await draft(); await repo.approve(user,p.id,1,randomUUID());
    const started=(await repo.beginPublish(user,p.id,1))!; await repo.failPublish(user,p.id,started.attemptId,'Access denied',false);
    const msg=(await repo.claimOutbox('notice',10,120,user))[0]!;
    expect(msg.postId).toBe(p.id); expect(msg.version).toBe(1); expect(msg.buttons[0]![0]!.callback_data).toBe(`retry:${p.id}:1`);
    await repo.completeOutbox(msg.id,msg.leaseToken,7654321); expect(await repo.resolveMessage(user,7654321)).toEqual({postId:p.id,version:1});
  });
  it('database lifecycle guard rejects reviving a cancelled post',async()=>{
    const p=await draft(); await repo.cancel(user,p.id,1);
    await expect(db.query("UPDATE post_drafts SET status='waiting_approval' WHERE user_id=$1 AND id=$2",[user,p.id])).rejects.toThrow('Invalid post lifecycle');
    await expect(db.query('UPDATE post_drafts SET current_version=0 WHERE user_id=$1 AND id=$2',[user,p.id])).rejects.toThrow('New version');
  });
});
