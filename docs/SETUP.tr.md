# AI Personal Brand & LinkedIn Growth Engine

Türkçe LinkedIn içerik stratejisi, fikir havuzu, AI taslak/editör, Telegram üzerinden doğal dil revizyonu ve açık insan onayı, resmî LinkedIn yayını ve performanstan öğrenme için modüler servis.

**Yayın kararı her zaman insandadır.** Scheduler ve AI yalnız taslak hazırlar. Son taslak sürümüne Telegram'da açık onay verilmeden yayın işi başlayamaz. Revizyon yeni sürüm üretir; eski onay yeni sürüme taşınmaz. Ertelenen içerik yeni saatte tekrar onay ister.

## Mevcut kapsam

- Varsayılan Salı, Perşembe, Cumartesi 10:30; `Europe/Istanbul`. Günler, saatler ve içerik ayarları veritabanından değişir.
- 40 fikir hedefleyen, 30–50 aralığında yapılandırılabilen backlog; 36 başlangıç kategorisi, içerik formatları ve tekrarlayan seriler.
- Yaklaşık %60 eğitim, %20 görüş/deneyim, %10 proje, %10 doğal ticari içerik dengesi. Üç gönderilik tek haftada bu yüzdeler tam sayı olarak oluşmaz; geçmiş üzerinden dengelenir.
- Canlı modda ayrı yazım ve kalite değerlendirme çağrıları. Kaynaksız sayılar, uydurma müşteri deneyimleri, aşırı emoji/hashtag, tekrar ve jenerik dil kontrolü.
- Telegram inline butonları: Onayla, Revize Et, Yeniden Yaz, İptal, Ertele. Metin komutları ve mesaja yanıt üzerinden belirli taslağı seçme.
- Immutable sürümler, onay kayıtları, kalıcı işler/outbox, kontrollü tekrar deneme ve belirsiz yayın sonucunda otomatik durdurma.
- Manuel metrik girişi; izni olan hesaplarda isteğe bağlı resmî member analytics collector'ı. Pazar 18:00 Telegram raporu.
- Yönetim API'si: takvim, fikirler, taslaklar, sürümler, ayarlar, marka hafızası, doğrulanmış kaynak notları ve analitik.
- Docker Compose dağıtımı, migration, offline çalışma ve dış hesap gerektirmeyen entegrasyon testleri.

Bu repository'de browser automation, scraping, otomatik DM veya connection request bulunmaz. İlk sürüm text post akışına odaklanır. Hazır görsel dashboard, carousel/video üretimi, zamanlanmış haber/RSS araştırma hattı ve çok kullanıcılı SaaS üyelik/ödeme sistemi bu sürümün parçası değildir. Resmî Hacker News kaynağından başlık toplayabilen, varsayılan akışa bağlı olmayan bir `TrendSource` adaptörü vardır; haberler otomatik doğrulanmış kanıt sayılmaz. Diğer kaynaklar aynı sözleşmeye eklenebilir.

## Mimari

```mermaid
flowchart TD
    S[Worker scheduler / isteğe bağlı n8n] --> Q[PostgreSQL kalıcı işler]
    Q --> I[Fikir havuzu ve strateji seçimi]
    I --> W[AI yazar]
    H[Geçmiş, kaynaklar, marka hafızası] --> W
    W --> E[Bağımsız kalite editörü + kurallı kontroller]
    E --> D[Sürümlü taslak]
    D --> O[Telegram outbox]
    O --> T[İzinli kullanıcı]
    T -->|Doğal dil revizyonu| R[Hedef blok editörü]
    R --> D
    T -->|Son sürüme açık onay| A[Kalıcı onay kaydı]
    A --> P[Yayın işi]
    P --> L[Resmî LinkedIn Posts API]
    L --> B[Yayın sonucu ve Telegram bildirimi]
    B --> M[Manuel / izinli API metrikleri]
    M --> H
```

**Stack:** Node.js 24, TypeScript strict, Fastify, PostgreSQL, Zod, Luxon, Vitest. API ve worker ayrı süreçlerdir. PostgreSQL aynı zamanda queue/outbox saklar; Redis gerektirmez. İşler lease ve transaction ile alınır. TypeScript sözleşmeleri `ContentEngine`, `TelegramPort`, `LinkedInPort` katmanlarını ayırır.

**n8n kararı:** Core iş kuralları backend'dedir. Versiyon kontrolü, onay, transaction, retry ve zamanlama tek büyük workflow'a gömülmez. n8n yalnız isteğe bağlı orkestrasyon için korunan `/v1/tick` adresini çağırır. Built-in worker tek başına yeterlidir; n8n kurulması ilk çalışmayı engellemez.

## Gereksinimler

- Offline geliştirme/test: Node.js **24+**, npm ve paket kurulumunda internet.
- Canlı yerel/production çalışma: Docker Engine + Compose veya Node.js 24 + PostgreSQL.
- Telegram bot token ve yalnız sizin sayısal Telegram user ID'niz.
- Canlı AI için API hesabınızda erişilebilir bir OpenAI modeline ait API anahtarı.
- LinkedIn Developer App ürün izinleri, OAuth client bilgileri ve sizin tarayıcıda vereceğiniz OAuth yetkisi.
- Production webhook/OAuth için size ait HTTPS adresi. Polling modunda Telegram inbound webhook adresi gerekmese de OAuth callback için erişilebilir adres gerekir.

Gerçek secret'ları bu dosyaya, Git'e, n8n workflow JSON'una veya loglara koymayın. `.env` yerel yapılandırmadır; `.env.example` yalnız boş alanlar ve açıklamalar içerir.

## Hızlı başlangıç: dış hesapsız doğrulama

```sh
npm ci
npm run check
npm run demo
```

`check`: typecheck → lint → test → build. `demo`, ayrı veritabanında scheduler → taslak → giriş revizyonu → CTA çıkarma → son sürüm onayı → kayıt ve başarı bildirimi senaryosunu çalıştırır. Telegram/LinkedIn adaptörleri offline seçildiği için dışarı mesaj veya gönderi gitmez. Offline LinkedIn sonuçları `example.invalid` URL taşır.

Kalıcı yerel geliştirme için:

```sh
npm run dev:offline
```

Bu çalışma `http://127.0.0.1:3000` adresinde açılır, veriyi `.data/postgres` altında saklar. Yalnız offline geliştirmede yönetim token'ı `offline-only-local-admin-token-0001`, örnek Telegram kullanıcı ID'si `123456`dır. Bu sabit geliştirme token'ını internete açık veya canlı deployment'ta kullanmayın. PGlite dizinini aynı anda birden fazla Node süreciyle açmayın; production için ayrı PostgreSQL sunucusu kullanılır. Offline yazım adaptörü kontrollü fixture üretir; gerçek AI kalitesinin testi değildir.

Taslak istemek ve kaydedilen sahte Telegram mesajlarını görmek için:

```sh
curl -X POST http://127.0.0.1:3000/v1/drafts/generate \
  -H 'Authorization: Bearer offline-only-local-admin-token-0001'
curl http://127.0.0.1:3000/v1/offline/messages \
  -H 'Authorization: Bearer offline-only-local-admin-token-0001'
```

Worker işi tamamladığında messages dolacaktır. Doğal dil update simülasyonu ve kontrollü iş yürütme örnekleri [offline API bölümünde](API.md#offline-geliştirme-yardımcıları) bulunur. `npm run demo` bütün kabul akışını bu manuel adımlar olmadan çalıştırır.

## Canlı yerel kurulum: Docker

1. Örnek yapılandırmadan, rastgele yerel secret'larla `.env` oluşturun:

   ```sh
   npm run env:init
   ```

   Bu komut mevcut `.env` dosyasını ezmez; admin token, webhook secret, encryption key ve PostgreSQL parolası üretir, dosyayı yalnız sahibinin okuyabileceği izinle yazar. `DATABASE_URL` aynı üretilen PostgreSQL parolasını kullanır; Compose container içinde veritabanı host'unu `postgres` olarak değiştirir. Ayrı/yönetilen PostgreSQL kullanıyorsanız URL'yi kendi bağlantınızla değiştirin. Alternatif olarak `cp .env.example .env` kullanıp bütün `GENERATE_...` yer tutucularını ve veritabanı parolasını kendiniz değiştirebilirsiniz.

2. `.env` içinde `APP_MODE=live` seçin; aşağıdaki Telegram, AI ve LinkedIn alanlarını doldurun. `env:init` kullanmadıysanız yönetim token'ı ve webhook secret için ayrı rastgele değerler üretin. Şifreleme anahtarı için:

   ```sh
   node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex') + '\n')"
   ```

   Bu komut her çalışmada yeni 64 karakter hex değer verir. `TOKEN_ENCRYPTION_KEY` için bir değer, `ADMIN_API_TOKEN` için başka değer, `TELEGRAM_WEBHOOK_SECRET` için başka değer kullanın. Mevcut token kayıtları varken encryption key'i rastgele değiştirmeyin.

3. Yerel yapılandırmayı kontrol edin, ardından servisleri başlatın:

   ```sh
   npm run doctor
   docker compose up --build -d
   docker compose ps
   docker compose logs --tail=100 api worker
   ```

   PostgreSQL hazır olduktan sonra migration çalışır; API ve worker başlar. `.env` değiştiğinde ilgili container'ları yeniden oluşturun. Volüm verileri kalıcıdır; `docker compose down -v` verileri siler.

4. Health kontrolleri:

   ```sh
   curl http://127.0.0.1:3000/health/live
   curl http://127.0.0.1:3000/health/ready
   ```

5. Aşağıdaki OAuth adımını tamamlayın. Botla özel sohbeti açıp `/start` gönderin. İlk taslağı yönetim API'sinden isteyin. Telegram'a gelen son sürümü kontrol edip onaylayana kadar LinkedIn yayını başlamaz.

Docker olmadan canlı çalıştırmak için PostgreSQL bağlantısını `.env` içindeki `DATABASE_URL` ile tanımlayıp ayrı terminallerde çalıştırın:

```sh
npm ci
npm run db:migrate
npm run dev
```

```sh
npm run worker
```

### Hesap bilgilerini göstermeden kurulum kontrolü

```sh
npm run doctor
npm run doctor -- --offline
npm run doctor -- --json
```

Varsayılan kontrol canlı yapılandırmayı inceler: eksik veya örnek hesap bilgileri, sayısal Telegram kimliği, bağımsız güvenlik anahtarları, PostgreSQL URL biçimi, OAuth callback ve başlangıç seçenekleri. Çıktıda yalnız alan adı, durum ve sabit açıklamalar vardır; hiçbir anahtar veya bağlantı URL'si gösterilmez. Komut `.env` dosyasını değiştirmez ve dış servislere bağlanmaz. Environment değişkenleri aynı adlı `.env` alanlarından önceliklidir.

Eksik/geçersiz alan varsa çıkış kodu `1`, yerel kontroller geçerse `0`, bilinmeyen komut seçeneğinde `2` döner. `--offline` yalnız yerel çalışma ayarlarını inceler; canlı hesap bağlantılarının hazır olduğunu söylemez. Başarılı canlı yapılandırma kontrolü de veritabanı erişimini, OAuth iznini veya provider kotasını doğrulamaz; bunlar servisler başladıktan sonra doğrulanır. Bu son bağlantı sırası [canlı aktivasyon rehberinde](ACTIVATION.md) bulunur.

## Telegram bot ve user ID

1. Telegram'da resmî [BotFather](https://t.me/BotFather) hesabını açın; `/newbot` ile bot adı ve kullanıcı adı oluşturun.
2. Token'ı `TELEGRAM_BOT_TOKEN` alanına yazın.
3. Oluşturduğunuz botla **özel sohbeti** başlatın; `/start` gönderin. Bot, siz sohbeti başlatmadan ilk özel mesajı gönderemeyebilir.
4. User ID'yi elde etmek için worker henüz çalışmıyorken Bot API `getUpdates` yanıtındaki sizin özel mesajınızın `message.from.id` değerini okuyun. `.env` okuyan, token'ı terminale veya hata URL'sine basmayan tek seferlik komut:

   ```sh
   node --env-file=.env --input-type=module -e 'try { const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`); const data=await r.json(); console.log(JSON.stringify((data.result ?? []).flatMap(u=>u.message?.chat?.type==="private"?[{userId:u.message.from?.id,chatId:u.message.chat.id}]:[]),null,2)); } catch { console.error("Telegram bağlantısı kurulamadı"); process.exitCode=1; }'
   ```

5. Sizin kullanıcı kimliğinizi `TELEGRAM_ALLOWED_USER_ID` alanına yazın. Bu değer kullanıcı adı (`@...`) veya bot ID'si değildir. Kendi özel sohbetinizde user ID ve chat ID eşleşir.

`getUpdates` boşsa botunuza yeniden mesaj gönderin. Aktif webhook varsa önce kontrollü olarak webhook'u kaldırıp polling'e geçin; aynı token ile iki polling worker çalıştırmayın. Telegram Bot API üzerinde izinli kullanıcı filtresi yoktur; uygulama kontrolü server-side uygular. [Bot API referansı](https://core.telegram.org/bots/api#getupdates)

### Polling veya webhook

`TELEGRAM_MODE=polling` başlangıç için uygundur. Worker update'leri alır ve kalıcı inbox'a yazar. Yapılandırma alanlarını doldurduktan sonra `npm run telegram:configure` mevcut webhook'u pending update'leri silmeden kaldırır.

`TELEGRAM_MODE=webhook` için dış HTTPS URL'niz `/webhooks/telegram` ile bitmelidir. Kurulum komutu `.env` içindeki `TELEGRAM_WEBHOOK_SECRET` değerini Telegram'a `secret_token` olarak iletir. Secret yoksa gelen istek `401` alır:

```sh
npm run telegram:configure -- https://engine.example.com/webhooks/telegram
```

Public URL örneğini kendi adresinizle değiştirin. Reverse proxy bu header'ı backend'e iletmelidir: `X-Telegram-Bot-Api-Secret-Token`. Uygulama `from.id`, özel sohbet tipi ve chat ID'yi birlikte doğrular. İzinli olmayan bir kullanıcı içerik göremez veya işlem yaptıramaz.

## LinkedIn Developer App ve OAuth

1. [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) üzerinden uygulama oluşturun. Portalın istediği şirket sayfası/uygulama doğrulama ve ürün başvuru adımlarını tamamlayın.
2. **Products** bölümünde **Share on LinkedIn** erişimini etkinleştirin; `w_member_social` kapsamının uygulamada mevcut olduğunu doğrulayın.
3. **Sign In with LinkedIn using OpenID Connect** ürününü etkinleştirin. `openid profile` ile kişisel yazar kimliği resmî `userinfo` endpoint'inden alınır.
4. **Auth** bölümünde OAuth redirect URL ekleyin. Örneğin `https://engine.example.com/oauth/linkedin/callback`. Protokol, host, port ve path `.env` ile birebir eşleşmelidir.
5. `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI` ve `TOKEN_ENCRYPTION_KEY` alanlarını doldurun; servisleri yeniden başlatın.
6. Korunan bağlantı endpoint'ini çağırın. Aşağıdaki `ADMIN_API_TOKEN` örnekleri gerçek değeri shell geçmişine yazmadan process environment veya secret manager üzerinden aktardığınızı varsayar:

   ```sh
   curl -s http://127.0.0.1:3000/v1/linkedin/connect \
     -H "Authorization: Bearer $ADMIN_API_TOKEN"
   ```

7. Dönen `authorizationUrl` adresini kendi tarayıcınızda açın, doğru LinkedIn hesabıyla giriş yapıp izin verin. Callback başarılı bağlantı mesajı döndürür. Bağlantı işlemi hiçbir gönderi yayınlamaz.
8. Bağlantı durumunu kontrol edin:

   ```sh
   curl -s http://127.0.0.1:3000/v1/linkedin/status \
     -H "Authorization: Bearer $ADMIN_API_TOKEN"
   ```

Callback state'i 10 dakika geçerli ve tek kullanımlıktır. Süresi dolduysa yeni `/v1/linkedin/connect` bağlantısı oluşturun. Token'lar AES-256-GCM ile şifrelenerek veritabanında saklanır. Secret değerleri status endpoint'inden dönmez.

Programatik refresh token her uygulamaya verilmez. LinkedIn bunu onaylı MDP ortakları için sunar. Sağlayıcı refresh token vermediyse erişim süresi bitince yeniden OAuth gerekir; sistem refresh token uydurmaz. Token/refresh süresi dolması durumunda taslak ve onay kaydı korunur. [LinkedIn OAuth refresh sınırları](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)

Geçici erişim token'ıyla çalışmak gerekiyorsa OAuth üçlüsü yerine `LINKEDIN_ACCESS_TOKEN` ve `LINKEDIN_AUTHOR_URN=urn:li:person:...` kullanılabilir. Bu yolun otomatik refresh'i yoktur; kalıcı kullanım için OAuth tercih edilir. Resmî kişisel paylaşım ve scope gereklilikleri için [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-05) ve [OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2) belgelerine bakın.

## Environment değişkenleri

| Değişken | Kullanım |
| --- | --- |
| `APP_MODE` | `offline` veya `live`; production `live` ister |
| `NODE_ENV` | `development`, `test`, `production` |
| `HOST`, `PORT` | Dinleme adresi ve port; host geliştirmede loopback, container'da `0.0.0.0` |
| `DATABASE_URL` | Canlı PostgreSQL bağlantısı |
| `POSTGRES_PASSWORD` | Compose PostgreSQL parolası; `env:init` üretir |
| `ADMIN_API_TOKEN` | Yönetim API'si için en az 32 karakter ayrı gizli anahtar |
| `TELEGRAM_BOT_TOKEN` | BotFather token'ı; live modda gerekli |
| `TELEGRAM_ALLOWED_USER_ID` | Tek izinli gerçek kullanıcının pozitif sayısal ID'si |
| `TELEGRAM_WEBHOOK_SECRET` | 32–256 karakter; harf/rakam/alt çizgi/tire |
| `TELEGRAM_MODE` | `polling` veya `webhook` |
| `LLM_API_KEY` | Canlı AI anahtarı |
| `LLM_MODEL` | Varsayılan `gpt-5-mini`; hesabınızın erişimi olmalı |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | OAuth uygulama bilgileri |
| `LINKEDIN_REDIRECT_URI` | Developer Portal'a kaydedilen tam callback URL |
| `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` | OAuth saklama akışına alternatif hazır token bağlantısı |
| `LINKEDIN_API_VERSION` | Başlangıç `202605`; desteklenen YYYYMM sürümü |
| `LINKEDIN_ANALYTICS_ENABLED` | Varsayılan `false`; yalnız ek API erişimi varsa `true` |
| `TOKEN_ENCRYPTION_KEY` | 32 byte'ın 64 karakter hex gösterimi; live modda gerekli |
| `WORKER_INTERVAL_MS` | Worker döngü aralığı; varsayılan 5000 ms |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `silent` |

Startup doğrulaması eksik veya geçersiz alan adını bildirir; secret'ın değerini yazmaz. OpenAI çağrıları `store: false` ile structured JSON ister. İçerik üretimi sırasında seçilen kaynaklar, marka tercihleri ve ilgili geçmiş AI sağlayıcısına gönderilir; kişisel proje notlarını eklerken gerekli içerikle sınırlı tutun.

## İlk taslak ve doğal dil revizyonu

Planlanan saati beklemeden bir taslak işi oluşturun:

```sh
curl -X POST http://127.0.0.1:3000/v1/drafts/generate \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

`202` yalnız işin kuyruğa alındığı anlamına gelir. Worker üretir, bağımsız editör değerlendirir ve kalite eşiği aşılırsa Telegram'a yollar. Fikir havuzunun ilk dolumu da AI çağrısı gerektirir; birkaç saniyeden uzun sürebilir.

Telegram'da örnek akış:

1. Taslak mesajına yanıt: **“girişi daha kısa ve vurucu yap”**.
2. Yeni sürüm geldiğinde yanıt: **“CTA'yı çıkar”**.
3. Son metni okuyun; **“onayla”** yazın veya son sürümün Onayla butonuna basın.
4. Yayın başarılıysa gönderi URL'si gelir. Son sürüm ve LinkedIn kimliği kalıcı kayda yazılır.

“İkinci paragraf iyi ama başlangıcı değiştir”, “sadece CTA'yı değiştir”, “çok kurumsal olmuş daha doğal yaz”, “emoji kullanma” ve “bunu SaaS kurucularına göre yaz” desteklenir. Dar kapsamlı taleplerde model yalnız izin verilen bloklara edit önerir; başka blokları değiştirmeye çalışırsa işlem reddedilir. Aynı konuya yeni açı için **Yeniden Yaz** kullanılır. Belirsiz “bu kısmı çıkar” talebinde paragrafı veya alıntıyı belirtmek gerekir.

Birden fazla açık taslak varsa belirli taslağın mesajını yanıtlamak veya düğmesini kullanmak bağlamı açık tutar. Eski sürüm düğmesi güncel sürümü onaylamaz. “onayla” dışındaki bir revizyon talebi, metninde yayınlama isteği bulunsa bile yayın onayı yerine geçmez.

**Erteleme örnekleri:** “2 saat ertele”, “yarına ertele”, “akşam 7'ye al”, “Cuma günü paylaş”. İstanbul yerel saatine çevrilir; ertelenen gönderi yeni zamanda tekrar Telegram onayı ister. **İptal** gönderiyi `cancelled` yapar; başka yeni taslak ihtiyacı varsa manuel üretim endpoint'i kullanılabilir.

## Ayarlar, kaynaklar ve kontrol edilebilir hafıza

```sh
curl -X PATCH http://127.0.0.1:3000/v1/settings \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"postingDays":[2,4,6],"postingTimes":["10:30"],"timezone":"Europe/Istanbul","ctaFrequency":0.55,"hashtagMode":"none"}'
```

Günler ISO düzenindedir: Pazartesi 1, Pazar 7. Her `postingTimes` değeri seçilen **her günde** ayrı slot üretir; iki saat seçmek haftalık post sayısını ikiye katlar. `contentLanguage` bu sürümde `tr`dir. Hard içerik üst sınırı en fazla 3000, başlangıç üst sınırı 2400 karakterdir; yazım yönergesinde çoğunlukla 600–1600 hedeflenir. `minPostLength` doğrulama sınırıdır; başlangıçta 100 karakterdir. Böylece 600–1600 karakterlik genel hedefin altında doğal kısa içeriklere de izin verilir.

`qualityThreshold`, `similarityThreshold`, `commercialContentRatio`, `explorationRatio`, `backlogTarget`, rapor günü/saati ve `memoryEnabled` değişebilir. Telegram kullanıcı ID'si güvenlik ayarıdır; API üzerinden farklı kullanıcıya çevrilemez, environment ve servis yeniden başlatması gerekir.

`GET /v1/memory` öğrenilen tercihleri listeler. `PATCH /v1/memory/:id` ile `{ "enabled": false }` pasifleştirir; `DELETE` kalıcı siler. `memoryEnabled=false` yeni tercihler öğrenilmesini ve mevcut tercihlerin yazıma katılmasını kapatır.

Gerçek proje/case study notlarını `POST /v1/sources` ile ekleyin. `personal=true` yalnız gerçekten sizin yaşadığınız deneyimler için, `verified=true` kaynağını kontrol ettiğiniz bilgi için kullanılmalıdır. URL referans olarak saklanır; bu endpoint URL'yi indirip otomatik doğrulama yapmaz. İnternet fact-check yapıldığı iddia edilmez. Kaynak metni ve ayrı AI eleştirisi, hatayı azaltan katmanlardır; son insan kontrolünü kaldırmaz.

## Analitik ve haftalık rapor

Resmî member analytics isteğe bağlıdır. `w_member_social` yayın izni analitik erişimi sağlamaz. Community Management API erişimi ve `r_member_postAnalytics` onayı olan hesaplarda `LINKEDIN_ANALYTICS_ENABLED=true` seçip OAuth'u yeni scope ile tekrarlayın. Collector toplam impressions, reactions, comments, reposts okur. Eksik değer `null`, sağlayıcının döndürdüğü gerçek sıfır `0` olarak saklanır. Genel follower change/profile views veya inbound lead verisi uydurulmaz. [LinkedIn Member Post Statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics?view=li-lms-2026-05)

Manuel ölçüm örneği (`POST_ID`, tarih ve rakamları gerçek ölçümlerinizle değiştirin):

```sh
curl -X POST "http://127.0.0.1:3000/v1/posts/$POST_ID/metrics" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"observedAt":"2026-09-10T15:00:00+03:00","impressions":1200,"reactions":24,"comments":5,"reposts":2,"inboundLeads":1}'
```

Her ölçüm o anki **toplam snapshot** olarak girilir, önceki toplamın üzerine eklenecek artış olarak değil. Ölçüm yayın zamanından önce veya gelecekte olamaz. Bilmediğiniz alanı göndermeyin. Skor `min(100, 100 × (reactions + 3×comments + 4×reposts) / impressions)` biçimindedir. Dört alan tamamlanmadan ve pozitif impression olmadan karşılaştırılabilir skor oluşmaz. Bu dahili ağırlıklı etkileşim skorudur; LinkedIn'in resmî engagement tanımı veya müşteri dönüşümü garantisi değildir.

Konu, format, hook türü, uzunluk, CTA varlığı, gün ve saat karşılaştırılır. Analitik özetinde en az iki gönderili kalıplar görünür; içerik seçimi öğrenilmiş kalıpları en az üç gönderiyle kullanır; küçük örnekler genel ortalamaya yaklaştırılır. Seçimde başlangıç keşif payı %30'dur. `GET /v1/report` veya Telegram “rapor” komutu raporu hemen gösterir. Zamanlanmış rapor varsayılan Pazar 18:00'de ölçüm kapsamını da belirtir.

## Veri modeli ve migration

`migrations/` altındaki SQL dosyaları kullanıcı, fikir, takvim, taslak, değişmez sürüm, onay, yayın denemesi, yayınlanan gönderi, Telegram inbox/interactions/session/message, kalıcı jobs/outbox, kaynak notu, marka hafızası, ölçüm, performans, ayar, OAuth ve runtime state tablolarını kurar. Foreign key, unique index ve durum kontrolleri veri tutarlılığını destekler. Uygulama sorguları kullanıcı kapsamını taşır.

```sh
npm run db:migrate
```

Migration kaydı tutulur; aynı migration tekrar uygulanmaz. Production'da önce yedek alın ve staging veritabanında doğrulayın. PGlite testleri SQL iş kurallarını gerçek PostgreSQL uyumlu motorla çalıştırır; container ağını, servis sağlayıcı izinlerini veya production bağlantı havuzunu doğrulamaz.

## n8n kurulumu

n8n zorunlu değildir. [n8n/scheduler.json](../n8n/scheduler.json) dosyasını kendi n8n kurulumunuza import edin. HTTP Request düğümünün URL'sini backend'in `/v1/tick` adresine ayarlayın. Örnek `http://api:3000` host'u yalnız n8n aynı Docker ağına bağlıysa çözülür; ayrı n8n için erişilebilir güvenli backend adresini kullanın. Header Auth credential olarak `Authorization` başlığına `Bearer <ADMIN_API_TOKEN>` değeri verin; token'ı workflow JSON'una gömmeyin. Schedule Trigger'ı istediğiniz periyotta etkinleştirin. Bu endpoint yalnız kalıcı işleri oluşturur; worker yine çalışmalıdır.

Built-in tick ve n8n aynı slotu tetiklese de dedupe anahtarı aynı slotu yeniden üretmeyi engeller. n8n'e yayın, onay veya doğrudan LinkedIn token'ı verilmez. Workflow'da insan onayını atlayan bir bağlantı yoktur.

## Production dağıtımı

1. Node.js 24 image veya Compose ile API, migration ve worker'ı kurun; PostgreSQL'i kalıcı volüm veya yönetilen servis üzerinde çalıştırın.
2. API'yi TLS sonlandıran reverse proxy arkasına koyun. Yönetim endpoint'lerini ayrıca özel ağ/VPN veya proxy erişim kontrolüyle sınırlandırabilirsiniz. HTTP portunu açık internete korumasız yayınlamayın.
3. `NODE_ENV=production`, `APP_MODE=live` kullanın. Production'da sessiz mock fallback yoktur. Secret'ları deployment secret store üzerinden enjekte edin.
4. OAuth callback URL'sini ve webhook kullanıyorsanız Telegram URL'sini üretim domain'iyle eşleştirin.
5. Başlangıçta **tek worker**, özellikle polling'de tek Telegram consumer çalıştırın. PostgreSQL job lease'leri duplicate işlere karşı koruma sağlar; çok tenant'lı ölçekleme ayrıca worker/tenant yönlendirmesi ve kullanıcı kimlik sistemi gerektirir.
6. `/health/ready`, worker logları, failed jobs/outbox ve `publish_uncertain` durumları için izleme kurun. Düşük tempolu kişisel içerik akışında API limitlerini düşürmek için sık metrik sorgusu yapmayın.
7. PostgreSQL yedeğini ve encryption key'i ayrı güvenli konumlarda saklayın; restore denemesi yapın. Encryption key olmadan kayıtlı token'lar çözülemez.
8. Yeni sürümde `npm run check`, migration ve staging smoke testi geçmeden canlı süreci değiştirip eski process'i durdurmayın.

Structured log event'leri taslak, Telegram, revizyon, onay, yayın başlangıç/sonuç, erteleme ve iş hatalarını içerir. Ham token, authorization header, OAuth query veya Telegram token içeren URL loglanmaz.

## Hata çözümü

| Belirti | Kontrol / çözüm |
| --- | --- |
| Startup yapılandırma hatası | Mesajdaki alanı `.env` ile karşılaştırın; live modda eksik credential'ı doldurun |
| Telegram mesajı gelmiyor | Botta `/start`; doğru token; kendi user ID'niz; tek polling worker; webhook/polling çakışması; `/v1/jobs` outbox durumu |
| Webhook `401` | `secret_token` ile `TELEGRAM_WEBHOOK_SECRET` aynı mı; proxy header'ı koruyor mu |
| Eski sürüm uyarısı | En son taslak mesajını kullanın; onay sürüm numarasına bağlıdır |
| AI işi tamamlanmıyor | Model erişimi/AI kota durumu; kaynakların yeterliliği; kalite ve tekrar eşiği; failed job kaydı |
| LinkedIn `401` | Token süresi veya iptali; hesabı yeniden OAuth ile bağlayın |
| LinkedIn `403` | Developer ürün erişimi, `w_member_social`; analitikse ayrıca `r_member_postAnalytics` |
| LinkedIn `426` | Desteklenen yeni `LINKEDIN_API_VERSION` değerine geçip kontrat/staging kontrolü yapın |
| OAuth state hatası | 10 dakikalık bağlantı süresi veya daha önce tüketilmiş state; yeni connect URL oluşturun |
| `failed` yayın | Taslak/onay korundu; açık hata düzeldikten sonra Telegram “Tekrar dene” |
| `publish_uncertain` | Profilde gönderi oluşup oluşmadığını kontrol edin; otomatik tekrar yayınlama durdurulmuştur |
| Raporda en iyi gönderi yok | Karşılaştırılabilir ölçüm yoktur; gerçek manual/API verisi girin |
| PostgreSQL erişilemiyor | URL, kullanıcı, parola, DNS, TLS ve container health; migration servisi logları |

### LinkedIn timeout ve uzlaştırma

LinkedIn Posts API güvenilir bir idempotency header sözleşmesi sunuyor varsayılmıyor. Ağ timeout'u veya `5xx` yanıtında istek LinkedIn'e ulaşmış olabilir. Sistem bu yüzden otomatik tekrar yapmaz ve `publish_uncertain` durumuna geçer. Yalnız açık `429` reddinde sınırlı backoff ile güvenli retry yapılır. Kesin sunucu yanıtı alındıktan sonra veritabanı yazımı yarıda kalırsa da gönderi tekrar basılmaz; uzlaştırılır.

Gönderinin profilinizde **gerçekten yayınlandığını** doğruladıysanız `POST /v1/posts/:id/reconcile` ile gerçek `urn:li:share:...` veya `urn:li:ugcPost:...` kimliğini kaydedin; [API örneğine](API.md) bakın. Bu işlem LinkedIn'e yeni içerik göndermez. Gönderi bulunamadıysa araştırmadan “retry” yapmayın. Bu ilk sürüm belirsiz gönderiye “kesin yayınlanmadı” diyerek kilidi kaldıran bir endpoint içermez; gerektiğinde kontrol sonrası ayrı yeni taslak ve yeni Telegram onayı kullanılır.

## Test kapsamı ve doğrulama sınırları

Kritik testler: yetkisiz kullanıcı engeli, webhook secret, onaysız yayın engeli, son sürüm seçimi, hedeflenmeyen blokların korunması, eski sürüm reddi, update/slot/onay dedupe, cancelled/postponed güvenliği, İstanbul takvimi, API hata sınıfları, belirsiz publish, OAuth şifreleme/state ve eksik analitik verisi.

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Standart test komutu, `TEST_DATABASE_URL` yoksa ayrı PostgreSQL isteyen testleri açıkça atlar. Bu kontrollerin atlanmasını kabul etmeyen doğrulama için `npm run test:postgres` kullanın; bağlantı alanı eksikse komut başarısız olur. İzole test veritabanı ve çalıştırma adımları [PostgreSQL test rehberindedir](POSTGRES_TESTING.md).

Canlı servis credential'ları olmadan HTTP kontrat testleri ve offline entegrasyon senaryosu çalıştırılabilir. Bu geliştirme ortamında gerçek Telegram/LinkedIn/OpenAI hesabı bağlanmadı ve canlı gönderi yayınlanmadı; Docker çalıştırması ayrı environment doğrulaması gerektirir. Sağlayıcı izinleri, OAuth ve ilk gerçek gönderi ancak sizin servis bağlantılarınız ve **o gönderiye özel Telegram onayınız** ile canlı doğrulanır.

Doğrulama sonuçları ve ortam sınırları [VALIDATION.md](VALIDATION.md) içinde kaydedilir.

Ek belgeler: [Proje planı](../PROJECT_PLAN.md), [canlı aktivasyon](ACTIVATION.md), [HTTP API](API.md), [entegrasyon sözleşmeleri](INTEGRATIONS.md), [repository işlem sözleşmesi](REPOSITORY_API.md).
