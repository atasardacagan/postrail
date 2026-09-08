import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeEnvironment, populateEnvironmentTemplate } from '../src/core/environment-template.js';

const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const temporaryDirectories: string[] = [];
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'brand-env-test-'));
  temporaryDirectories.push(path);
  await writeFile(join(path, '.env.example'), template);
  return path;
}
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('safe environment initialization', () => {
  it('creates independent secrets and consistent native/Compose database credentials', () => {
    const env = parse(populateEnvironmentTemplate(template));
    const secrets = [env.ADMIN_API_TOKEN!, env.TELEGRAM_WEBHOOK_SECRET!, env.TOKEN_ENCRYPTION_KEY!];
    for (const secret of secrets) expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(secrets).size).toBe(3);
    expect(env.POSTGRES_PASSWORD).toMatch(/^[a-f0-9]{48}$/);
    expect(new URL(env.DATABASE_URL!).password).toBe(env.POSTGRES_PASSWORD);
    expect(env.TELEGRAM_ALLOWED_USER_ID).toBe('');
    expect(env.TELEGRAM_BOT_TOKEN).toBe('');
    expect(env.LLM_API_KEY).toBe('');
    expect(env.LINKEDIN_CLIENT_SECRET).toBe('');
  });

  it('uses new random secrets for every new installation', () => {
    const first = parse(populateEnvironmentTemplate(template));
    const second = parse(populateEnvironmentTemplate(template));
    for (const key of ['ADMIN_API_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TOKEN_ENCRYPTION_KEY', 'POSTGRES_PASSWORD']) {
      expect(first[key]).not.toBe(second[key]);
    }
  });

  it('restricts the created file to the owner', async () => {
    const path = await directory();
    await initializeEnvironment(path);
    const info = await stat(join(path, '.env'));
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('refuses to overwrite existing account settings', async () => {
    const path = await directory();
    const existing = 'TOKEN_ENCRYPTION_KEY=existing-private-setting\n';
    await writeFile(join(path, '.env'), existing);
    await expect(initializeEnvironment(path)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(path, '.env'), 'utf8')).toBe(existing);
  });

  it('refuses a symlink instead of changing its target', async () => {
    const path = await directory();
    await writeFile(join(path, 'existing'), 'preserve');
    await symlink(join(path, 'existing'), join(path, '.env'));
    await expect(initializeEnvironment(path)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(path, 'existing'), 'utf8')).toBe('preserve');
  });

  it('allows only one writer when initialization races', async () => {
    const path = await directory();
    const attempts = await Promise.allSettled([initializeEnvironment(path), initializeEnvironment(path)]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    const saved = parse(await readFile(join(path, '.env'), 'utf8'));
    expect(new URL(saved.DATABASE_URL!).password).toBe(saved.POSTGRES_PASSWORD);
  });
});
