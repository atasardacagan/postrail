import 'dotenv/config';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Settings } from './types.js';

export const categories = [
  'Web tasarımı', 'Modern web geliştirme', 'Şirket otomasyonu', 'AI otomasyonları',
  'AI agent sistemleri', 'Vibe Coding', 'SaaS geliştirme', 'Micro-SaaS', 'No-code / Low-code',
  'n8n otomasyonları', 'AI ile iş süreçleri', 'İşletmelerde verimlilik', 'Dijital dönüşüm',
  'Landing page optimizasyonu', 'Conversion Rate Optimization', 'UX/UI', 'Web sitelerinin satışa etkisi',
  'Lead generation', 'CRM otomasyonları', 'Satış otomasyonları', 'AI müşteri hizmetleri',
  'AI ile ürün geliştirme', 'Founder / girişimcilik', 'Building in public', 'Projelerden öğrenilenler',
  'Yazılım ürünleştirme', 'Ajans otomasyonu', 'B2B SaaS', 'AI + SaaS', 'Şirketlerin geleceği',
  'Otomasyon yatırım geri dönüşü', 'Veri kalitesi ve entegrasyon', 'AI güvenilirliği ve insan onayı',
  'Müşteri onboarding', 'Ürün analitiği', 'Erişilebilirlik ve web performansı',
];
const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const settingsSchema = z.object({
  postingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine(x => new Set(x).size === x.length),
  postingTimes: z.array(clockTime).min(1).max(3).refine(x => new Set(x).size === x.length),
  timezone: z.string().refine(v => DateTime.now().setZone(v).isValid, 'Geçerli IANA timezone gerekli'),
  contentLanguage: z.literal('tr'), contentCategories: z.array(z.string().min(2).max(100)).min(1).max(100),
  minPostLength: z.number().int().min(50).max(2000), maxPostLength: z.number().int().min(100).max(3000),
  hashtagMode: z.enum(['none', 'minimal']), ctaFrequency: z.number().min(0).max(1),
  commercialContentRatio: z.number().min(0).max(0.3), telegramUserId: z.string().regex(/^[1-9]\d*$/),
  qualityThreshold: z.number().min(0).max(100), similarityThreshold: z.number().min(0.3).max(1),
  explorationRatio: z.number().min(0.1).max(1), backlogTarget: z.number().int().min(30).max(50),
  weeklyReportDay: z.number().int().min(1).max(7), weeklyReportTime: clockTime, memoryEnabled: z.boolean(),
}).strict().refine(v => v.minPostLength < v.maxPostLength, 'minPostLength maxPostLength değerinden küçük olmalı');

export function defaultSettings(telegramUserId: string): Settings {
  return settingsSchema.parse({ postingDays: [2, 4, 6], postingTimes: ['10:30'], timezone: 'Europe/Istanbul',
    contentLanguage: 'tr', contentCategories: categories, minPostLength: 100, maxPostLength: 2400,
    hashtagMode: 'none', ctaFrequency: 0.55, commercialContentRatio: 0.1, telegramUserId,
    qualityThreshold: 75, similarityThreshold: 0.8, explorationRatio: 0.3, backlogTarget: 40,
    weeklyReportDay: 7, weeklyReportTime: '18:00', memoryEnabled: true });
}
const optional = z.string().optional().transform(x => x?.trim() || undefined);
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_MODE: z.enum(['offline', 'live']).default('offline'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000), HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: optional, ADMIN_API_TOKEN: z.string().min(32),
  TELEGRAM_ALLOWED_USER_ID: z.string().regex(/^[1-9]\d*$/), TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  TELEGRAM_MODE: z.enum(['polling', 'webhook']).default('polling'),
  LLM_API_KEY: optional, LLM_MODEL: z.string().min(1).default('gpt-5-mini'),
  LINKEDIN_CLIENT_ID: optional, LINKEDIN_CLIENT_SECRET: optional, LINKEDIN_REDIRECT_URI: optional,
  LINKEDIN_ACCESS_TOKEN: optional, LINKEDIN_AUTHOR_URN: optional,
  LINKEDIN_ANALYTICS_ENABLED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  LINKEDIN_API_VERSION: z.string().regex(/^20\d{2}(0[1-9]|1[0-2])$/).default('202605'),
  TOKEN_ENCRYPTION_KEY: optional, WORKER_INTERVAL_MS: z.coerce.number().int().min(100).max(60000).default(5000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
}).superRefine((v, ctx) => {
  if (v.NODE_ENV === 'production' && v.APP_MODE !== 'live') ctx.addIssue({ code: 'custom', message: 'Production APP_MODE=live gerektirir' });
  if (v.APP_MODE === 'live') {
    for (const key of ['DATABASE_URL', 'LLM_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TOKEN_ENCRYPTION_KEY'] as const) {
      if (!v[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Live modda gerekli' });
    }
    const oauth = v.LINKEDIN_CLIENT_ID && v.LINKEDIN_CLIENT_SECRET && v.LINKEDIN_REDIRECT_URI;
    if (!oauth && !(v.LINKEDIN_ACCESS_TOKEN && v.LINKEDIN_AUTHOR_URN)) ctx.addIssue({ code: 'custom', message: 'LinkedIn OAuth üçlüsü veya access token + author URN gerekli' });
    if (v.TOKEN_ENCRYPTION_KEY && !/^[a-f0-9]{64}$/i.test(v.TOKEN_ENCRYPTION_KEY)) ctx.addIssue({ code: 'custom', path: ['TOKEN_ENCRYPTION_KEY'], message: '32 byte hex anahtar gerekli (64 karakter)' });
    if (v.LINKEDIN_REDIRECT_URI && !/^https:\/\//.test(v.LINKEDIN_REDIRECT_URI) && v.NODE_ENV === 'production') ctx.addIssue({ code: 'custom', message: 'Production OAuth redirect HTTPS olmalı' });
  }
});
export type Env = z.infer<typeof envSchema>;
export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Yapılandırma geçersiz:\n${parsed.error.issues.map(i => `${i.path.join('.') || 'env'}: ${i.message}`).join('\n')}`);
  return parsed.data;
}
