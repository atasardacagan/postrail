import { z } from 'zod';

export interface JsonModel {
  complete<T>(name: string, schema: z.ZodType<T>, instructions: string, data: unknown): Promise<T>;
}
export interface ResponsesOptions { apiKey: string; model: string; baseUrl?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }

export class ResponsesModel implements JsonModel {
  private readonly request: typeof globalThis.fetch;
  private readonly url: string;
  constructor(private readonly options: ResponsesOptions) {
    if (!options.apiKey?.trim()) throw new Error('LLM_API_KEY is required in live mode');
    if (!options.model?.trim()) throw new Error('LLM_MODEL is required in live mode');
    this.url = `${(options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/responses`;
    const url = new URL(this.url);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('LLM base URL must use HTTPS');
    this.request = options.fetch ?? globalThis.fetch;
  }

  async complete<T>(name: string, schema: z.ZodType<T>, instructions: string, data: unknown): Promise<T> {
    const jsonSchema = z.toJSONSchema(schema);
    delete jsonSchema.$schema;
    const response = await this.request(this.url, {
      method: 'POST', signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({ model: this.options.model, store: false, max_output_tokens: 9000,
        instructions,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(data) }] }],
        text: { format: { type: 'json_schema', name, strict: true, schema: jsonSchema } },
      }),
    });
    // Never put provider bodies or request headers in error messages: they may echo private prompts.
    if (!response.ok) throw new Error(`LLM API request failed (HTTP ${response.status}); check model access, quota and credentials`);
    const envelope = z.object({ status: z.string(), output: z.array(z.object({
      type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional(),
    }).passthrough()) }).passthrough().parse(await response.json());
    if (envelope.status !== 'completed') throw new Error(`LLM response did not complete (${envelope.status})`);
    const chunks = envelope.output.flatMap(item => item.type === 'message' ? item.content ?? [] : []);
    if (chunks.some(chunk => chunk.type === 'refusal')) throw new Error('LLM refused content generation');
    const text = chunks.filter(chunk => chunk.type === 'output_text').map(chunk => chunk.text ?? '').join('');
    if (!text) throw new Error('LLM returned no structured content');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error('LLM returned invalid structured JSON'); }
    return schema.parse(parsed);
  }
}
