/**
 * فیلدهای اختصاصی مشتری (کد ملی، نام شرکت، نشانی، کد اقتصادی، هر چیز دلخواه).
 *
 * - هر مشتری فیلدهای خودش را درون همان ردیف مشتری نگه می‌دارد ({id, label, value, pinned}).
 *   فهرست سراسریِ تعریف فیلد نداریم تا ویرایش هم‌زمان دو دستگاه چیزی را پاک نکند؛
 *   برچسب‌های پیشنهادی از پیش‌فرض‌ها و برچسب‌های قبلاً استفاده‌شده ساخته می‌شوند.
 * - «سنجاق‌شده» (pinned) یعنی روی هر فاکتور جدید این مشتری خودکار می‌آید.
 * - روی فاکتور ثبت‌شده یک «عکس» از مقدارها (customerFields) ذخیره می‌شود؛ ویرایش
 *   بعدی مشتری فاکتورهای صادرشده را عوض نمی‌کند.
 */
import type { Customer } from "./store";

export type CustomerField = {
  id: string;
  label: string;
  value: string;
  /** روی فاکتورهای جدید این مشتری خودکار پر شود */
  pinned?: boolean;
};

/** مقدار چاپ‌شده روی یک فاکتور (عکس لحظهٔ صدور) */
export type InvoicePartyField = { label: string; value: string };

export const PRESET_FIELD_LABELS = [
  "کد ملی",
  "نام شرکت",
  "شناسه ملی",
  "کد اقتصادی",
  "شماره ثبت",
  "نشانی",
  "کد پستی",
  "تلفن ثابت",
  "ایمیل",
] as const;

export function normalizeFieldLabel(s: string | undefined): string {
  return (s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/‌/g, "")
    .toLowerCase();
}

export function fieldId(): string {
  return "f" + Math.random().toString(36).slice(2, 9);
}

/** فیلدهای معتبر یک مشتری (داده‌ی قدیمی/دست‌خورده را نادیده می‌گیرد) */
export function customerFields(c: Pick<Customer, "fields"> | null | undefined): CustomerField[] {
  const list = c?.fields;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (f): f is CustomerField =>
      !!f && typeof f === "object" && typeof f.label === "string" && typeof f.value === "string",
  );
}

/** برچسب‌های پیشنهادی: پیش‌فرض‌ها + هر برچسبی که در مشتریان دیگر استفاده شده */
export function fieldLabelSuggestions(list: readonly Customer[]): string[] {
  const seen = new Map<string, string>();
  for (const l of PRESET_FIELD_LABELS) seen.set(normalizeFieldLabel(l), l);
  for (const c of list) {
    for (const f of customerFields(c)) {
      const k = normalizeFieldLabel(f.label);
      if (k && !seen.has(k)) seen.set(k, f.label.trim());
    }
  }
  return [...seen.values()];
}

/** فیلدهای سنجاق‌شده‌ی پرشده — پیش‌فرضِ «اطلاعات مشتری روی فاکتور» */
export function pinnedInvoiceFields(
  c: Pick<Customer, "fields"> | null | undefined,
): InvoicePartyField[] {
  return customerFields(c)
    .filter((f) => f.pinned && f.value.trim() && f.label.trim())
    .map((f) => ({ label: f.label.trim(), value: f.value.trim() }));
}

/** پاک‌سازی قبل از ذخیره روی فاکتور: بدون خالی و بدون برچسب تکراری */
export function cleanInvoiceFields(
  list: readonly InvoicePartyField[] | undefined,
): InvoicePartyField[] | undefined {
  if (!list?.length) return undefined;
  const seen = new Set<string>();
  const out: InvoicePartyField[] = [];
  for (const f of list) {
    const label = (f?.label || "").trim();
    const value = (f?.value || "").trim();
    const k = normalizeFieldLabel(label);
    if (!label || !value || seen.has(k)) continue;
    seen.add(k);
    out.push({ label, value });
  }
  return out.length ? out : undefined;
}

/**
 * طراح فاکتور: خانه‌هایی که «هنگام ثبت پرسیده می‌شوند» و برچسبشان با فیلد مشتری
 * یکی است (مثلاً «کد ملی») از همان مقدار پر می‌شوند — مگر کاربر خودش چیزی نوشته باشد.
 */
export function prefillTemplateFields(
  checkout: readonly { id: string; label: string }[],
  fields: readonly InvoicePartyField[],
  current: Record<string, string>,
): Record<string, string> {
  if (!checkout.length || !fields.length) return current;
  const byLabel = new Map(fields.map((f) => [normalizeFieldLabel(f.label), f.value]));
  let changed = false;
  const next = { ...current };
  for (const cf of checkout) {
    if ((next[cf.id] || "").trim()) continue;
    const v = byLabel.get(normalizeFieldLabel(cf.label));
    if (v) {
      next[cf.id] = v;
      changed = true;
    }
  }
  return changed ? next : current;
}
