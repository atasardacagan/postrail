import type { Database } from '../db/database.js';
import { LinkedInOAuth, TokenCipher, createOAuthState, hashOAuthState, OAuthError, type OAuthTokens } from '../integrations/oauth.js';

export class OAuthService {
  constructor(private readonly db: Database, private readonly userId: string, private readonly client: LinkedInOAuth, private readonly cipher: TokenCipher) {}
  async start(): Promise<string> {
    const state = createOAuthState();
    await this.db.query('INSERT INTO oauth_states(state_hash,user_id,expires_at) VALUES($1,$2,$3)', [hashOAuthState(state), this.userId, new Date(Date.now() + 10 * 60_000).toISOString()]);
    return this.client.authorizationUrl(state);
  }
  async complete(code: string, state: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new OAuthError('OAuth state geçersiz');
    const result = await this.db.query('UPDATE oauth_states SET consumed_at=now() WHERE state_hash=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING state_hash', [hashOAuthState(state), this.userId]);
    if (!result.rowCount) throw new OAuthError('OAuth state süresi dolmuş veya daha önce kullanılmış');
    const token = await this.client.exchange(code);
    if (token.scope && !token.scope.split(/[ ,]+/).includes('w_member_social')) throw new OAuthError('w_member_social izni verilmedi');
    const identity = await this.client.userInfo(token.accessToken);
    await this.db.query(`INSERT INTO oauth_connections(user_id,provider,encrypted_token,expires_at,subject,scopes) VALUES($1,'linkedin',$2,$3,$4,$5) ON CONFLICT(user_id,provider) DO UPDATE SET encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at,subject=excluded.subject,scopes=excluded.scopes,updated_at=now()`,
      [this.userId, this.cipher.encrypt(JSON.stringify(token), this.userId), token.expiresAt, identity.authorUrn, token.scope?.split(/[ ,]+/) ?? []]);
  }
  async accessToken(): Promise<string> {
    return this.db.transaction(async tx => {
      const result = await tx.query<{ encrypted_token: string }>("SELECT encrypted_token FROM oauth_connections WHERE user_id=$1 AND provider='linkedin' FOR UPDATE", [this.userId]);
      if (!result.rows[0]) throw new OAuthError('LinkedIn hesabı bağlı değil; OAuth yetkilendirmesi gerekli');
      const token = JSON.parse(this.cipher.decrypt(result.rows[0].encrypted_token, this.userId)) as OAuthTokens;
      if (new Date(token.expiresAt).getTime() > Date.now() + 60_000) return token.accessToken;
      if (!token.refreshToken || !token.refreshExpiresAt || new Date(token.refreshExpiresAt).getTime() <= Date.now()) throw new OAuthError('LinkedIn token süresi doldu. Hesabı yeniden yetkilendirin; bu uygulama için geçerli refresh token yok.');
      const refreshed = await this.client.refresh(token.refreshToken);
      const next = { ...refreshed, refreshToken: refreshed.refreshToken ?? token.refreshToken, refreshExpiresAt: refreshed.refreshExpiresAt ?? token.refreshExpiresAt };
      await tx.query("UPDATE oauth_connections SET encrypted_token=$1,expires_at=$2,updated_at=now() WHERE user_id=$3 AND provider='linkedin'", [this.cipher.encrypt(JSON.stringify(next), this.userId), next.expiresAt, this.userId]);
      return next.accessToken;
    });
  }
  async authorUrn(): Promise<string> {
    const result = await this.db.query<{ subject: string }>("SELECT subject FROM oauth_connections WHERE user_id=$1 AND provider='linkedin'", [this.userId]);
    if (!result.rows[0]?.subject) throw new OAuthError('LinkedIn kişi kimliği bulunamadı; hesabı bağlayın');
    return result.rows[0].subject;
  }
}
