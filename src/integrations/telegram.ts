import { z } from 'zod';
import type { TelegramButton, TelegramPort } from '../core/types.js';

const telegramId = z.number().int().safe();
const senderSchema = z.object({ id: telegramId, is_bot: z.boolean().optional() });
const chatSchema = z.object({ id: telegramId, type: z.enum(['private', 'group', 'supergroup', 'channel']) });
const messageSchema = z.object({
  message_id: telegramId,
  from: senderSchema.optional(),
  chat: chatSchema,
  text: z.string().max(16_384).optional(),
  reply_to_message: z.object({ message_id: telegramId }).optional(),
});

// Unknown update variants are acknowledged without giving them command privileges.
export const telegramUpdateSchema = z.object({
  update_id: telegramId.nonnegative(),
  message: messageSchema.optional(),
  callback_query: z.object({
    id: z.string().min(1).max(256),
    from: senderSchema,
    message: messageSchema.optional(),
    data: z.string().max(64).optional(),
  }).optional(),
});
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export class TelegramError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'TelegramError';
  }
}

export interface TelegramOptions { token: string; fetch?: typeof fetch; timeoutMs?: number }

/** Bot API errors intentionally omit raw responses/causes: the endpoint contains the bot token. */
export class TelegramBot implements TelegramPort {
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: TelegramOptions) {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(options.token)) throw new TelegramError('Telegram bot token formatı geçersiz.');
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async call(method: string, body: object, timeoutMs = this.#timeoutMs): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`https://api.telegram.org/bot${this.#token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
      });
    } catch {
      throw new TelegramError('Telegram bağlantısı tamamlanamadı; ağ ve bot yapılandırmasını kontrol edin.');
    }
    let json: unknown;
    try { json = await response.json(); } catch { throw new TelegramError('Telegram geçersiz yanıt döndürdü.', response.status); }
    const parsed = z.object({
      ok: z.boolean(), result: z.unknown().optional(), error_code: z.number().optional(),
      parameters: z.object({ retry_after: z.number().positive().optional() }).optional(),
    }).safeParse(json);
    if (!parsed.success) throw new TelegramError('Telegram yanıt biçimi geçersiz.', response.status);
    if (!response.ok || !parsed.data.ok) {
      const code = parsed.data.error_code ?? response.status;
      const detail = code === 401 ? 'Bot token geçersiz.' : code === 403 ? 'Bot engellenmiş veya sohbete erişemiyor.' : code === 429 ? 'İstek sınırına ulaşıldı.' : 'API isteği reddedildi.';
      throw new TelegramError(`Telegram (${code}): ${detail}`, code, parsed.data.parameters?.retry_after);
    }
    return parsed.data.result;
  }

  async send(chatId: string, text: string, buttons?: TelegramButton[][]): Promise<{ messageId: number }> {
    if (!/^-?\d+$/.test(chatId)) throw new TelegramError('Telegram chat ID geçersiz.');
    if (!text.length || text.length > 4096) throw new TelegramError('Telegram mesajı 1–4096 karakter olmalı.');
    if (buttons?.flat().some(button => !button.text || Buffer.byteLength(button.callback_data, 'utf8') > 64 || !button.callback_data)) {
      throw new TelegramError('Telegram buton verisi 1–64 byte olmalı.');
    }
    const result = await this.call('sendMessage', {
      chat_id: chatId, text, link_preview_options: { is_disabled: true },
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
    const parsed = z.object({ message_id: telegramId }).safeParse(result);
    if (!parsed.success) throw new TelegramError('Telegram mesaj kimliği dönmedi; gönderim sonucu belirsiz.');
    return { messageId: parsed.data.message_id };
  }

  async answerCallback(id: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text: text.slice(0, 200) } : {}) });
  }

  async getUpdates(offset?: number, timeoutSeconds = 25): Promise<TelegramUpdate[]> {
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 50) throw new TelegramError('Polling timeout 0–50 saniye olmalı.');
    const result = await this.call('getUpdates', {
      ...(offset === undefined ? {} : { offset }), timeout: timeoutSeconds, limit: 100,
      allowed_updates: ['message', 'callback_query'],
    }, Math.max(this.#timeoutMs, (timeoutSeconds + 5) * 1000));
    const parsed = z.array(telegramUpdateSchema).safeParse(result);
    if (!parsed.success) throw new TelegramError('Telegram update biçimi geçersiz.');
    return parsed.data;
  }

  async setWebhook(url: string, secret: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new TelegramError('Webhook URL geçerli bir HTTPS adresi olmalı.');
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw new TelegramError('Webhook secret 32–256 güvenli karakter olmalı.');
    await this.call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
  }

  async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook', { drop_pending_updates: false });
  }
}
