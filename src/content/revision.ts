import type { ContentBlock, DraftContent } from '../core/types.js';
import { normalize } from './similarity.js';

export interface RevisionScope { allowedIds: string[]; removeIds: string[]; preference: string | null; fullRewrite: boolean }
export class RevisionScopeError extends Error {
  constructor(message = 'Revizyon kapsamı belirsiz. Başlangıç, CTA veya paragraf numarasını belirtin.') { super(message); this.name = 'RevisionScopeError'; }
}

export function revisionScope(content: DraftContent, instruction: string): RevisionScope {
  const text = normalize(instruction);
  if (!text || text.length > 2000) throw new RevisionScopeError('Revizyon talebi boş veya çok uzun.');
  const ids = new Set<string>();
  const protectedIds = new Set<string>();
  const hook = content.blocks.find(b => b.kind === 'hook');
  const cta = content.blocks.find(b => b.kind === 'cta');
  const mentionsCta = /\bcta\b|cagri|aksiyon cagrisi/.test(text);
  const mentionsHook = /giris|baslangic|\bhook\b|ilk paragraf|ilk satir/.test(text);
  const remove = /cikar|kaldir|\bsil\b|kullanma/.test(text);
  const fullRewrite = /yeniden yaz|bastan yaz|tamamen.*(?:yaz|degistir|aci)|baska acidan|storytelling|hikaye format|formatina cevir/.test(text);
  // The final explicit "sadece" clause defines the edit boundary even if other parts are mentioned.
  const only = text.includes('sadece ') ? text.slice(text.lastIndexOf('sadece ') + 7) : null;
  if (mentionsCta && (!only || /cta|cagri/.test(only))) {
    if (!cta) throw new RevisionScopeError('Bu taslakta CTA yok. Yeni CTA eklemek için yeniden yazma isteği verin.');
    ids.add(cta.id);
  }
  if (mentionsHook && (!only || /giris|baslangic|hook|ilk/.test(only)) && hook) ids.add(hook.id);
  const ordinals: [string, number][] = [['birinci', 0], ['ikinci', 1], ['ucuncu', 2], ['dorduncu', 3], ['besinci', 4]];
  for (const [word, index] of ordinals) {
    if (!text.includes(`${word} paragraf`)) continue;
    const block = content.blocks[index];
    if (!block) throw new RevisionScopeError('Belirtilen paragraf bu taslakta yok.');
    if (new RegExp(`${word} paragraf.{0,25}(iyi|koru|ayni kalsin|birak|degistirme)`).test(text)) protectedIds.add(block.id);
    else if (!only || only.includes(`${word} paragraf`)) ids.add(block.id);
  }
  const ordinal = text.match(/\b(\d+) paragraf/);
  if (ordinal?.[1]) {
    const block = content.blocks[Number(ordinal[1]) - 1];
    if (!block) throw new RevisionScopeError('Belirtilen paragraf bu taslakta yok.');
    ids.add(block.id);
  }
  if (/son (?:bolum|paragraf)/.test(text) && !only) {
    const last = content.blocks.at(-1); if (last) ids.add(last.id);
  }
  const quoted = instruction.match(/[“"]([^”"]{5,})[”"]/u)?.[1];
  if (quoted && ids.size === 0) {
    const matches = content.blocks.filter(block => block.text.includes(quoted));
    if (matches.length !== 1) throw new RevisionScopeError('Alıntı tek bir paragrafa karşılık gelmiyor.');
    if (matches[0]) ids.add(matches[0].id);
  }
  if (!ids.size) {
    if (/bu kismi|bu ornegi|burayi|su kismi/.test(text) && !fullRewrite) throw new RevisionScopeError();
    // Global style instructions are authorized to edit every existing block, never add or reorder them.
    if (fullRewrite || /kisa|uzun|dogal|kurumsal|yapay|insan gibi|teknik|iddiali|emoji|bahset|hedef|kurucular|gore yaz|musteri|ton|samimi|sade/.test(text)) {
      for (const block of content.blocks) ids.add(block.id);
    } else throw new RevisionScopeError();
  }
  for (const id of protectedIds) ids.delete(id);
  if (!ids.size) throw new RevisionScopeError();
  const preference = /dogal|yapay|insan gibi/.test(text) ? 'Daha doğal, konuşur gibi; yapay ve kurumsal kalıplardan kaçın.'
    : /emoji.*(?:kullanma|cikar|kaldir)/.test(text) ? 'Emoji kullanma.'
      : /daha kisa|biraz.*kisa/.test(text) && !mentionsHook ? 'Gönderileri daha kısa tut.' : null;
  const removeIds = mentionsCta && remove && cta && ids.has(cta.id) ? [cta.id]
    : remove && !/emoji|hashtag|kelime|cumle/.test(text) && /paragraf|bolum/.test(text) ? [...ids] : [];
  return { allowedIds: [...ids], removeIds, preference, fullRewrite: fullRewrite && !only && !protectedIds.size };
}

export function applyEdits(content: DraftContent, scope: RevisionScope, edits: { blockId: string; text: string | null }[]): DraftContent {
  if (!edits.length || new Set(edits.map(edit => edit.blockId)).size !== edits.length) throw new RevisionScopeError('Empty or repeated edits');
  const map = new Map(edits.map(edit => [edit.blockId, edit.text]));
  for (const edit of edits) {
    if (!scope.allowedIds.includes(edit.blockId) || !content.blocks.some(block => block.id === edit.blockId)) throw new RevisionScopeError('Model attempted to modify a protected block');
    if (edit.text === null && !scope.removeIds.includes(edit.blockId)) throw new RevisionScopeError('Model attempted an unauthorized deletion');
    if (edit.text !== null && (!edit.text.trim() || /\n\s*\n/u.test(edit.text))) throw new RevisionScopeError('Edits must contain one nonempty paragraph');
  }
  const blocks: ContentBlock[] = content.blocks.flatMap(block => {
    if (!map.has(block.id)) return [{ ...block }];
    const text = map.get(block.id);
    return text === null ? [] : [{ ...block, text: text ?? block.text }];
  });
  return { ...structuredClone(content), blocks };
}
