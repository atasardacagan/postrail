# AI Personal Brand & LinkedIn Growth Engine

## Hedef
Türkçe kişisel marka içeriğini fikir havuzundan Telegram revizyonuna, açık insan onayından resmi LinkedIn API yayınlamasına ve ölçülebilen performanstan öğrenmeye taşıyan çalıştırılabilir servis. Konumlandırma: işletmeler için web, AI ve otomasyonu ticari sonuçlara dönüştürmek.

## Mimari ve teknoloji
Node.js 24 LTS, strict TypeScript, Fastify, PostgreSQL, Zod, Vitest. PostgreSQL hem kalıcı durum hem dayanıklı iş kuyruğu/outbox sağlar. Bir API süreci ve bağımsız worker; Redis zorunlu değil. n8n isteğe bağlı olarak korunan tick endpoint'ini tetikler, iş mantığı backend'dedir. Dış servis adaptörleri resmi Telegram Bot API, LinkedIn Posts/OAuth API ve OpenAI Responses Structured Outputs kullanır. Offline adaptörler yalnız development/test modunda kullanılabilir.

## Veri modeli
Tenant olarak users; content_topics, content_ideas, content_calendar, post_drafts, immutable post_versions, approvals, publish_attempts, published_posts, telegram_interactions, jobs, outbox, linkedin_metrics, content_performance, brand_memory, system_settings ve oauth_connections. Tüm kişisel veriler user_id ile kapsamlanır. Geçerli sürüm ve onaylanan sürüm eşleşmeden yayınlama yoktur. Takvim slotları ve Telegram update kimlikleri tekildir.

## İş akışı
Scheduler → kalıcı slot → fikir seçimi (strateji dengesi, %70 kanıt / %30 keşif) → geçmiş benzerlik → yazar → ayrı kalite/fakt değerlendirmesi → Telegram outbox → WAITING_APPROVAL.
Revizyon → kapsamlı/sınırlı edit sözleşmesi → yeni immutable sürüm → yeniden onay.
Onay → kullanıcı/sürüm/mesaj doğrulama → APPROVED → kalıcı yayın işi → PUBLISHING → PUBLISHED → sonuç bildirimi.
İptal yayını durdurur. Erteleme onayı geçersiz kılar; yeni saatte tekrar onay istenir.

## Güvenlik ve hata yönetimi
Telegram özel sohbet ve allowlist, webhook secret, replay deduplication, tenant kapsamı, admin bearer token, OAuth tek kullanımlık state, AES-GCM token şifreleme, secret redaction, input sınırları. AI yayın kararı veremez. Ağ timeout'u/5xx sonrası LinkedIn tarafında sonuç belirsizse otomatik tekrar yayınlanmaz: manuel uzlaştırma gerekir. Kesin retlerde sınırlı backoff uygulanır. Telegram bildirimi ayrı outbox ile tekrar denenir.

## Aşamalar
1. Foundation, migration, durum makinesi ve kalıcı queue.
2. Telegram kimlik kontrolü, mesaj bağlamı, versiyonlu aksiyonlar.
3. Fikir havuzu, strateji, üretim, kalite, gerçeklik ve tekrar kontrolü.
4. Doğal dil revizyonu ve kontrollü marka hafızası.
5. İstanbul zaman dilimiyle takvim, erteleme, Pazar raporu.
6. Resmi LinkedIn API, OAuth, onay ve idempotency sınırları.
7. Manuel metrikler, veri kapsamı açık analitik ve öğrenme.
8. Docker, n8n örneği, dokümantasyon, kritik testler ve doğrulama.

## Kabul kriterleri
- Ana senaryo: scheduler → taslak → girişi revize → CTA çıkar → son sürümü onayla → yalnız bu sürümü yayınla → DB ve Telegram sonucu.
- Yetkisiz, eski sürüm, iptal edilmiş, ertelenmiş veya onaysız gönderi yayınlanamaz.
- Aynı update/slot/onay tekrarında duplicate yayın yoktur; belirsiz sonuç güvenle bloke edilir.
- Revizyonda hedeflenmeyen bloklar aynen korunur.
- Kalite eşiği altında veya kaynaksız riskli iddialı içerik onaya sunulmaz.
- Haftalık rapor eksik metrikleri sıfır/veri varmış gibi sunmaz.
- typecheck, lint, test, build; gerçek PostgreSQL motoruyla offline entegrasyon senaryosu.
- Credential olmadan offline çalışma; gerçek yayın için kullanıcı servis bağlantıları gerekir.

## Doğrulama sınırları
8 Eylül 2026 tarihinde geçici ve yalnız localhost’a bağlı native PostgreSQL 17.10 üzerinde tüm testler çalıştırıldı: 10 dosyada 182 test PASS, 0 SKIP. Bu koşu ayrı bağlantı havuzlarıyla 8 concurrency testi ve 1 PostgreSQL uçtan uca iş akışı testini de içerir. TEST_DATABASE_URL tanımlanmayan varsayılan test koşusunda 173 test çalışır, bu 9 test açıkça SKIP olur. Docker container build/boot bu doğrulamanın kapsamında değildir. Gerçek Telegram/LinkedIn/OpenAI çağrıları test adapter’ları ve HTTP kontrat fixture’larıyla doğrulanmıştır; canlı sağlayıcı izinleri ve gerçek yayın test edilmemiştir. Canlı yayın yalnız kullanıcı bağlantıları ve gönderiye özel açık Telegram onayıyla mümkündür.

## Tamamlanan teslimat — 8 Eylül 2026

- Foundation/PostgreSQL migration, DB lifecycle trigger, immutable sürüm ve onay defteri tamamlandı.
- Telegram private-chat allowlist, webhook secret, polling, ingress anında sürüme bağlama, sıralı işlem ve dayanıklı outbox tamamlandı.
- Canlı Responses yazarı/bağımsız eleştirmeni, 10 fikirlik bounded backlog grupları, 40 ayrı offline örnek, kalite ve tekrar kontrolü tamamlandı.
- Sınırlı blok revizyonu, CTA silme, yeniden yazma, iptal, erteleme ve kontrol edilebilir hafıza tamamlandı.
- İstanbul takvimi, kalıcı slotlar ve Pazar raporu tamamlandı.
- LinkedIn resmi Posts API, OAuth state/şifreleme/koşullu refresh, bounded retry ve belirsiz sonuç uzlaştırması tamamlandı.
- Manuel/izinli API metrikleri, eksik veri koruması, örnek sayısına duyarlı skor ve keşif/öğrenme tamamlandı.
- Docker, migration servisi, API/worker ayrımı, isteğe bağlı n8n workflow, CI ve Türkçe kullanım belgeleri tamamlandı.
- Canlı aktivasyon için credential değerlerini göstermeyen doctor, güvenli environment üretimi ve açık PostgreSQL test komutu eklendi.
- Son tam doğrulama: native PostgreSQL 17.10 ile 182 test PASS / 0 SKIP; typecheck/lint/build PASS. Gerçek PostgreSQL üzerinde scheduler → hook revizyonu → CTA çıkarma → son sürümü açık onay → tek yayın adapter çağrısı → kalıcı kayıt ve bildirim kabul senaryosu PASS. PostgreSQL bağlantısı verilmeden çalıştırılan varsayılan suite sonucu 173 PASS / 9 SKIP olarak ayrı raporlanır.
- Daha önce port izinleri nedeniyle çalıştırılamayan 8 PostgreSQL concurrency ve 1 uçtan uca test, 8 Eylül 2026 tarihinde izin verilen geçici native sunucuda tamamlandı. Üretilmiş test parolası ve izole test schema’ları kullanıldı; sunucu koşu sonunda durduruldu. Docker container build/boot burada yapılmadı. Canlı servis credential’ları ve OAuth kullanıcı yetkisi sağlanmadığı için dış serviste yayın yapılmadı.
- Ayrıntılı sonuçlar: docs/VALIDATION.md. Bu sınırlara canlı ortamda geçmiş test sonucu atfedilmez.
