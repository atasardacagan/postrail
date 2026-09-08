import { loadEnv } from './core/config.js';
import { createRuntime, startWorker } from './runtime.js';
try {
  const runtime = await createRuntime(loadEnv());
  const stopWorker = startWorker(runtime);
  runtime.logger.info({ event: 'worker_started', mode: runtime.env.APP_MODE });
  const stop = async () => { await stopWorker(); await runtime.app.close(); await runtime.db.close(); };
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
} catch (error) {
  process.stderr.write(`Worker başlatılamadı: ${error instanceof Error && error.message.startsWith('Yapılandırma') ? error.message : 'Database, migration ve environment ayarlarını kontrol edin.'}\n`);
  process.exitCode = 1;
}
