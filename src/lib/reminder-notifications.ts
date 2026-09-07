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
};

function nativeBridge(): KamaliRemindersBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { KamaliReminders?: KamaliRemindersBridge }).KamaliReminders;
}

function formatDueClock(dueAt: number): string {
  try {
    return new Date(dueAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function futureNotificationPayloads(
  reminders: Reminder[],
  now = Date.now(),
): ReminderNotificationPayload[] {
  return reminders
    .filter((reminder) => !reminder.done && reminder.dueAt > now + 5_000)
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
