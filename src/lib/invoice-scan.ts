/**
 * اسکن فاکتور خرید با دوربین — منطق خالص (بدون store، بدون شبکه) تا تست‌پذیر باشد.
 *
 * جریان کار:
 *   عکس فاکتور → سرور (مدل هوش مصنوعی) → `RawScanResult`
 *   → `sanitizeScanResult` (تمیز کردن اعداد/متن، حذف ردیف‌های جمع و مالیات)
 *   → `buildReviewRows` (تطبیق با انبار، تبدیل ریال/تومان، هشدارها)
 *   → کاربر در صفحهٔ بازبینی ویرایش و تایید می‌کند
 *   → `reviewRowsToPurchaseItems` → همان پیش‌نویس فاکتور خرید همیشگی.
 *
 * این فایل هیچ داده‌ای ذخیره نمی‌کند؛ ثبت نهایی فقط با دکمهٔ «ثبت فاکتور خرید»
 * و از مسیر امتحان‌شدهٔ `purchases.archive` انجام می‌شود.
 */
import type { Product, PurchaseItem, UnitDef } from "./store";
import { findProductByCode } from "./barcode-match.ts";
import { filterAndRankSearch, normalizeSearchText } from "./search.ts";
import { convertUnitPrice, roundQty, unitsConvertible } from "./units.ts";

const COUNT_UNIT = "عدد";

// ─── خروجی خام مدل ─────────────────────────────────────────────────────────

export type ScanCurrency = "rial" | "toman" | "unknown";
export type ScanConfidence = "high" | "medium" | "low";

export type ScannedLine = {
  name: string;
  code?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  lineTotal?: number;
  confidence: ScanConfidence;
};

export type RawScanResult = {
  supplierName?: string;
  supplierPhone?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  currency: ScanCurrency;
  items: ScannedLine[];
  discount?: number;
  total?: number;
  notes?: string;
};

export const MAX_SCAN_LINES = 150;
const MAX_QTY = 1_000_000;
const MAX_PRICE = 1e13;

/** ارقام فارسی/عربی → لاتین */
function latinDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * عدد از خروجی مدل (ممکن است رشته با ارقام فارسی و جداکنندهٔ هزارگان باشد).
 * «۱۲٬۵۰۰»، «12,500»، «۲٫۵»، «2/5» (اعشار فارسی) همه درست خوانده می‌شوند.
 */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let s = latinDigits(v).trim();
  if (!s) return undefined;
  s = s.replace(/[٬،,\s‌]/g, "").replace(/[٫/]/g, ".");
  s = s.replace(/[^\d.-]/g, "");
  if (!s || (s.match(/\./g) || []).length > 1) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  // کاراکترهای کنترلی حذف، فاصله‌ها یکی
  let printable = "";
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    printable += c < 32 || c === 127 ? " " : ch;
  }
  const s = printable.replace(/\s+/g, " ").trim().slice(0, max);
  return s || undefined;
}

function cleanCode(v: unknown): string | undefined {
  const raw = typeof v === "number" ? String(v) : v;
  const s = cleanText(raw, 40);
  if (!s) return undefined;
  const c = latinDigits(s).replace(/\s+/g, "");
  return c.length >= 2 ? c : undefined;
}

function positive(n: number | undefined, max: number): number | undefined {
  if (n == null || !Number.isFinite(n) || n <= 0 || n > max) return undefined;
  return n;
}

/** ردیف‌هایی که کالا نیستند (جمع، تخفیف، مالیات، کرایه...) */
const SUMMARY_ROW =
  /^(جمع|مجموع|مبلغ کل|تخفیف|مالیات|عوارض|ارزش افزوده|قابل پرداخت|مبلغ قابل پرداخت|باقیمانده|پرداختی|total|subtotal|tax|vat|discount)(\s|:|$)/i;

/** خروجی خام مدل را به ساختاری امن و یکدست تبدیل می‌کند؛ هرگز خطا پرتاب نمی‌کند. */
export function sanitizeScanResult(input: unknown): RawScanResult {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const cur = String(o.currency ?? "").toLowerCase();
  const currency: ScanCurrency =
    cur === "rial" || cur.includes("ریال")
      ? "rial"
      : cur === "toman" || cur.includes("تومان")
        ? "toman"
        : "unknown";

  const itemsIn = Array.isArray(o.items) ? o.items.slice(0, MAX_SCAN_LINES) : [];
  const items: ScannedLine[] = [];
  for (const it of itemsIn) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const name = cleanText(r.name, 120);
    if (!name || SUMMARY_ROW.test(name)) continue;
    const conf = String(r.confidence ?? "").toLowerCase();
    items.push({
      name,
      code: cleanCode(r.code),
      quantity: positive(toNumber(r.quantity), MAX_QTY),
      unit: cleanText(r.unit, 30),
      unitPrice: positive(toNumber(r.unitPrice), MAX_PRICE),
      lineTotal: positive(toNumber(r.lineTotal), MAX_PRICE),
      confidence: conf === "high" || conf === "low" ? conf : "medium",
    });
  }

  return {
    supplierName: cleanText(o.supplierName, 80),
    supplierPhone: cleanText(
      typeof o.supplierPhone === "string" ? latinDigits(o.supplierPhone) : undefined,
      30,
    ),
    invoiceNumber: cleanText(
      typeof o.invoiceNumber === "number" ? String(o.invoiceNumber) : o.invoiceNumber,
      40,
    ),
    invoiceDate: cleanText(o.invoiceDate, 30),
    currency,
    items,
    discount: positive(toNumber(o.discount), MAX_PRICE),
    total: positive(toNumber(o.total), MAX_PRICE),
    notes: cleanText(o.notes, 300),
  };
}

// ─── واحد ───────────────────────────────────────────────────────────────────

/** واحد نوشته‌شده روی فاکتور → یکی از واحدهای تعریف‌شده در برنامه */
export function mapScanUnit(raw: string | undefined, unitDefs: Pick<UnitDef, "name">[]): string {
  const u = normalizeSearchText(raw);
  if (!u) return COUNT_UNIT;
  const exact = unitDefs.find((d) => normalizeSearchText(d.name) === u);
  if (exact) return exact.name;
  const has = (name: string) => unitDefs.some((d) => d.name === name);
  if (/^(kg|کیلو|کیلوگرم|كيلو|کیلو گرم|ک گ)/.test(u) && has("کیلوگرم")) return "کیلوگرم";
  if (/^(g|gr|گرم|گ)$/.test(u) && has("گرم")) return "گرم";
  return COUNT_UNIT;
}

// ─── ردیف‌های صفحهٔ بازبینی ─────────────────────────────────────────────────

export type ReviewRow = {
  key: string;
  include: boolean;
  name: string;
  code: string;
  quantity: number;
  unit: string;
  /** قیمت خرید هر واحد (به تومان، به واحد همین ردیف) */
  buyPrice: number;
  /** قیمت فروش هر واحد (به تومان، به واحد همین ردیف) */
  sellPrice: number;
  /** کاربر قیمت فروش را دستی تغییر داده؟ (تا «درصد سود» رویش ننویسد) */
  sellEdited: boolean;
  /** کالای موجود در انبار که این ردیف به آن وصل است؛ خالی = کالای جدید */
  productId: string;
  /** پیشنهاد کالای مشابه (فقط پیشنهاد — خودکار وصل نمی‌شود) */
  suggestionId?: string;
  matchedBy?: "code" | "name";
  confidence: ScanConfidence;
  warnings: string[];
};

/** قیمت فروش پیشنهادی با گرد کردن به عدد «بازاری» */
export function suggestSellPrice(buyPrice: number, marginPercent: number): number {
  if (!(buyPrice > 0)) return 0;
  const m = Math.max(0, Math.min(1000, Number(marginPercent) || 0));
  const raw = buyPrice * (1 + m / 100);
  const step =
    raw >= 1_000_000
      ? 10_000
      : raw >= 100_000
        ? 1_000
        : raw >= 10_000
          ? 500
          : raw >= 1_000
            ? 100
            : 1;
  return Math.ceil(raw / step) * step;
}

function sameNormalizedName(a: string, b: string): boolean {
  const x = normalizeSearchText(a);
  return !!x && x === normalizeSearchText(b);
}

/** تبدیل مبلغ فاکتور به تومان (مبالغ برنامه همیشه تومان است) */
export function toToman(amount: number, currency: ScanCurrency): number {
  if (!(amount > 0)) return 0;
  const v = currency === "rial" ? amount / 10 : amount;
  return Math.round(v * 100) / 100;
}

let keySeq = 0;
function rowKey(): string {
  keySeq = (keySeq + 1) % 1e9;
  return `scan-${Date.now().toString(36)}-${keySeq}`;
}

export type BuildRowsOptions = {
  products: Product[];
  unitDefs: Pick<UnitDef, "name">[];
  currency: ScanCurrency;
  marginPercent: number;
};

/** ساخت ردیف‌های قابل ویرایش از نتیجهٔ اسکن */
export function buildReviewRows(scan: RawScanResult, opts: BuildRowsOptions): ReviewRow[] {
  const { products, unitDefs, marginPercent } = opts;
  const currency = opts.currency === "rial" ? "rial" : "toman";
  const rows: ReviewRow[] = [];

  for (const line of scan.items) {
    const warnings: string[] = [];
    let qty = line.quantity;
    let unitPrice = line.unitPrice;
    const lineTotal = line.lineTotal;

    // تکمیل مقدار/قیمت از روی جمع ردیف
    if (!unitPrice && lineTotal && qty) unitPrice = lineTotal / qty;
    if (!qty && lineTotal && unitPrice) {
      const q = lineTotal / unitPrice;
      if (q > 0 && q <= MAX_QTY) qty = roundQty(q);
    }
    if (!qty) {
      qty = 1;
      warnings.push("تعداد خوانده نشد — بررسی کنید");
    }
    if (!unitPrice) warnings.push("قیمت خرید خوانده نشد — وارد کنید");
    if (unitPrice && lineTotal && qty) {
      const expected = unitPrice * qty;
      if (Math.abs(expected - lineTotal) > Math.max(10, lineTotal * 0.01)) {
        warnings.push("«تعداد × قیمت» با جمع ردیف فاکتور نمی‌خواند");
      }
    }
    if (line.confidence === "low") warnings.push("خوانایی پایین — با فاکتور مقایسه کنید");

    let unit = mapScanUnit(line.unit, unitDefs);

    // تطبیق با انبار: کد → نام دقیق → فقط پیشنهاد
    let product: Product | undefined;
    let matchedBy: ReviewRow["matchedBy"];
    if (line.code) {
      product = findProductByCode(products, line.code);
      if (product) matchedBy = "code";
    }
    if (!product) {
      product = products.find((p) => sameNormalizedName(p.name, line.name));
      if (product) matchedBy = "name";
    }
    let suggestionId: string | undefined;
    if (!product) {
      const best = filterAndRankSearch(products, line.name, (p) => [p.name])[0];
      if (best) suggestionId = best.id;
    }

    const buyPrice = toToman(unitPrice || 0, currency);
    let sellPrice = suggestSellPrice(buyPrice, marginPercent);
    if (product) {
      const productUnit = product.unit || COUNT_UNIT;
      if (unit !== productUnit && !unitsConvertible(unit, productUnit)) unit = productUnit;
      // قیمت فروش فعلی کالا به واحد همین ردیف
      if (product.price > 0) sellPrice = convertUnitPrice(product.price, productUnit, unit);
    }

    rows.push({
      key: rowKey(),
      include: true,
      name: product ? product.name : line.name,
      code: product?.code || line.code || "",
      quantity: roundQty(qty),
      unit,
      buyPrice,
      sellPrice,
      sellEdited: !!product,
      productId: product?.id ?? "",
      suggestionId,
      matchedBy,
      confidence: line.confidence,
      warnings,
    });
  }

  // یک کالا دو بار در همین فاکتور
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const k = r.productId || normalizeSearchText(r.name);
    const prev = seen.get(k);
    if (prev != null) {
      r.warnings.push("این کالا در فاکتور تکرار شده است");
      if (!rows[prev].warnings.includes("این کالا در فاکتور تکرار شده است")) {
        rows[prev].warnings.push("این کالا در فاکتور تکرار شده است");
      }
    } else seen.set(k, i);
  });

  return rows;
}

/** وصل کردن یک ردیف به کالای موجود (مثلاً با قبول پیشنهاد) */
export function linkRowToProduct(row: ReviewRow, product: Product): ReviewRow {
  const productUnit = product.unit || COUNT_UNIT;
  const unit =
    row.unit === productUnit || unitsConvertible(row.unit, productUnit) ? row.unit : productUnit;
  return {
    ...row,
    productId: product.id,
    name: product.name,
    code: product.code || row.code,
    unit,
    sellPrice:
      product.price > 0 ? convertUnitPrice(product.price, productUnit, unit) : row.sellPrice,
    sellEdited: true,
    suggestionId: undefined,
    matchedBy: "name",
  };
}

/** جمع ردیف‌های انتخاب‌شده (تومان) */
export function reviewRowsTotal(rows: ReviewRow[]): number {
  return rows
    .filter((r) => r.include)
    .reduce((s, r) => s + Math.round((Number(r.quantity) || 0) * (Number(r.buyPrice) || 0)), 0);
}

/**
 * ردیف‌های تاییدشده → اقلام فاکتور خرید.
 * برای کالای موجود، قیمت فروش فقط وقتی کاربر واقعاً عوضش کرده باشد اعمال می‌شود.
 */
export function reviewRowsToPurchaseItems(
  rows: ReviewRow[],
  products: Product[],
  defaultCategory: string,
): PurchaseItem[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: PurchaseItem[] = [];
  for (const r of rows) {
    if (!r.include) continue;
    const qty = roundQty(Number(r.quantity) || 0);
    if (!(qty > 0) || !r.name.trim()) continue;
    const buyPrice = Math.max(0, Number(r.buyPrice) || 0);
    const sell = Math.max(0, Math.round(Number(r.sellPrice) || 0));
    const product = r.productId ? byId.get(r.productId) : undefined;
    if (product) {
      const productUnit = product.unit || COUNT_UNIT;
      const current = product.price > 0 ? convertUnitPrice(product.price, productUnit, r.unit) : 0;
      const changed = sell > 0 && Math.abs(sell - current) >= 1;
      out.push({
        productId: product.id,
        name: product.name,
        quantity: qty,
        buyPrice,
        unit: r.unit || productUnit,
        productUnit,
        category: product.category,
        ...(changed ? { sellPrice: sell, updateSellPrice: true } : {}),
        ...(r.code.trim() && !product.code ? { code: r.code.trim() } : {}),
      });
    } else {
      out.push({
        productId: "",
        name: r.name.trim(),
        quantity: qty,
        buyPrice,
        sellPrice: sell,
        unit: r.unit || COUNT_UNIT,
        category: defaultCategory,
        ...(r.code.trim() ? { code: r.code.trim() } : {}),
      });
    }
  }
  return out;
}
