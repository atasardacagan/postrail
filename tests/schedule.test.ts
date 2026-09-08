import { describe, expect, it } from 'vitest';
import { defaultSettings, loadEnv, settingsSchema } from '../src/core/config.js';
import { parsePostpone, slotsBetween, reportSlots } from '../src/core/schedule.js';

describe('Istanbul scheduling', () => {
  const settings = defaultSettings('123456');
  it('creates Tue Thu Sat 10:30 Istanbul = 07:30 UTC', () => {
    expect(slotsBetween(new Date('2026-09-07T00:00:00Z'), new Date('2026-09-14T00:00:00Z'), settings).map(x => x.toISOString())).toEqual([
      '2026-09-08T07:30:00.000Z', '2026-09-10T07:30:00.000Z', '2026-09-12T07:30:00.000Z',
    ]);
  });
  it('reports Sunday in local time', () => {
    expect(reportSlots(new Date('2026-09-07T00:00:00Z'), new Date('2026-09-14T00:00:00Z'), settings)[0]?.toISOString()).toBe('2026-09-13T15:00:00.000Z');
  });
  it.each([
    ['2 saat ertele', '2026-09-08T09:30:00.000Z'],
    ['yarına ertele', '2026-09-09T07:30:00.000Z'],
    ["akşam 7'ye al", '2026-09-08T16:00:00.000Z'],
    ['Cuma günü paylaş', '2026-09-11T07:30:00.000Z'],
  ])('parses %s', (text, result) => {
    expect(parsePostpone(text, new Date('2026-09-08T07:30:00Z'), settings.timezone)?.toISOString()).toBe(result);
  });
  it('rejects invalid or ambiguous times', () => {
    expect(parsePostpone('bir ara ertele', new Date(), settings.timezone)).toBeNull();
    expect(parsePostpone('akşam 27:00 al', new Date(), settings.timezone)).toBeNull();
    expect(parsePostpone('0 saat ertele', new Date(), settings.timezone)).toBeNull();
  });
  it('rejects settings that could create invalid slots', () => {
    expect(settingsSchema.safeParse({ ...settings, timezone: 'not/a/zone' }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...settings, postingTimes: ['25:00'] }).success).toBe(false);
  });
  it('never silently enables offline mode in production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', APP_MODE: 'offline', ADMIN_API_TOKEN: 'a'.repeat(40), TELEGRAM_ALLOWED_USER_ID: '1', TELEGRAM_WEBHOOK_SECRET: 'b'.repeat(40) })).toThrow(/Production/);
  });
});
