# Canlı aktivasyon

Bu rehber, kodu doğrulanmış projeyi kendi Telegram, AI ve LinkedIn hesaplarınıza bağlama sırasını açıklar. Hesap bağlantısı ve servis kurulumu yayın onayı değildir. Her gönderinin son sürümü ayrıca Telegram'da onaylanır.

## 1. Projeyi ve yerel ayarları hazırlayın

Proje klasöründe Node.js 24+ ile:

```sh
npm ci
npm run env:init
```

`.env` zaten varsa ikinci komut dosyayı koruyarak durur; anahtar üretmek için dosyayı silmeyin. Üretilen admin token, webhook secret ve token şifreleme anahtarı birbirinden bağımsızdır. PostgreSQL parolası hem `POSTGRES_PASSWORD` hem yerel `DATABASE_URL` içinde aynıdır. Bu URL bir PostgreSQL sunucusu oluşturmaz; sonraki adımda Compose veya kendi sunucunuz gerekir.

`.env` yalnız yerel makinede saklanır; ZIP teslimatına ve Git'e dahil edilmez. Kendi anahtarlarınızı sohbet mesajına yazmanız gerekmez.

## 2. Kendi hesap bilgilerinizi ekleyin

| Alan | Nasıl doldurulur? |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather ile oluşturduğunuz botun token'ı |
| `TELEGRAM_ALLOWED_USER_ID` | Botunuza kendi özel sohbetinizden gönderdiğiniz mesajın `from.id` değeri |
| `LLM_API_KEY` | API hesabınızdaki AI anahtarı |
| `LLM_MODEL` | Hesabınızın erişebildiği Responses uyumlu model; proje varsayılanı yapılandırmada bulunur |
| `LINKEDIN_CLIENT_ID` | LinkedIn Developer App kimliği |
| `LINKEDIN_CLIENT_SECRET` | Aynı uygulamanın client secret değeri |
| `LINKEDIN_REDIRECT_URI` | Developer Portal'a kaydettiğiniz, API'ye yönlenen tam HTTPS callback adresi |

Bot oluşturma, kimlik okuma ve LinkedIn ürün erişimi adımları [README](../README.md#telegram-bot-ve-user-id) içinde verilmiştir. Varsayılan Telegram modu polling'dir. LinkedIn analitiği ayrıca ürün/izin gerektirir; erişim almadan `LINKEDIN_ANALYTICS_ENABLED=true` yapmayın. Manuel metrik girişi her iki durumda da kullanılabilir.

## 3. Yerel kontrolü çalıştırın

```sh
npm run doctor
```

`EKSİK` ve `GEÇERSİZ` satırlarını düzeltin. Rapor alanların değerlerini içermez. “Yerel yapılandırma kontrolleri geçti” sonucu, biçim ve gerekli alanların uygun olduğunu gösterir; henüz Telegram, OpenAI veya LinkedIn'e bir istek gönderilmez.

## 4. Veritabanı, API ve worker'ı başlatın

Docker + Compose kurulu bir makinede:

```sh
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:3000/health/ready
```

Migration servisi PostgreSQL hazır olduğunda şemayı uygular. API ve worker sonra başlar. `health/ready` yanıtı uygulamanın veritabanına ulaşabildiğini gösterir; sağlayıcıların yetkisini sınamaz.

Compose API portunu yalnız `127.0.0.1:3000` üzerinde yayınlar. Production için HTTPS adresinizi bu API'ye yönlendirin. Docker kurulmayan ortamda kendi PostgreSQL bağlantınızı `DATABASE_URL` içine yazıp README'deki ayrı API ve worker komutlarını kullanın.

## 5. Telegram bağlantısını tamamlayın

Botla özel sohbeti açıp `/start` gönderin. Polling kullanırken eski webhook varsa proje klasöründe:

```sh
npm run telegram:configure
```

Bu komut Telegram bağlantı ayarını değiştirir; içerik göndermez. Webhook seçtiyseniz README'deki HTTPS URL parametresini kullanın. Aynı bot için tek polling consumer çalıştırın.

## 6. LinkedIn OAuth yetkisini verin

`GET /v1/linkedin/connect` yönetim endpoint'ini admin yetkisiyle çağırın ve dönen `authorizationUrl` adresini tarayıcınızda açın. Doğru LinkedIn hesabıyla izin verin. Ardından `GET /v1/linkedin/status` ile bağlantıyı kontrol edin. Hazır komutlar ve endpoint örnekleri [README OAuth bölümünde](../README.md#linkedin-developer-app-ve-oauth) bulunur.

Bu işlem hiçbir LinkedIn gönderisi oluşturmaz. Ürün izni, scope veya token süresi nedeniyle hata varsa önce hesap ayarını düzeltin; sistemin onay kontrolünü atlayarak yayınlamayı denemeyin.

## 7. İlk gerçek taslağı kontrol edin

Yönetim API'sinde `POST /v1/drafts/generate` çağırın veya varsayılan Salı/Perşembe/Cumartesi 10:30 İstanbul slotunu bekleyin. API örnekleri [API rehberinde](API.md) bulunur.

1. Telegram'a v1 taslağı gelir; LinkedIn'de henüz gönderi oluşmaz.
2. `girişi daha kısa ve vurucu yap` yazın. Yalnız giriş değişerek v2 gelmelidir.
3. `CTA'yı çıkar` yazın. CTA kaldırılarak v3 gelmelidir.
4. Son metni okuyun. Yalnız yayınlamak istediğinizde `onayla` yazın veya o sürümün Onayla düğmesine basın.
5. Başarı bildirimindeki gerçek LinkedIn URL'sini açın. Veritabanında published kaydı ve approved version eşleşmelidir.

Gerçek API zaman aşımında yayın sonucu belirsizse sistem otomatik ikinci POST yapmaz. Profilde sonucu kontrol edip [uzlaştırma rehberini](../README.md#linkedin-timeout-ve-uzlaştırma) izleyin.

## 8. Çalışmayı sürdürün

API ve worker'ın sürekli açık kaldığını, PostgreSQL yedeğinin alındığını ve token şifreleme anahtarının ayrıca korunduğunu doğrulayın. Gerçek proje deneyimlerinizi kaynak olarak ekleyin; uydurma müşteri sonuçlarına ihtiyaç yoktur. İlk ölçümleri mevcut API izninizle veya manuel girin. Haftalık rapor varsayılan Pazar 18:00 İstanbul saatinde Telegram'a gelir; ölçülmeyen metrikler uydurulmaz.

Geliştirme ortamında geçmiş ve henüz çalıştırılmamış kontrollerin ayrımı [VALIDATION.md](VALIDATION.md) dosyasındadır.
