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

/** متن قابل کپی برای فرستادن به پشتیبانی */
export function formatSyncLog(list: SyncLogEntry[] = readSyncLog()): string {
  return list
    .map((x) => {
      const time = new Date(x.t).toISOString().replace("T", " ").slice(5, 19);
      return `${time} ${x.e}${x.d ? " " + x.d : ""}${x.n ? ` ×${x.n}` : ""}`;
    })
    .join("\n");
}
