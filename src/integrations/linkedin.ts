import type { LinkedInPort, PublishResult } from '../core/types.js';

export type PublishErrorKind = 'retryable' | 'rejected' | 'uncertain';
export class PublishError extends Error {
  constructor(readonly kind: PublishErrorKind, message: string, readonly status?: number, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'PublishError';
  }
}

export interface LinkedInOptions {
  accessToken: () => Promise<string>;
  authorUrn: string | (() => Promise<string>);
  version: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function retryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.min(86_400, Math.max(1, seconds)) : undefined;
}

/** Exactly-once publication cannot be guaranteed by Posts API. Never retry an ambiguous POST. */
export class LinkedInClient implements LinkedInPort {
  readonly #options: LinkedInOptions;
  readonly #fetch: typeof fetch;
  constructor(options: LinkedInOptions) {
    if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(options.version)) throw new Error('LinkedIn API sürümü YYYYMM biçiminde olmalı.');
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  async publish(text: string, idempotencyKey: string): Promise<PublishResult> {
    if (!text.trim() || text.length > 3000) throw new PublishError('rejected', 'LinkedIn metni 1–3000 karakter olmalı.');
    if (!idempotencyKey) throw new PublishError('rejected', 'Yayın kaydı için idempotency anahtarı gerekli.');
    let token: string;
    let author: string;
    try {
      token = await this.#options.accessToken();
      author = typeof this.#options.authorUrn === 'string' ? this.#options.authorUrn : await this.#options.authorUrn();
    } catch {
      throw new PublishError('rejected', 'LinkedIn bağlantı bilgileri alınamadı; OAuth bağlantısını yenileyin.');
    }
    if (!token || !/^urn:li:person:[A-Za-z0-9_-]+$/.test(author)) throw new PublishError('rejected', 'LinkedIn token veya kişisel yazar kimliği eksik/geçersiz.');
    let response: Response;
    try {
      response = await this.#fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`, 'content-type': 'application/json',
          'LinkedIn-Version': this.#options.version, 'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author, commentary: text, visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
        }),
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? 20_000), redirect: 'error',
      });
    } catch {
      throw new PublishError('uncertain', 'LinkedIn isteğinin sonucu belirsiz. Profilinizi kontrol etmeden yeniden yayınlamayın.');
    }
    if (response.status === 429) {
      throw new PublishError('retryable', 'LinkedIn istek sınırına ulaşıldı; onaylı sürüm güvenli tekrar için korundu.', 429, retryAfter(response.headers.get('retry-after')));
    }
    if (response.status === 408 || response.status >= 500 || response.status < 200 || response.status >= 300 && response.status < 400) {
      throw new PublishError('uncertain', `LinkedIn (${response.status}) yayın sonucunu doğrulamadı. Profilinizi kontrol edin.`, response.status);
    }
    if (response.status >= 400) {
      const detail = response.status === 401 ? 'Token süresi dolmuş veya geçersiz; OAuth bağlantısını yenileyin.'
        : response.status === 403 ? 'w_member_social veya Developer App ürün erişimi eksik.'
          : response.status === 426 ? 'LinkedIn API sürümü artık desteklenmiyor; sürüm ayarını güncelleyin.'
            : 'İstek reddedildi; içerik ve hesap izinlerini kontrol edin.';
      throw new PublishError('rejected', `LinkedIn (${response.status}): ${detail}`, response.status);
    }
    const urn = response.headers.get('x-restli-id');
    if (response.status !== 201 || !urn || !/^urn:li:(share|ugcPost):\d+$/.test(urn)) {
      throw new PublishError('uncertain', 'LinkedIn başarı yanıtında geçerli gönderi kimliği bulunamadı. Profilinizi kontrol edin.', response.status);
    }
    return { urn, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/` };
  }
}
