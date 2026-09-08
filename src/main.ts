import { loadEnv } from './core/config.js';
import { createRuntime } from './runtime.js';
try {
  const runtime = await createRuntime(loadEnv());
  await runtime.app.listen({ host: runtime.env.HOST, port: runtime.env.PORT });
  runtime.logger.info({ event: 'api_started', port: runtime.env.PORT, mode: runtime.env.APP_MODE });
  const stop = async () => { await runtime.app.close(); await runtime.db.close(); };
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
} catch (error) {
  process.stderr.write(`Başlatma başarısız: ${error instanceof Error && error.message.startsWith('Yapılandırma') ? error.message : 'Database, migration ve environment ayarlarını kontrol edin.'}\n`);
  process.exitCode = 1;
}
