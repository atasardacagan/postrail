import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { dirname, resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl?.trim()) {
  process.stderr.write('TEST_DATABASE_URL eksik. Ayrı ve silinebilir bir PostgreSQL test veritabanı tanımlayın; docs/POSTGRES_TESTING.md dosyasını izleyin. Testler çalıştırılmadı.\n');
  process.exitCode = 1;
} else {
  let validUrl = false;
  try {
    const parsed = new URL(databaseUrl);
    validUrl = ['postgres:', 'postgresql:'].includes(parsed.protocol) && Boolean(parsed.hostname || parsed.searchParams.get('host'));
  } catch { /* Connection strings and parsing errors must never be printed. */ }
  if (!validUrl) {
    process.stderr.write('TEST_DATABASE_URL geçerli bir PostgreSQL bağlantı URI değeri olmalı. Güvenlik nedeniyle verilen değer gösterilmiyor. Testler çalıştırılmadı.\n');
    process.exitCode = 1;
  } else {
    const require = createRequire(import.meta.url);
    let vitestEntry: string | undefined;
    try { vitestEntry = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'); }
    catch {
      process.stderr.write('PostgreSQL test çalıştırıcısı bulunamadı. Proje dizininde npm ci çalıştırıp yeniden deneyin.\n');
      process.exitCode = 1;
    }
    if (vitestEntry) {
      process.stdout.write('Gerçek PostgreSQL concurrency ve uçtan uca workflow testleri çalıştırılıyor. Bağlantı bilgileri gösterilmez.\n');
      process.exitCode = await new Promise<number>(resolveExit => {
        const child = spawn(process.execPath, [vitestEntry, 'run', 'tests/postgres-concurrency.test.ts', 'tests/postgres-workflow.test.ts'], {
          stdio: 'inherit', env: process.env,
        });
        const interrupt = () => { child.kill('SIGINT'); };
        const terminate = () => { child.kill('SIGTERM'); };
        process.once('SIGINT', interrupt);
        process.once('SIGTERM', terminate);
        const cleanup = () => {
          process.removeListener('SIGINT', interrupt);
          process.removeListener('SIGTERM', terminate);
        };
        child.once('error', () => {
          cleanup();
          process.stderr.write('PostgreSQL test süreci başlatılamadı. Node.js ve proje bağımlılıklarını kontrol edin.\n');
          resolveExit(1);
        });
        child.once('close', (code, signal) => {
          cleanup();
          resolveExit(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1));
        });
      });
    }
  }
}
