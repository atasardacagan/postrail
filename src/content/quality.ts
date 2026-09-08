import type { ContentContext, DraftContent, SourceFact } from '../core/types.js';
import { draftSchema } from './schemas.js';
import { findDuplicate, normalize, renderContent, similarity } from './similarity.js';

export class ContentQualityError extends Error {
  constructor(public readonly issues: string[]) { super(`Content rejected: ${issues.join('; ')}`); this.name = 'ContentQualityError'; }
}

const banned = ['günümüz dünyasında', 'hızla değişen dijital dünyada', 'işte burada devreye giriyor', 'oyunun kurallarını değiştiriyor', 'kaçırılmayacak fırsat'];
const personalClaim = /(?:geçen\s+(?:hafta|ay|yıl)|müşterim(?:de|iz|in|e)?|müşterimiz(?:de|in|e)?|projemde|geliştirdiğim|kazandırdım|artırdım|artırdık|sağladım|tasarruf ettirdim|elde ettim|kurduğum|yaşadım)/iu;
const researchClaim = /(?:araştırma(?:ya|lar|sı)?\s+(?:göre|göster|ortaya)|rapor(?:una|a)\s+göre|istatistik|kanıtlandı|dünyanın (?:en|ilk)|pazar lideri|milyon|milyar|(?<!\p{L})yüzde(?!\p{L})|ikiye katla|iki kat|yarıya indir|yarı yarıya)/iu;

function factSupports(sentence: string, fact: SourceFact, personal: boolean): boolean {
  if (!fact.verified || (personal && !fact.personal)) return false;
  const numbers = sentence.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numbers.some(number => !fact.text.includes(number))) return false;
  // Conservative lexical evidence check plus separate model entailment review, not web verification.
  return normalize(fact.text).includes(normalize(sentence)) || similarity(sentence, fact.text) >= 0.72;
}

export function validateContent(content: DraftContent, context: ContentContext, options: { checkSimilarity?: boolean } = {}): string[] {
  const result = draftSchema.safeParse(content);
  if (!result.success) return ['Invalid content structure'];
  const issues: string[] = [];
  const text = renderContent(content);
  const hook = content.blocks.filter(b => b.kind === 'hook');
  if (new Set(content.blocks.map(b => b.id)).size !== content.blocks.length) issues.push('Duplicate block IDs');
  if (hook.length !== 1 || content.blocks[0]?.kind !== 'hook') issues.push('Exactly one opening hook is required');
  if (!content.blocks.some(b => b.kind === 'body')) issues.push('A useful body is required');
  if (content.blocks.filter(b => b.kind === 'cta').length > 1) issues.push('At most one CTA is permitted');
  if (content.blocks.some((b, i) => b.kind === 'cta' && i !== content.blocks.length - 1)) issues.push('CTA must be the final block');
  if (text.length > Math.min(3000, context.settings.maxPostLength)) issues.push('Post exceeds maximum length');
  if (text.length < Math.max(80, context.settings.minPostLength)) issues.push('Post is shorter than configured minimum');
  if (banned.some(phrase => normalize(text).includes(normalize(phrase)))) issues.push('Generic AI or promotional wording');
  const hashtags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (hashtags.length > (context.settings.hashtagMode === 'none' ? 0 : 3)) issues.push('Hashtag policy violation');
  if ((text.match(/\p{Extended_Pictographic}/gu) ?? []).length > 3) issues.push('Excessive emoji');
  const citedFacts = context.facts.filter(fact => content.sourceIds.includes(fact.id) && fact.verified);
  if (content.sourceIds.some(id => !citedFacts.some(fact => fact.id === id))) issues.push('Unverified or unknown source ID');
  for (const block of content.blocks) {
    if (block.text.length > 650) issues.push('Paragraph is too long for mobile reading');
    const sentences = block.text.split(/(?<=[.!?])\s+|\n/u);
    for (const rawSentence of sentences) {
      const sentence = rawSentence.replace(/^\s*\d+[.)]\s*/, '');
      const personal = personalClaim.test(sentence);
      // List labels are structural; numerical claims, dates and measured results require provenance.
      const numeric = /\d/u.test(sentence.replace(/\b(?:n8n|b2b|b2c|html5|css3)\b/giu, ''));
      if ((personal || numeric || researchClaim.test(sentence)) && !citedFacts.some(fact => factSupports(sentence, fact, personal))) {
        issues.push(personal ? 'Unsupported personal experience claim' : 'Unsupported numerical or research claim');
      }
    }
  }
  if (content.scores.overall < context.settings.qualityThreshold) issues.push('Quality score is below threshold');
  if (options.checkSimilarity !== false) {
    const duplicate = findDuplicate(content, context.history, context.settings.similarityThreshold);
    if (duplicate) issues.push(`Repeated ${duplicate.reason}`);
  }
  return [...new Set(issues)];
}

export function requireQuality(content: DraftContent, context: ContentContext, options?: { checkSimilarity?: boolean }): void {
  const issues = validateContent(content, context, options);
  if (issues.length) throw new ContentQualityError(issues);
}
