import { loadEnv } from '../src/core/config.js';
import { createRuntime, startWorker } from '../src/runtime.js';
const env = loadEnv({ NODE_ENV: 'development', APP_MODE: 'offline', HOST: '127.0.0.1', PORT: process.env.PORT ?? '3000', ADMIN_API_TOKEN: 'offline-only-local-admin-token-0001', TELEGRAM_ALLOWED_USER_ID: '123456', TELEGRAM_WEBHOOK_SECRET: 'offline-only-local-webhook-secret-0001' });
const runtime = await createRuntime(env);
const stopWorker = startWorker(runtime);
await runtime.app.listen({ host: env.HOST, port: env.PORT });
process.stdout.write(`Offline geliştirme servisi: http://127.0.0.1:${env.PORT}\nSadece yerel test: gerçek LinkedIn/Telegram/LLM çağrısı yapılmaz.\nAPI örnekleri README.md içinde. Kalıcı veriler .data/postgres altında.\n`);
const stop = async () => { await stopWorker(); await runtime.app.close(); await runtime.db.close(); };
process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
