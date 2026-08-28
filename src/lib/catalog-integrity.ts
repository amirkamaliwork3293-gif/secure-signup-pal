/**
 * تشخیص کاتالوگ خراب‌شده (فحاشی / متن چینی تصادفی) و تصمیم اینکه
 * نسخهٔ ابری باید روی نسخهٔ محلیِ «dirty» برنده شود.
 *
 * پس‌زمینه: همگام‌سازی قبلی فیلدهای dirty را از روی ابر بازنویسی نمی‌کرد
 * و همان دادهٔ خرابِ گوشی را دوباره روی user_data می‌فرستاد. اگر بک‌آپ ابری
 * سالم باشد و گوشی هنوز نسخهٔ هک‌شده را داشته باشد، باید ابر برنده شود.
 */

export const PROTECTED_CATALOG_FIELDS = [
  "products",
  "invoices",
  "categories",
  "customers",
  "purchases",
  "settings",
  "current_invoice",
] as const;

export type ProtectedCatalogField = (typeof PROTECTED_CATALOG_FIELDS)[number];

export function isProtectedCatalogField(field: string): field is ProtectedCatalogField {
  return (PROTECTED_CATALOG_FIELDS as readonly string[]).includes(field);
}

/** فحاشی رایج که در خرابکاری روی نام کالا/فاکتور دیده شده — نه برای سانسور ورودی عادی */
const INSULT_RE =
  /کیر|کص|کس\s*کش|جنده|گایید|گوه|حروم\s*زاده|لاشی|fuck|shit|bitch|\bdick\b/iu;

const CJK_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u;

export type VandalismReport = {
  blobs: number;
  insults: number;
  cjk: number;
  ratio: number;
  vandalized: boolean;
};

function pushStr(out: string[], v: unknown) {
  if (typeof v === "string") {
    const t = v.trim();
    if (t) out.push(t);
  }
}

function stringsFromUnknown(value: unknown, field: ProtectedCatalogField): string[] {
  const out: string[] = [];
  if (value == null) return out;

  if (field === "settings") {
    const s = value as { shopName?: unknown; storeDescription?: unknown };
    pushStr(out, s.shopName);
    pushStr(out, s.storeDescription);
    return out;
  }

  if (field === "current_invoice") {
    collectInvoiceStrings(value, out);
    return out;
  }

  if (!Array.isArray(value)) return out;

  if (field === "products") {
    for (const p of value) {
      const row = p as { name?: unknown; description?: unknown; category?: unknown };
      pushStr(out, row?.name);
      pushStr(out, row?.description);
      pushStr(out, row?.category);
    }
    return out;
  }

  if (field === "invoices") {
    for (const inv of value) collectInvoiceStrings(inv, out);
    return out;
  }

  if (field === "categories") {
    for (const c of value) pushStr(out, (c as { name?: unknown })?.name);
    return out;
  }

  if (field === "customers") {
    for (const c of value) {
      const row = c as { firstName?: unknown; lastName?: unknown; name?: unknown };
      pushStr(out, row?.firstName);
      pushStr(out, row?.lastName);
      pushStr(out, row?.name);
    }
    return out;
  }

  if (field === "purchases") {
    for (const p of value) {
      const row = p as {
        supplierName?: unknown;
        note?: unknown;
        items?: { name?: unknown }[];
      };
      pushStr(out, row?.supplierName);
      pushStr(out, row?.note);
      for (const item of row?.items ?? []) pushStr(out, item?.name);
    }
  }

  return out;
}

function collectInvoiceStrings(inv: unknown, out: string[]) {
  const row = inv as {
    notes?: unknown;
    shopName?: unknown;
    documentTitle?: unknown;
    customer?: { firstName?: unknown; lastName?: unknown };
    items?: { name?: unknown }[];
    customFields?: Record<string, unknown>;
  } | null;
  if (!row || typeof row !== "object") return;
  pushStr(out, row.notes);
  pushStr(out, row.shopName);
  pushStr(out, row.documentTitle);
  pushStr(out, row.customer?.firstName);
  pushStr(out, row.customer?.lastName);
  for (const item of row.items ?? []) pushStr(out, item?.name);
  if (row.customFields && typeof row.customFields === "object") {
    for (const v of Object.values(row.customFields)) pushStr(out, v);
  }
}

export function textLooksVandalized(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (INSULT_RE.test(t)) return true;
  const cjk = [...t].filter((ch) => CJK_RE.test(ch)).length;
  if (cjk >= 2) return true;
  return false;
}

export function inspectCatalog(value: unknown, field: ProtectedCatalogField): VandalismReport {
  const blobs = stringsFromUnknown(value, field);
  let insults = 0;
  let cjk = 0;
  for (const s of blobs) {
    if (INSULT_RE.test(s)) insults += 1;
    if ([...s].filter((ch) => CJK_RE.test(ch)).length >= 2) cjk += 1;
  }
  const bad = insults + cjk;
  const ratio = blobs.length === 0 ? 0 : bad / blobs.length;
  const vandalized =
    insults >= 1 ||
    (cjk >= 5 && ratio >= 0.12) ||
    (cjk >= 3 && blobs.length <= 20 && ratio >= 0.35);
  return { blobs: blobs.length, insults, cjk, ratio, vandalized };
}

export function catalogLooksVandalized(value: unknown, field: ProtectedCatalogField): boolean {
  return inspectCatalog(value, field).vandalized;
}

function arrayLen(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

/**
 * آیا نسخهٔ ابری باید جایگزین نسخهٔ محلیِ همگام‌نشده شود؟
 *
 * - محلی فحاشی/چینی، ابر سالم → ابر
 * - ابر فحاشی، محلی سالم → محلی (تا ذخیره شود و ابر را درست کند)
 * - هر دو سالم، ولی محلی خیلی کوچک‌تر از ابر → ابر (کش ناقص بعد از بازیابی)
 * - هر دو سالم و اندازه نزدیک → محلی (ویرایش آفلاین واقعی)
 */
export function preferCloudValue(
  local: unknown,
  cloud: unknown,
  field: ProtectedCatalogField,
): boolean {
  if (cloud == null) return false;

  const localReport = inspectCatalog(local, field);
  const cloudReport = inspectCatalog(cloud, field);

  if (localReport.vandalized && !cloudReport.vandalized) return true;
  if (!localReport.vandalized && cloudReport.vandalized) return false;

  if (localReport.vandalized && cloudReport.vandalized) {
    if (cloudReport.ratio + 0.08 < localReport.ratio) return true;
    const localN = arrayLen(local);
    const cloudN = arrayLen(cloud);
    if (localN != null && cloudN != null) {
      return cloudN > localN * 1.2 && cloudN >= localN + 8;
    }
    return false;
  }

  const localN = arrayLen(local);
  const cloudN = arrayLen(cloud);
  if (localN != null && cloudN != null) {
    if (cloudN >= 10 && localN === 0) return true;
    if (cloudN >= 20 && localN * 2 < cloudN) return true;
  }

  return false;
}
