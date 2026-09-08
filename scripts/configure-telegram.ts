import { loadEnv } from '../src/core/config.js';
import { TelegramBot } from '../src/integrations/telegram.js';
const env = loadEnv();
if (env.APP_MODE !== 'live' || !env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram kurulumu live mod ve bot token gerektirir');
const bot = new TelegramBot({ token: env.TELEGRAM_BOT_TOKEN });
if (env.TELEGRAM_MODE === 'polling') await bot.deleteWebhook();
else {
  const url = process.argv[2]; if (!url) throw new Error('HTTPS webhook URL gerekli');
  await bot.setWebhook(url, env.TELEGRAM_WEBHOOK_SECRET);
}
process.stdout.write('Telegram bağlantı modu yapılandırıldı.\n');
