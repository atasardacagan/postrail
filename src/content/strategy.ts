import type { ContentContext, ContentPillar, Idea } from '../core/types.js';
import { latestHistory } from './similarity.js';

export type IdeaInput = Omit<Idea, 'id' | 'userId' | 'used' | 'createdAt'>;

export const FORMATS = ['educational', 'opinion', 'storytelling', 'case_study', 'before_after', 'list', 'building_in_public', 'contrarian', 'problem_solution', 'mini_guide', 'founder_insight'] as const;
export const SERIES = ['1 Dakikada Otomasyon', 'Bir İşletmede Bunu Otomatikleştirirdim', 'Vibe Coding Günlüğü', 'SaaS Yaparken Öğrendiğim Şeyler', 'Web Siten Neden Satmıyor?', 'AI ile Şirket Operasyonları', 'Bu işi hâlâ manuel mi yapıyorsunuz?'];

// Durable topics only: seed entries make no news, customer, revenue or personal-experience claims.
const TOPICS: [string, string, string, string][] = [
  ['Excel’den CRM’e veri taşıyan ekibin ilk otomasyon haritası', 'CRM otomasyonları', 'satış ekipleri', 'Alan eşleme ve çift kayıt riskini somut bir iş akışıyla anlat'],
  ['İyi görünen bir web sitesi neden teklif talebi getirmeyebilir?', 'Web tasarımı', 'KOBİ sahipleri', 'Görsel beğeni ile satın alma sorularını ayır'],
  ['Landing page formunda hangi alan gerçekten gerekli?', 'Landing page optimizasyonu', 'pazarlama yöneticileri', 'Her alanın karar için gerekliliğini sorgula'],
  ['AI agent’a araç yetkisi vermeden önce sorulacak sorular', 'AI agent sistemleri', 'operasyon yöneticileri', 'Yetki sınırı ve insan kontrolünü ticari risk üzerinden anlat'],
  ['n8n akışında hata olunca işi kim devralıyor?', 'n8n otomasyonları', 'ajans sahipleri', 'Başarısız adımın görünürlüğü ve sahipliği'],
  ['MVP kapsamı için özellik listesi yerine karar listesi', 'SaaS geliştirme', 'SaaS kurucuları', 'Doğrulanacak varsayımı üründen önce seç'],
  ['E-ticarette iade talebinin manuel yolculuğu', 'Şirket otomasyonu', 'e-ticaret şirketleri', 'Varsayımsal bir iade akışını önce sonra karşılaştır'],
  ['Satış otomasyonunda yanlış kişiye giden doğru mesaj', 'Satış otomasyonları', 'satış ekipleri', 'Tetikleyici koşullar ve izinli iletişim'],
  ['Destek botu hangi noktada insana devretmeli?', 'AI müşteri hizmetleri', 'şirket sahipleri', 'Yanıt kalitesinden önce devretme eşiği'],
  ['Web sitesi hızı bir tasarım kararını nasıl etkiler?', 'Modern web geliştirme', 'KOBİ sahipleri', 'Ölçüm ve kullanıcı görevi üzerinden düşün'],
  ['Vibe coding ile çıkan ürünü teslim etmeden önce', 'Vibe Coding', 'freelancerlar', 'Çalışan ekran ile güvenilir teslimat arasındaki kontroller'],
  ['Micro-SaaS fikrini tek bir tekrarlayan işe indirgemek', 'Micro-SaaS', 'girişimciler', 'Dar kullanım senaryosunda değer önerisi'],
  ['No-code aracından çıkış planı neden baştan düşünülmeli?', 'No-code / Low-code', 'startup kurucuları', 'Veri taşınabilirliği ve araç bağımlılığı'],
  ['Toplantı notundan göreve: onay nerede olmalı?', 'AI ile iş süreçleri', 'operasyon yöneticileri', 'Taslak görev ile kesin taahhüdü ayır'],
  ['Verimlilik ölçerken sadece süreye bakmak yeterli mi?', 'İşletmelerde verimlilik', 'şirket sahipleri', 'Hata, yeniden iş ve çalışan yükünü birlikte değerlendir'],
  ['Dijital dönüşüme yeni yazılım almadan başlamak', 'Dijital dönüşüm', 'KOBİ sahipleri', 'Süreç sahibi ve veri akışını görünür kıl'],
  ['CRO testinde aynı anda her şeyi değiştirme sorunu', 'Conversion Rate Optimization', 'pazarlama yöneticileri', 'Bir varsayım ve ölçülebilir davranış seç'],
  ['UX hatası olarak belirsiz hata mesajları', 'UX/UI', 'e-ticaret şirketleri', 'Kullanıcının sonraki adımını açık hale getir'],
  ['Bir hizmet sayfası müşterinin hangi sorularını cevaplamalı?', 'Web sitelerinin satışa etkisi', 'ajans sahipleri', 'Süreç, kapsam ve güven işaretlerini yapılandır'],
  ['Lead formundan sonra sessizlik oluşmasını önlemek', 'Lead generation', 'şirket sahipleri', 'Sahip atama ve yanıt takibini görünür kıl'],
  ['AI ile ürün geliştirmede küçük değerlendirme seti', 'AI ile ürün geliştirme', 'yazılımcılar', 'Gerçek izinli örneklerle hata türlerini takip et'],
  ['Ajans teslimatında tekrar eden kontrol listesini ürünleştirmek', 'Ajans otomasyonu', 'ajans sahipleri', 'Kontrol listesi ile müşteri iletişimini bağla'],
  ['B2B SaaS onboarding’de ilk faydayı tanımlamak', 'B2B SaaS', 'SaaS kurucuları', 'Kurulum tamamlandı ile değer görüldü farkı'],
  ['AI özelliğine maliyet sınırı koymak', 'AI + SaaS', 'startup kurucuları', 'Kullanım kotası ve maliyet görünürlüğü'],
  ['Her süreci otomatikleştirmek iyi bir fikir değil', 'Şirketlerin geleceği', 'şirket sahipleri', 'Önce gereksiz işi kaldırma görüşü'],
  ['Founder için ürün kararını değiştiren müşteri soruları', 'Founder / girişimcilik', 'girişimciler', 'Kendi yaşanmış hikâyesi iddia etmeden görüşme soruları öner'],
  ['AI agent yerine basit bir kural yeterli olabilir', 'AI agent sistemleri', 'KOBİ sahipleri', 'Belirsizlik düşükse daha basit sistemin avantajları'],
  ['Yazılım ürünleştirmede her müşteriye evet demenin bedeli', 'Yazılım ürünleştirme', 'freelancerlar', 'Ürün sınırı ve özel iş ayrımı üzerine görüş'],
  ['Prompt değişikliği neden ürün değişikliği sayılmalı?', 'AI güvenilirliği ve insan onayı', 'SaaS kurucuları', 'Versiyonlama ve geri dönüş planı üzerine görüş'],
  ['Daha fazla dashboard daha iyi karar demek mi?', 'Ürün analitiği', 'operasyon yöneticileri', 'Metrik yerine karar sahibine odaklan'],
  ['Ucuz otomasyonun görünmeyen bakım yükü', 'Otomasyon yatırım geri dönüşü', 'ajans sahipleri', 'İlk kurulumdan sonra sahiplik üzerine karşı görüş'],
  ['Teknik borcu sadece geliştiricinin sorunu saymak', 'Modern web geliştirme', 'şirket sahipleri', 'Değişim süresi üzerinden iş etkisi'],
  ['Bir AI içerik sisteminin onay adımını tasarlamak', 'Building in public', 'yazılımcılar', 'Proje tasarım notu: uyguladım demeden tasarım tercihleri'],
  ['MVP günlüğü için karar kaydı şablonu', 'Projelerden öğrenilenler', 'startup kurucuları', 'Kullanıcının gerçek proje notları yoksa kullanılabilecek şablon sun'],
  ['Vibe coding projesinde geri alınabilir değişiklikler', 'Vibe Coding', 'freelancerlar', 'Deney tasarımı ve küçük teslimat notu'],
  ['Micro-SaaS için halka açık problem günlüğü', 'Micro-SaaS', 'girişimciler', 'Gerçek veri yoksa kişisel başarı iddia etmeden çalışma yöntemi'],
  ['Web sitesi talebinden önce hazırlanabilecek kısa problem notu', 'Web tasarımı', 'KOBİ sahipleri', 'Uygun müşteri için doğal görüşme daveti'],
  ['Otomasyon projesi için hangi süreci seçmelisiniz?', 'Şirket otomasyonu', 'şirket sahipleri', 'Tekrarlanan sorun üzerinden nazik görüşme önerisi'],
  ['CRM dağınıklığını tarif eden bir keşif kontrol listesi', 'CRM otomasyonları', 'satış ekipleri', 'Sorunun kapsamını belirlemek için yumuşak CTA'],
  ['Landing page iyileştirmesine başlamadan paylaşılacak bilgiler', 'Landing page optimizasyonu', 'pazarlama yöneticileri', 'Müşteri ihtiyacını netleştiren ticari ama faydalı içerik'],
];

export function seedIdeas(count = 40): IdeaInput[] {
  return TOPICS.slice(0, Math.max(0, Math.min(count, TOPICS.length))).map(([title, category, audience, angle], index) => ({
    title, category, audience, angle, hookIdea: title,
    pillar: index < 24 ? 'education' : index < 32 ? 'opinion' : index < 36 ? 'building' : 'commercial',
    format: FORMATS[index % FORMATS.length] ?? 'educational', series: index % 3 === 0 ? SERIES[index % SERIES.length] ?? null : null,
    priority: 60 + index % 5 * 5, freshness: 70,
  }));
}

export function selectIdea(ideas: Idea[], context: ContentContext, random: () => number = Math.random): Idea | null {
  const candidates = ideas.filter(i => !i.used && (!context.settings.contentCategories.length || context.settings.contentCategories.includes(i.category)));
  if (!candidates.length) return null;
  const history = latestHistory(context.history).slice(0, 20);
  const commercial = context.settings.commercialContentRatio;
  const ratios: Record<ContentPillar, number> = { education: (1 - commercial) * 2 / 3, opinion: (1 - commercial) * 2 / 9, building: (1 - commercial) / 9, commercial };
  const counts = { education: 0, opinion: 0, building: 0, commercial: 0 };
  for (const item of history) counts[item.content.pillar]++;
  const pillar = (Object.keys(ratios) as ContentPillar[]).filter(p => candidates.some(i => i.pillar === p))
    .sort((a, b) => (ratios[b] * (history.length + 1) - counts[b]) - (ratios[a] * (history.length + 1) - counts[a]))[0];
  const pool = candidates.filter(i => i.pillar === pillar);
  const experimental = random() < context.settings.explorationRatio;
  const ranked = pool.map(idea => {
    let score = idea.priority * 0.35 + idea.freshness * 0.25;
    for (const [index, previous] of history.slice(0, 6).entries()) {
      const weight = 1 / (index + 1);
      if (previous.content.category === idea.category) score -= 35 * weight;
      if (index < 2 && previous.content.format === idea.format) score -= 40 * weight;
      if (index < 3 && idea.series && previous.content.series === idea.series) score -= 50 * weight;
    }
    if (experimental) score += random() * 30;
    else for (const pattern of context.patterns) {
      if (pattern.sampleSize < 3) continue;
      const matches = (pattern.dimension === 'category' && pattern.value === idea.category) || (pattern.dimension === 'format' && pattern.value === idea.format);
      if (matches) score += Math.min(100, Math.max(0, pattern.score)) * 0.3;
    }
    return { idea, score };
  });
  return ranked.sort((a, b) => b.score - a.score || a.idea.id.localeCompare(b.idea.id))[0]?.idea ?? null;
}
