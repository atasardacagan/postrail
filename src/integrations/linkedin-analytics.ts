import { z } from 'zod';
import type { MetricInput } from '../core/types.js';

export interface LinkedInAnalyticsOptions {
  enabled?: boolean;
  accessToken: () => Promise<string>;
  version: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
export class AnalyticsError extends Error {
  constructor(readonly kind: 'unavailable' | 'retryable' | 'invalid', message: string, readonly status?: number) {
    super(message); this.name = 'AnalyticsError';
  }
}
const definitions = [
  ['IMPRESSION', 'impressions'], ['REACTION', 'reactions'], ['COMMENT', 'comments'], ['RESHARE', 'reposts'],
] as const;
const metricSchema = z.union([
  z.string(), z.object({ 'com.linkedin.adsexternalapi.memberanalytics.v1.CreatorPostAnalyticsMetricTypeV1': z.string() }),
]);
const targetSchema = z.union([z.string(), z.object({ share: z.string() }).strict(), z.object({ ugc: z.string() }).strict()]);
const responseSchema = z.object({
  elements: z.array(z.object({ count: z.number().int().safe().nonnegative(), metricType: metricSchema, targetEntity: targetSchema })).max(1),
});

/** Optional Community Management API access. Missing measurements never become artificial zeros. */
export class LinkedInAnalytics {
  readonly #options: LinkedInAnalyticsOptions;
  readonly #fetch: typeof fetch;
  constructor(options: LinkedInAnalyticsOptions) {
    if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(options.version)) throw new AnalyticsError('invalid', 'LinkedIn API sürümü YYYYMM biçiminde olmalı.');
    this.#options = options; this.#fetch = options.fetch ?? fetch;
  }

  async getMetrics(postUrn: string): Promise<MetricInput | null> {
    if (!this.#options.enabled) return null;
    const matched = /^urn:li:(share|ugcPost):\d+$/.exec(postUrn);
    if (!matched) throw new AnalyticsError('invalid', 'Analitik için geçerli LinkedIn gönderi URN gerekli.');
    let token: string;
    try { token = await this.#options.accessToken(); } catch { throw new AnalyticsError('unavailable', 'LinkedIn analitik token alınamadı; OAuth bağlantısını yenileyin.'); }
    if (!token) throw new AnalyticsError('unavailable', 'LinkedIn analitik token eksik.');
    const metrics: MetricInput = { observedAt: new Date().toISOString(), source: 'api' };
    let measured = false;
    // Sequential calls stop immediately on a missing permission or rate limit.
    for (const [metric, field] of definitions) {
      const unionKey = matched[1] === 'share' ? 'share' : 'ugc';
      const url = `https://api.linkedin.com/rest/memberCreatorPostAnalytics?q=entity&entity=(${unionKey}:${encodeURIComponent(postUrn)})&queryType=${metric}&aggregation=TOTAL`;
      let response: Response;
      try {
        response = await this.#fetch(url, {
          headers: { authorization: `Bearer ${token}`, 'LinkedIn-Version': this.#options.version, 'X-Restli-Protocol-Version': '2.0.0' },
          signal: AbortSignal.timeout(this.#options.timeoutMs ?? 15_000), redirect: 'error',
        });
      } catch { throw new AnalyticsError('retryable', 'LinkedIn analitik bağlantısı tamamlanamadı.'); }
      if (!response.ok) {
        const unavailable = response.status === 401 || response.status === 403;
        const retryable = response.status === 429 || response.status === 408 || response.status >= 500;
        throw new AnalyticsError(unavailable ? 'unavailable' : retryable ? 'retryable' : 'invalid',
          unavailable ? `LinkedIn analitik (${response.status}): r_member_postAnalytics ve Community Management API erişimini kontrol edip yeniden yetkilendirin.`
            : `LinkedIn analitik (${response.status}) alınamadı; mevcut ölçümler korunuyor.`, response.status);
      }
      let body: unknown;
      try { body = await response.json(); } catch { throw new AnalyticsError('invalid', 'LinkedIn analitik yanıtı geçersiz.'); }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) throw new AnalyticsError('invalid', 'LinkedIn analitik ölçüm biçimi geçersiz; ölçüm kaydedilmedi.');
      const item = parsed.data.elements[0];
      if (!item) { metrics[field] = null; continue; }
      const receivedMetric = typeof item.metricType === 'string' ? item.metricType : item.metricType['com.linkedin.adsexternalapi.memberanalytics.v1.CreatorPostAnalyticsMetricTypeV1'];
      const receivedUrn = typeof item.targetEntity === 'string' ? item.targetEntity : 'share' in item.targetEntity ? item.targetEntity.share : item.targetEntity.ugc;
      if (receivedMetric !== metric || receivedUrn !== postUrn) throw new AnalyticsError('invalid', 'LinkedIn analitik yanıtı istenen gönderi veya metrikle eşleşmiyor.');
      metrics[field] = item.count;
      measured = true;
    }
    return measured ? metrics : null;
  }
}
