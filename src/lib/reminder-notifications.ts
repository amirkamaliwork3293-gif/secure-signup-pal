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
  /** فقط APKهای جدید (ویجت صفحهٔ اصلی). APK قدیمی این متدها را ندارد. */
  syncWidget?: (json: string) => void;
  /** نسخهٔ ویجت APK؛ ۲ به بعد یادآوری‌های انجام‌شده را خط‌خورده نشان می‌دهد. */
  widgetVersion?: () => number;
  takeOpenRoute?: () => string;
  canPinWidget?: () => boolean;
  requestPinWidget?: () => boolean;
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
    if (bridge && typeof bridge.sync === "function") {
      const payload = enabled ? futureNotificationPayloads(reminders, now) : [];
      bridge.sync(JSON.stringify(payload));
    }
  } catch {
    /* native bridge must never break the web app */
  }
  // جدا از زنگ‌ها: ویجت صفحهٔ اصلی (فقط APK جدید). خطای آن روی زنگ‌ها اثری ندارد.
  syncReminderWidget(reminders, enabled, now);
}

// ─── ویجت «یادآوری‌های امروز» در صفحهٔ اصلی اندروید ─────────────────────────

export const REMINDER_WIDGET_PAYLOAD_VERSION = 1;
/** سقف آیتم‌های ارسالی به ویجت (ویجت حداکثر چند ردیف نشان می‌دهد و بقیه را «+N» می‌شمارد). */
export const MAX_WIDGET_ITEMS = 300;
/**
 * پنجرهٔ زمانی ارسال: از ۳۶ ساعت پیش (تا یادآوری‌های گذشتهٔ امروز در هر منطقهٔ زمانی بیایند)
 * تا ۸ روز بعد (تا ویجت بعد از نیمه‌شب بدون باز کردن برنامه هم فهرست روز جدید را داشته باشد).
 * انتخاب دقیق «امروز» به وقت تهران در خود ویجت انجام می‌شود.
 */
export const WIDGET_PAST_WINDOW_MS = 36 * 3_600_000;
export const WIDGET_FUTURE_WINDOW_MS = 8 * 86_400_000;
const MAX_WIDGET_TITLE = 120;
const MAX_WIDGET_CUSTOMER = 60;
/** تنها مسیری که ویجت اجازه دارد برنامه را رویش باز کند. */
export const REMINDER_WIDGET_ROUTE = "/reminders";

export type ReminderWidgetItem = {
  id: string;
  title: string;
  customer: string;
  at: number;
  /** انجام‌شده — ویجت با تیک سبز و خط روی متن نشانش می‌دهد (APK قدیمی این فیلد را نادیده می‌گیرد). */
  done: boolean;
};

export type ReminderWidgetPayload = {
  v: number;
  /** false یعنی کاربر وارد نشده یا بخش یادآوری خاموش است — ویجت چیزی نشان نمی‌دهد. */
  enabled: boolean;
  generatedAt: number;
  items: ReminderWidgetItem[];
};

function clip(text: unknown, max: number): string {
  const value = typeof text === "string" ? text.trim() : "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** داده‌ای که ویجت لازم دارد — فقط عنوان، نام مشتری و زمان (همان چیزی که نوتیف هم نشان می‌دهد). */
export function widgetPayload(
  reminders: Reminder[],
  enabled: boolean,
  now = Date.now(),
  includeDone = true,
): ReminderWidgetPayload {
  const from = now - WIDGET_PAST_WINDOW_MS;
  const to = now + WIDGET_FUTURE_WINDOW_MS;
  const items =
    enabled && Array.isArray(reminders)
      ? reminders
          .filter(
            (r) =>
              !!r &&
              (includeDone || !r.done) &&
              typeof r.id === "string" &&
              r.id.length > 0 &&
              typeof r.dueAt === "number" &&
              Number.isFinite(r.dueAt) &&
              r.dueAt >= from &&
              r.dueAt < to,
          )
          // انجام‌نشده‌ها اول تا اگر سقف پر شد، کارهای باز حذف نشوند.
          .sort((a, b) => Number(!!a.done) - Number(!!b.done) || a.dueAt - b.dueAt)
          .slice(0, MAX_WIDGET_ITEMS)
          .map((r) => ({
            id: r.id,
            title: clip(r.title, MAX_WIDGET_TITLE) || "یادآوری",
            customer: clip(r.customerName, MAX_WIDGET_CUSTOMER),
            at: r.dueAt,
            done: !!r.done,
          }))
      : [];
  return { v: REMINDER_WIDGET_PAYLOAD_VERSION, enabled, generatedAt: now, items };
}

/** No-op روی سایت و APK قدیمی. روی APK جدید دادهٔ ویجت را جداگانه می‌فرستد. */
export function syncReminderWidget(
  reminders: Reminder[],
  enabled: boolean,
  now = Date.now(),
): void {
  try {
    const bridge = nativeBridge();
    if (!bridge || typeof bridge.syncWidget !== "function") return;
    // APK ویجتِ نسخهٔ ۱ فیلد done را نمی‌شناسد؛ برای آن انجام‌شده‌ها را نمی‌فرستیم تا باز به نظر نرسند.
    let version = 1;
    try {
      if (typeof bridge.widgetVersion === "function") version = Number(bridge.widgetVersion()) || 1;
    } catch {
      version = 1;
    }
    bridge.syncWidget(JSON.stringify(widgetPayload(reminders, enabled, now, version >= 2)));
  } catch {
    /* native bridge must never break the web app */
  }
}

/** اگر کاربر روی ویجت زده باشد، یک‌بار «/reminders» برمی‌گرداند؛ وگرنه null. */
export function takeWidgetOpenRoute(): typeof REMINDER_WIDGET_ROUTE | null {
  try {
    const bridge = nativeBridge();
    if (!bridge || typeof bridge.takeOpenRoute !== "function") return null;
    return bridge.takeOpenRoute() === REMINDER_WIDGET_ROUTE ? REMINDER_WIDGET_ROUTE : null;
  } catch {
    return null;
  }
}

/** فقط APK جدید روی اندروید ۸+ با لانچری که «افزودن ویجت از داخل برنامه» را پشتیبانی کند. */
export function canRequestReminderWidget(): boolean {
  try {
    const bridge = nativeBridge();
    if (!bridge || typeof bridge.canPinWidget !== "function") return false;
    return bridge.canPinWidget() === true;
  } catch {
    return false;
  }
}

/** پنجرهٔ سیستمی «افزودن ویجت به صفحهٔ اصلی» را باز می‌کند. */
export function requestReminderWidget(): boolean {
  try {
    const bridge = nativeBridge();
    if (!bridge || typeof bridge.requestPinWidget !== "function") return false;
    return bridge.requestPinWidget() === true;
  } catch {
    return false;
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
