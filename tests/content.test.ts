import { describe, expect, it, vi } from 'vitest';
import type { ContentContext, DraftContent, Idea, Version } from '../src/core/types.js';
import { defaultSettings } from '../src/core/config.js';
import { applyEdits, ContentQualityError, findDuplicate, fingerprint, LiveContentEngine, OfflineContentEngine, renderContent, ResponsesModel, revisionScope, seedIdeas, selectIdea, similarity, validateContent } from '../src/content/index.js';
import type { JsonModel } from '../src/content/index.js';
import type { z } from 'zod';
import { HackerNewsSource, trendToSourceFact } from '../src/content/trends.js';

function context(): ContentContext {
  return { settings: defaultSettings('123456'), history: [], memory: [], facts: [], patterns: [] };
}
function ideas(): Idea[] { return seedIdeas().map((idea, i) => ({ ...idea, id: `idea-${i}`, userId: 'owner', used: false, createdAt: '2026-09-01T07:30:00Z' })); }
async function draft(): Promise<DraftContent> { return new OfflineContentEngine().generate(ideas()[0]!, context()); }
function version(content: DraftContent, postId = 'post-1', date = '2026-09-01T07:30:00Z'): Version {
  const text = renderContent(content);
  return { id: `${postId}-v1`, postId, userId: 'owner', version: 1, content, text, fingerprint: fingerprint(text), instruction: null, createdAt: date };
}

class QueueModel implements JsonModel {
  calls: { name: string; data: unknown }[] = [];
  constructor(private readonly responses: unknown[]) {}
  async complete<T>(name: string, schema: z.ZodType<T>, _instructions: string, data: unknown): Promise<T> {
    this.calls.push({ name, data });
    return schema.parse(this.responses.shift());
  }
}

describe('content strategy', () => {
  it('provides 40 distinct ideas with configured categories and desired seed mix', () => {
    const pool = ideas(); const config = context().settings;
    expect(pool).toHaveLength(40);
    expect(new Set(pool.map(idea => fingerprint(idea.title))).size).toBe(40);
    expect(pool.every(idea => config.contentCategories.includes(idea.category))).toBe(true);
    expect(pool.filter(idea => idea.pillar === 'education')).toHaveLength(24);
    expect(pool.filter(idea => idea.pillar === 'commercial')).toHaveLength(4);
  });
  it('allocates 60/20/10/10 over ten posts without counting revisions as additional posts', async () => {
    const ctx = context(); const pool = ideas(); const base = await draft(); const selected: Idea[] = [];
    for (let i = 0; i < 10; i++) {
      const idea = selectIdea(pool, ctx, () => 0.8)!;
      expect(idea).not.toBeNull(); selected.push(idea); idea.used = true;
      const item = version({ ...base, topic: idea.title, category: idea.category, format: idea.format, pillar: idea.pillar, series: idea.series }, `post-${i}`, `2026-09-${String(i + 1).padStart(2, '0')}T07:30:00Z`);
      ctx.history.push(item, { ...item, id: `${item.id}-rev`, version: 2 });
    }
    expect(selected.filter(idea => idea.pillar === 'education')).toHaveLength(6);
    expect(selected.filter(idea => idea.pillar === 'opinion')).toHaveLength(2);
    expect(selected.filter(idea => idea.pillar === 'building')).toHaveLength(1);
    expect(selected.filter(idea => idea.pillar === 'commercial')).toHaveLength(1);
  });
  it('uses learned patterns only outside exploration and only with enough samples', () => {
    const ctx = context();
    const pool = ideas().slice(0, 2).map((item, index) => ({ ...item, priority: index ? 65 : 70, freshness: 70, series: null, format: index ? 'contrarian' : 'mini_guide' }));
    ctx.patterns = [{ dimension: 'format', value: 'contrarian', score: 100, sampleSize: 8 }];
    expect(selectIdea(pool, ctx, () => 0.9)?.id).toBe(pool[1]?.id);
    expect(selectIdea(pool, ctx, () => 0)?.id).toBe(pool[0]?.id);
    ctx.patterns[0]!.sampleSize = 1;
    expect(selectIdea(pool, ctx, () => 0.9)?.id).toBe(pool[0]?.id);
  });
  it('returns no idea when all topics are used', () => {
    expect(selectIdea(ideas().map(idea => ({ ...idea, used: true })), context())).toBeNull();
  });
  it('can generate the full offline backlog in sequence without repeating draft content or recent CTA', async () => {
    const engine = new OfflineContentEngine(); const ctx = context(); const pool = ideas();
    for (let i = 0; i < 40; i++) {
      const idea = selectIdea(pool, ctx, () => 0.8)!;
      const content = await engine.generate(idea, ctx);
      expect(validateContent(content, ctx)).toEqual([]);
      ctx.history.push(version(content, `sequential-${i}`, new Date(Date.UTC(2026, 8, i + 1)).toISOString()));
      idea.used = true;
    }
    expect(new Set(ctx.history.map(item => item.fingerprint)).size).toBe(40);
    expect(await engine.ideas(ctx, pool, 40)).toEqual([]);
  });
  it('refills forty live ideas in four bounded batches and carries prior batches into the exclusion context', async () => {
    const pool = seedIdeas();
    const model = new QueueModel(Array.from({ length: 4 }, (_, index) => ({ ideas: pool.slice(index * 10, index * 10 + 10) })));
    const generated = await new LiveContentEngine({ jsonModel: model }).ideas(context(), [], 40);
    expect(generated).toHaveLength(40);
    expect(model.calls).toHaveLength(4);
    expect(model.calls.map(call => (call.data as { count: number }).count)).toEqual([10, 10, 10, 10]);
    const fourth = model.calls[3]!.data as { existing: { title: string; angle: string }[] };
    expect(fourth.existing).toHaveLength(30);
    expect(fourth.existing[29]?.title).toBe(pool[29]?.title);
  });
  it('uses a smaller final idea batch and rejects over-sized model responses', async () => {
    const pool = seedIdeas();
    const model = new QueueModel([{ ideas: pool.slice(0, 10) }, { ideas: pool.slice(10, 12) }]);
    expect(await new LiveContentEngine({ jsonModel: model }).ideas(context(), [], 12)).toHaveLength(12);
    expect(model.calls.map(call => (call.data as { count: number }).count)).toEqual([10, 2]);
    const oversized = new QueueModel([{ ideas: pool.slice(0, 2) }]);
    await expect(new LiveContentEngine({ jsonModel: oversized }).ideas(context(), [], 1)).rejects.toThrow();
  });
  it('does not loop forever when a later live idea batch repeats prior ideas', async () => {
    const pool = seedIdeas().slice(0, 10);
    const model = new QueueModel([{ ideas: pool }, { ideas: pool }]);
    const generated = await new LiveContentEngine({ jsonModel: model }).ideas(context(), [], 20);
    expect(generated).toHaveLength(10);
    expect(model.calls).toHaveLength(2);
    expect(new Set(generated.map(item => item.title)).size).toBe(10);
  });
});

describe('writer performance learning', () => {
  it('provides observed hook and length suggestions with sufficient samples while honoring config and visible brand preferences', async () => {
    const ctx = context(); const idea = ideas()[1]!;
    ctx.settings.maxPostLength = 1000; ctx.settings.ctaFrequency = 0;
    ctx.memory = [{ id: 'style', preference: 'Kısa ve sade yaz.', count: 5, enabled: true }];
    ctx.patterns = [
      { dimension: 'hook', value: 'question', score: 70, sampleSize: 3 },
      { dimension: 'hook', value: 'statement', score: 95, sampleSize: 2 },
      { dimension: 'length', value: '>1600', score: 100, sampleSize: 8 },
      { dimension: 'length', value: '800-1600', score: 60, sampleSize: 4 },
      { dimension: 'cta', value: 'present', score: 90, sampleSize: 8 },
      { dimension: 'day', value: '2', score: 100, sampleSize: 8 },
    ];
    const current = await new OfflineContentEngine().generate(idea, ctx);
    const model = new QueueModel([current, { pass: true, scores: current.scores, issues: [], unsupportedClaims: [] }]);
    await new LiveContentEngine({ jsonModel: model }).generate(idea, ctx);
    const writer = model.calls[0]!.data as { learning: { mode: string; suggestions: unknown[] }; preferences: string[]; includeCta: boolean };
    expect(writer.learning.mode).toBe('proven');
    expect(writer.learning.suggestions).toEqual([
      { dimension: 'hook', value: 'question', score: 70, sampleSize: 3 },
      { dimension: 'length', value: '800-1600', score: 60, sampleSize: 4, characterRange: { min: 800, max: 1000 } },
    ]);
    expect(writer.preferences).toEqual(['Kısa ve sade yaz.']);
    expect(writer.includeCta).toBe(false);
    expect(model.calls[1]?.data).not.toHaveProperty('learning');
  });
  it('keeps exploration assignment stable across retries and omits proven pattern pressure', async () => {
    const ctx = context(); ctx.settings.explorationRatio = 1;
    ctx.patterns = [{ dimension: 'hook', value: 'question', score: 90, sampleSize: 8 }];
    const current = await draft();
    const model = new QueueModel([current, { pass: false, scores: current.scores, issues: ['Hook zayıf'], unsupportedClaims: [] }, current, { pass: true, scores: current.scores, issues: [], unsupportedClaims: [] }]);
    await new LiveContentEngine({ jsonModel: model }).generate(ideas()[0]!, ctx);
    const first = model.calls[0]!.data as { learning: unknown };
    const retry = model.calls[2]!.data as { learning: unknown };
    expect(first.learning).toEqual({ mode: 'exploration', suggestions: [] });
    expect(retry.learning).toEqual(first.learning);
  });
});

describe('revision boundaries', () => {
  it('changes only hook, then removes CTA while preserving all body bytes', async () => {
    const engine = new OfflineContentEngine(); const current = await draft(); const ctx = context();
    const result = await engine.revise(current, 'girişi daha kısa ve vurucu yap', ctx, []);
    expect(result.content.blocks[0]?.text).not.toBe(current.blocks[0]?.text);
    expect(result.content.blocks.slice(1)).toEqual(current.blocks.slice(1));
    const second = await engine.revise(result.content, 'CTA’yı çıkar', ctx, ['girişi daha kısa ve vurucu yap']);
    expect(second.content.blocks).toEqual(result.content.blocks.filter(block => block.kind !== 'cta'));
    expect(current.blocks.some(block => block.kind === 'cta')).toBe(true);
  });
  it('treats explicit only-CTA constraint as an immutable boundary', async () => {
    const current = await draft();
    const scope = revisionScope(current, "Bu kısmı bırak, sadece CTA'yı değiştir.");
    expect(scope.allowedIds).toEqual(['cta']);
    expect(() => applyEdits(current, scope, [{ blockId: 'body-1', text: 'Başka metin.' }])).toThrow('protected block');
    expect(() => applyEdits(current, scope, [{ blockId: 'cta', text: null }])).toThrow('unauthorized deletion');
    expect(() => applyEdits(current, scope, [{ blockId: 'cta', text: 'Metin.\n\nYeni paragraf.' }])).toThrow('one nonempty paragraph');
  });
  it('understands protected second paragraph and edits the beginning', async () => {
    const current = await draft();
    const scope = revisionScope(current, 'ikinci paragraf iyi ama başlangıcı değiştir');
    expect(scope.allowedIds).toEqual(['hook']);
  });
  it('does not infer ambiguous references or approval actions as content edits', async () => {
    const current = await draft();
    expect(() => revisionScope(current, 'bu örneği çıkar')).toThrow('belirsiz');
    expect(() => revisionScope(current, 'onayla')).toThrow('belirsiz');
  });
  it('rejects a live model edit outside the allowed scope', async () => {
    const current = await draft();
    const model = new QueueModel([{ edits: [{ blockId: 'body-1', text: 'Yetkisiz değişiklik.' }] }]);
    await expect(new LiveContentEngine({ jsonModel: model }).revise(current, 'ilk paragrafı değiştir', context(), [])).rejects.toThrow('protected block');
  });
  it('performs live hook editing and independent review while preserving body exactly', async () => {
    const current = await draft();
    const model = new QueueModel([{ edits: [{ blockId: 'hook', text: 'Bilgiyi taşımak neden hâlâ birinin işi?' }] }, { pass: true, scores: current.scores, issues: [], unsupportedClaims: [] }]);
    const result = await new LiveContentEngine({ jsonModel: model }).revise(current, 'girişi daha kısa ve vurucu yap', context(), ['önceki konuşma']);
    expect(result.content.blocks.slice(1)).toEqual(current.blocks.slice(1));
    expect(model.calls.map(call => call.name)).toEqual(['targeted_edits', 'revision_critique']);
  });
  it('removes CTA deterministically without asking writer and still reviews quality', async () => {
    const current = await draft();
    const model = new QueueModel([{ pass: true, scores: current.scores, issues: [], unsupportedClaims: [] }]);
    const result = await new LiveContentEngine({ jsonModel: model }).revise(current, "CTA'yı çıkar", context(), []);
    expect(result.content.blocks).toEqual(current.blocks.filter(b => b.kind !== 'cta'));
    expect(model.calls.map(call => call.name)).toEqual(['revision_critique']);
  });
  it('respects disabled brand memory when learning preferences', async () => {
    const ctx = context(); ctx.settings.memoryEnabled = false;
    expect((await new OfflineContentEngine().revise(await draft(), 'daha doğal yaz', ctx, [])).preference).toBeNull();
  });
  it('applies compound hook-edit and CTA-removal instructions without ignoring either action', async () => {
    const current = await draft();
    const model = new QueueModel([{ edits: [{ blockId: 'hook', text: 'Bilgi taşımak kimin asıl işi?' }] }, { pass: true, scores: current.scores, issues: [], unsupportedClaims: [] }]);
    const result = await new LiveContentEngine({ jsonModel: model }).revise(current, 'girişi kısalt ve CTA’yı çıkar', context(), []);
    expect(result.content.blocks[0]?.text).toBe('Bilgi taşımak kimin asıl işi?');
    expect(result.content.blocks.some(block => block.kind === 'cta')).toBe(false);
    expect(result.content.blocks.filter(block => block.kind === 'body')).toEqual(current.blocks.filter(block => block.kind === 'body'));
  });
});

describe('quality and provenance', () => {
  it('rejects invented personal results, metrics and unknown sources', async () => {
    const current = await draft();
    current.blocks[1]!.text = 'Geçen hafta bir müşterimde satışları %40 artırdım.';
    current.sourceIds = ['invented'];
    const issues = validateContent(current, context());
    expect(issues).toContain('Unsupported personal experience claim');
    expect(issues).toContain('Unverified or unknown source ID');
  });
  it('does not let an unrelated verified source legitimize a made-up statistic', async () => {
    const current = await draft(); const ctx = context();
    current.blocks[1]!.text = 'Araştırmaya göre otomasyon şirketlerin satışını %40 artırıyor.';
    current.sourceIds = ['source']; ctx.facts = [{ id: 'source', url: 'https://example.org/research', text: 'Form testine 40 kişi katıldı.', verified: true, personal: false }];
    expect(validateContent(current, ctx)).toContain('Unsupported numerical or research claim');
  });
  it('allows explicitly verified exact source claims and structural list labels', async () => {
    const current = await draft(); const ctx = context();
    const fact = 'Form testine 40 kişi katıldı.';
    current.blocks[1]!.text = fact; current.blocks[2]!.text = '1. Mevcut iş akışını yazın.\n2. Sorumlusunu belirleyin.';
    current.sourceIds = ['source']; ctx.facts = [{ id: 'source', url: 'https://example.org/research', text: fact, verified: true, personal: false }];
    expect(validateContent(current, ctx)).toEqual([]);
  });
  it('requires personal provenance for personal claims even if a generic source matches', async () => {
    const current = await draft(); const ctx = context();
    const fact = 'Müşterimde bu akışı kurduğum gün veri eşlemesini düzelttim.';
    current.blocks[1]!.text = fact; current.sourceIds = ['source'];
    ctx.facts = [{ id: 'source', url: null, text: fact, verified: true, personal: false }];
    expect(validateContent(current, ctx)).toContain('Unsupported personal experience claim');
    ctx.facts[0]!.personal = true;
    expect(validateContent(current, ctx)).toEqual([]);
  });
  it('rejects independent reviewer concerns and bounds generation attempts', async () => {
    const current = await draft();
    const badReview = { pass: false, scores: current.scores, issues: ['Fazla jenerik'], unsupportedClaims: [] };
    const model = new QueueModel([current, badReview, current, badReview]);
    await expect(new LiveContentEngine({ jsonModel: model, maxAttempts: 2 }).generate(ideas()[0]!, context())).rejects.toBeInstanceOf(ContentQualityError);
    expect(model.calls).toHaveLength(4);
  });
  it('does not allow writer or reviewer to self-assign a false aggregate passing score', async () => {
    const current = await draft();
    const model = new QueueModel([current, { pass: true, scores: { ...current.scores, hook: 0, value: 0, originality: 0, overall: 100 }, issues: [], unsupportedClaims: [] }]);
    await expect(new LiveContentEngine({ jsonModel: model, maxAttempts: 1 }).generate(ideas()[0]!, context())).rejects.toThrow('below threshold');
  });
});

describe('content memory similarity', () => {
  it('normalizes Turkish punctuation and rejects exact or close semantic lexical reuse', async () => {
    expect(fingerprint('Şirketiniz için otomasyon!')).toBe(fingerprint('Şirketiniz için otomasyon.'));
    expect(similarity('Şirketler manuel veri taşıyor', 'İşletmeler elle veri taşıyor')).toBeGreaterThan(0.9);
    const current = await draft(); const changed = structuredClone(current);
    changed.blocks[1]!.text += ' Küçük değişiklik.';
    expect(findDuplicate(changed, [version(current)])).not.toBeNull();
  });
  it('checks hook and CTA reuse separately from whole-text score', async () => {
    const previous = await draft(); const changed = structuredClone(previous);
    changed.topic = 'Başka konu'; changed.blocks = [previous.blocks[0]!, { id: 'body-1', kind: 'body', text: 'Farklı bir içerik, başka bir alan ve başka bir yöntemle tamamen değişiyor.' }];
    expect(findDuplicate(changed, [version(previous)], 1)?.reason).toBe('hook');
  });
});

describe('Responses provider adapter', () => {
  it('fails closed with no live key', () => { expect(() => new LiveContentEngine({ model: 'model' })).toThrow('LLM_API_KEY'); });
  it('sends strict structured outputs with storage disabled and handles refusal', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }), { status: 200 }));
    const model = new ResponsesModel({ apiKey: 'secret-test-only', model: 'configured-model', fetch: request });
    const { z: zod } = await import('zod');
    await expect(model.complete('test_result', zod.object({ text: zod.string() }).strict(), 'rules', { topic: 'test' })).rejects.toThrow('refused');
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as { store: boolean; text: { format: { strict: boolean; type: string } } };
    expect(body.store).toBe(false); expect(body.text.format).toMatchObject({ strict: true, type: 'json_schema' });
  });
});

describe('optional trend adapter', () => {
  it('collects official HN metadata as unverified and never fetches arbitrary article URLs', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('[17,18]'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 17, type: 'story', title: '<b>AI tools</b>', time: 1788750000, url: 'https://example.org/story' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 18, type: 'story', title: 'Deleted', time: 1788750000, deleted: true })));
    const collected = await new HackerNewsSource(request).collect(2);
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ title: 'AI tools', verified: false });
    expect(trendToSourceFact(collected[0]!)).toMatchObject({ verified: false, personal: false });
    expect(request.mock.calls.every(([url]) => String(url).startsWith('https://hacker-news.firebaseio.com/v0/'))).toBe(true);
  });
});
