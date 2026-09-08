import type { Reminder } from "@/lib/store";

const MAX_NATIVE_ALARMS = 64;

export type ReminderNotificationPayload = {
  id: string;
  title: string;
  body: string;
  at: number;
};

type KamaliRemindersBridge = {
  sync?: (json: string) => void;
  takeCompleted?: () => string;
};

function nativeBridge(): KamaliRemindersBridge | undefined {
  try {
    const root = globalThis as typeof globalThis & {
      KamaliReminders?: KamaliRemindersBridge;
      window?: { KamaliReminders?: KamaliRemindersBridge };
    };
    return root.window?.KamaliReminders ?? root.KamaliReminders;
  } catch {
    return undefined;
  }
}

function formatDueClock(dueAt: number): string {
  try {
    return new Date(dueAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function sameClockMinute(a: number, b: number): boolean {
  return Math.floor(a / 60_000) === Math.floor(b / 60_000);
}

/**
 * فاصلهٔ حداقلی تا زنگ تا از فیلترهای زمان‌بندی (وب و APK) رد شود.
 * اگر کاربر همین ساعت و دقیقهٔ جاری را بگذارد، ثانیه‌ها معمولاً گذشته‌اند
 * و بدون این جلوکشیدن نوتیف/آهنگ زمان‌بندی نمی‌شود.
 */
export const REMINDER_NOTIFY_LEAD_MS = 6_000;

/** اگر سررسید همین دقیقه (یا چند ثانیهٔ بعد) باشد، کمی جلو می‌بریم تا زنگ زده شود. */
export function dueAtReadyToNotify(dueAt: number, now = Date.now()): number {
  if (!Number.isFinite(dueAt)) return dueAt;
  if (dueAt > now + REMINDER_NOTIFY_LEAD_MS) return dueAt;
  if (sameClockMinute(dueAt, now) || dueAt > now) return now + REMINDER_NOTIFY_LEAD_MS;
  return dueAt;
}

export function futureNotificationPayloads(
  reminders: Reminder[],
  now = Date.now(),
): ReminderNotificationPayload[] {
  return reminders
    .filter((reminder) => !reminder.done && reminder.dueAt > now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, MAX_NATIVE_ALARMS)
    .map((reminder) => {
      const clock = formatDueClock(reminder.dueAt);
      const who = (reminder.customerName ?? "").trim();
      const bodyParts = [
        clock ? `ساعت ${clock}` : "",
        who ? `برای ${who}` : "",
        (reminder.note ?? "").trim(),
      ].filter(Boolean);
      return {
        id: reminder.id,
        title: (reminder.title ?? "").trim() || "یادآوری",
        body: bodyParts.join(" — ") || "زمان این یادآوری رسیده است.",
        at: reminder.dueAt,
      };
    });
}

/** No-op on the website. On the Android APK, schedules OS banners for future reminders. */
export function syncReminderNotifications(
  reminders: Reminder[],
  enabled: boolean,
  now = Date.now(),
): void {
  try {
    const bridge = nativeBridge();
    if (!bridge || typeof bridge.sync !== "function") return;
    const payload = enabled ? futureNotificationPayloads(reminders, now) : [];
    bridge.sync(JSON.stringify(payload));
  } catch {
    /* native bridge must never break the web app */
  }
}

/** شناسه‌هایی که از دکمهٔ «انجام شد» روی نوتیف گوشی آمده‌اند. */
export function takeCompletedReminderIds(): string[] {
  try {
    const bridge = nativeBridge();
    if (!bridge || typeof bridge.takeCompleted !== "function") return [];
    const parsed: unknown = JSON.parse(bridge.takeCompleted() || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}
