# Resmî servis entegrasyonları

Bu belge sağlayıcı bağlantılarının davranışını ve sınırlarını açıklar. Uygulamayı çalıştırma, environment değişkenleri ve HTTP adresleri için ana README'yi izleyin. Belgeler 7 Eylül 2026 tarihinde kontrol edilmiştir. Bir API sürümünün kullanılabilirliği uygulama ürün izinlerinden bağımsızdır; çalışan kod, Developer Portal'dan verilmemiş bir yetkiyi sağlayamaz.

## LinkedIn: kişisel metin gönderisi

`LinkedInClient`, `POST https://api.linkedin.com/rest/posts` çağrısını yapar. `LinkedIn-Version` ayardan gelir; başlangıç değeri `202605`tir. `X-Restli-Protocol-Version: 2.0.0` gönderilir. Kişisel profil yazarı `urn:li:person:<member-id>` biçimindedir. İçerik `commentary`, görünürlük `PUBLIC`, dağıtım `MAIN_FEED` olarak gönderilir. Başarı yalnız `201` ve geçerli `x-restli-id` birlikte geldiğinde kabul edilir. `share` ve `ugcPost` kimlikleri desteklenir. [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-05)

Developer App üzerinde **Share on LinkedIn** ürünü ve `w_member_social` izni gerekir. Kimliği resmî `userinfo` çağrısından almak için **Sign In with LinkedIn using OpenID Connect** ürününü de etkinleştirin. OAuth izinleri `openid profile w_member_social`dır; bu sürümün ihtiyaç duymadığı e-posta izni istenmez. Callback adresi Developer Portal'daki kayıtla birebir aynı olmalıdır. Token alındıktan sonra `GET https://api.linkedin.com/v2/userinfo` yanıtının `sub` alanından yazar URN'i oluşturulur. Bir JWT, imzası kontrol edilmeden kimlik kaynağı olarak kullanılmaz. [LinkedIn OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)

Sağlayıcı örneği:

```ts
const client = new LinkedInClient({
  accessToken: async () => tokenStore.getValidAccessToken(),
  authorUrn: async () => tokenStore.getAuthorUrn(),
  version: '202605',
});
```

`publish(text, idempotencyKey)` bir ağ isteği yapar. Bu metodu yalnız veritabanında son sürüm için insan onayı doğrulandıktan sonra çağıran yayın servisi kullanır. Transport katmanı tek başına iş akışının onay kontrolü değildir. Dashboard veya scheduler doğrudan sağlayıcıya bağlanmamalıdır.

### Tekrarlı yayın ve belirsiz sonuç

Posts API için güvenilir bir `Idempotency-Key` sözleşmesi varsayılmıyor. Gönderiye böyle bir başlık eklemek, aynı isteğin iki kez paylaşılmasını önlediğine kanıt değildir. Uygulama kayıt kilidi, tekil yayın işi ve onaylı sürüm kaydı üzerinden eşzamanlı çağrıları engeller.

| Yanıt | Sınıf | Yayın servisinin yapması gereken |
| --- | --- | --- |
| `201` ve geçerli gönderi kimliği | Başarı | Kimliği ve URL'yi kalıcı kaydet; başarı bildirimi gönder |
| Açık `429` | `retryable` | Onaylanan aynı sürümü koruyarak `Retry-After` ve backoff ile sınırlı yeniden dene |
| `400/401/403/422/426` vb. açık istemci reddi | `rejected` | Hata kaydı; izin/token/içerik düzeltildikten sonra kontrollü işlem |
| Ağ hatası, timeout, `408`, `5xx`, yönlendirme | `uncertain` | Otomatik yeniden yayınlama; profil üzerinden sonucu uzlaştır |
| Başarı durum kodu fakat eksik/geçersiz kimlik | `uncertain` | Gönderi oluşmuş olabilir; manuel uzlaştır |

`uncertain` durumunda kullanıcı LinkedIn profilinde gönderiyi kontrol etmelidir. Varsa gerçek gönderi kimliği sisteme işlenir; bulunmadığı doğrulandıktan sonra yeniden onay yoluna gidilir. Bu yaklaşım, ağ sınırında teorik olarak sağlanamayan mutlak “exactly once” garantisini verdiğini iddia etmez. Hiçbir sağlayıcı hatası otomatik olarak taslağı silmez.

`PublishError` içinde yalnız `kind`, güvenli açıklama, varsa HTTP kodu ve bekleme süresi vardır. Ham response body, authorization header ve ağ hatasının token içerebilen `cause` alanı taşınmaz. `401` yeniden yetkilendirmeye, `403` ürün/izin kontrolüne, `426` API sürümü güncellemesine yönlendirir.

## OAuth ve token yaşam döngüsü

`createOAuthState()` 32 rastgele byte üretir. Veritabanında ham state yerine `hashOAuthState(state)` tutulur. Callback'te `verifyOAuthState()` eşleşmeyi zaman bakımından güvenli karşılaştırır. Süre aşımı, tenant/owner bağı ve **tek seferlik atomik tüketim**, callback servisinin sorumluluğudur. Bir state doğrulama helper'ı tek başına replay koruması değildir.

`LinkedInOAuth.exchange(code)` token endpoint'ine form kodlu istek yapar. Token ömrünü sağlayıcının `expires_in` alanından hesaplar. `LinkedInOAuth.refresh(token)` yalnız LinkedIn gerçekten refresh token vermişse çağrılır. Programatik refresh erişimi onaylı Marketing Developer Platform ortaklarına sunulur; her kişisel paylaşım uygulamasının refresh token alacağı varsayılmaz. Refresh token yoksa veya süresi dolduysa yeniden kullanıcı OAuth yetkilendirmesi gerekir. Dönüşte refresh token yoksa önceki geçerli token ve **önceki mutlak sona erme tarihi** korunabilir; ömrü uydurularak uzatılmaz. [LinkedIn programatik refresh tokens](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)

`TokenCipher` AES-256-GCM ile her şifreleme için yeni nonce kullanır. Anahtar process environment'tan okunur; veritabanına yazılmaz. Kurucu Base64 kodlu 32 byte alır; uygulamanın hex environment ayarı varsa composition root Base64'e dönüştürür. Token record'u JSON olarak serialize edip şifreleyin. `encrypt(data, userId)` ve `decrypt(envelope, userId)` çağrıları tenant bağını authenticated additional data ile korumak için kullanılabilir. Anahtarı değiştirirken eski kayıtları güvenli şekilde yeniden şifrelemek veya hesapları yeniden bağlamak gerekir.

## Telegram

`TelegramBot` resmî Bot API üzerinden düz metin ve inline keyboard yollar. İçerik HTML/Markdown parse edilmez; kullanıcı metni biçimlendirme komutu olarak yorumlanmaz. Mesaj 4096 karakteri, `callback_data` 64 UTF-8 byte'ı aşarsa ağ çağrısından önce reddedilir. Uzun draft'ı keserek görünmeyen metne onay almak yerine backend toplam taslak zarfını bu sınıra uygun tutmalıdır. [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage)

`getUpdates(offset, timeoutSeconds)` doğrulanmış `TelegramUpdate[]` döndürür ve yalnız `message`/`callback_query` tiplerini ister. İşlenen update offset'i kalıcı tutulmalı, süreç yeniden başlayınca aynı update tekrar işlense de iş mantığı idempotent olmalıdır. `setWebhook(url, secret)` HTTPS ister; pending update'leri silmez. Webhook ve polling aynı bot için eşzamanlı kullanılmamalıdır. `deleteWebhook()` polling'e dönmek için pending update'leri korur.

Güvenlik transporttan önce/sonra uygulama sınırında uygulanır: webhook secret header'ı doğrulanır; `from.id`, private chat tipi ve chat ID server-side izinli kullanıcı ile eşleştirilir. Sadece chat ID'ye bakmak yeterli değildir. Callback üzerinde post/version/token eşleşmesi kontrol edilir. Eski mesajdaki onay düğmesi yeni sürümü örtük onaylamamalıdır. Yetkisiz kullanıcıya taslak veya hesap bilgisi dönülmez.

Bot endpoint'inin URL'si token içerdiğinden fetch hatasının ham metni loglanmaz. `TelegramError`, sağlayıcıdan gelen açıklamayı da kopyalamaz; yalnız güvenli durum bilgisi ve varsa `retry_after` taşır. `answerCallback()` yalnız Telegram arayüzündeki bekleme göstergesini kapatır; insan onayının kalıcı kaydı yerine geçmez.

## Analitik erişiminin sınırları

Temel yayın izni analitik erişimi vermez. `memberCreatorPostAnalytics` erişimi için `r_member_postAnalytics` gerekir; bunu Community Management API erişim süreci ve üyenin ek OAuth izni belirler. Resmî API sürümlerinde impressions, reactions, comments, reposts ve bazı içerikten kaynaklanan follower/profile metrikleri bulunabilir. Toplam profil görüntülenmesi ile belirli içerikten kaynaklanan görüntülenme aynı metrik değildir. [LinkedIn Member Post Statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics?view=li-lms-2026-05), [ürün ve izin erişimi](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2025-11)

`LinkedInAnalytics` collector'ı varsayılan olarak kapalıdır. Developer App'e gerekli erişim verildikten sonra `LINKEDIN_ANALYTICS_ENABLED=true` seçilir ve ek scope için OAuth bağlantısı yeniden kurulur. Her post için `aggregation=TOTAL`, `q=entity` ile dört resmî sorgu yapılır: impressions, reactions, comments ve reposts. `dateRange` gönderilmeyerek post ömrü boyunca toplam ölçüm alınır; günlük impression sorgusu kullanılmaz. `share` ve `ugcPost` kimlikleri Rest.li union biçiminde kodlanır. Dönen metrik türü, gönderi kimliği ve sayısal değer doğrulanır. [Toplam ve tarih aralığı sözleşmesi](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics?view=li-lms-2026-05)

Boş alanlar `null` olarak kalır; erişim yokluğu `0` etkileşim şeklinde yorumlanmaz. Açıkça dönen `count: 0` gerçek sıfır ölçüm olarak tutulur. Bütün sonuçlar boşsa collector `null` döndürür. `401/403` durumunda ilk istekte durur ve izin/yeniden OAuth açıklaması döndürür; mevcut ölçümler silinmez. Ölçüm zamanı ve `source: 'api'` korunur. Genel follower change/profile views alanlarına content-attributed metrikler yazılmaz; bu alanlar ve inbound lead verisi manuel giriş/CRM kaynağı kullanır. Analitik kapalı veya erişilemez olsa da manuel ölçüm ve öğrenme döngüsü çalışır.

## Test ve offline modu

`MockTelegram` mesajları bellekte kaydeder. `MockLinkedIn` dış çağrı yapmaz ve `example.invalid` URL üretir. Her `publish` çağrısını ayrı kaydeder; duplicate testleri yanlışlıkla geçmesin diye sahte sağlayıcı idempotency'si uygulamaz. Bunlar yalnız açık offline/test seçiminde kullanılır.

`tests/integrations.test.ts`, resmî payload ve başlıkları, hata redaksiyonunu, belirsiz yayın sonucunu, Telegram update doğrulamasını, OAuth scope/form kodlamasını, refresh sınırlarını, state karşılaştırmasını ve token şifrelemesinin bozulmaya direncini doğrular. Bu testler canlı hesap izni alındığını veya gerçek LinkedIn gönderisi yayınlandığını iddia etmez.
