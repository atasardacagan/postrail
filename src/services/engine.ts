import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { Repository, ConflictError } from '../db/repository.js';
import type { Job } from '../db/repository.js';
import type { BrandMemory, ContentContext, ContentEngine, LinkedInPort, Logger, Settings, SourceFact, TelegramButton, TelegramPort, Version } from '../core/types.js';
import { defaultSettings } from '../core/config.js';
import { formatTime, looksLikePostpone, parsePostpone, reportSlots, slotsBetween } from '../core/schedule.js';
import { selectIdea, RevisionScopeError, ContentQualityError } from '../content/index.js';
import { AnalyticsError, type LinkedInAnalytics } from '../integrations/linkedin-analytics.js';
import { PublishError } from '../integrations/linkedin.js';
import { telegramUpdateSchema, type TelegramUpdate } from '../integrations/telegram.js';
import { patterns, recordMetrics, weeklyReport } from './analytics.js';

export interface EngineOptions { repo: Repository; content: ContentEngine; telegram: TelegramPort; linkedin: LinkedInPort; telegramUserId: string; logger: Logger; analytics?: LinkedInAnalytics; now?: () => Date }
export class BrandEngine {
  readonly repo: Repository; readonly workerId = randomUUID();
  private readonly now: () => Date;
  private userIdValue = '';
  constructor(private readonly options: EngineOptions) { this.repo = options.repo; this.now = options.now ?? (() => new Date()); }
  get userId(): string { if (!this.userIdValue) throw new Error('Engine henüz başlatılmadı'); return this.userIdValue; }
  async initialize(): Promise<void> {
    this.userIdValue = await this.repo.ensureUser(this.options.telegramUserId);
    if (!(await this.repo.getSettings(this.userId))) await this.repo.saveSettings(this.userId, defaultSettings(this.options.telegramUserId));
  }
  async settings(): Promise<Settings> { return (await this.repo.getSettings(this.userId))!; }
  async context(): Promise<ContentContext> {
    const [settings, history, memory, facts, learned] = await Promise.all([
      this.settings(), this.repo.history(this.userId, 200),
      this.repo.db.query<BrandMemory>('SELECT id,preference,count,enabled FROM brand_memory WHERE user_id=$1 AND enabled=true ORDER BY count DESC LIMIT 30', [this.userId]),
      this.repo.db.query<SourceFact>('SELECT id,url,text,verified,personal FROM source_facts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [this.userId]),
      patterns(this.repo.db, this.userId),
    ]);
    return { settings, history, memory: settings.memoryEnabled ? memory.rows : [], facts: facts.rows, patterns: learned };
  }
  async ensureBacklog(): Promise<void> {
    const existing = await this.repo.listIdeas(this.userId, false);
    const context = await this.context();
    const need = context.settings.backlogTarget - existing.filter(i => !i.used).length;
    if (need > 0) await this.repo.addIdeas(this.userId, await this.options.content.ideas(context, existing, need));
  }
  async tick(): Promise<void> {
    const now = this.now(); const settings = await this.settings();
    const from = DateTime.fromJSDate(now, { zone: settings.timezone }).startOf('day').toJSDate();
    // Today-only catch-up avoids flooding approval requests after a long outage.
    const to = DateTime.fromJSDate(now).plus({ days: 14 }).toJSDate();
    for (const slot of slotsBetween(from, to, settings)) {
      await this.repo.enqueueJob(this.userId, 'generate', { scheduledAt: slot.toISOString(), slotKey: `slot:${slot.toISOString()}` }, slot.toISOString(), `slot:${slot.toISOString()}`);
    }
    for (const slot of reportSlots(from, to, settings)) await this.repo.enqueueJob(this.userId, 'report', { at: slot.toISOString() }, slot.toISOString(), `report:${slot.toISOString()}`);
    const day = DateTime.fromJSDate(now, { zone: settings.timezone }).toISODate();
    await this.repo.enqueueJob(this.userId, 'backlog', {}, now.toISOString(), `backlog:${day}`);
    if (this.options.analytics) {
      const published = await this.repo.db.query<{ post_id: string; linkedin_urn: string }>("SELECT post_id,linkedin_urn FROM published_posts WHERE user_id=$1 AND published_at>now()-interval '30 days' ORDER BY published_at DESC LIMIT 30", [this.userId]);
      for (const post of published.rows) await this.repo.enqueueJob(this.userId, 'metrics', { postId: post.post_id, urn: post.linkedin_urn }, now.toISOString(), `metrics:${post.post_id}:${day}`);
    }
    await this.repo.recoverStalePublishing(new Date(now.getTime() - 10 * 60_000).toISOString());
    // Recover the gap between durable draft save and notification enqueue after process failure.
    for (const post of await this.repo.listPosts(this.userId, 100)) {
      if (post.status === 'waiting_approval') await this.sendDraft(post.id);
    }
  }
  private async sendDraft(postId: string): Promise<void> {
    const post = await this.repo.getPost(this.userId, postId);
    if (!post || post.status !== 'waiting_approval') return;
    const version = await this.repo.latestVersion(this.userId, postId); if (!version) return;
    const settings = await this.settings();
    const callback = (action: string) => `${action}:${post.id}:${version.version}`;
    const buttons: TelegramButton[][] = [
      [{ text: '✅ Onayla', callback_data: callback('approve') }, { text: '✏️ Revize Et', callback_data: callback('revise') }],
      [{ text: '🔄 Yeniden Yaz', callback_data: callback('rewrite') }, { text: '❌ İptal', callback_data: callback('cancel') }],
      [{ text: '⏰ Ertele', callback_data: callback('postpone') }],
    ];
    await this.repo.enqueueOutbox(this.userId, `📌 LinkedIn gönderisi hazır · v${version.version}\n\nKonu: ${version.content.topic}\n\n${version.text}\n\nPlanlanan yayın zamanı: ${formatTime(post.scheduledAt, settings.timezone)}\n\nBu sürüm açık onayınızı bekliyor. Revizyon için bu mesajı yanıtlayabilirsiniz.`, buttons, post.id, version.version, `draft:${post.id}:${version.version}:${post.scheduledAt}`);
  }
  authorized(update: TelegramUpdate): boolean {
    const actor = update.callback_query?.from ?? update.message?.from;
    const message = update.callback_query?.message ?? update.message;
    return !!actor && String(actor.id) === this.options.telegramUserId && message?.chat.type === 'private' && String(message.chat.id) === this.options.telegramUserId;
  }
  async receive(raw: unknown): Promise<boolean> {
    const parsed = telegramUpdateSchema.safeParse(raw);
    if (!parsed.success || !this.authorized(parsed.data)) return false;
    return this.repo.acceptTelegramUpdate(this.userId, String(parsed.data.update_id), parsed.data as unknown as Record<string, unknown>);
  }
  async runJobs(limit = 10): Promise<number> {
    let count = 0;
    // Claim one at a time: never let a long content request consume leases of untouched jobs.
    for (; count < limit; count++) {
      const job = (await this.repo.claimJobs(this.workerId, 1, 900, this.userId))[0]; if (!job) break;
      if (job.userId !== this.userId) { await this.repo.failJob(job.id, job.leaseToken, 'Tenant worker mismatch'); continue; }
      try {
        await this.handleJob(job);
        await this.repo.completeJob(job.id, job.leaseToken);
      } catch (error) {
        const conflict = error instanceof ConflictError;
        const editorial = error instanceof RevisionScopeError || error instanceof ContentQualityError;
        const message = conflict || error instanceof RevisionScopeError || error instanceof AnalyticsError ? error.message : 'İşlem tamamlanamadı; servis yapılandırmasını ve erişimini kontrol edin.';
        this.options.logger.error({ event: 'job_failed', jobId: job.id, type: job.type, conflict, ...(error instanceof AnalyticsError ? { provider: 'linkedin_analytics', kind: error.kind, status: error.status } : {}) });
        if (editorial) {
          const revision = job.type === 'telegram';
          const text = error instanceof RevisionScopeError ? `Revizyonu netleştirelim: ${error.message}` : revision
            ? 'İçerik kalite veya kaynak kontrolünü geçemedi. Mevcut sürüm korundu. Başka bir revizyon isteği yazabilir veya Yeniden Yaz seçeneğini kullanabilirsiniz.'
            : 'İlk içerik kalite veya kaynak kontrolünü geçemedi; onaya veya yayına gönderilmedi. Kaynakları/ayarları kontrol edip /v1/jobs üzerinden başarısız işi yeniden deneyebilirsiniz.';
          await this.repo.enqueueOutbox(this.userId, text, [], undefined, undefined, `editorial:${job.id}:${job.attempts}`);
          if (revision) await this.repo.completeJob(job.id, job.leaseToken);
          else {
            // The content engine already exhausted its bounded generation attempts. Keep the slot recoverable.
            await this.repo.failJob(job.id, job.leaseToken, 'İçerik kalite veya kaynak kontrolünü geçemedi');
            if (job.type === 'generate') await this.repo.db.query('UPDATE post_drafts p SET failure=$1 WHERE p.user_id=$2 AND p.current_version=0 AND EXISTS (SELECT 1 FROM content_calendar c WHERE c.user_id=p.user_id AND c.post_id=p.id AND c.slot_key=$3)', ['İçerik kalite veya kaynak kontrolünü geçemedi', this.userId, String(job.payload.slotKey)]);
          }
        } else if (conflict) {
          await this.repo.enqueueOutbox(this.userId, `Bu işlem uygulanmadı: ${message}\nEn son taslak mesajını kullanın.`, [], undefined, undefined, `conflict:${job.id}`);
          await this.repo.completeJob(job.id, job.leaseToken);
        } else {
          const retryAt = job.attempts < 4 && !(error instanceof AnalyticsError && error.kind !== 'retryable') ? new Date(this.now().getTime() + Math.min(3600, 30 * 2 ** job.attempts) * 1000).toISOString() : undefined;
          await this.repo.failJob(job.id, job.leaseToken, message, retryAt);
          if (!retryAt) await this.repo.enqueueOutbox(this.userId, error instanceof AnalyticsError ? `LinkedIn analitik verileri alınamadı. ${error.message}\nManuel ölçüm girişi kullanılabilir.` : `❌ ${job.type} işlemi tamamlanamadı. Taslak ve geçmiş korundu. Yönetim API'sinde /v1/jobs üzerinden hata durumunu inceleyin.`, [], undefined, undefined, error instanceof AnalyticsError ? `metrics-access:${this.now().toISOString().slice(0, 10)}` : `job-failed:${job.id}`);
        }
      }
    }
    return count;
  }
  async flushOutbox(limit = 20): Promise<number> {
    let count = 0;
    for (; count < limit; count++) {
      const message = (await this.repo.claimOutbox(this.workerId, 1, 60, this.userId))[0]; if (!message) break;
      try {
        if (message.userId !== this.userId) throw new Error('Tenant mismatch');
        const result = await this.options.telegram.send(this.options.telegramUserId, message.text, message.buttons);
        await this.repo.completeOutbox(message.id, message.leaseToken, result.messageId);
        this.options.logger.info({ event: 'telegram_sent', outboxId: message.id });
      } catch {
        const retry = new Date(this.now().getTime() + Math.min(3600, 15 * 2 ** Math.min(message.attempts, 8)) * 1000).toISOString();
        await this.repo.failOutbox(message.id, message.leaseToken, 'Telegram bildirimi gönderilemedi', retry);
        this.options.logger.warn({ event: 'telegram_failed', outboxId: message.id });
      }
    }
    return count;
  }
  private async handleJob(job: Job): Promise<void> {
    switch (job.type) {
      case 'metrics': {
        if (!this.options.analytics) break;
        const measurements = await this.options.analytics.getMetrics(String(job.payload.urn));
        if (measurements) await recordMetrics(this.repo.db, this.userId, String(job.payload.postId), measurements, (await this.settings()).timezone);
        break;
      }
      case 'backlog': await this.ensureBacklog(); break;
      case 'generate': await this.generate(job); break;
      case 'telegram': await this.handleTelegram(job); break;
      case 'publish': await this.publish(job); break;
      case 'resume': {
        const postId = String(job.payload.postId);
        if (await this.repo.resumePost(this.userId, postId, String(job.payload.scheduledAt))) await this.sendDraft(postId);
        break;
      }
      case 'report': await this.repo.enqueueOutbox(this.userId, await weeklyReport(this.repo.db, this.userId, new Date(String(job.payload.at)), (await this.settings()).timezone), [], undefined, undefined, `weekly:${job.payload.at}`); break;
      default: throw new Error('Unknown job type');
    }
  }
  private async generate(job: Job): Promise<void> {
    const scheduledAt = String(job.payload.scheduledAt);
    const settings = await this.settings();
    if (!job.payload.manual && slotsBetween(new Date(scheduledAt), new Date(scheduledAt), settings).length === 0) return; // old config slot
    await this.ensureBacklog();
    const ideas = await this.repo.listIdeas(this.userId, false);
    const context = await this.context();
    const choice = selectIdea(ideas.filter(x => !x.used), context);
    if (!choice) throw new Error('Kullanılabilir fikir bulunamadı');
    const post = await this.repo.createPost(this.userId, scheduledAt, choice.id, String(job.payload.slotKey));
    if (post.currentVersion > 0 || post.status === 'cancelled') { await this.sendDraft(post.id); return; }
    const selected = ideas.find(i => i.id === post.ideaId); if (!selected) throw new Error('Kayıtlı fikir bulunamadı');
    await this.repo.claimIdea(this.userId, selected.id);
    const content = await this.options.content.generate(selected, context);
    await this.repo.saveDraft(this.userId, post.id, 0, content);
    this.options.logger.info({ event: 'draft_generated', postId: post.id });
    await this.sendDraft(post.id);
  }
  private async publish(job: Job): Promise<void> {
    const item = await this.repo.beginPublish(this.userId, String(job.payload.postId), Number(job.payload.version));
    if (!item) return;
    this.options.logger.info({ event: 'publish_started', postId: item.post.id, version: item.version.version });
    let result;
    try { result = await this.options.linkedin.publish(item.version.text, `${item.post.id}:${item.version.version}`); }
    catch (error) {
      const known = error instanceof PublishError;
      const uncertain = !known || error.kind === 'uncertain';
      const retryAt = known && error.kind === 'retryable' && job.attempts < 4
        ? new Date(this.now().getTime() + Math.max(error.retryAfterSeconds ?? 60, 30 * 2 ** job.attempts) * 1000).toISOString() : undefined;
      await this.repo.failPublish(this.userId, item.post.id, item.attemptId, known ? error.message : 'Yayın sonucunun doğrulanması gerekiyor', uncertain, retryAt);
      this.options.logger.error({ event: 'publish_failed', postId: item.post.id, uncertain });
      return;
    }
    // Never catch a DB completion error as a failed provider call. Recovery marks it uncertain.
    await this.repo.completePublish(this.userId, item.post.id, item.attemptId, result);
    this.options.logger.info({ event: 'publish_successful', postId: item.post.id });
  }
  private async handleTelegram(job: Job): Promise<void> {
    const update = telegramUpdateSchema.parse(job.payload.update ?? job.payload);
    if (!this.authorized(update)) return;
    const callback = update.callback_query;
    if (callback) { try { await this.options.telegram.answerCallback(callback.id); } catch { /* acknowledgement does not authorize anything */ } }
    const raw = callback?.data ?? update.message?.text ?? '';
    if (!raw.trim()) return;
    const command = raw.trim().toLocaleLowerCase('tr').replace(/^\//, '');
    if (command === 'start' || command === 'help' || command === 'yardım') {
      await this.repo.enqueueOutbox(this.userId, 'Taslak geldiğinde Onayla, Revize Et, Yeniden Yaz, İptal veya Ertele butonlarını kullanın. Metinle de “onayla”, “girişi kısalt”, “CTA’yı çıkar”, “2 saat ertele” yazabilirsiniz. Belirli taslağa işlem yapmak için o mesajı yanıtlayın. Yayın için her yeni sürüm açık onay bekler.', [], undefined, undefined, `help:${job.id}`); return;
    }
    if (command === 'rapor') { await this.repo.enqueueOutbox(this.userId, await weeklyReport(this.repo.db, this.userId, this.now(), (await this.settings()).timezone), [], undefined, undefined, `report-command:${job.id}`); return; }
    let action = command;
    let target = job.payload.target as { postId: string; version: number } | undefined;
    if (job.payload.targetCaptured && !target) {
      await this.repo.enqueueOutbox(this.userId, 'Mesajınız alındığında işlem yapılacak bir taslak bulunamadı. Bir taslak mesajını yanıtlayın.', [], undefined, undefined, `no-target:${job.id}`); return;
    }
    if (callback && target) {
      const [buttonAction, postId, version, extra] = raw.split(':');
      if (extra || !buttonAction || postId !== target.postId || Number(version) !== target.version) throw new ConflictError('Buton kayıtlı taslak sürümüyle eşleşmiyor');
      action = buttonAction;
    }
    if (!target) {
      if (callback) {
        const parts = raw.split(':');
        if (parts.length !== 3 || !/^[a-z]+$/.test(parts[0]!) || !/^[0-9a-f-]{36}$/.test(parts[1]!) || !/^\d+$/.test(parts[2]!)) return;
        action = parts[0]!;
        const mapped = await this.repo.resolveMessage(this.userId, callback.message!.message_id);
        if (!mapped || mapped.postId !== parts[1] || mapped.version !== Number(parts[2])) throw new ConflictError('Buton taslak sürümüyle eşleşmiyor');
        target = mapped;
      } else if (update.message?.reply_to_message) {
        target = (await this.repo.resolveMessage(this.userId, update.message.reply_to_message.message_id)) ?? undefined;
        if (!target) throw new ConflictError('Yanıtlanan mesaj bir taslak değil');
      } else target = (await this.repo.activeDraft(this.userId)) ?? undefined;
      if (!target) { await this.repo.enqueueOutbox(this.userId, 'İşlem yapılacak bir taslak yok. Bir taslak mesajını yanıtlayın.', [], undefined, undefined, `no-target:${job.id}`); return; }
      // Freeze the exact target before an external edit. Retried updates cannot edit a later version.
      job.payload.target = target;
      await this.repo.db.query('UPDATE jobs SET payload=$1 WHERE id=$2 AND lease_token=$3', [JSON.stringify(job.payload), job.id, job.leaseToken]);
    } else if (callback) action = raw.split(':')[0]!;
    const post = await this.repo.getPost(this.userId, target.postId);
    if (!post || post.currentVersion !== target.version) throw new ConflictError('Bu taslak eski bir sürüm');
    if (action === 'approve' || command === 'onayla') {
      await this.repo.approve(this.userId, post.id, target.version, String(update.update_id));
      this.options.logger.info({ event: 'draft_approved', postId: post.id, version: target.version }); return;
    }
    if (action === 'retry' || command === 'tekrar dene') { await this.repo.retryPublish(this.userId, post.id, target.version); return; }
    if (action === 'cancel' || command === 'iptal') {
      await this.repo.cancel(this.userId, post.id, target.version);
      await this.repo.enqueueOutbox(this.userId, '❌ Gönderi iptal edildi.', [], undefined, undefined, `cancel:${job.id}`); return;
    }
    if (action === 'revise' || action === 'postpone') {
      const text = action === 'revise' ? 'Değişikliği yazın; örneğin “sadece girişi kısalt” veya “CTA’yı çıkar”. Bu taslağı yanıtlayarak devam edin.' : 'Yeni zamanı yazın; örneğin “2 saat ertele”, “yarına ertele”, “akşam 7’ye al” veya “Cuma günü paylaş”. Bu taslağı yanıtlayın.';
      await this.repo.enqueueOutbox(this.userId, text, [], post.id, target.version, `prompt:${job.id}`); return;
    }
    if (looksLikePostpone(raw)) {
      const settings = await this.settings();
      const date = parsePostpone(raw, this.now(), settings.timezone, settings.postingTimes[0]);
      if (!date) { await this.repo.enqueueOutbox(this.userId, 'Zamanı netleştiremedim. “2 saat ertele” veya “Cuma günü paylaş” şeklinde yazın.', [], post.id, target.version, `time-clarify:${job.id}`); return; }
      await this.repo.postpone(this.userId, post.id, target.version, date.toISOString());
      await this.repo.enqueueOutbox(this.userId, `⏰ ${formatTime(date.toISOString(), settings.timezone)} zamanına ertelendi. O saatte tekrar onay isteyeceğim.`, [], undefined, undefined, `postponed:${job.id}`);
      this.options.logger.info({ event: 'schedule_changed', postId: post.id }); return;
    }
    if (post.status !== 'waiting_approval') throw new ConflictError('Bu gönderi şu anda düzenlenemez');
    const current = (await this.repo.getVersion(this.userId, post.id, target.version)) as Version;
    const context = await this.context(); context.history = context.history.filter(v => v.postId !== post.id);
    const rewrite = action === 'rewrite' || command === 'yeniden yaz';
    await this.repo.recordInteraction(this.userId, post.id, raw);
    this.options.logger.info({ event: 'revision_requested', postId: post.id });
    const edited = rewrite ? { content: await this.options.content.rewrite(current.content, context), preference: null }
      : await this.options.content.revise(current.content, raw, context, await this.repo.conversation(this.userId, post.id));
    await this.repo.saveDraft(this.userId, post.id, target.version, edited.content, raw);
    if (edited.preference && context.settings.memoryEnabled) {
      await this.repo.db.query('INSERT INTO brand_memory(id,user_id,preference) VALUES($1,$2,$3) ON CONFLICT(user_id,preference) DO UPDATE SET count=brand_memory.count+1,updated_at=now()', [randomUUID(), this.userId, edited.preference.slice(0, 300)]);
    }
    await this.sendDraft(post.id);
  }
}
