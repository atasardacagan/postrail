import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { Database } from '../db/database.js';
import type { DraftContent, MetricInput, PerformancePattern } from '../core/types.js';

export function performanceScore(metrics: MetricInput): number | null {
  const { impressions, reactions, comments, reposts } = metrics;
  if (!impressions || reactions == null || comments == null || reposts == null) return null;
  return Math.round(Math.min(100, (reactions + 3 * comments + 4 * reposts) / impressions * 100) * 100) / 100;
}
export async function recordMetrics(db: Database, userId: string, postId: string, metrics: MetricInput, timezone: string): Promise<void> {
  const { rows } = await db.query<{ content: DraftContent; published_at: Date }>(`SELECT v.content,p.published_at FROM published_posts p JOIN post_versions v ON v.user_id=p.user_id AND v.post_id=p.post_id AND v.version=p.version WHERE p.user_id=$1 AND p.post_id=$2`, [userId, postId]);
  const post = rows[0];
  if (!post) throw new Error('Yayınlanmış gönderi bulunamadı');
  if (new Date(metrics.observedAt) < new Date(post.published_at)) throw new Error('Ölçüm zamanı yayın zamanından önce olamaz');
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO linkedin_metrics(id,user_id,post_id,impressions,reactions,comments,reposts,follower_change,profile_views,inbound_leads,observed_at,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(user_id,post_id,observed_at,source) DO UPDATE SET impressions=excluded.impressions,reactions=excluded.reactions,comments=excluded.comments,reposts=excluded.reposts,follower_change=excluded.follower_change,profile_views=excluded.profile_views,inbound_leads=excluded.inbound_leads`,
      [randomUUID(), userId, postId, metrics.impressions ?? null, metrics.reactions ?? null, metrics.comments ?? null, metrics.reposts ?? null, metrics.followerChange ?? null, metrics.profileViews ?? null, metrics.inboundLeads ?? null, metrics.observedAt, metrics.source]);
    const latest = await tx.query<{ observed_at: Date }>('SELECT observed_at FROM linkedin_metrics WHERE user_id=$1 AND post_id=$2 ORDER BY observed_at DESC,created_at DESC LIMIT 1', [userId, postId]);
    if (new Date(latest.rows[0]!.observed_at).getTime() !== new Date(metrics.observedAt).getTime()) return;
    const score = performanceScore(metrics);
    if (score === null) { await tx.query('DELETE FROM content_performance WHERE user_id=$1 AND post_id=$2', [userId, postId]); return; }
    const text = post.content.blocks.map(x => x.text).join('\n\n');
    const local = DateTime.fromJSDate(new Date(post.published_at), { zone: timezone });
    const dimensions = { category: post.content.category, format: post.content.format,
      hook: post.content.blocks.find(b => b.kind === 'hook')?.text.includes('?') ? 'question' : 'statement',
      length: text.length < 800 ? '<800' : text.length <= 1600 ? '800-1600' : '>1600',
      cta: post.content.blocks.some(b => b.kind === 'cta') ? 'present' : 'none', day: String(local.weekday), hour: local.toFormat('HH') };
    await tx.query('INSERT INTO content_performance(user_id,post_id,score,dimensions,sample) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,post_id) DO UPDATE SET score=excluded.score,dimensions=excluded.dimensions,sample=excluded.sample,updated_at=now()', [userId, postId, score, JSON.stringify(dimensions), JSON.stringify(metrics)]);
  });
}
export async function patterns(db: Database, userId: string): Promise<PerformancePattern[]> {
  const { rows } = await db.query<{ score: number; dimensions: Record<string, string> }>('SELECT score,dimensions FROM content_performance WHERE user_id=$1', [userId]);
  if (!rows.length) return [];
  const prior = rows.reduce((a, b) => a + b.score, 0) / rows.length;
  const groups = new Map<string, { dimension: string; value: string; scores: number[] }>();
  for (const row of rows) for (const [dimension, value] of Object.entries(row.dimensions)) {
    const key = `${dimension}:${value}`;
    const group = groups.get(key) ?? { dimension, value, scores: [] }; group.scores.push(row.score); groups.set(key, group);
  }
  return [...groups.values()].filter(g => g.scores.length >= 2).map(g => ({ dimension: g.dimension, value: g.value,
    score: (g.scores.reduce((a, b) => a + b, 0) + 3 * prior) / (g.scores.length + 3), sampleSize: g.scores.length }));
}
export async function weeklyReport(db: Database, userId: string, at: Date, timezone: string): Promise<string> {
  const since = DateTime.fromJSDate(at, { zone: timezone }).startOf('week').toUTC().toISO();
  const { rows } = await db.query<{ post_id: string; url: string; content: DraftContent; score: number | null }>(`SELECT p.post_id,p.url,v.content,c.score FROM published_posts p JOIN post_versions v ON v.user_id=p.user_id AND v.post_id=p.post_id AND v.version=p.version LEFT JOIN content_performance c ON c.user_id=p.user_id AND c.post_id=p.post_id WHERE p.user_id=$1 AND p.published_at >= $2 AND p.published_at <= $3 ORDER BY c.score DESC NULLS LAST`, [userId, since, at.toISOString()]);
  const coverage = rows.filter(p => p.score !== null).length;
  const best = rows.find(p => p.score !== null);
  const learned = (await patterns(db, userId)).sort((a, b) => b.score - a.score);
  const category = learned.find(p => p.dimension === 'category');
  const format = learned.find(p => p.dimension === 'format');
  const ideas = await db.query<{ title: string }>('SELECT title FROM content_ideas WHERE user_id=$1 AND used=false ORDER BY priority DESC LIMIT 3', [userId]);
  return ['📊 LinkedIn Haftalık Rapor', `${DateTime.fromJSDate(at, { zone: timezone }).setLocale('tr').toFormat('dd LLLL yyyy')}`,
    `Bu hafta ${rows.length} gönderi yayınlandı.`, `Karşılaştırılabilir ölçüm: ${coverage}/${rows.length} gönderi.`,
    best ? `En iyi ölçülen gönderi: ${best.content.topic}\n${best.url}\nAğırlıklı etkileşim skoru: ${best.score}` : 'En iyi gönderiyi seçmek için yeterli ölçüm yok.',
    category ? `Ölçülen geçmişte öne çıkan konu: ${category.value} (${category.sampleSize} gönderi)` : 'En iyi konu: henüz yeterli veri yok.',
    format ? `Öne çıkan format: ${format.value} (${format.sampleSize} gönderi)` : 'En iyi format: henüz yeterli veri yok.',
    `Gelecek hafta odak: ${category?.value ?? 'İşletmelerin somut web ve otomasyon problemleri'}. Deneysel içerik payı korunacak.`,
    `Yeni fikirler:\n${ideas.rows.map(i => `• ${i.title}`).join('\n') || 'Fikir havuzu hazırlanıyor.'}`,
    'Eksik metrikler sıfır sayılmaz. Takipçi/profil verileri ve lead atfı manuel olabilir; skor büyüme garantisi veya nedensellik kanıtı değildir.',
  ].join('\n\n').slice(0, 4000);
}
