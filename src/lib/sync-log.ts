/**
 * گزارش رویدادهای همگام‌سازی روی همین دستگاه (برای «وضعیت همگام‌سازی» در تنظیمات).
 *
 * فقط ثبت می‌کند و روی هیچ رفتاری اثر ندارد. حلقوی است (آخرین MAX رویداد) و هیچ
 * دادهٔ کسب‌وکار، توکن یا رمزی در آن نوشته نمی‌شود — فقط نام رویداد، تعداد و شناسه.
 */

export const SYNC_LOG_KEY = "kamix.synclog.v1";
const MAX = 250;

export type SyncLogEntry = { t: number; e: string; d?: string; n?: number };

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readSyncLog(): SyncLogEntry[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(SYNC_LOG_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as SyncLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function syncLog(event: string, detail?: unknown): void {
  const s = storage();
  if (!s) return;
  try {
    let d: string | undefined;
    if (detail !== undefined) {
      d = typeof detail === "string" ? detail : JSON.stringify(detail);
      if (d.length > 300) d = d.slice(0, 300) + "…";
    }
    const list = readSyncLog();
    const last = list[list.length - 1];
    if (last && last.e === event && last.d === d) {
      // تکرار پشت‌سرهم همان رویداد: فقط شمارش و زمان آخر
      last.n = (last.n || 1) + 1;
      last.t = Date.now();
    } else {
      list.push(d === undefined ? { t: Date.now(), e: event } : { t: Date.now(), e: event, d });
    }
    s.setItem(SYNC_LOG_KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* حافظه پر است — گزارش مهم نیست */
  }
}

export function clearSyncLog(): void {
  try {
    storage()?.removeItem(SYNC_LOG_KEY);
  } catch {
    /* noop */
  }
}

const FIELD_FA: Record<string, string> = {
  invoices: "فاکتورها",
  current_invoice: "فاکتور باز",
  products: "کالاها",
  categories: "دسته‌ها",
  customers: "مشتریان",
  students: "هنرجویان",
  purchases: "خریدها",
  expenses: "هزینه‌ها",
  reminders: "یادآورها",
  accounts: "حساب‌ها",
  account_txs: "تراکنش حساب‌ها",
  production: "تولید",
  manual_ledger: "دفتر دستی",
  settings: "تنظیمات",
};

export const AUTH_FA: Record<string, string> = {
  authenticated: "وارد شده",
  "offline-cached": "وارد شده (بدون اتصال به سرور)",
  unauthenticated: "خارج شده",
  loading: "در حال بررسی",
  expired: "اشتراک تمام شده",
  pending: "در انتظار تأیید",
  rejected: "رد شده",
};

const AUTH_EVENT_FA: Record<string, string> = {
  SIGNED_IN: "ورود به سرور انجام شد",
  SIGNED_OUT: "نشست سرور بسته شد",
  INITIAL_SESSION: "نشست ذخیره‌شده خوانده شد",
  USER_UPDATED: "اطلاعات حساب به‌روز شد",
  PASSWORD_RECOVERY: "بازیابی رمز",
};

const WAIT_FA: Record<string, string> = {
  "no-session": "منتظر ورود به سرور",
  offline: "اینترنت قطع است",
  "not-read-yet": "منتظر خواندن اطلاعات سرور",
  "scope-mismatch": "حساب حافظه با حساب سرور نمی‌خواند",
};

/** پیام‌های خطای رایج شبکه/سرور به فارسی */
function errFa(raw: string): string {
  if (!raw) return "خطای شبکه";
  if (/failed to fetch|network|load failed|fetch failed|aborted|timeout/i.test(raw)) {
    return "سرور در دسترس نبود";
  }
  if (/jwt|token|auth/i.test(raw)) return "نیاز به ورود دوباره";
  if (/quota|storage/i.test(raw)) return "حافظهٔ گوشی پر است";
  return raw;
}

const fa = (n: unknown) => (typeof n === "number" ? n.toLocaleString("fa-IR") : String(n ?? "-"));
const fields = (v: unknown) =>
  Array.isArray(v) ? v.map((f) => FIELD_FA[String(f)] || String(f)).join("، ") : "-";

/** یک رویداد به زبان فارسی و قابل‌فهم */
export { errFa as syncErrorFa };

export function describeSyncLogEntry(x: SyncLogEntry): string {
  let d: Record<string, unknown> = {};
  let raw = x.d ?? "";
  try {
    const parsed = x.d ? JSON.parse(x.d) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) d = parsed;
    else if (typeof parsed === "string") raw = parsed;
    else if (Array.isArray(parsed)) d = { list: parsed };
  } catch {
    /* متن ساده */
  }
  const inv = (d.invoices ?? {}) as Record<string, unknown>;
  switch (x.e) {
    case "net":
      return raw === "online"
        ? "اینترنت وصل شد"
        : raw === "offline"
          ? "اینترنت قطع شد"
          : `اتصال: ${raw}`;
    case "auth":
      return `وضعیت حساب: ${AUTH_FA[String(d.status)] || String(d.status)}`;
    case "auth-event":
      return AUTH_EVENT_FA[raw] || `رویداد ورود: ${raw}`;
    case "scope":
      return "حافظهٔ حساب روی گوشی عوض شد";
    case "pull-ok":
    case "refresh-ok":
      return (
        `${x.e === "pull-ok" ? "اطلاعات سرور خوانده و ادغام شد" : "اطلاعات تازهٔ سرور ادغام شد"} — ` +
        `فاکتورها: گوشی ${fa(inv.local)}، سرور ${fa(inv.cloud)}، بعد از ادغام ${fa(inv.after)}` +
        (Array.isArray(d.dirty) && d.dirty.length ? ` — منتظر ارسال: ${fields(d.dirty)}` : "")
      );
    case "pull-fail":
      return `خواندن اطلاعات سرور ناموفق بود (${errFa(raw)})`;
    case "pull-no-row":
      return "روی سرور هنوز اطلاعاتی برای این حساب نیست";
    case "push-ok":
      return (
        `ارسال به سرور موفق بود: ${fields(d.fields)}` +
        (typeof d.invoices === "number" ? ` (${fa(d.invoices)} فاکتور)` : "")
      );
    case "push-conflict":
      return `دستگاه دیگری هم‌زمان ذخیره کرد؛ ادغام و ارسال دوباره (${fields(d.list)})`;
    case "push-fail":
      return `ارسال به سرور ناموفق بود؛ دوباره تلاش می‌شود (${errFa(raw)})`;
    case "push-wait":
      return `ارسال منتظر ماند: ${WAIT_FA[raw] || raw}`;
    case "invoice-saved":
      return `فاکتور روی گوشی ثبت شد (کد ${String(d.id ?? "").slice(-6)}، جمعاً ${fa(d.total)} فاکتور)`;
    case "invoice-NOT-saved":
      return `⚠️ فاکتور روی گوشی ثبت نشد و باز ماند (کد ${String(d.id ?? "").slice(-6)})`;
    case "removed":
      return `حذف از ${FIELD_FA[String(d.field)] || String(d.field)}: ${fa(d.count)} مورد`;
    case "write-blocked":
      return `ثبت در ${FIELD_FA[String(d.key)] || "حافظه"} انجام نشد (اشتراک تمام شده)`;
    case "write-refused-scope":
      return "⚠️ ثبت رد شد: حافظهٔ گوشی مال حساب دیگری است";
    case "journal-restored":
      return `✓ ${fa(d.count)} فاکتور گم‌شده از نسخهٔ پشتیبان گوشی برگردانده شد`;
    case "journal-restore-failed":
      return `⚠️ برگرداندن ${fa(d.count)} فاکتور از نسخهٔ پشتیبان انجام نشد`;
    case "journal-error":
      return `خطای نسخهٔ پشتیبان گوشی (${errFa(raw)})`;
    default:
      return `${x.e}${x.d ? " " + x.d : ""}`;
  }
}

function formatTime(t: number): string {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(t));
  } catch {
    return new Date(t).toLocaleString();
  }
}

/** متن قابل کپی برای فرستادن به پشتیبانی (فارسی) */
export function formatSyncLog(list: SyncLogEntry[] = readSyncLog()): string {
  return list
    .map((x) => {
      const times = x.n ? ` (${fa(x.n)} بار)` : "";
      return `${formatTime(x.t)} — ${describeSyncLogEntry(x)}${times}`;
    })
    .join("\n");
}
