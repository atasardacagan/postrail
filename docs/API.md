# HTTP API

Bu API ileride dashboard'un veri katmanı olabilir. İlk sürümde environment ile tanımlanan tek kullanıcıya hizmet eder. Kimliği request body içindeki `userId` ile değiştirmek mümkün değildir. Tüm `/v1/*` istekleri `Authorization: Bearer <ADMIN_API_TOKEN>` ister. TLS production reverse proxy'de sağlanmalıdır. Gövde üst sınırı 32 KiB, başlangıç global rate limit dakikada 120 istektir.

**İnsan onayı için yönetim endpoint'i yoktur.** `/v1/drafts/generate` ve `/v1/tick` yalnız iş kuyruğu oluşturur. Yayın için Telegram'da izinli kullanıcının doğru sürüme açık onayı gerekir. OAuth bağlantısı veya admin API token'ına sahip olmak yayın onayı yerine geçmez.

## Genel yanıtlar

| HTTP | Anlam |
| --- | --- |
| `200` | İşlem veya okuma başarılı |
| `201` | Kayıt oluşturuldu |
| `202` | Asenkron iş kuyruğa alındı; henüz tamamlanmadı |
| `204` | İşlem başarılı, response body yok |
| `400` | Zod alan doğrulama veya güvenli OAuth hata açıklaması |
| `401` | Admin token veya webhook secret doğrulanamadı |
| `404` | Bu kullanıcı için kayıt yok |
| `409` | Durum/sürüm uyuşmazlığı veya güvenli tekrar koşulu sağlanmıyor |
| `429` | HTTP API rate limit |
| `500/503` | İşlem/servis hazır değil; raw secret/stack döndürülmez |

## Endpoint haritası

| Metot | Yol | Sonuç |
| --- | --- | --- |
| GET | `/health/live` | Public süreç liveness |
| GET | `/health/ready` | Public DB erişimi ve çalışma modu |
| POST | `/webhooks/telegram` | Telegram secret header ile update kabulü |
| GET | `/oauth/linkedin/callback` | Public, tek kullanımlık state korumalı OAuth callback |
| POST | `/v1/tick` | Zamanlanmış slot/rapor/backlog işlerini oluşturur |
| GET | `/v1/posts` | Son gönderiler ve lifecycle durumları |
| GET | `/v1/posts/:id` | Gönderi ve sıralı immutable sürümleri |
| GET | `/v1/calendar` | Kayıtlı takvim ve yaklaşan generate işleri |
| POST | `/v1/drafts/generate` | Hemen yeni taslak oluşturma işini kuyruğa alır |
| GET | `/v1/ideas` | Fikir havuzu |
| POST | `/v1/ideas` | Manuel fikir ekler |
| GET | `/v1/settings` | Etkin ayarlar |
| PATCH | `/v1/settings` | Kısmi ayar güncellemesi; tamamı doğrulanır |
| GET | `/v1/memory` | Öğrenilen marka tercihleri |
| PATCH | `/v1/memory/:id` | Tercihi enabled true/false yapar |
| DELETE | `/v1/memory/:id` | Tercihi siler |
| GET | `/v1/sources` | Kaynak ve gerçek proje notları |
| POST | `/v1/sources` | Kaynak notu ekler; URL'den içerik çekmez |
| POST | `/v1/posts/:id/metrics` | Yayınlanmış gönderiye manuel snapshot |
| GET | `/v1/analytics` | Ölçümler, performans kalıpları, kapsam notu |
| GET | `/v1/report` | Haftalık rapor metni |
| GET | `/v1/jobs` | Son işler ve tamamlanmamış outbox kayıtları |
| POST | `/v1/jobs/:id/retry` | Failed, yayın dışı işi yeniden kuyruğa alır |
| POST | `/v1/outbox/:id/retry` | Failed Telegram bildirimini yeniden kuyruğa alır; LinkedIn çağrısı yapmaz |
| POST | `/v1/posts/:id/reconcile` | Profilde yayınlandığı doğrulanan belirsiz sonucu kaydeder |
| GET | `/v1/linkedin/connect` | OAuth authorization URL üretir |
| GET | `/v1/linkedin/status` | Token değerlerini içermeyen bağlantı durumu |

`:id` alanları UUID biçimindedir. Listeler operasyonel kullanım için sınırlıdır; bu sürümde genel cursor pagination sözleşmesi yoktur.

## Health

`GET /health/live` → `{ "status": "ok" }`.

`GET /health/ready` → `{ "status": "ready", "mode": "live" }`; DB erişilemiyorsa `503 { "status": "unavailable" }`. Ready endpoint'i LinkedIn token/AI kredisi veya worker'ın son işini doğrulamaz; `/v1/linkedin/status` ve `/v1/jobs` ayrıca izlenmelidir.

## Telegram webhook

```http
POST /webhooks/telegram
X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>
Content-Type: application/json
```

Gövde Telegram'ın gerçek `Update` yapısıdır. Özel sohbet, `from.id` ve `chat.id` izinli kullanıcıyla eşleşmelidir. Doğrulanmış update kalıcı inbox/iş kuyruğuna yazılır. Aynı `update_id` yeniden teslim edilirse yeni bir iş oluşmaz. Yetkisiz veya kullanılmayan update içerik sızdırmadan `{ "ok": true }` ile kapanabilir; yanlış webhook secret `401` döndürür. Başarılı HTTP yanıtı revizyon/yayının tamamlandığı anlamına gelmez.

İstemci uygulamaları için Telegram update taklit eden bir yayın API'si olarak kullanılmamalıdır. Bu route botun resmî teslimat sınırıdır; production webhook secret'ını yalnız sunucu ve Telegram yapılandırması bilmelidir.

## Taslak ve takvim

`POST /v1/drafts/generate` body istemez; `202 { "queued": true, "key": "manual:..." }` döndürür. Worker fikir seçimi, üretim, kalite kontrolü ve Telegram bildirimini yapar.

`GET /v1/posts/:id` yanıtı:

```json
{
  "post": {
    "id": "POST_UUID",
    "status": "waiting_approval",
    "currentVersion": 3,
    "approvedVersion": null,
    "scheduledAt": "2026-09-08T07:30:00.000Z"
  },
  "versions": [
    {
      "version": 3,
      "text": "Son taslak metni",
      "content": {
        "topic": "Otomasyondan önce süreç netliği",
        "blocks": [{ "id": "hook", "kind": "hook", "text": "Açılış" }]
      },
      "fingerprint": "NORMALIZED_SHA256",
      "instruction": "CTA'yı çıkar"
    }
  ]
}
```

Örnek kısaltılmıştır; gerçek yanıtta diğer model alanları ve tüm sürümler bulunur. `scheduledAt` UTC'de saklanır; arayüzde `settings.timezone` ile gösterin. `calendar.upcoming` gelecekte üretim yapacak işleri, `calendar.calendar` oluşturulmuş post kayıtlarını gösterir.

`POST /v1/tick` → `{ "queued": true }`. Slot dedupe anahtarları tekrar çağrıları güvenli kılar; çağrı doğrudan iş yürütmez veya onay vermez. Worker'ın ayrıca açık olması gerekir.

## Fikir oluşturma

`POST /v1/ideas` örneği:

```json
{
  "title": "CRM otomasyonundan önce veri sahipliği",
  "category": "CRM otomasyonları",
  "audience": "KOBİ sahipleri ve satış yöneticileri",
  "angle": "Aynı müşteri kaydının farklı ekiplerce güncellenmesi sorununu süreç üzerinden anlat",
  "hookIdea": "CRM'deki hatayı otomatikleştirmek çözüm olmayabilir.",
  "pillar": "education",
  "format": "problem_solution",
  "series": "Bir İşletmede Bunu Otomatikleştirirdim",
  "priority": 75,
  "freshness": 70
}
```

`pillar`: `education | opinion | building | commercial`. `series` varsayılan `null`, priority/freshness varsayılan 50 ve 0–100 aralığındadır. Topic/format adları stratejiyle tutarlı tutulmalıdır. `used`, oluşturma zamanı, kullanıcı ve kimlik server tarafından belirlenir. Yanıt `201 { "ideas": [...] }`.

## Ayarlar

`PATCH /v1/settings` mevcut ayarlarla birleştirilir. Bilinmeyen alan reddedilir; tekil posting day/time listeleri ve timezone doğrulanır.

```json
{
  "postingDays": [2, 4, 6],
  "postingTimes": ["10:30"],
  "timezone": "Europe/Istanbul",
  "maxPostLength": 2400,
  "ctaFrequency": 0.55,
  "commercialContentRatio": 0.1,
  "explorationRatio": 0.3,
  "backlogTarget": 40,
  "weeklyReportDay": 7,
  "weeklyReportTime": "18:00",
  "memoryEnabled": true
}
```

Tam sözleşme `src/core/config.ts` içindeki `settingsSchema`dır. Günler 1–7 ISO, saatler `HH:mm`, frekanslar 0–1'dir. `commercialContentRatio` en fazla 0.3, `explorationRatio` en az 0.1, backlog 30–50'dir. `contentLanguage` `tr` olmak zorundadır. `hashtagMode` `none | minimal`. `telegramUserId` environment'taki güvenlik kimliğinden farklıysa `409` döner.

Ayar değişimi yeni slotları kuyruğa alır. Eski gün/saat konfigürasyonuna ait üretim işleri çalışmadan önce tekrar doğrulanır. Zaten kullanıcıya gösterilmiş taslak otomatik olarak yeni bir metinle değiştirilmez.

## Marka hafızası

`GET /v1/memory` → `{ "memory": [{ "id": "...", "preference": "...", "count": 2, "enabled": true }] }`.

`PATCH /v1/memory/:id` body yalnız `{ "enabled": false }` veya true olabilir. `DELETE` `204` döndürür. Düzenlenebilir serbest bir sistem prompt'u yoktur; API mevcut öğrenilen tercihleri kontrol eder. Tüm hafızayı kapatmak için settings `memoryEnabled=false` kullanılır.

## Kaynak ve kişisel proje notu

`POST /v1/sources`:

```json
{
  "url": "https://example.com/your-public-project-notes",
  "text": "Buraya kendi doğruladığınız proje bulgusunu ve gerçek bağlamını yazın.",
  "verified": true,
  "personal": true
}
```

Örnek URL kanıt değildir; gerçek referansla değiştirin veya `null` kullanın. Metin 5–4000 karakterdir; `verified` ve `personal` varsayılan false. API URL'yi indirmez; SSRF yaratmadan referans saklar. `verified=true`, kullanıcının kaynak doğrulama beyanıdır; AI otomatik olarak internet araştırması yaptığını iddia etmez. Henüz doğrulanmayan trend/link notları false kalmalıdır.

## Manuel metrikler ve öğrenme

`POST /v1/posts/:id/metrics` yalnız **yayınlanmış** gönderi için kullanılır. `source` kullanıcı tarafından gönderilmez; API `manual` atar. `observedAt` timezone içeren ISO datetime olmalı, yayın zamanından önce veya gelecekte olmamalıdır. En az bir null olmayan metrik gerekir.

```json
{
  "observedAt": "2026-09-10T15:00:00+03:00",
  "impressions": 1200,
  "reactions": 24,
  "comments": 5,
  "reposts": 2,
  "followerChange": null,
  "profileViews": null,
  "inboundLeads": 1
}
```

Rakamlar örnektir; gerçek ölçümünüzü girin. Reaction/comment/repost/impression/profile/lead sayıları negatif olamaz; `followerChange` azalma için negatif olabilir. Snapshot'lar toplam değer olarak saklanır. Aynı user/post/observedAt/source tekrarında kayıt güncellenir. Eski zamanlı ölçüm daha güncel performans skorunu geriye götürmez.

`GET /v1/analytics` ölçüm kayıtları, kalıp puanları ve veri kapsamı notu döndürür. Eksik alan `null` kalır. `GET /v1/report` → `{ "report": "📊 ..." }`; rapor metninin UI'de HTML olarak yorumlanmasına gerek yoktur.

## İşler ve retry

`GET /v1/jobs`: iş ID, tür, durum, run_at, attempt sayısı, güvenli hata mesajı; ayrıca tamamlanmamış outbox özeti. Payload secret'ları veya ham LLM prompt'u bu yanıtın parçası değildir.

`POST /v1/jobs/:id/retry` yalnız `failed` ve `type != publish` işini pending yapar. Başarı `{ "queued": true }`, uygun değilse `409`. Yayın hatalarının retry yolu Telegram'daki mevcut onaylı sürümdür. `publish_uncertain` otomatik veya genel job retry ile yayına zorlanamaz.

`POST /v1/outbox/:id/retry` on denemeden sonra failed kalan Telegram bildirimini tekrar kuyruğa alır. LinkedIn yayınına dokunmaz.

## Belirsiz yayın sonucunu uzlaştırma

Önce LinkedIn profilinde gönderinin gerçekten oluştuğunu doğrulayın. Sonra:

```http
POST /v1/posts/POST_UUID/reconcile
Authorization: Bearer <ADMIN_API_TOKEN>
Content-Type: application/json
```

```json
{
  "urn": "urn:li:share:1234567890123456789",
  "confirmation": "LINKEDIN_UZERINDE_YAYINLANDIGINI_KONTROL_ETTIM"
}
```

URN örneğini gerçek LinkedIn kimliğiyle değiştirin. Post `publish_uncertain` olmalıdır. Bu işlem yalnız mevcut LinkedIn yayınının yerel kaydını tamamlar; LinkedIn'e POST göndermez. Başarı `{ "reconciled": true }` ve aynı transaction içinde kaydedilen Telegram bildirimi. Aynı gönderi ve URN ile tekrar çağrı idempotenttir. Yanlış post/status `409`.

Yayın bulunamadıysa bu endpoint'e hayali URN gönderilmez. İlk sürümde “yayın yok” için kilidi açan bir API bulunmaz; araştırma sonrası ayrı yeni taslak ve yeni Telegram onayı gerekir. Entegrasyonun exactly-once sınırı [INTEGRATIONS.md](INTEGRATIONS.md) içinde açıklanır.

## LinkedIn bağlantısı

`GET /v1/linkedin/connect` → `{ "authorizationUrl": "https://www.linkedin.com/oauth/v2/authorization?..." }`. URL kullanıcı tarafından tarayıcıda açılır. OAuth yoksa `503`.

Callback `GET /oauth/linkedin/callback?code=...&state=...` state'i atomik olarak tüketir, token exchange ve userinfo tamamlar, şifreli bağlantıyı kaydeder. Başarı `{ "connected": true, "message": "LinkedIn bağlandı. Bu işlem gönderi yayınlamaz." }`. Callback query değerlerini reverse proxy access loglarına yazdırmayın.

`GET /v1/linkedin/status`: mode, provider, expires_at, subject, scopes ve `environmentTokenConfigured`. Access/refresh token ve client secret dönmez. Status salt DB kaydını gösterir; sağlayıcı tarafında token'ın iptal edilmediğini canlı doğrulama iddiası yoktur.

## Offline geliştirme yardımcıları

Bu üç route yalnız `APP_MODE=offline` runtime'da eklenir ve yine admin token gerektirir. `npm run dev:offline` örnek token'ı `offline-only-local-admin-token-0001`, örnek Telegram kullanıcı ID'si `123456` kullanır. Canlı modda bu route'lar tanımlı değildir.

| Metot | Yol | Amaç |
| --- | --- | --- |
| GET | `/v1/offline/messages` | Bu process'teki mock Telegram mesajları ve LinkedIn çağrı kayıtları |
| POST | `/v1/offline/telegram` | Dış ağa çıkmadan gerçek update şemasında komut simülasyonu |
| POST | `/v1/offline/drain` | En fazla 50 iş ve 50 bildirim işleyerek test akışını ilerletir |

Önce `/v1/drafts/generate`, sonra `/v1/offline/drain` çağırın. Mesajları alın. Draft mesajının ID'sini aşağıda `reply_to_message.message_id` olarak kullanın. Her yeni komutta farklı `update_id` ve `message_id` gerekir; tekrar kullanılan update bilinçli olarak dedupe edilir.

```sh
curl -X POST http://127.0.0.1:3000/v1/offline/telegram \
  -H 'Authorization: Bearer offline-only-local-admin-token-0001' \
  -H 'Content-Type: application/json' \
  -d '{"update_id":10001,"message":{"message_id":20001,"from":{"id":123456},"chat":{"id":123456,"type":"private"},"reply_to_message":{"message_id":1},"text":"girişi daha kısa ve vurucu yap"}}'
curl -X POST http://127.0.0.1:3000/v1/offline/drain \
  -H 'Authorization: Bearer offline-only-local-admin-token-0001'
```

Yeni draft ID'sini okuyup CTA çıkarma için tekrar edin; son sürüme “onayla” gönderin. Mock publish kaydı oluşur, gerçek LinkedIn paylaşımı olmaz. Process yeniden başlarsa bu endpoint'teki in-memory mesaj listesi sıfırlanır; kalıcı post/sürüm verisini `/v1/posts` üzerinden inceleyin. Baştan sona tek komut doğrulama için `npm run demo` kullanın.
