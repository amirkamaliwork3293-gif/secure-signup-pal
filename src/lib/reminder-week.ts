import { jalaliToTimestamp, toJalali, type Reminder } from "@/lib/store";

/** شنبه تا جمعه — هفته‌ی کاری ایرانی */
export const WEEKDAY_SAT_FIRST = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
] as const;

export const WEEKDAY_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"] as const;

export function jalaliDayKey(ts: number): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${j.jy}-${j.jm}-${j.jd}`;
}

export function startOfJalaliDay(ts: number): number {
  const j = toJalali(ts);
  if (!j) return ts;
  return jalaliToTimestamp(j.jy, j.jm, j.jd, 0, 0);
}

/** شروع شنبهٔ همان هفته به وقت تهران */
export function saturdayOfWeek(ts: number): number {
  const j = toJalali(ts);
  if (!j) return startOfJalaliDay(ts);
  const start = jalaliToTimestamp(j.jy, j.jm, j.jd, 0, 0);
  const fromSat = (j.dow + 1) % 7;
  return start - fromSat * 86_400_000;
}

export type WeekDay = {
  start: number;
  key: string;
  jy: number;
  jm: number;
  jd: number;
  dowSat: number;
  isToday: boolean;
};

export function weekDays(now = Date.now()): WeekDay[] {
  const sat = saturdayOfWeek(now);
  const todayKey = jalaliDayKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const start = startOfJalaliDay(sat + i * 86_400_000);
    const j = toJalali(start);
    const key = jalaliDayKey(start);
    return {
      start,
      key,
      jy: j?.jy ?? 0,
      jm: j?.jm ?? 1,
      jd: j?.jd ?? 1,
      dowSat: i,
      isToday: key === todayKey,
    };
  });
}

export function isInWeek(ts: number, weekStart: number): boolean {
  const day = startOfJalaliDay(ts);
  return day >= weekStart && day < weekStart + 7 * 86_400_000;
}

export function remindersOnDay(list: Reminder[], dayKey: string): Reminder[] {
  return list.filter((r) => jalaliDayKey(r.dueAt) === dayKey).sort((a, b) => a.dueAt - b.dueAt);
}

export function weekStats(list: Reminder[], weekStart: number, now = Date.now()) {
  const inWeek = list.filter((r) => isInWeek(r.dueAt, weekStart));
  const open = inWeek.filter((r) => !r.done);
  const done = inWeek.filter((r) => r.done);
  const todayKey = jalaliDayKey(now);
  const todayOpen = open.filter((r) => jalaliDayKey(r.dueAt) === todayKey).length;
  return {
    total: inWeek.length,
    open: open.length,
    done: done.length,
    todayOpen,
    progress: inWeek.length === 0 ? 0 : done.length / inWeek.length,
  };
}
