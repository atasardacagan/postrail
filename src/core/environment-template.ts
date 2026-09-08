import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Create credentials once; reuse only the DB password in its two required settings. */
export function populateEnvironmentTemplate(template: string): string {
  const databasePassword = randomBytes(24).toString('hex');
  const replacements: Record<string, string> = {
    GENERATE_ADMIN_TOKEN: randomBytes(32).toString('hex'),
    GENERATE_WEBHOOK_SECRET: randomBytes(32).toString('hex'),
    GENERATE_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    GENERATE_DB_PASSWORD: databasePassword,
    YOUR_DATABASE_PASSWORD: databasePassword,
  };
  return template.replace(/GENERATE_ADMIN_TOKEN|GENERATE_WEBHOOK_SECRET|GENERATE_ENCRYPTION_KEY|GENERATE_DB_PASSWORD|YOUR_DATABASE_PASSWORD/g,
    placeholder => replacements[placeholder]!);
}

export async function initializeEnvironment(directory: string): Promise<void> {
  const template = await readFile(join(directory, '.env.example'), 'utf8');
  // Exclusive creation also protects existing symlinks and concurrent invocations.
  await writeFile(join(directory, '.env'), populateEnvironmentTemplate(template), { flag: 'wx', mode: 0o600 });
}
