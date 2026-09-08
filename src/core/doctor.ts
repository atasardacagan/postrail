import { z } from 'zod';

export type DoctorStatus = 'ok' | 'missing' | 'invalid' | 'warning' | 'skipped';
export interface DoctorCheck { key: string; status: DoctorStatus; message: string }
export interface DoctorOptions {
  mode?: 'live' | 'offline';
  envFile?: 'present' | 'missing' | 'unreadable';
  nodeVersion?: string;
}
export interface DoctorReport {
  mode: 'live' | 'offline'; ready: boolean; checks: DoctorCheck[]; note: string;
}

const placeholders = /(?:^|[\s:/@._-])(?:YOUR(?:_|-)|GENERATE(?:_|-)|CHANGE(?:_|-)ME|REPLACE(?:_|-)|INSERT(?:_|-)|TODO(?:$|[_-])|PLACEHOLDER|offline-only)|example\.(?:com|org|net|invalid)|YOUR_DOMAIN|YOUR_DATABASE_PASSWORD|\$\{[^}]+\}/i;
// Keep this module free of config.ts: that entry point loads dotenv as a side effect.
// Credential diagnostics below are stricter than startup; this schema covers runtime options only.
const runtimeSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).max(255).refine(text => !/\s/.test(text)).optional(),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(100).max(60000).default(5000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
});
const containsControl = (text: string) => [...text].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
function placeholder(value: string): boolean {
  return placeholders.test(value) || /^(?:x{4,}|0{8,}|1{8,}|a{8,}|secret|password|changeme|test-token)$/i.test(value);
}
function safeUrl(value: string, protocol: 'database' | 'redirect', production: boolean): boolean {
  try {
    const url = new URL(value);
    const decoded = [url.hostname, url.username, url.password, url.pathname].map(part => decodeURIComponent(part));
    if (decoded.some(placeholder) || url.hash) return false;
    if (protocol === 'database') return ['postgres:', 'postgresql:'].includes(url.protocol) && !!url.hostname && url.pathname.length > 1;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return !!url.hostname && !url.username && !url.password && !url.search &&
      (url.protocol === 'https:' || !production && local && url.protocol === 'http:');
  } catch { return false; }
}

/** Pure diagnostic result contains allowlisted key names and fixed messages; never input values. */
export function diagnoseEnvironment(input: NodeJS.ProcessEnv, options: DoctorOptions = {}): DoctorReport {
  const mode = options.mode ?? 'live';
  const checks: DoctorCheck[] = [];
  const add = (key: string, status: DoctorStatus, message: string) => checks.push({ key, status, message });
  const value = (key: string) => input[key]?.trim() ?? '';
  const field = (key: string, valid: (text: string) => boolean, message: string, required = true): boolean => {
    const text = value(key);
    if (!text) { add(key, required ? 'missing' : 'skipped', required ? message : 'Bu bağlantı yolunda gerekli değil.'); return !required; }
    if (placeholder(text)) { add(key, 'invalid', 'Örnek veya yer tutucu değer var; kendi gerçek yapılandırmanızla değiştirin.'); return false; }
    if (!valid(text)) { add(key, 'invalid', message); return false; }
    add(key, 'ok', 'Yerel biçim kontrolü geçti.'); return true;
  };
  if (options.nodeVersion !== undefined) {
    const version = /^v?(\d+)\.\d+\.\d+(?:[-+].*)?$/.exec(options.nodeVersion);
    add('NODE_RUNTIME', version && Number(version[1]) >= 24 ? 'ok' : 'invalid', version && Number(version[1]) >= 24 ? 'Node.js çalışma sürümü uygun.' : 'Node.js 24 veya üstünü kurun.');
  }
  if (options.envFile !== undefined) {
    if (options.envFile === 'present') add('ENV_FILE', 'ok', 'Yerel environment dosyası okunabildi; değerler rapora eklenmedi.');
    else if (options.envFile === 'missing') add('ENV_FILE', mode === 'offline' ? 'skipped' : 'warning', mode === 'offline' ? 'Offline çalışma environment dosyası gerektirmez.' : 'Yerel dosya yok. npm run env:init çalıştırın veya gerekli alanları servis environment ayarlarından sağlayın.');
    else add('ENV_FILE', mode === 'offline' ? 'warning' : 'invalid', 'Environment dosyası okunamadı; dosya izinlerini kontrol edin.');
  }

  if (mode === 'offline') {
    // Match scripts/offline.ts: provider environment and any existing live DB URL are ignored.
    const offlineInput = { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: input.PORT ?? '3000' };
    if (runtimeSchema.safeParse(offlineInput).success) add('OFFLINE_STARTUP_SCHEMA', 'ok', 'Yerel offline başlangıç seçenekleri uygun. npm run dev:offline ile çalıştırın.');
    else add('OFFLINE_STARTUP_SCHEMA', 'invalid', 'Offline başlangıç seçenekleri geçersiz; PORT alanını kontrol edin.');
    add('EXTERNAL_SERVICES', 'skipped', 'Telegram, LinkedIn, AI ve canlı veritabanı credential alanları offline yolda kullanılmaz.');
    return { mode, ready: !checks.some(check => check.status === 'missing' || check.status === 'invalid'), checks,
      note: 'Yalnız yerel offline yapılandırma incelendi. Dosya yazma, port bağlama veya ağ çağrısı yapılmadı; canlı kullanım hazır sayılmaz.' };
  }

  field('APP_MODE', text => text === 'live', 'Canlı hazır olma kontrolü için APP_MODE=live seçin.');
  const production = !value('NODE_ENV') || value('NODE_ENV') === 'production';
  if (value('NODE_ENV')) field('NODE_ENV', text => ['production', 'development', 'test'].includes(text), 'NODE_ENV production, development veya test olmalı.');
  else add('NODE_ENV', 'warning', 'NODE_ENV tanımlı değil; canlı deployment için production seçin.');
  field('ADMIN_API_TOKEN', text => text.length >= 32 && text.length <= 500 && !/\s/.test(text) && !containsControl(text), 'ADMIN_API_TOKEN için en az 32 karakter bağımsız rastgele anahtar üretin.');
  field('TELEGRAM_WEBHOOK_SECRET', text => /^[A-Za-z0-9_-]{32,256}$/.test(text), 'TELEGRAM_WEBHOOK_SECRET için 32–256 güvenli karakterden oluşan bağımsız anahtar üretin.');
  field('TOKEN_ENCRYPTION_KEY', text => /^[a-f0-9]{64}$/i.test(text), 'TOKEN_ENCRYPTION_KEY 32 byte değerinin 64 karakter hex gösterimi olmalı.');
  const secrets = ['ADMIN_API_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TOKEN_ENCRYPTION_KEY'].map(value).filter(Boolean);
  const secretForms = secrets.map(secret => /^[a-f0-9]+$/i.test(secret) ? secret.toLowerCase() : secret);
  add('SECRET_SEPARATION', new Set(secretForms).size === secretForms.length ? 'ok' : 'invalid', new Set(secretForms).size === secretForms.length ? 'Mevcut yönetim, webhook ve şifreleme anahtarları birbirinden farklı.' : 'ADMIN_API_TOKEN, TELEGRAM_WEBHOOK_SECRET ve TOKEN_ENCRYPTION_KEY için ayrı rastgele anahtarlar kullanın.');

  field('TELEGRAM_ALLOWED_USER_ID', text => /^[1-9]\d{0,15}$/.test(text) && Number.isSafeInteger(Number(text)) && !['123456', '123456789', '12345', '111111'].includes(text), 'Botunuzdaki kendi özel mesajınızın gerçek sayısal from.id değerini kullanın; örnek ID kullanmayın.');
  field('TELEGRAM_BOT_TOKEN', text => /^[1-9]\d{4,}:[A-Za-z0-9_-]{20,}$/.test(text), 'BotFather tarafından verilen bot token alanını doldurun.');
  field('LLM_API_KEY', text => text.length >= 20 && !/\s/.test(text), 'Kendi AI sağlayıcı API anahtarınızı girin.');
  if (value('LLM_MODEL')) field('LLM_MODEL', text => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(text), 'Geçerli ve hesabınızın erişebildiği model kimliğini seçin.');
  else add('LLM_MODEL', 'ok', 'Model ayarı varsayılan yapılandırmadan alınacak; hesap erişimi çevrimiçi doğrulanmadı.');
  field('DATABASE_URL', text => safeUrl(text, 'database', production), 'Gerçek PostgreSQL bağlantı URL alanını doldurun. Compose bu alanı container içinde POSTGRES_PASSWORD ile oluşturur; ana makine kontrolü mevcut alanı inceler.');
  field('POSTGRES_PASSWORD', text => text.length >= 16 && !containsControl(text), 'Compose kullanıyorsanız POSTGRES_PASSWORD için en az 16 karakter rastgele parola oluşturun.', false);

  const clientFields = ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI'];
  const oauthComplete = clientFields.every(key => !!value(key));
  const oauthTouched = clientFields.some(key => !!value(key));
  const manualComplete = !!value('LINKEDIN_ACCESS_TOKEN') && !!value('LINKEDIN_AUTHOR_URN');
  if (oauthComplete || !manualComplete) {
    field('LINKEDIN_CLIENT_ID', text => /^[A-Za-z0-9_-]{4,}$/.test(text), 'LinkedIn Developer App client ID alanını doldurun.');
    field('LINKEDIN_CLIENT_SECRET', text => text.length >= 12 && !/\s/.test(text), 'LinkedIn Developer App client secret alanını doldurun.');
    field('LINKEDIN_REDIRECT_URI', text => safeUrl(text, 'redirect', production), 'Developer Portal ile aynı callback URL gerekli; production HTTPS, development yalnız localhost HTTP kabul eder.');
    if (!oauthComplete) add('LINKEDIN_CONNECTION', 'missing', 'OAuth client ID, client secret ve redirect URI üçlüsünü tamamlayın; alternatif hazır access token ile author URN birlikte kullanılabilir.');
    if (manualComplete && oauthComplete) add('LINKEDIN_CONNECTION', 'warning', 'İki LinkedIn bağlantı yolu tanımlı. Runtime tam OAuth yapılandırmasını öncelikli kullanır; kullanılmayan alternatif alanları temizleyin.');
    field('LINKEDIN_ACCESS_TOKEN', text => text.length >= 20 && !/\s/.test(text), 'Geçerli LinkedIn erişim token alanını girin.', false);
    field('LINKEDIN_AUTHOR_URN', text => /^urn:li:person:[A-Za-z0-9_-]+$/.test(text), 'Kişisel LinkedIn yazar kimliği urn:li:person biçiminde olmalı.', false);
  } else {
    field('LINKEDIN_ACCESS_TOKEN', text => text.length >= 20 && !/\s/.test(text), 'Geçerli LinkedIn erişim token alanını girin.');
    field('LINKEDIN_AUTHOR_URN', text => /^urn:li:person:[A-Za-z0-9_-]+$/.test(text), 'Kişisel LinkedIn yazar kimliği urn:li:person biçiminde olmalı.');
    add('LINKEDIN_CONNECTION', 'warning', oauthTouched ? 'Hazır token yolu kullanılacak; eksik OAuth alanlarını temizleyin. Hazır token otomatik yenilenmez.' : 'Hazır token yolu kullanılacak; süresi dolduğunda token yenileme gerekir.');
  }
  if (value('LINKEDIN_API_VERSION')) field('LINKEDIN_API_VERSION', text => /^20\d{2}(0[1-9]|1[0-2])$/.test(text), 'API sürümü YYYYMM biçiminde olmalı; sağlayıcının desteklediği sürümler ayrıca kontrol edilmeli.');
  else add('LINKEDIN_API_VERSION', 'ok', 'Varsayılan API sürümü kullanılacak; sağlayıcı destek durumu çevrimiçi doğrulanmadı.');
  if (value('TELEGRAM_MODE')) field('TELEGRAM_MODE', text => text === 'polling' || text === 'webhook', 'TELEGRAM_MODE polling veya webhook olmalı.');
  if (value('TELEGRAM_MODE') === 'webhook') add('TELEGRAM_WEBHOOK_REGISTRATION', 'warning', 'HTTPS webhook adresini npm run telegram:configure komutuyla Telegram tarafına ayrıca kaydedin; bu kontrol kayıt işlemi yapmaz.');
  if (value('LINKEDIN_ANALYTICS_ENABLED')) field('LINKEDIN_ANALYTICS_ENABLED', text => text === 'true' || text === 'false', 'Analitik ayarı yalnız true veya false olmalı.');
  if (value('LINKEDIN_ANALYTICS_ENABLED') === 'true') add('LINKEDIN_ANALYTICS_ACCESS', 'warning', 'Community Management API erişimi ve r_member_postAnalytics iznini sağlayıcıdan alıp yeniden OAuth yapın; erişim burada doğrulanmadı.');
  if (runtimeSchema.safeParse(input).success) add('RUNTIME_OPTIONS', 'ok', 'Port, host, worker ve log başlangıç seçenekleri uygun.');
  else add('RUNTIME_OPTIONS', 'invalid', 'Başlangıç seçenekleri geçersiz. PORT, HOST, WORKER_INTERVAL_MS, NODE_ENV ve LOG_LEVEL alanlarını kontrol edin.');
  return { mode, ready: !checks.some(check => check.status === 'missing' || check.status === 'invalid'), checks,
    note: 'Bu rapor yalnız yerel yapılandırmayı inceler. Dosya değiştirilmedi; ağ, OAuth, mesaj veya yayın çağrısı yapılmadı. Hazır sonucu canlı hesap bağlantılarının doğrulandığı anlamına gelmez.' };
}

export function formatDoctorReport(report: DoctorReport): string {
  const labels: Record<DoctorStatus, string> = { ok: 'UYGUN', missing: 'EKSİK', invalid: 'GEÇERSİZ', warning: 'KONTROL', skipped: 'ATLANDI' };
  return [
    `Brand Engine yapılandırma kontrolü · ${report.mode === 'live' ? 'canlı' : 'offline'}`,
    report.ready ? 'Yerel yapılandırma kontrolleri geçti.' : 'Yerel yapılandırma tamamlanmalı.',
    '', ...report.checks.map(check => `[${labels[check.status]}] ${check.key}: ${check.message}`), '', report.note, '',
  ].join('\n');
}
