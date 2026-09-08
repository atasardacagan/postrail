import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export interface OAuthTokens {
  accessToken: string;
  expiresAt: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
  scope?: string;
}
export interface OAuthOptions {
  clientId: string; clientSecret: string; redirectUri: string;
  fetch?: typeof fetch; timeoutMs?: number; analyticsEnabled?: boolean;
}
export class OAuthError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'OAuthError'; }
}

export function createOAuthState(): string { return randomBytes(32).toString('base64url'); }
export function hashOAuthState(state: string): string { return createHash('sha256').update(state).digest('hex'); }
/** The caller additionally enforces expiry, owner and atomic one-time consumption in PostgreSQL. */
export function verifyOAuthState(raw: string, digest: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw) || !/^[a-f0-9]{64}$/.test(digest)) return false;
  return timingSafeEqual(Buffer.from(hashOAuthState(raw), 'hex'), Buffer.from(digest, 'hex'));
}

/** AES-256-GCM; no plaintext token or key becomes an enumerable object property. */
export class TokenCipher {
  readonly #key: Buffer;
  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32 || key.toString('base64') !== keyBase64) throw new OAuthError('TOKEN_ENCRYPTION_KEY, Base64 kodlanmış 32 byte olmalı.');
    this.#key = key;
  }
  encrypt(plaintext: string, context = 'linkedin-oauth'): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(`brand-engine:v1:${context}`));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }
  decrypt(envelope: string, context = 'linkedin-oauth'): string {
    try {
      const parts = envelope.split('.');
      const [version, iv64, tag64, encrypted64] = parts;
      if (parts.length !== 4 || version !== 'v1' || !iv64 || !tag64 || encrypted64 === undefined) throw new Error();
      const iv = Buffer.from(iv64, 'base64url');
      const tag = Buffer.from(tag64, 'base64url');
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.#key, iv);
      decipher.setAAD(Buffer.from(`brand-engine:v1:${context}`));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(encrypted64, 'base64url')), decipher.final()]).toString('utf8');
    } catch { throw new OAuthError('Kayıtlı OAuth token çözülemedi; şifreleme anahtarını kontrol edin veya bağlantıyı yenileyin.'); }
  }
}

const tokenSchema = z.object({
  access_token: z.string().min(1), expires_in: z.number().int().positive().max(31_536_000),
  refresh_token: z.string().min(1).optional(), refresh_token_expires_in: z.number().int().positive().max(63_072_000).optional(),
  scope: z.string().optional(),
});

export class LinkedInOAuth {
  readonly #options: OAuthOptions;
  readonly #fetch: typeof fetch;
  constructor(options: OAuthOptions) {
    const uri = new URL(options.redirectUri);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname);
    if (uri.username || uri.password || uri.hash || uri.protocol !== 'https:' && !(local && uri.protocol === 'http:')) {
      throw new OAuthError('OAuth redirect URI HTTPS olmalı; HTTP yalnız localhost için kullanılabilir.');
    }
    if (!options.clientId || !options.clientSecret) throw new OAuthError('LinkedIn OAuth client ID ve client secret gerekli.');
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  authorizationUrl(state: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new OAuthError('OAuth state createOAuthState ile üretilmeli.');
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.search = new URLSearchParams({
      response_type: 'code', client_id: this.#options.clientId, redirect_uri: this.#options.redirectUri,
      state, scope: `openid profile w_member_social${this.#options.analyticsEnabled ? ' r_member_postAnalytics' : ''}`,
    }).toString();
    return url.toString();
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init, signal: AbortSignal.timeout(this.#options.timeoutMs ?? 15_000), redirect: 'error',
      });
    } catch { throw new OAuthError('LinkedIn OAuth bağlantısı tamamlanamadı.'); }
    if (!response.ok) {
      throw new OAuthError(`LinkedIn OAuth (${response.status}): bağlantı reddedildi; uygulama ayarlarını kontrol edin ve yeniden yetkilendirin.`, response.status);
    }
    try { return await response.json(); } catch { throw new OAuthError('LinkedIn OAuth geçersiz yanıt döndürdü.'); }
  }

  private async tokens(parameters: Record<string, string>): Promise<OAuthTokens> {
    const body = new URLSearchParams({ client_id: this.#options.clientId, client_secret: this.#options.clientSecret, ...parameters });
    const result = await this.request('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    });
    const parsed = tokenSchema.safeParse(result);
    if (!parsed.success) throw new OAuthError('LinkedIn OAuth token yanıtı beklenen biçimde değil.');
    const data = parsed.data;
    const now = Date.now();
    return {
      accessToken: data.access_token, expiresAt: new Date(now + data.expires_in * 1000).toISOString(),
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      ...(data.refresh_token_expires_in ? { refreshExpiresAt: new Date(now + data.refresh_token_expires_in * 1000).toISOString() } : {}),
      ...(data.scope ? { scope: data.scope } : {}),
    };
  }

  async exchange(code: string): Promise<OAuthTokens> {
    if (!code || code.length > 8192) throw new OAuthError('Geçerli OAuth authorization code gerekli.');
    return this.tokens({ grant_type: 'authorization_code', code, redirect_uri: this.#options.redirectUri });
  }

  /** Only call when the original provider response actually included a valid refresh token. */
  async refresh(refreshToken: string): Promise<OAuthTokens> {
    if (!refreshToken) throw new OAuthError('Refresh token yok; LinkedIn hesabını yeniden yetkilendirin.');
    return this.tokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async userInfo(accessToken: string): Promise<{ sub: string; authorUrn: string; name?: string }> {
    if (!accessToken) throw new OAuthError('Kullanıcı bilgisi için erişim token gerekli.');
    const result = await this.request('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
    const parsed = z.object({ sub: z.string().regex(/^[A-Za-z0-9_-]+$/), name: z.string().optional() }).safeParse(result);
    if (!parsed.success) throw new OAuthError('LinkedIn kullanıcı kimliği alınamadı.');
    return { ...parsed.data, authorUrn: `urn:li:person:${parsed.data.sub}` };
  }
}
