import { createHash } from 'node:crypto';
import type { DraftContent, Version } from '../core/types.js';

export function normalize(text: string): string {
  return text.toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function renderContent(content: Pick<DraftContent, 'blocks'>): string {
  return content.blocks.map(block => block.text).join('\n\n');
}

export function fingerprint(text: string): string {
  return createHash('sha256').update(normalize(text)).digest('hex');
}

const stop = new Set('bir bu ve ile icin de da mi mu daha en her olan olarak ama veya ise o su'.split(' '));
const synonyms: Record<string, string> = { manuel: 'manual', elle: 'manual', sirket: 'business', isletme: 'business', otomasyon: 'automation', otomatik: 'automation', musteri: 'customer', yazilim: 'software' };
function tokens(text: string): string[] {
  return normalize(text).split(' ').filter(t => t.length > 2 && !stop.has(t)).map(token => {
    const stem = token.replace(/(larinin|lerinin|larin|lerin|larda|lerde|lari|leri|nin|nun|dan|den|lar|ler|iniz|imiz|ini|unu|si)$/, '');
    return synonyms[stem] ?? stem;
  });
}

/** Lexical semantic approximation; this is deliberately not advertised as an embedding. */
export function similarity(a: string, b: string): number {
  if (!normalize(a) || !normalize(b)) return 0;
  if (normalize(a) === normalize(b)) return 1;
  const at = tokens(a); const bt = tokens(b);
  const ac = new Map<string, number>(); const bc = new Map<string, number>();
  for (const t of at) ac.set(t, (ac.get(t) ?? 0) + 1);
  for (const t of bt) bc.set(t, (bc.get(t) ?? 0) + 1);
  let dot = 0; let an = 0; let bn = 0;
  for (const [t, count] of ac) { dot += count * (bc.get(t) ?? 0); an += count * count; }
  for (const count of bc.values()) bn += count * count;
  return an && bn ? dot / Math.sqrt(an * bn) : 0;
}

export function latestHistory(history: Version[]): Version[] {
  const latest = new Map<string, Version>();
  for (const version of history) {
    const previous = latest.get(version.postId);
    if (!previous || previous.version < version.version) latest.set(version.postId, version);
  }
  return [...latest.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findDuplicate(content: DraftContent, history: Version[], threshold = 0.82): { postId: string; reason: string; score: number } | null {
  const text = renderContent(content);
  const hook = content.blocks.find(b => b.kind === 'hook')?.text ?? '';
  const cta = content.blocks.find(b => b.kind === 'cta')?.text ?? '';
  const recent = latestHistory(history);
  for (const [index, previous] of recent.entries()) {
    const score = similarity(text, previous.text);
    if (score >= threshold || fingerprint(text) === previous.fingerprint) return { postId: previous.postId, reason: 'text', score };
    const oldHook = previous.content.blocks.find(b => b.kind === 'hook')?.text ?? '';
    if (index < 12 && hook && similarity(hook, oldHook) >= 0.91) return { postId: previous.postId, reason: 'hook', score: similarity(hook, oldHook) };
    if (index < 8 && similarity(content.topic, previous.content.topic) >= 0.95) return { postId: previous.postId, reason: 'main_idea', score: 1 };
    const oldCta = previous.content.blocks.find(b => b.kind === 'cta')?.text ?? '';
    if (index < 3 && cta && similarity(cta, oldCta) >= 0.95) return { postId: previous.postId, reason: 'cta', score: 1 };
  }
  return null;
}

export interface EmbeddingPort { embed(texts: string[]): Promise<number[][]> }
export function cosineEmbedding(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length || [...a, ...b].some(v => !Number.isFinite(v))) throw new Error('Invalid embedding dimensions');
  const dot = a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
  const magnitude = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0));
  return magnitude ? dot / magnitude : 0;
}
