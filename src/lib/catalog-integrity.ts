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

function invoiceLineFingerprint(inv: unknown): string {
  const row = inv as {
    id?: unknown;
    items?: { productId?: unknown; price?: unknown; quantity?: unknown }[];
    total?: unknown;
  } | null;
  if (!row || typeof row !== "object") return "";
  const items = (row.items ?? [])
    .map(
      (it) =>
        `${String(it.productId ?? "")}:${Number(it.price) || 0}:${Number(it.quantity) || 0}`,
    )
    .join(",");
  return `${String(row.id ?? "")}|${Number(row.total) || 0}|${items}`;
}

/**
 * آیا قیمت/اقلام فاکتورهای محلی با نسخهٔ ابریِ همان شناسه‌ها فرق دارد؟
 * حمله قیمت‌ها را عوض کرد بدون اینکه لزوماً اسم چینی بگذارد؛ در آن حالت
 * تشخیص فحاشی کافی نیست و باید ابرِ بازیابی‌شده برنده شود.
 */
export function invoicePricesDiverge(local: unknown, cloud: unknown): boolean {
  if (!Array.isArray(local) || !Array.isArray(cloud)) {
    if (local && cloud && typeof local === "object" && typeof cloud === "object" && !Array.isArray(local)) {
      const localId = (local as { id?: unknown }).id;
      const cloudId = (cloud as { id?: unknown }).id;
      if (localId && localId === cloudId) {
        return invoiceLineFingerprint(local) !== invoiceLineFingerprint(cloud);
      }
    }
    return false;
  }
  if (cloud.length < 1 || local.length < 1) return false;

  const cloudById = new Map<string, unknown>();
  for (const inv of cloud) {
    const id = (inv as { id?: unknown })?.id;
    if (typeof id === "string" && id) cloudById.set(id, inv);
  }

  let compared = 0;
  let diverged = 0;
  for (const inv of local) {
    const id = (inv as { id?: unknown })?.id;
    if (typeof id !== "string" || !id) continue;
    const other = cloudById.get(id);
    if (!other) continue;
    compared += 1;
    if (invoiceLineFingerprint(inv) !== invoiceLineFingerprint(other)) diverged += 1;
  }

  if (compared >= 3 && diverged / compared >= 0.3) return true;

  // مجموعهٔ فاکتور کلاً عوض شده (شناسه‌های مشترک خیلی کم) — نسخهٔ ابریِ بازیابی
  const overlap = compared;
  const minN = Math.min(local.length, cloud.length);
  if (minN >= 8 && overlap <= minN * 0.2) return true;

  return false;
}

/**
 * ادغام فاکتور بدون حذف: همهٔ فاکتورهای محلی می‌مانند.
 * اگر همان شناسه در ابر قیمت متفاوت داشته باشد، قیمت ابر روی همان فاکتور می‌نشیند.
 * فاکتورهایی که فقط در ابر هستند اضافه می‌شوند. هیچ شناسه‌ای از محلی پاک نمی‌شود.
 */
export function mergeInvoicesKeepAll(local: unknown, cloud: unknown): unknown[] {
  const localArr = Array.isArray(local) ? local : [];
  const cloudArr = Array.isArray(cloud) ? cloud : [];
  const cloudById = new Map<string, unknown>();
  for (const inv of cloudArr) {
    const id = (inv as { id?: unknown })?.id;
    if (typeof id === "string" && id) cloudById.set(id, inv);
  }
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const inv of localArr) {
    const id = (inv as { id?: unknown })?.id;
    if (typeof id === "string" && id) seen.add(id);
    const cloudInv = typeof id === "string" && id ? cloudById.get(id) : undefined;
    if (cloudInv && invoiceLineFingerprint(inv) !== invoiceLineFingerprint(cloudInv)) {
      out.push(cloudInv);
    } else {
      out.push(inv);
    }
  }
  for (const inv of cloudArr) {
    const id = (inv as { id?: unknown })?.id;
    if (typeof id === "string" && id && !seen.has(id)) out.push(inv);
  }
  return out;
}

const VANDAL_PRICE = 9999;
const PRODUCT_PRICE_KEYS = ["price", "buyPrice", "consumerPrice", "sellerPrice", "wholesalePrice"] as const;
const LINE_PRICE_KEYS = ["price", "buyPrice", "originalPrice"] as const;

function isVandalPrice(value: unknown): boolean {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && Math.round(n) === VANDAL_PRICE;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function restorePriceKeys(
  live: Record<string, unknown>,
  backup: Record<string, unknown> | null,
  keys: readonly string[],
): Record<string, unknown> {
  if (!backup) return live;
  const next = { ...live };
  let changed = false;
  for (const key of keys) {
    if (isVandalPrice(live[key]) && backup[key] != null && !isVandalPrice(backup[key])) {
      next[key] = backup[key];
      changed = true;
    }
  }
  return changed ? next : live;
}

export type CatalogMergeOpts = {
  /**
   * اگر true باشد، ردیف‌هایی که فقط در ابر هستند اضافه می‌شوند.
   * برای همگام‌سازی روزمره باید false بماند وگرنه حذف فاکتور/کالا از گوشی
   * با نسخهٔ قدیمی ابر برمی‌گردد.
   */
  adoptCloudOnly?: boolean;
};

function appendCloudOnly(
  out: unknown[],
  seen: Set<string>,
  cloudArr: unknown[],
  adopt: boolean,
) {
  if (!adopt) return;
  for (const row of cloudArr) {
    const rec = asRecord(row);
    const id = rec && typeof rec.id === "string" ? rec.id : "";
    if (id && !seen.has(id)) out.push(row);
  }
}

export function catalogHasVandalPrice(value: unknown, field: "products" | "invoices"): boolean {
  if (!Array.isArray(value)) return false;
  if (field === "products") {
    for (const row of value) {
      const rec = asRecord(row);
      if (!rec) continue;
      for (const key of PRODUCT_PRICE_KEYS) {
        if (isVandalPrice(rec[key])) return true;
      }
    }
    return false;
  }
  for (const inv of value) {
    const rec = asRecord(inv);
    const items = rec && Array.isArray(rec.items) ? rec.items : [];
    for (const it of items) {
      const item = asRecord(it);
      if (!item) continue;
      for (const key of LINE_PRICE_KEYS) {
        if (isVandalPrice(item[key])) return true;
      }
    }
  }
  return false;
}

/**
 * قیمت ۹۹۹۹ جعلی هکر را از روی ابر درست می‌کند؛ هیچ کالایی از محلی حذف نمی‌شود.
 * ردیف حذف‌شدهٔ محلی به‌صورت پیش‌فرض از ابر برنمی‌گردد.
 */
export function mergeProductPricesFromCloud(
  local: unknown,
  cloud: unknown,
  opts?: CatalogMergeOpts,
): unknown[] {
  const localArr = Array.isArray(local) ? local : [];
  const cloudArr = Array.isArray(cloud) ? cloud : [];
  const cloudById = new Map<string, Record<string, unknown>>();
  for (const row of cloudArr) {
    const rec = asRecord(row);
    const id = rec && typeof rec.id === "string" ? rec.id : "";
    if (rec && id) cloudById.set(id, rec);
  }
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const row of localArr) {
    const rec = asRecord(row);
    if (!rec) {
      out.push(row);
      continue;
    }
    const id = typeof rec.id === "string" ? rec.id : "";
    if (id) seen.add(id);
    out.push(restorePriceKeys(rec, id ? cloudById.get(id) ?? null : null, PRODUCT_PRICE_KEYS));
  }
  appendCloudOnly(out, seen, cloudArr, !!opts?.adoptCloudOnly);
  return out;
}

function restoreInvoiceItems(inv: Record<string, unknown>, backupInv: Record<string, unknown> | null, productsById: Map<string, Record<string, unknown>>): Record<string, unknown> {
  const items = Array.isArray(inv.items) ? inv.items : [];
  const backupItems = backupInv && Array.isArray(backupInv.items) ? backupInv.items : [];
  const backupByProduct = new Map<string, Record<string, unknown>>();
  for (const it of backupItems) {
    const rec = asRecord(it);
    const pid = rec && typeof rec.productId === "string" ? rec.productId : "";
    if (rec && pid && !backupByProduct.has(pid)) backupByProduct.set(pid, rec);
  }
  const nextItems = items.map((it) => {
    const rec = asRecord(it);
    if (!rec) return it;
    const pid = typeof rec.productId === "string" ? rec.productId : "";
    const fromBackupItem = pid ? backupByProduct.get(pid) ?? null : null;
    const fromProduct = pid ? productsById.get(pid) ?? null : null;
    let fixed = restorePriceKeys(rec, fromBackupItem, LINE_PRICE_KEYS);
    if (isVandalPrice(fixed.price)) {
      fixed = restorePriceKeys(fixed, fromProduct, ["price", "buyPrice"]);
    }
    return fixed;
  });
  return { ...inv, items: nextItems };
}

/** فاکتورهای محلی می‌مانند؛ فقط ردیف‌هایی که قیمت ۹۹۹۹ دارند از ابر/کالا درست می‌شوند. */
export function mergeInvoicePricesFromCloud(
  local: unknown,
  cloud: unknown,
  cloudProducts?: unknown,
  opts?: CatalogMergeOpts,
): unknown[] {
  const localArr = Array.isArray(local) ? local : [];
  const cloudArr = Array.isArray(cloud) ? cloud : [];
  const productsById = new Map<string, Record<string, unknown>>();
  if (Array.isArray(cloudProducts)) {
    for (const row of cloudProducts) {
      const rec = asRecord(row);
      const id = rec && typeof rec.id === "string" ? rec.id : "";
      if (rec && id) productsById.set(id, rec);
    }
  }
  const cloudById = new Map<string, Record<string, unknown>>();
  for (const row of cloudArr) {
    const rec = asRecord(row);
    const id = rec && typeof rec.id === "string" ? rec.id : "";
    if (rec && id) cloudById.set(id, rec);
  }
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const row of localArr) {
    const rec = asRecord(row);
    if (!rec) {
      out.push(row);
      continue;
    }
    const id = typeof rec.id === "string" ? rec.id : "";
    if (id) seen.add(id);
    out.push(restoreInvoiceItems(rec, id ? cloudById.get(id) ?? null : null, productsById));
  }
  appendCloudOnly(out, seen, cloudArr, !!opts?.adoptCloudOnly);
  return out;
}

export function catalogLooksVandalized(value: unknown, field: ProtectedCatalogField): boolean {
  return inspectCatalog(value, field).vandalized;
}

/**
 * آیا نسخهٔ ابری باید جایگزین نسخهٔ محلیِ همگام‌نشده شود؟
 *
 * - محلی فحاشی/چینی، ابر سالم → ابر
 * - ابر فحاشی، محلی سالم → محلی (تا ذخیره شود و ابر را درست کند)
 * - فاکتور باز با کالا → هرگز با ابر خالی نشود
 * - هر دو سالم → محلی (حذف و ویرایش واقعی کاربر)
 */
export function preferCloudValue(
  local: unknown,
  cloud: unknown,
  field: ProtectedCatalogField,
): boolean {
  if (cloud == null) return false;

  if (field === "current_invoice") {
    const items = (local as { items?: unknown[] } | null)?.items;
    if (Array.isArray(items) && items.length > 0) return false;
  }

  const localReport = inspectCatalog(local, field);
  const cloudReport = inspectCatalog(cloud, field);

  if (localReport.vandalized && !cloudReport.vandalized) return true;
  if (!localReport.vandalized && cloudReport.vandalized) return false;

  if (localReport.vandalized && cloudReport.vandalized) {
    if (cloudReport.ratio + 0.08 < localReport.ratio) return true;
    return false;
  }

  return false;
}
