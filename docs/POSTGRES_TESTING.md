# Gerçek PostgreSQL testleri

`npm run test:postgres`, PostgreSQL'e bağlanarak concurrency ve uçtan uca workflow testlerini açıkça çalıştırır. `TEST_DATABASE_URL` yoksa komut hata kodu `1` ile durur; atlanmış testleri başarı olarak sunmaz. Bağlantı tanımlandığında Vitest'in çıkış kodunu aynen döndürür. Normal `npm test` komutunda bağlantı tanımlanmayan bu testler `skipped` olarak görünmeye devam eder.

## Ayrı test veritabanı kullanın

**Yalnız test için oluşturulmuş, silinebilir bir PostgreSQL 17 veritabanı kullanın. Üretim veya kişisel verilerin bulunduğu veritabanını vermeyin.** Test bağlantısının schema oluşturma ve silme yetkisi olmalıdır. Her test grubu rastgele ve bağımsız bir schema oluşturur; `search_path` ayarıyla bütün migration ve uygulama sorgularını bu schema'ya yönlendirir. Grup sonunda yalnız oluşturduğu schema'yı siler. Süreç zorla sonlandırılırsa kalan `brand_engine_test_...` veya `brand_workflow_test_...` schema'ları yalnız test veritabanında kontrol edilerek temizlenebilir.

Bu komut PostgreSQL sunucusu oluşturmaz veya başlatmaz. Önceden erişilebilir bir test veritabanı gerekir. `TEST_DATABASE_URL` değerini terminal ortamında veya CI secret olarak tanımlayın. Runner proje `.env` dosyasını otomatik yüklemez; `DATABASE_URL` değişkenini yedek bağlantı olarak kullanmaz.

Proje dizininden örnek kullanım; aşağıdaki kullanıcı, parola ve adres yalnız yer tutucudur:

```sh
export TEST_DATABASE_URL='postgresql://TEST_USER:TEST_PASSWORD@TEST_HOST:5432/brand_engine_test'
npm run test:postgres
unset TEST_DATABASE_URL
```

Gerçek bağlantı bilgisini repository'ye veya test raporuna kaydetmeyin. Runner bağlantı URI'sini ve parse hatası ayrıntılarını yazdırmaz.

## Doğrulanan kapsam

- `tests/postgres-concurrency.test.ts`: 8 test. Ayrı bağlantı havuzları, eşzamanlı migration, aynı/farklı onay yarışları, tek yayın başlangıcı, eşzamanlı revizyonda sürüm kontrolü, kullanıcı başına tek aktif iş, kilitli kullanıcının atlanması, Telegram update deduplication ve PostgreSQL veri bütünlüğü kısıtları.
- `tests/postgres-workflow.test.ts`: 1 test. Scheduler → ilk taslak → yalnız hook revizyonu → CTA çıkarma → eski sürüm onayının reddi → son sürümün açık onayı → tek yayın çağrısı → kalıcı yayın kaydı ve Telegram sonuç bildirimi.

Toplam **9 test** gerçek PostgreSQL üzerinde çalışır. Uygulama, HTTP webhook işleme, scheduler, repository, transaction ve kuyruklar gerçektir. Dış LinkedIn/Telegram servisleri ve LLM, açık test adapter'ları kullanır; testler gerçek LinkedIn gönderisi yayınlamaz, Telegram mesajı göndermez veya ücretli LLM çağrısı yapmaz. Canlı sağlayıcı erişimi ve OAuth izinleri ayrı doğrulama gerektirir.
