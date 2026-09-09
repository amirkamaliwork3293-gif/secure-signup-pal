/**
 * ادغام امن دادهٔ محلی و ابر برای فاکتور.
 * هیچ ردیفی حذف نمی‌شود مگر شناسه‌اش عمداً tombstone شده باشد.
 * فاکتور ثبت‌شده هرگز نباید دوباره به‌صورت تبِ باز برگردد.
 */

export function rowId(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

function itemCount(row: unknown): number {
  if (!row || typeof row !== "object") return 0;
  const items = (row as { items?: unknown }).items;
  return Array.isArray(items) ? items.length : 0;
}

function rowTime(row: unknown): number {
  if (!row || typeof row !== "object") return 0;
  const n = Number((row as { createdAt?: unknown }).createdAt);
  return Number.isFinite(n) ? n : 0;
}

/** بین دو نسخهٔ یک شناسه، نسخهٔ کامل‌تر می‌ماند (اقلام بیشتر، بعد تاریخ). */
export function pickRicherRow(a: unknown, b: unknown): unknown {
  if (a == null) return b;
  if (b == null) return a;
  const ac = itemCount(a);
  const bc = itemCount(b);
  if (ac !== bc) return ac >= bc ? a : b;
  const at = rowTime(a);
  const bt = rowTime(b);
  if (at !== bt) return at >= bt ? a : b;
  return a;
}

export function historyIds(history: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(history)) return ids;
  for (const row of history) {
    const id = rowId(row);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * اتحاد شناسه‌به‌شناسه: هر فاکتوری که محلی یا ابر دارد می‌ماند.
 * ترتیب محلی حفظ می‌شود؛ فقط ردیف‌های ابریِ جدید به انتها اضافه می‌شوند.
 */
export function unionMergeById(
  local: unknown,
  cloud: unknown,
  tombstoned: ReadonlySet<string> = new Set(),
): unknown[] {
  const localArr = Array.isArray(local) ? local : [];
  const cloudArr = Array.isArray(cloud) ? cloud : [];
  const cloudById = new Map<string, unknown>();
  for (const row of cloudArr) {
    const id = rowId(row);
    if (id) cloudById.set(id, row);
  }
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const row of localArr) {
    const id = rowId(row);
    if (id && tombstoned.has(id)) continue;
    if (!id) {
      out.push(row);
      continue;
    }
    seen.add(id);
    out.push(pickRicherRow(row, cloudById.get(id) ?? null));
  }
  for (const row of cloudArr) {
    const id = rowId(row);
    if (!id || seen.has(id) || tombstoned.has(id)) continue;
    out.push(row);
  }
  return out;
}

export function extractOpenInvoices(board: unknown): unknown[] {
  if (!board || typeof board !== "object") return [];
  const rec = board as { open?: unknown; items?: unknown };
  if (Array.isArray(rec.open)) return rec.open;
  if (Array.isArray(rec.items)) return [board];
  return [];
}

export function extractActiveId(board: unknown): string {
  if (!board || typeof board !== "object") return "";
  const id = (board as { activeId?: unknown }).activeId;
  return typeof id === "string" ? id : "";
}

/**
 * تب‌های باز را ادغام می‌کند، ولی فاکتورهایی که در تاریخچه ثبت شده‌اند
 * (یا عمداً از تب باز برداشته شده‌اند) دوباره باز نمی‌شوند.
 */
export function mergeOpenInvoiceBoard(
  local: unknown,
  cloud: unknown,
  registeredIds: ReadonlySet<string>,
): { open: unknown[]; activeId: string } {
  const localOpen = extractOpenInvoices(local);
  const cloudOpen = extractOpenInvoices(cloud);
  const byId = new Map<string, unknown>();
  for (const row of cloudOpen) {
    const id = rowId(row);
    if (!id || registeredIds.has(id)) continue;
    byId.set(id, row);
  }
  for (const row of localOpen) {
    const id = rowId(row);
    if (!id || registeredIds.has(id)) continue;
    const prev = byId.get(id);
    byId.set(id, prev ? pickRicherRow(row, prev) : row);
  }
  const open = [...byId.values()];
  if (open.length === 0) return { open: [], activeId: "" };
  const localActive = extractActiveId(local);
  const activeId = open.some((row) => rowId(row) === localActive && localActive)
    ? localActive
    : rowId(open[0]);
  return { open, activeId };
}

export function arraysDiffer(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  } catch {
    return true;
  }
}
