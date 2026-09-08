import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGliteDatabase } from '../src/db/pglite.js';
import { migrate } from '../src/db/migrate.js';
import { Repository } from '../src/db/repository.js';
import { LinkedInOAuth, TokenCipher } from '../src/integrations/oauth.js';
import { OAuthService } from '../src/services/oauth.js';

let db: PGliteDatabase;
beforeEach(async () => { db = new PGliteDatabase(); await migrate(db); });
afterEach(async () => { await db.close(); });

describe('persisted OAuth connection', () => {
  it('single-use expiring state protects callback and tokens never persist as plaintext', async () => {
    const userId = await new Repository(db).ensureUser('123456');
    const calls: string[] = [];
    const client = new LinkedInOAuth({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.com/oauth/linkedin/callback', fetch: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(String(url).endsWith('/userinfo') ? { sub: 'MemberId' } : { access_token: 'private-token', expires_in: 3600, scope: 'openid profile w_member_social' }));
    } });
    const service = new OAuthService(db, userId, client, new TokenCipher(randomBytes(32).toString('base64')));
    const state = new URL(await service.start()).searchParams.get('state')!;
    await service.complete('authorization-code', state);
    expect(await service.accessToken()).toBe('private-token');
    expect(await service.authorUrn()).toBe('urn:li:person:MemberId');
    const record = (await db.query<{ encrypted_token: string }>('SELECT encrypted_token FROM oauth_connections')).rows[0]!;
    expect(record.encrypted_token).not.toContain('private-token');
    await expect(service.complete('authorization-code', state)).rejects.toThrow(/kullanılmış/);
    expect(calls).toHaveLength(2);
    const expired = new URL(await service.start()).searchParams.get('state')!;
    await db.query("UPDATE oauth_states SET expires_at=now()-interval '1 second' WHERE consumed_at IS NULL");
    await expect(service.complete('code', expired)).rejects.toThrow(/süresi/);
    expect(calls).toHaveLength(2);
  });
  it('refreshes only a returned still-valid token and serializes concurrent refreshes', async () => {
    const userId = await new Repository(db).ensureUser('123456');
    let refreshes = 0;
    const cipher = new TokenCipher(randomBytes(32).toString('base64'));
    const client = new LinkedInOAuth({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.com/callback', fetch: async (_url, init) => {
      expect(String(init?.body)).toContain('grant_type=refresh_token'); refreshes++;
      return new Response(JSON.stringify({ access_token: 'new-private-token', expires_in: 3600 }));
    } });
    await db.query("INSERT INTO oauth_connections(user_id,provider,encrypted_token,expires_at,subject) VALUES($1,'linkedin',$2,$3,$4)", [userId, cipher.encrypt(JSON.stringify({ accessToken: 'expired', expiresAt: new Date(Date.now() - 1000).toISOString(), refreshToken: 'refresh-private', refreshExpiresAt: new Date(Date.now() + 86400_000).toISOString() }), userId), new Date(Date.now() - 1000), 'urn:li:person:Member']);
    const service = new OAuthService(db, userId, client, cipher);
    expect(await Promise.all([service.accessToken(), service.accessToken()])).toEqual(['new-private-token', 'new-private-token']);
    expect(refreshes).toBe(1);
  });
  it('requires reauthorization when refresh was not granted instead of inventing refresh requests', async () => {
    const userId = await new Repository(db).ensureUser('123456'); const cipher = new TokenCipher(randomBytes(32).toString('base64'));
    let calls = 0;
    const client = new LinkedInOAuth({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.com/callback', fetch: async () => { calls++; throw new Error('must not call'); } });
    await db.query("INSERT INTO oauth_connections(user_id,provider,encrypted_token) VALUES($1,'linkedin',$2)", [userId, cipher.encrypt(JSON.stringify({ accessToken: 'expired', expiresAt: new Date(Date.now() - 1000).toISOString() }), userId)]);
    await expect(new OAuthService(db, userId, client, cipher).accessToken()).rejects.toThrow(/yeniden yetkilendirin/);
    expect(calls).toBe(0);
  });
});
