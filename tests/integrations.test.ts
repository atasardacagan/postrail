import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { LinkedInClient, PublishError } from '../src/integrations/linkedin.js';
import { LinkedInAnalytics } from '../src/integrations/linkedin-analytics.js';
import { MockLinkedIn, MockTelegram } from '../src/integrations/mocks.js';
import { LinkedInOAuth, TokenCipher, createOAuthState, hashOAuthState, verifyOAuthState } from '../src/integrations/oauth.js';
import { TelegramBot, telegramUpdateSchema } from '../src/integrations/telegram.js';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const linkedin = (fetcher: typeof fetch) => new LinkedInClient({
  accessToken: async () => 'private-linkedin-token', authorUrn: 'urn:li:person:abc_123', version: '202605', fetch: fetcher,
});
const oauth = (fetcher: typeof fetch) => new LinkedInOAuth({
  clientId: 'client', clientSecret: 'private-secret', redirectUri: 'https://engine.example.com/oauth/linkedin/callback', fetch: fetcher,
});

describe('Official LinkedIn publishing adapter', () => {
  it('sends the approved text through versioned Posts API and reads the server post ID', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:12345678' } }));
    const result = await linkedin(fetcher).publish('Onaylanan son sürüm.', 'post:123:v3');
    expect(result).toEqual({ urn: 'urn:li:share:12345678', url: 'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A12345678/' });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.linkedin.com/rest/posts');
    expect(options?.method).toBe('POST');
    const headers = new Headers(options?.headers);
    expect(headers.get('LinkedIn-Version')).toBe('202605');
    expect(headers.get('X-Restli-Protocol-Version')).toBe('2.0.0');
    expect(headers.get('Authorization')).toBe('Bearer private-linkedin-token');
    expect(headers.has('Idempotency-Key')).toBe(false);
    expect(JSON.parse(String(options?.body))).toEqual({
      author: 'urn:li:person:abc_123', commentary: 'Onaylanan son sürüm.', visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    });
  });

  it.each([400, 401, 403, 422, 426])('treats explicit rejection %i as rejected and omits raw responses', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ message: 'private-linkedin-token' }, status));
    const promise = linkedin(fetcher).publish('Metin', 'post:1');
    await expect(promise).rejects.toMatchObject({ name: 'PublishError', kind: 'rejected', status });
    await expect(promise).rejects.not.toThrow('private-linkedin-token');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('permits only explicit throttling to be retried by the durable worker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '120' } }));
    await expect(linkedin(fetcher).publish('Metin', 'post:1')).rejects.toMatchObject({ kind: 'retryable', retryAfterSeconds: 120 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([408, 500, 502, 503, 504, 302])('does not automatically repeat a possibly accepted publication (%i)', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    await expect(linkedin(fetcher).publish('Metin', 'post:1')).rejects.toMatchObject({ kind: 'uncertain' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats a network timeout as uncertain and sanitizes the cause', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('Authorization: Bearer private-linkedin-token'));
    const promise = linkedin(fetcher).publish('Metin', 'post:1');
    await expect(promise).rejects.toMatchObject({ kind: 'uncertain' });
    await expect(promise).rejects.not.toThrow('private-linkedin-token');
    const error: unknown = await promise.catch(error => error);
    expect((error as Error).cause).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([null, 'garbage', 'https://malicious.example/post'])('does not fabricate a post identity for malformed success %s', async urn => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201, ...(urn ? { headers: { 'x-restli-id': urn } } : {}) }));
    await expect(linkedin(fetcher).publish('Metin', 'post:1')).rejects.toMatchObject({ kind: 'uncertain' });
  });

  it('rejects bad author credentials before sending a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new LinkedInClient({ fetch: fetcher, accessToken: async () => 'token', authorUrn: 'urn:li:organization:123', version: '202605' });
    await expect(client.publish('Metin', 'post:1')).rejects.toBeInstanceOf(PublishError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Telegram Bot API transport', () => {
  it('sends readable plain text and an inline keyboard without interpreting user HTML', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true, result: { message_id: 78 } }));
    const bot = new TelegramBot({ token: '123456:secret-token', fetch: fetcher });
    expect(await bot.send('42', '<b>Kullanıcı içeriği</b>', [[{ text: '✅ Onayla', callback_data: 'approve:post:v3' }]])).toEqual({ messageId: 78 });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.telegram.org/bot123456:secret-token/sendMessage');
    expect(JSON.parse(String(options?.body))).toEqual({
      chat_id: '42', text: '<b>Kullanıcı içeriği</b>', link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: '✅ Onayla', callback_data: 'approve:post:v3' }]] },
    });
  });

  it('rejects overlong text and callback bytes before sending', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const bot = new TelegramBot({ token: '123456:secret-token', fetch: fetcher });
    await expect(bot.send('42', 'x'.repeat(4097))).rejects.toThrow('4096');
    await expect(bot.send('42', 'x', [[{ text: 'x', callback_data: 'ı'.repeat(33) }]])).rejects.toThrow('64');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never leaks the token embedded in fetch error URLs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('https://api.telegram.org/bot123456:secret-token/sendMessage'));
    const bot = new TelegramBot({ token: '123456:secret-token', fetch: fetcher });
    const error: unknown = await bot.send('42', 'text').catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('secret-token');
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(bot)).not.toContain('secret-token');
  });

  it('omits untrusted raw provider error messages and returns retry delay', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: false, error_code: 429, description: 'secret-token', parameters: { retry_after: 3 } }, 429));
    const bot = new TelegramBot({ token: '123456:secret-token', fetch: fetcher });
    const promise = bot.send('42', 'text');
    await expect(promise).rejects.toMatchObject({ status: 429, retryAfterSeconds: 3 });
    await expect(promise).rejects.not.toThrow('secret-token');
  });

  it('requests only message/callback updates and validates identity types', async () => {
    const update = { update_id: 1, message: { message_id: 2, from: { id: 42 }, chat: { id: 42, type: 'private' }, text: 'onayla' } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true, result: [update] }));
    const bot = new TelegramBot({ token: '123456:secret-token', fetch: fetcher });
    expect(await bot.getUpdates(1, 0)).toEqual([update]);
    const options = fetcher.mock.calls[0]![1];
    expect(JSON.parse(String(options?.body))).toMatchObject({ offset: 1, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    expect(telegramUpdateSchema.safeParse({ ...update, message: { ...update.message, from: { id: '42' } } }).success).toBe(false);
  });

  it('preserves pending updates when configuring authenticated webhooks', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true, result: true }));
    const bot = new TelegramBot({ token: '123456:secret-token', fetch: fetcher });
    await bot.setWebhook('https://engine.example.com/telegram/webhook', 'a'.repeat(40));
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ secret_token: 'a'.repeat(40), drop_pending_updates: false });
    await expect(bot.setWebhook('http://engine.example.com/telegram/webhook', 'a'.repeat(40))).rejects.toThrow('HTTPS');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('LinkedIn OAuth and encrypted secrets', () => {
  it('generates unpredictable state, uses constant-time verification, rejects alterations', () => {
    const state = createOAuthState();
    const digest = hashOAuthState(state);
    expect(state).not.toBe(createOAuthState());
    expect(state).toHaveLength(43);
    expect(verifyOAuthState(state, digest)).toBe(true);
    expect(verifyOAuthState(createOAuthState(), digest)).toBe(false);
    expect(verifyOAuthState(state, 'incorrect')).toBe(false);
    expect(verifyOAuthState('', digest)).toBe(false);
  });

  it('requests only necessary publishing and profile scopes with the exact registered redirect URI', () => {
    const state = createOAuthState();
    const url = new URL(oauth(vi.fn<typeof fetch>()).authorizationUrl(state));
    expect(url.origin + url.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('scope')).toBe('openid profile w_member_social');
    expect(url.searchParams.get('redirect_uri')).toBe('https://engine.example.com/oauth/linkedin/callback');
    expect(url.search).not.toContain('private-secret');
  });

  it('exchanges a code using form encoding without inventing a refresh token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: 'access', expires_in: 3600 }));
    const tokens = await oauth(fetcher).exchange('code&+=');
    expect(tokens.accessToken).toBe('access');
    expect(tokens.refreshToken).toBeUndefined();
    expect(Date.parse(tokens.expiresAt) - Date.now()).toBeGreaterThan(3_599_000);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://www.linkedin.com/oauth/v2/accessToken');
    const form = new URLSearchParams(String(options?.body));
    expect(form.get('code')).toBe('code&+=');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_secret')).toBe('private-secret');
  });

  it('uses only a supplied refresh token and derives returned expiry from provider lifetime', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: 'renewed', expires_in: 3600, refresh_token: 'rotated', refresh_token_expires_in: 7200 }));
    const client = oauth(fetcher);
    await expect(client.refresh('')).rejects.toThrow('yeniden yetkilendirin');
    expect(fetcher).not.toHaveBeenCalled();
    const tokens = await client.refresh('provider-refresh');
    expect(tokens.refreshToken).toBe('rotated');
    expect(Date.parse(tokens.refreshExpiresAt!) - Date.now()).toBeGreaterThan(7_199_000);
    expect(new URLSearchParams(String(fetcher.mock.calls[0]![1]?.body)).get('refresh_token')).toBe('provider-refresh');
  });

  it('obtains author identity through the official authenticated userinfo endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ sub: '782bbtaQ', name: 'Arda' }));
    expect(await oauth(fetcher).userInfo('access')).toEqual({ sub: '782bbtaQ', authorUrn: 'urn:li:person:782bbtaQ', name: 'Arda' });
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.linkedin.com/v2/userinfo');
  });

  it('hides secret values in OAuth provider errors and instances', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ error_description: 'private-secret' }, 400));
    const client = oauth(fetcher);
    await expect(client.exchange('code')).rejects.not.toThrow('private-secret');
    expect(JSON.stringify(client)).not.toContain('private-secret');
  });

  it('encrypts with a unique nonce and rejects tampering, wrong keys and wrong tenant context', () => {
    const cipher = new TokenCipher(randomBytes(32).toString('base64'));
    const data = JSON.stringify({ accessToken: 'very-secret' });
    const encrypted = cipher.encrypt(data, 'user:a');
    expect(encrypted).not.toContain('very-secret');
    expect(encrypted).not.toBe(cipher.encrypt(data, 'user:a'));
    expect(cipher.decrypt(encrypted, 'user:a')).toBe(data);
    expect(() => cipher.decrypt(encrypted, 'user:b')).toThrow('çözülemedi');
    const fields = encrypted.split('.');
    fields[3] = Buffer.from('tampered').toString('base64url');
    expect(() => cipher.decrypt(fields.join('.'), 'user:a')).toThrow('çözülemedi');
    expect(() => new TokenCipher(randomBytes(32).toString('base64')).decrypt(encrypted, 'user:a')).toThrow('çözülemedi');
    expect(() => new TokenCipher('short')).toThrow('32 byte');
    expect(JSON.stringify(cipher)).toBe('{}');
  });
});

describe('explicit offline adapters', () => {
  it('records duplicate mock publish calls so workflow tests can detect them', async () => {
    const adapter = new MockLinkedIn();
    const result = await adapter.publish('draft', 'post:v1');
    await adapter.publish('draft', 'post:v1');
    expect(adapter.published).toHaveLength(2);
    expect(result.url).toContain('example.invalid');
  });
  it('records Telegram sends and callbacks without any network access', async () => {
    const adapter = new MockTelegram();
    expect(await adapter.send('42', 'Taslak')).toEqual({ messageId: 1 });
    await adapter.answerCallback('callback-1', 'Kaydedildi');
    expect(adapter.messages[0]?.text).toBe('Taslak');
    expect(adapter.answered).toEqual([{ id: 'callback-1', text: 'Kaydedildi' }]);
  });
});

describe('optional LinkedIn member post analytics', () => {
  const postUrn = 'urn:li:share:12345678';
  const analytics = (fetcher: typeof fetch, enabled = true) => new LinkedInAnalytics({ enabled, version: '202605', accessToken: async () => 'private-token', fetch: fetcher });

  it('makes no requests until analytics is explicitly enabled', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await analytics(fetcher, false).getMetrics(postUrn)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requests TOTAL lifetime counts with the Rest.li entity union and validates metric identity', async () => {
    const counts: Record<string, number> = { IMPRESSION: 1200, REACTION: 25, COMMENT: 0, RESHARE: 4 };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      const uri = new URL(String(input));
      const metric = uri.searchParams.get('queryType')!;
      return json({ elements: [{ count: counts[metric], metricType: metric, targetEntity: { share: postUrn } }] });
    });
    expect(await analytics(fetcher).getMetrics(postUrn)).toMatchObject({ source: 'api', impressions: 1200, reactions: 25, comments: 0, reposts: 4 });
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toContain('entity=(share:urn%3Ali%3Ashare%3A12345678)');
      expect(new URL(String(url)).searchParams.get('aggregation')).toBe('TOTAL');
      expect(new URL(String(url)).searchParams.has('dateRange')).toBe(false);
      expect(new Headers(init?.headers).get('LinkedIn-Version')).toBe('202605');
    }
  });

  it('uses ugc union encoding and supports legacy documented metricType objects', async () => {
    const urn = 'urn:li:ugcPost:123';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      const metric = new URL(String(input)).searchParams.get('queryType');
      return json({ elements: [{ count: 1, metricType: { 'com.linkedin.adsexternalapi.memberanalytics.v1.CreatorPostAnalyticsMetricTypeV1': metric }, targetEntity: { ugc: urn } }] });
    });
    expect(await analytics(fetcher).getMetrics(urn)).toMatchObject({ impressions: 1 });
    expect(String(fetcher.mock.calls[0]![0])).toContain('entity=(ugc:urn%3Ali%3AugcPost%3A123)');
  });

  it('keeps missing data distinct from measured zero and omits unsupported totals', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      const metric = new URL(String(input)).searchParams.get('queryType');
      return json({ elements: metric === 'IMPRESSION' ? [{ count: 0, metricType: metric, targetEntity: postUrn }] : [] });
    });
    const result = await analytics(fetcher).getMetrics(postUrn);
    expect(result).toMatchObject({ impressions: 0, reactions: null, comments: null, reposts: null });
    expect(result?.profileViews).toBeUndefined();
    expect(result?.followerChange).toBeUndefined();
    expect(result?.inboundLeads).toBeUndefined();
    expect(await analytics(vi.fn<typeof fetch>().mockImplementation(async () => json({ elements: [] }))).getMetrics(postUrn)).toBeNull();
  });

  it('fails closed on missing member analytics permission and stops further requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ message: 'private-token' }, 403));
    const promise = analytics(fetcher).getMetrics(postUrn);
    await expect(promise).rejects.toMatchObject({ kind: 'unavailable', status: 403 });
    await expect(promise).rejects.not.toThrow('private-token');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { count: 4, metricType: 'IMPRESSION', targetEntity: 'urn:li:share:999' },
    { count: 4, metricType: 'COMMENT', targetEntity: postUrn },
    { count: -1, metricType: 'IMPRESSION', targetEntity: postUrn },
    { count: 4, metricType: 'IMPRESSION' },
  ])('does not save mismatched or malformed provider measurements', async item => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ elements: [item] }));
    await expect(analytics(fetcher).getMetrics(postUrn)).rejects.toMatchObject({ kind: 'invalid' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not silently sum multiple points returned for a TOTAL query', async () => {
    const item = { count: 4, metricType: 'IMPRESSION', targetEntity: postUrn };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ elements: [item, item] }));
    await expect(analytics(fetcher).getMetrics(postUrn)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('adds member analytics scope only for explicitly enabled OAuth connections', () => {
    const client = new LinkedInOAuth({ clientId: 'client', clientSecret: 'private-secret', redirectUri: 'https://engine.example.com/callback', analyticsEnabled: true });
    expect(new URL(client.authorizationUrl(createOAuthState())).searchParams.get('scope')).toBe('openid profile w_member_social r_member_postAnalytics');
  });
});
