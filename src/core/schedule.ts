import { DateTime } from 'luxon';
import type { Settings } from './types.js';

export function slotsBetween(from: Date, to: Date, settings: Settings): Date[] {
  const start = DateTime.fromJSDate(from, { zone: settings.timezone });
  const end = DateTime.fromJSDate(to, { zone: settings.timezone });
  if (!start.isValid || !end.isValid || end < start) throw new Error('Geçersiz takvim aralığı');
  const slots: Date[] = [];
  for (let day = start.startOf('day'); day <= end; day = day.plus({ days: 1 })) {
    if (!settings.postingDays.includes(day.weekday)) continue;
    for (const time of settings.postingTimes) {
      const [hour, minute] = time.split(':').map(Number);
      const local = day.set({ hour, minute, second: 0, millisecond: 0 });
      // Skip nonexistent DST wall times instead of silently moving the slot.
      if (local.toFormat('HH:mm') !== time) continue;
      if (local >= start && local <= end) slots.push(local.toJSDate());
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime());
}
export function reportSlots(from: Date, to: Date, settings: Settings): Date[] {
  return slotsBetween(from, to, { ...settings, postingDays: [settings.weeklyReportDay], postingTimes: [settings.weeklyReportTime] });
}
export function formatTime(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).setLocale('tr').toFormat('dd LLLL yyyy cccc HH:mm');
}
const weekdays: Record<string, number> = { pazartesi: 1, salı: 2, çarşamba: 3, perşembe: 4, cuma: 5, cumartesi: 6, pazar: 7 };
export function looksLikePostpone(text: string): boolean {
  return /ertele|yarın|akşam|\d+[.:]\d+.*al|(?:pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)\s+(?:günü\s+)?(?:paylaş|al|yayınla)/i.test(text.toLocaleLowerCase('tr'));
}
export function parsePostpone(text: string, now: Date, timezone: string, defaultTime = '10:30'): Date | null {
  const s = text.toLocaleLowerCase('tr').trim().replace(/[’‘]/g, "'");
  const local = DateTime.fromJSDate(now, { zone: timezone });
  const duration = s.match(/^(\d{1,3})\s*(saat|dakika|gün)\s*ertele[.!]?$/);
  if (duration) {
    const amount = Number(duration[1]);
    if (amount < 1 || amount > 168) return null;
    const unit = duration[2] === 'saat' ? 'hours' : duration[2] === 'gün' ? 'days' : 'minutes';
    return local.plus({ [unit]: amount }).toJSDate();
  }
  if (!looksLikePostpone(s)) return null;
  const [defaultHour, defaultMinute] = defaultTime.split(':').map(Number);
  let hour = defaultHour ?? 10; let minute = defaultMinute ?? 30;
  const explicitTime = s.match(/(?:saat\s*|akşam\s*|sabah\s*)?(\d{1,2})(?:[:.](\d{2}))?(?:'?(?:ye|ya|e|a))?\s*(?:al|ertele|paylaş|yayınla|olsun)?[.!]?$/);
  if (explicitTime) {
    hour = Number(explicitTime[1]); minute = Number(explicitTime[2] ?? 0);
    if (s.includes('akşam') && hour < 12) hour += 12;
  }
  if (hour > 23 || minute > 59) return null;
  let target = local.set({ hour, minute, second: 0, millisecond: 0 });
  if (s.includes('yarın')) target = target.plus({ days: 1 });
  else {
    const weekday = Object.entries(weekdays).find(([name]) => new RegExp(`(^|\\s)${name}(\\s|$)`).test(s));
    if (weekday) {
      const delta = (weekday[1] - local.weekday + 7) % 7;
      target = target.plus({ days: delta || (target <= local ? 7 : 0) });
    } else if (explicitTime) {
      if (target <= local) target = target.plus({ days: 1 });
    } else return null;
  }
  if (!target.isValid || target <= local || target > local.plus({ days: 180 })) return null;
  return target.toJSDate();
}
