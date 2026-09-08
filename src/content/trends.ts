import { z } from 'zod';
import type { SourceFact } from '../core/types.js';

export interface TrendItem {
  id: string; provider: string; title: string; url: string; publishedAt: string; verified: false;
}
export interface TrendSource { collect(limit?: number): Promise<TrendItem[]> }

const storySchema = z.object({
  id: z.number().int().positive(), type: z.string(), title: z.string().max(2000).optional(), time: z.number().int().nonnegative().optional(),
  url: z.string().max(4000).optional(), deleted: z.boolean().optional(), dead: z.boolean().optional(),
}).passthrough().nullable();

/** Optional extension adapter; only requests the fixed official HN origin, never article URLs. */
export class HackerNewsSource implements TrendSource {
  constructor(private readonly request: typeof globalThis.fetch = globalThis.fetch) {}
  private async get(path: string): Promise<unknown> {
    const response = await this.request(`https://hacker-news.firebaseio.com/v0/${path}`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new Error(`Hacker News source unavailable (HTTP ${response.status})`);
    const body = await response.text();
    if (body.length > 256_000) throw new Error('Hacker News source response exceeded size limit');
    return JSON.parse(body) as unknown;
  }
  async collect(limit = 5): Promise<TrendItem[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Trend collection limit must be between 1 and 20');
    const ids = z.array(z.number().int().positive()).max(1000).parse(await this.get('beststories.json')).slice(0, limit);
    const results = await Promise.allSettled(ids.map(id => this.get(`item/${id}.json`)));
    const items: TrendItem[] = [];
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const parsed = storySchema.safeParse(result.value); if (!parsed.success) continue;
      const story = parsed.data;
      if (!story || story.type !== 'story' || story.deleted || story.dead || !story.title || !story.time) continue;
      let url = `https://news.ycombinator.com/item?id=${story.id}`;
      if (story.url) {
        try { const link = new URL(story.url); if (link.protocol === 'https:' && !link.username && !link.password) url = link.toString(); } catch { /* retain official discussion link */ }
      }
      const published = new Date(story.time * 1000);
      if (Number.isNaN(published.getTime())) continue;
      const title = story.title.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!title) continue;
      items.push({ id: `hn:${story.id}`, provider: 'hackernews', title, url, publishedAt: published.toISOString(), verified: false });
    }
    return items;
  }
}

/** Collected headlines are leads for research, never automatically verified facts. */
export function trendToSourceFact(item: TrendItem): SourceFact {
  return { id: item.id, url: item.url, text: item.title, verified: false, personal: false };
}
