# İçerik motoru ve editoryal kontroller

Bu modül `ContentEngine` arayüzünü uygular. `LiveContentEngine` gerçek model istekleri yapar; `OfflineContentEngine` ağ bağlantısı olmadan entegrasyon akışını doğrulamak için açıkça seçilen örnek adaptördür. Hiçbir içerik sınıfı Telegram onayı, OAuth token’ı veya LinkedIn yayın yetkisi almaz. Yayın kararı servis ve veritabanı durum makinesine aittir.

## Canlı model bağlantısı

Canlı mod `LLM_API_KEY` ve `LLM_MODEL` ister. Anahtar eksikse örnek metne sessiz geçiş yapılmaz. Model adı yapılandırmadan gelir; model erişimi ve kota ilgili API hesabına bağlıdır.

İstekler OpenAI Responses API’ye `text.format.type=json_schema`, `strict=true` ve `store=false` ile gönderilir. Yanıt ayrıca Zod ile doğrulanır. Refusal, incomplete yanıt, geçersiz JSON ve başarısız HTTP durumları işlem hatasıdır. Sağlayıcı hata gövdesi, anahtar ve özel prompt hata mesajına yazılmaz. Referans: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

`ResponsesModel` tek istek için varsayılan 60 saniye zaman sınırı uygular. Her yeni taslak denemesi ayrı yazar ve eleştirmen çağrısından oluşur. Varsayılan üç denemeden sonra başarısız taslak reddedilir. İstek katmanı gizli retry yapmaz; kalıcı iş kuyruğu geri çekilme ve tekrar denemeyi yönetir. Fikir havuzu bir istekte en fazla 10 fikir üretir: 40 fikir için en fazla dört, 50 fikir için en fazla beş sıralı çağrı yapılır. `maxAttempts` programatik olarak en fazla dört olabilir; boş havuz doldurmayla beraber toplam model çağrısı en fazla 13 olabilir. Üretim worker lease süresi buna göre değerlendirilmelidir.

## Strateji ve fikir havuzu

`seedIdeas()` güncel haber veya başarı iddiası içermeyen 40 ayrı başlangıç fikri sunar. Kategoriler temel yapılandırmayla aynıdır. Web, CRO, CRM, n8n, AI agent, SaaS, ajans ve girişimcilik konularına ek olarak AI güvenilirliği, ürün analitiği ve otomasyon bakımı ele alınır. Teknik olmayan işletme sahiplerinin sorunlarına da yer verilir.

Canlı `ideas()` mevcut başlıkları ve açıları modele verir, kategori izin listesini uygular ve benzer fikirleri eler. İstekler en fazla 10 fikirlik gruplara bölünür; her grubun geçerli sonuçları sonraki grubun tekrar dışlama bağlamına eklenir. Döngü talep edilen miktara göre sınırlıdır; tekrarlar yüzünden sonsuz üretim yapılmaz. Verilen sayıda farklı fikir gelmezse yalnız geçerli olanlar eklenir; sonraki backlog işi eksik miktarı tamamlayabilir. Geçerli fikir hiç yoksa hata döner. Üretilmiş haber başlığı otomatik olarak gerçek haber sayılmaz.

`selectIdea()`:

- Aynı gönderinin farklı sürümlerini tek gönderi olarak sayar.
- Son 20 gönderide eğitim / görüş / building / ticari dağılımındaki açığı hesaplar; varsayılan hedefler %60 / %20 / %10 / %10’dur.
- Üç gönderilik haftada bu oranları zorla yuvarlamak yerine zaman içinde dengeler.
- Kullanılmış fikirleri ve kapatılmış kategorileri seçmez.
- Yakın geçmişte kullanılan konu, format ve serilere ceza verir.
- Varsayılan seçimlerin yaklaşık %70’inde yeterli örneği olan performans kalıplarını kullanır; %30’unda rastlantısal keşif ağırlığı ekler.
- En az üç gözleme ulaşmayan performans kalıbını kanıtlanmış saymaz.

Ticari oran değiştirildiğinde kalan pay eğitim / görüş / building arasında aynı göreli ağırlıklarla dağıtılır. Keşif olasılığı uzun dönem hedefidir; her haftanın tam bu oranı vermesi beklenmez. Eksik ölçümden başarı puanı türetilmez; analitik katmanından mevcut kalıplar alınır.

Yazım aşaması da en az üç gözleme dayanan hook türü, metin uzunluğu ve CTA varlığı kalıplarını kullanır. Bir fikir için keşif ataması kimliğinden deterministik olarak yapılır; aynı işin yeniden denenmesi bu atamayı değiştirmez. Varsayılan yaklaşık %30 keşif grubunda başarılı kalıp önerileri yazara verilmez. Diğer grupta her boyutun en yüksek puanlı uygun kalıbı editoryal öneri olarak iletilir. Önerilen karakter aralığı yapılandırılmış sınırlara daraltılır; CTA kapalıysa CTA ekleme önerisi verilmez. Kullanıcının marka tercihleri önerilerden önce gelir. Gün ve saat gözlemleri yazara zamanlama değiştirme yetkisi vermez; takvim ayarları korunur. Bu gözlemler nedensellik veya büyüme garantisi değildir. Bağımsız kalite eleştirmenine performans önerileri verilmez.

## Yazım, kalite ve kaynak kontrolü

Yazar prompt’u doğal Türkçe, kısa paragraflar, hedef kitleye göre teknik derinlik, değişken CTA ve düşük satış baskısı ister. Topic, category, audience, pillar, format ve series sunucu tarafından fikir kaydından atanır. Model içerik stratejisini metadata değiştirerek yeniden sınıflandıramaz.

Bağımsız eleştirmen hook, fayda, özgünlük, okunabilirlik, marka uyumu, doğal lead potansiyeli ve sahicilik puanlarını üretir. Overall puan sunucuda bu yedi puanın ortalaması olarak yeniden hesaplanır. Modelin kendi aggregate puanına güvenilmez. Eleştirmen bir iddiayı desteksiz bulursa veya taslağı reddederse yayın onayı bekleyen taslak oluşmaz.

İkinci aşamada deterministik kontrol şunları inceler:

- Tek açılış hook’u, en az bir body paragrafı, en fazla bir son CTA ve benzersiz blok kimlikleri.
- Yapılandırılmış minimum ve maksimum uzunluk; LinkedIn metni için üst sınır 3000 karakter.
- Uzun paragraflar, sık kullanılan yapay kalıplar, aşırı emoji ve hashtag politikası.
- Bilinmeyen veya doğrulanmamış source ID’leri.
- Kaynağı bulunmayan sayısal, araştırma ve kişisel deneyim iddiaları.
- Konu, hook, CTA ve tam metin tekrarı.
- Kalite eşiği.

`SourceFact.verified=true` güvenilir yönetici tarafından doğrulanmış bilgi anlamına gelir. Sistem bu alanı internetten doğruladığını iddia etmez. Kişisel geçmiş iddiası ayrıca `personal=true` bir kaynağa dayanmalıdır. Sadece kaynak ID’si eklemek yeterli değildir: iddiadaki sayılar kaynak metninde bulunmalı ve metin iddiayla ilişkili olmalıdır. Canlı eleştirmen ayrıca anlam bakımından destek arar.

Bu kontroller eksiksiz bir doğruluk garantisi değildir. Deterministik filtre dilsel sezgiler kullanır; bazı geçerli metinleri reddedebilir veya bazı yanlış iddiaları kaçırabilir. Liste sıra numaraları ve n8n / B2B gibi ürün veya iş modeli terimlerindeki rakamlar sonuç iddiası sayılmaz. Kaynaksız tarihler ve ölçülmüş sonuçlar muhafazakâr şekilde reddedilir. Kullanıcının son metni inceleyip onaylaması zorunludur.

Kaynak, geçmiş ve hafıza metinleri prompt içinde güvenilmeyen veri olarak sınırlanır. İçindeki sistem talimatını değiştirme veya yayın yapma istekleri için araç yetkisi yoktur. Bu sınır prompt’un ötesinde arayüz ayrımıyla da korunur.

## Tekrar hafızası

`fingerprint()` Türkçe harf, boşluk ve noktalama normalizasyonundan sonra SHA-256 özeti üretir. Veritabanında her sürümün fingerprint’i saklanır.

`similarity()` Türkçe için küçük ek temizleme ve sınırlı eşanlam eşleştirmesiyle kelime vektörü kosinüs benzerliği hesaplar. Bu **lexical approximation** yöntemidir; varsayılan sistem embedding kullanıyormuş gibi sunulmaz. Tam metin için ayarlanabilir eşik, yakın geçmişte aynı hook ve ana fikir, son gönderilerde tekrar eden CTA ayrıca kontrol edilir.

`EmbeddingPort` isteğe bağlı genişletme arayüzüdür. `LiveContentEngine({ embeddings })` verilirse son 50 içerik üzerinde ek kosinüs kontrolü devreye girer. Bu dağıtımda hazır embedding sağlayıcısı, vektör indeks veya otomatik embedding API çağrısı etkin değildir. Sonraki SaaS sürümünde aynı arayüze sağlayıcı ve kalıcı vektör önbelleği eklenebilir.

## Doğal dil revizyon sınırları

Her paragrafın değişmeyen bir kimliği vardır. `revisionScope()` kullanıcının cümlesinden izin verilen kimlikleri belirler; `applyEdits()` modelin yalnız bu kimliklerde değişiklik yapmasına izin verir. Kapsam dışındaki paragraflar, sıra ve metadata mevcut kayıttan birebir korunur. Model tüm metni geri yazıp fark edilmeden başka bölümü değiştiremez.

Örnek davranışlar:

| İstek | Uygulama |
| --- | --- |
| “girişi daha kısa ve vurucu yap” | Sadece hook düzenlenir. |
| “CTA’yı çıkar” | CTA deterministik olarak kaldırılır; yazar çağrısı gerekmez. |
| “Bu kısmı bırak, sadece CTA’yı değiştir” | Yalnız CTA değişebilir. |
| “ikinci paragraf iyi ama başlangıcı değiştir” | İkinci paragraf korunur, hook değişebilir. |
| “üçüncü paragrafı değiştir” | Görünen metindeki üçüncü blok değişebilir; hook ilk paragraftır. |
| “girişi kısalt ve CTA’yı çıkar” | Hook için sınırlı model düzenlemesi ve kesin CTA silme birlikte uygulanır. |
| “çok kurumsal olmuş, daha doğal yaz” | Genel üslup isteği mevcut paragrafları düzenlemeye izin verir. |
| “bunu storytelling formatına çevir” | Açık format değiştirme isteği tam yeniden yazma yolunu kullanır. |
| “bu örneği çıkar” | Örnek belirsizse paragraf veya alıntı belirtme mesajı döner. |

Belirsiz bir “bu kısım” isteği model tahminiyle bütün gönderiyi değiştirme iznine dönüştürülmez. Tırnak içinde verilmiş tek bir paragraf parçası da hedef olarak kullanılabilir. Son konuşma mesajları modele bağlam olarak verilir; sunucudaki kapsam sınırı model tarafından genişletilemez.

Revizyon tamamlanınca kalite ve kaynak denetimi tekrar çalışır. Denetleyici diğer paragrafları kendi kararıyla düzeltmez; sorun varsa eski sürüm korunur. Başarılı revizyon yeni sürüm olarak kaydedilir ve yeniden insan onayı bekler. LLM’den gelen hiçbir değer “onaylandı” olarak yorumlanmaz.

## Marka hafızası

Tekrarlanan doğal üslup, emoji kullanmama ve daha kısa metin talepleri kontrollü tercih cümlelerine dönüşür. Servis bunları sayaçla kaydeder. `memoryEnabled=false` ise kayıtlı tercihler modele gönderilmez ve yeni tercih öğrenilmez. Tekil tercihlerin `enabled` alanı yönetim API’sinden kontrol edilebilir.

Bu sürüm sınırsız kişilik çıkarımı yapmaz. Kullanıcının her revizyonunu kalıcı sistem talimatı olarak kaydetmez. Öğrenilen tercih kapsamı genişletilebilir; kullanıcı verisi kaynak doğrulama veya yayın izninin yerine geçemez.

## Trend kaynakları için genişletme noktası

`TrendSource.collect()` yeni kaynakların ortak arayüzüdür. `HackerNewsSource` çalıştırılabilir isteğe bağlı adaptördür: resmi best stories listesi ve item uçlarını kullanır, her çağrıda en fazla 20 başlık toplar. HTTP istekleri yalnız sabit resmi API alanına gider; makale bağlantıları ziyaret edilmez. Referans: [Hacker News resmi API](https://github.com/HackerNews/API).

Toplanan başlıklar daima `verified=false` gelir. `trendToSourceFact()` aynı durumu korur. Yönetim API’sindeki kaynak kaydına aktarılabilir; başlık otomatik gerçek iddia veya kişisel deneyim sayılamaz. Bir başlığı dayanak olarak kullanmak için kaynağın içeriği ayrıca incelenmeli ve ilgili, sınırları belli olgu metni kaydedilmelidir. Sonrasında fikir motoru haberi kopyalamak yerine işletme etkisi üzerine açı üretebilir.

Bu sürümde trend toplama scheduler’a otomatik bağlı değildir. RSS, Product Hunt, GitHub Trending ve diğer kaynaklar için arayüz hazırdır; bunların canlı adaptörleri uygulanmış sayılmaz. İlk çalışan yayın akışı bu kaynaklara bağımlı değildir.

## Offline modun kesin sınırı

Offline adaptör, 40 elle yazılmış farklı örneğe sahiptir ve aynı kalite/tekrar kapısından geçer. Bu havuzun arka arkaya tamamının üretilebildiği test edilir. Yerel örneklerde gerçek model çağrısı, web doğrulaması, müşteri başarısı veya ölçülmüş sonuç yoktur.

Offline fikir havuzu sonludur: 40 fikir tüketilince kendi kendine yeni fikir uydurmaz. Gerçek sürekli fikir üretimi canlı model adaptörünün görevidir. Offline revizyonlar hook, CTA, kısaltma ve emoji kontrollerini deterministic örneklerle gösterir; genel doğal dil yazım kalitesini temsil etmez. Yerel testin başarılı olması canlı OpenAI, Telegram veya LinkedIn hesabının izinlerini doğrulamış olmaz.

## Doğrulama

`npx vitest run tests/content.test.ts` içerik modülünü tek başına test eder. Testler dağılım dengesi, sürümlerin tek sayılması, keşif, tüm offline havuzun özgünlüğü, sınırlı revizyon, birleşik komut, mevcut içeriğin korunması, sahte kaynak, sayısal iddia, bağımsız eleştirmen reddi, model yanıtı ve trend kaynağı sınırlarını kapsar.

Tam `npm run check` ve servis entegrasyon testleri de README’deki uçtan uca yayın senaryosunu doğrular. Gerçek hesaplarda canlı test için kullanıcı OAuth bağlantısı ve dış servis credential’ları gereklidir; canlı paylaşım ayrıca Telegram’daki açık onayı bekler.
