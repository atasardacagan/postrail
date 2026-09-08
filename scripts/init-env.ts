import { initializeEnvironment } from '../src/core/environment-template.js';

try {
  await initializeEnvironment(process.cwd());
  process.stdout.write('.env oluşturuldu. Servis hesap alanlarını kendi bilgilerinizle doldurun; ardından npm run doctor çalıştırın.\n');
} catch (error) {
  const exists = typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
  process.stderr.write(exists
    ? '.env zaten var; mevcut ayarlar ve anahtarlar korundu. Dosyayı düzenleyip npm run doctor çalıştırın.\n'
    : '.env oluşturulamadı. Proje dizininde .env.example dosyasını ve yazma izinlerini kontrol edin.\n');
  process.exitCode = 1;
}
