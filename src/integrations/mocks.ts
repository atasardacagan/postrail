import { createHash } from 'node:crypto';
import type { LinkedInPort, PublishResult, TelegramButton, TelegramPort } from '../core/types.js';

export interface RecordedTelegramMessage { messageId: number; chatId: string; text: string; buttons?: TelegramButton[][] }

/** Explicit offline/test adapter. It makes no network calls. */
export class MockTelegram implements TelegramPort {
  constructor(private readonly initialMessageId = 0) {}
  readonly messages: RecordedTelegramMessage[] = [];
  readonly answered: { id: string; text?: string }[] = [];
  async send(chatId: string, text: string, buttons?: TelegramButton[][]): Promise<{ messageId: number }> {
    const messageId = this.initialMessageId + this.messages.length + 1;
    this.messages.push({ messageId, chatId, text, ...(buttons ? { buttons: structuredClone(buttons) } : {}) });
    return { messageId };
  }
  async answerCallback(id: string, text?: string): Promise<void> { this.answered.push({ id, text }); }
}

/** Records every invocation; deliberately does NOT hide duplicate calls through mock idempotency. */
export class MockLinkedIn implements LinkedInPort {
  readonly published: { text: string; idempotencyKey: string; result: PublishResult }[] = [];
  async publish(text: string, idempotencyKey: string): Promise<PublishResult> {
    const id = createHash('sha256').update(`${idempotencyKey}:${this.published.length}`).digest('hex').slice(0, 12);
    const result = { urn: `mock:post:${id}`, url: `https://example.invalid/offline-post/${id}` };
    this.published.push({ text, idempotencyKey, result });
    return result;
  }
}
