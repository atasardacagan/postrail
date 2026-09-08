import { describe, expect, it } from 'vitest';
import { diagnoseEnvironment, formatDoctorReport } from '../src/core/doctor.js';

const live = (): NodeJS.ProcessEnv => ({
  APP_MODE: 'live', NODE_ENV: 'production',
  ADMIN_API_TOKEN: 'ab01cd23ef45'.repeat(4),
  TELEGRAM_WEBHOOK_SECRET: 'ac01de23fb45'.repeat(4),
  TOKEN_ENCRYPTION_KEY: 'fa01ec23bd456789'.repeat(4),
  TELEGRAM_ALLOWED_USER_ID: '847293015',
  TELEGRAM_BOT_TOKEN: '8472930150:BcDEf0123456789ghIJklmnopQRSTuVWxYz',
  LLM_API_KEY: 'sk-local-fixture-8472abcdef0123456789',
  LLM_MODEL: 'gpt-5-mini',
  DATABASE_URL: 'postgresql://brand:safeFixturePassword8472@localhost:5432/brand_engine',
  POSTGRES_PASSWORD: 'safeFixturePassword8472',
  LINKEDIN_CLIENT_ID: '86AB7cdE01',
  LINKEDIN_CLIENT_SECRET: 'abCD0123efGH4567ijKL89',
  LINKEDIN_REDIRECT_URI: 'https://brand-engine.internal/oauth/linkedin/callback',
  LINKEDIN_API_VERSION: '202605',
  LINKEDIN_ANALYTICS_ENABLED: 'false',
  TELEGRAM_MODE: 'polling',
});
const status = (input: NodeJS.ProcessEnv, key: string) => diagnoseEnvironment(input).checks.find(check => check.key === key)?.status;

describe('credential-safe local readiness doctor', () => {
  it('reports all missing live fields without requiring credentials to execute', () => {
    const report = diagnoseEnvironment({}, { envFile: 'missing', nodeVersion: 'v24.1.0' });
    expect(report.ready).toBe(false);
    for (const key of ['APP_MODE', 'ADMIN_API_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TOKEN_ENCRYPTION_KEY', 'TELEGRAM_ALLOWED_USER_ID', 'TELEGRAM_BOT_TOKEN', 'LLM_API_KEY', 'DATABASE_URL', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI']) {
      expect(report.checks.find(check => check.key === key)?.status).toBe('missing');
    }
    expect(report.checks.find(check => check.key === 'ENV_FILE')?.status).toBe('warning');
  });

  it('accepts complete local live configuration without claiming provider validation', () => {
    const report = diagnoseEnvironment(live(), { envFile: 'present', nodeVersion: 'v24.7.0' });
    expect(report.ready).toBe(true);
    expect(report.note).toContain('canlı hesap bağlantılarının doğrulandığı anlamına gelmez');
    expect(report.checks.find(check => check.key === 'ENV_FILE')?.status).toBe('ok');
  });

  it.each(['YOUR_ADMIN_TOKEN', 'GENERATE_ADMIN_TOKEN', 'offline-only-local-admin-token-0001', 'a'.repeat(40)])('rejects placeholder admin credentials without disclosing them', token => {
    const report = diagnoseEnvironment({ ...live(), ADMIN_API_TOKEN: token });
    expect(report.ready).toBe(false);
    expect(report.checks.find(check => check.key === 'ADMIN_API_TOKEN')?.status).toBe('invalid');
    expect(JSON.stringify(report)).not.toContain(token);
  });

  it.each(['123456', '123456789', 'name@example.com', '-42', '9007199254740999'])('rejects unsafe or example Telegram IDs', userId => {
    expect(status({ ...live(), TELEGRAM_ALLOWED_USER_ID: userId }, 'TELEGRAM_ALLOWED_USER_ID')).toBe('invalid');
  });

  it('requires independent admin, webhook and encryption keys including hex case variants', () => {
    const config = live();
    const shared = config.TOKEN_ENCRYPTION_KEY!;
    expect(status({ ...config, ADMIN_API_TOKEN: shared.toUpperCase(), TELEGRAM_WEBHOOK_SECRET: shared }, 'SECRET_SEPARATION')).toBe('invalid');
  });

  it.each(['a'.repeat(63), 'z'.repeat(64), 'GENERATE_ENCRYPTION_KEY'])('rejects malformed encryption keys', key => {
    expect(status({ ...live(), TOKEN_ENCRYPTION_KEY: key }, 'TOKEN_ENCRYPTION_KEY')).toBe('invalid');
  });

  it.each([
    'postgresql://brand:YOUR_DATABASE_PASSWORD@127.0.0.1:5432/brand_engine',
    'postgresql://brand:%59OUR_DATABASE_PASSWORD@127.0.0.1:5432/brand_engine',
    'postgresql://brand:${POSTGRES_PASSWORD}@127.0.0.1:5432/brand_engine',
    'https://brand-engine.internal/database',
    'postgresql://brand:password@localhost:5432',
    'postgresql://brand:%00@localhost:5432/db#fragment',
  ])('rejects placeholder or malformed database connections without echoing URLs', databaseUrl => {
    const report = diagnoseEnvironment({ ...live(), DATABASE_URL: databaseUrl });
    expect(report.checks.find(check => check.key === 'DATABASE_URL')?.status).toBe('invalid');
    expect(JSON.stringify(report)).not.toContain(databaseUrl);
  });

  it.each([
    'http://brand-engine.internal/oauth/linkedin/callback',
    'https://YOUR_DOMAIN/oauth/linkedin/callback',
    'https://user:secret@brand-engine.internal/oauth/linkedin/callback',
    'https://brand-engine.internal/oauth/linkedin/callback?token=do-not-leak',
    'https://brand-engine.internal/oauth/linkedin/callback#fragment',
  ])('rejects unsafe OAuth redirect configuration', redirectUri => {
    expect(status({ ...live(), LINKEDIN_REDIRECT_URI: redirectUri }, 'LINKEDIN_REDIRECT_URI')).toBe('invalid');
  });

  it('allows local HTTP OAuth only for development', () => {
    const config = { ...live(), LINKEDIN_REDIRECT_URI: 'http://localhost:3000/oauth/linkedin/callback' };
    expect(status(config, 'LINKEDIN_REDIRECT_URI')).toBe('invalid');
    expect(status({ ...config, NODE_ENV: 'development' }, 'LINKEDIN_REDIRECT_URI')).toBe('ok');
  });

  it('supports an explicit manual token/author pair with a renewal warning', () => {
    const config = live();
    delete config.LINKEDIN_CLIENT_ID; delete config.LINKEDIN_CLIENT_SECRET; delete config.LINKEDIN_REDIRECT_URI;
    const report = diagnoseEnvironment({ ...config, LINKEDIN_ACCESS_TOKEN: 'AQfixture0123456789abcdefghijklmnopqrstuvwxyz', LINKEDIN_AUTHOR_URN: 'urn:li:person:AbC123' });
    expect(report.ready).toBe(true);
    expect(report.checks.find(check => check.key === 'LINKEDIN_CONNECTION')?.status).toBe('warning');
  });

  it('rejects an incomplete OAuth path when no alternative token pair exists', () => {
    const config = live(); delete config.LINKEDIN_CLIENT_SECRET;
    const report = diagnoseEnvironment(config);
    expect(report.ready).toBe(false);
    expect(report.checks.find(check => check.key === 'LINKEDIN_CONNECTION')?.status).toBe('missing');
  });

  it('adds explicit provider permission and webhook registration reminders without requests', () => {
    const report = diagnoseEnvironment({ ...live(), LINKEDIN_ANALYTICS_ENABLED: 'true', TELEGRAM_MODE: 'webhook' });
    expect(report.ready).toBe(true);
    expect(report.checks.find(check => check.key === 'LINKEDIN_ANALYTICS_ACCESS')?.status).toBe('warning');
    expect(report.checks.find(check => check.key === 'TELEGRAM_WEBHOOK_REGISTRATION')?.status).toBe('warning');
  });

  it('accepts absent .env when all needed values are supplied by process environment', () => {
    expect(diagnoseEnvironment(live(), { envFile: 'missing' }).ready).toBe(true);
    expect(diagnoseEnvironment(live(), { envFile: 'unreadable' }).ready).toBe(false);
  });

  it.each([{ PORT: '70000' }, { WORKER_INTERVAL_MS: '2' }, { LOG_LEVEL: 'token-in-error' }, { HOST: 'bad host' }])('rejects invalid runtime fields using fixed diagnostics', override => {
    const report = diagnoseEnvironment({ ...live(), ...override });
    expect(report.ready).toBe(false);
    expect(report.checks.find(check => check.key === 'RUNTIME_OPTIONS')?.status).toBe('invalid');
    for (const text of Object.values(override)) expect(JSON.stringify(report)).not.toContain(text);
  });

  it('requires Node.js 24 or newer while keeping unknown version input out of output', () => {
    const report = diagnoseEnvironment(live(), { nodeVersion: 'v22.4.0' });
    expect(report.ready).toBe(false);
    expect(report.checks.find(check => check.key === 'NODE_RUNTIME')?.status).toBe('invalid');
    expect(diagnoseEnvironment(live(), { nodeVersion: 'secret version input' }).ready).toBe(false);
  });

  it('checks the explicit offline script path independently of live credentials or .env', () => {
    const report = diagnoseEnvironment({ APP_MODE: 'live', DATABASE_URL: 'invalid-secret-url', LLM_API_KEY: 'secret' }, { mode: 'offline', envFile: 'missing', nodeVersion: 'v24.1.0' });
    expect(report.ready).toBe(true);
    expect(report.mode).toBe('offline');
    expect(report.checks.find(check => check.key === 'EXTERNAL_SERVICES')?.status).toBe('skipped');
    expect(report.note).toContain('canlı kullanım hazır sayılmaz');
    expect(diagnoseEnvironment({ PORT: 'invalid' }, { mode: 'offline' }).ready).toBe(false);
  });

  it('never mutates inputs or process environment and never copies credentials into JSON or text', () => {
    const config = live();
    config.UNKNOWN_SECRET_KEY = 'unique-unknown-secret-marker';
    const original = structuredClone(config);
    const environmentBefore = { ...process.env };
    const report = diagnoseEnvironment(config, { envFile: 'present', nodeVersion: 'v24.1.0' });
    const output = JSON.stringify(report) + formatDoctorReport(report);
    for (const key of ['ADMIN_API_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TOKEN_ENCRYPTION_KEY', 'TELEGRAM_BOT_TOKEN', 'LLM_API_KEY', 'DATABASE_URL', 'POSTGRES_PASSWORD', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI', 'UNKNOWN_SECRET_KEY']) {
      expect(output).not.toContain(config[key]);
    }
    expect(output).not.toContain('UNKNOWN_SECRET_KEY');
    expect(config).toEqual(original);
    expect(process.env).toEqual(environmentBefore);
  });
});
