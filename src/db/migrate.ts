import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Database } from './database.js';

export async function migrate(db: Database, directory = resolve(process.cwd(), 'migrations')): Promise<void> {
  const files = (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  await db.transaction(async tx => {
    // Transaction-scoped advisory lock serializes migrations across API/worker starts.
    await tx.query('SELECT pg_advisory_xact_lock(74192914)');
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of files) {
      const sql = await readFile(resolve(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await tx.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Migration değiştirildi: ${name}; yeni migration ekleyin.`);
        continue;
      }
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
    }
  });
}
