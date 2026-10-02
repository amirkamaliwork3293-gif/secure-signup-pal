/**
 * «سلامت داده‌ها» — بررسی فقط‌خواندنی ناهماهنگی‌های انبار، محصولات و فاکتورها.
 *
 * اصول (دادهٔ مالی واقعی):
 *  - این فایل هیچ‌چیز را نمی‌نویسد؛ فقط مشکل‌ها و «اصلاح پیشنهادی» را برمی‌گرداند.
 *  - هر اصلاح پیشنهادی افزایشی یا قطعی است (مثلاً ساختن دسته‌ای که محصولات به
 *    آن اشاره می‌کنند، یا تبدیل «"۱۲۰۰۰"» متنی به عدد ۱۲۰۰۰). هر جا تصمیم به
 *    حدس نیاز دارد، فقط گزارش می‌شود و تصمیم با کاربر است.
 *  - اعمال اصلاح در store انجام می‌شود (dataHealth.apply) و فقط با تأیید کاربر
 *    و پس از گرفتن پشتیبان.
 */
import type { Category, Invoice, Product, Purchase, UnitDef } from "./store";
import { invoiceTotals, purchaseTotals } from "./invoice-math.ts";
import { unitsConvertible } from "./units.ts";

export type HealthSeverity = "error" | "warning" | "info";
export type HealthArea = "products" | "categories" | "invoices" | "purchases" | "customers";

export type HealthFix =
  | { kind: "coerce-product-numbers"; productId: string }
  | { kind: "add-category"; name: string }
  | { kind: "add-unit"; name: string }
  | { kind: "recalc-invoice-total"; invoiceId: string }
  | { kind: "recalc-purchase-total"; purchaseId: string }
  | { kind: "link-invoice-customer"; invoiceId: string; customerId: string }
  | { kind: "link-purchase-supplier"; purchaseId: string; customerId: string };

export type HealthIssue = {
  /** کلید پایدار برای فهرست و «انتخاب» در UI */
  key: string;
  severity: HealthSeverity;
  area: HealthArea;
  title: string;
  detail: string;
  /** اصلاح امن خودکار — اگر نباشد، کاربر باید خودش تصمیم بگیرد */
  fix?: HealthFix;
  /** برای رفتن به صفحهٔ مربوط (مثلاً جستجوی نام کالا) */
  ref?: { productId?: string; invoiceId?: string; purchaseId?: string; customerId?: string };
};

export type HealthInput = {
  products: Product[];
  categories: Category[];
  units: UnitDef[];
  invoices: Invoice[];
  purchases: Purchase[];
};

const NUMERIC_PRODUCT_KEYS = [
  "price",
  "stock",
  "buyPrice",
  "consumerPrice",
  "sellerPrice",
  "wholesalePrice",
  "wholesaleMinQty",
  "lowStockThreshold",
  "discountPercent",
] as const;

/** ارقام فارسی/عربی و جداکننده‌ها → عدد؛ اگر واقعاً عدد نباشد null */
export function strictNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const map: Record<string, string> = {};
  "۰۱۲۳۴۵۶۷۸۹".split("").forEach((d, i) => (map[d] = String(i)));
  "٠١٢٣٤٥٦٧٨٩".split("").forEach((d, i) => (map[d] = String(i)));
  const t = v
    .trim()
    .replace(/[۰-۹٠-٩]/g, (d) => map[d] ?? d)
    .replace(/[,،٬\s]/g, "")
    .replace(/٫/g, ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** فیلدهای عددی محصول که به‌صورت متن یا مقدار نامعتبر ذخیره شده‌اند */
export function badProductNumbers(p: Product): { key: string; fixable: boolean }[] {
  const rec = p as unknown as Record<string, unknown>;
  const out: { key: string; fixable: boolean }[] = [];
  for (const k of NUMERIC_PRODUCT_KEYS) {
    const v = rec[k];
    if (v === undefined || v === null) {
      if (k === "price" || k === "stock") out.push({ key: k, fixable: false });
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) continue;
    out.push({ key: k, fixable: strictNumber(v) !== null });
  }
  return out;
}

/** نسخهٔ عددیِ همان محصول — فقط مقدارهای متنیِ قطعاً عددی تبدیل می‌شوند */
export function coerceProductNumbers(p: Product): Product {
  const rec = { ...(p as unknown as Record<string, unknown>) };
  for (const k of NUMERIC_PRODUCT_KEYS) {
    const v = rec[k];
    if (typeof v === "string") {
      const n = strictNumber(v);
      if (n !== null) rec[k] = n;
    }
  }
  return rec as unknown as Product;
}

const FIELD_LABEL: Record<string, string> = {
  price: "قیمت فروش",
  stock: "موجودی",
  buyPrice: "قیمت خرید",
  consumerPrice: "قیمت مصرف‌کننده",
  sellerPrice: "قیمت همکار",
  wholesalePrice: "قیمت عمده",
  wholesaleMinQty: "حداقل تعداد عمده",
  lowStockThreshold: "حد هشدار موجودی",
  discountPercent: "درصد تخفیف",
};

function normName(s: string | undefined): string {
  return (s || "").trim().replace(/\s+/g, " ").replace(/ي/g, "ی").replace(/ك/g, "ک");
}

export function auditCatalog(input: HealthInput): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const { products, categories, units, invoices, purchases } = input;
  const byId = new Map(products.map((p) => [p.id, p]));

  // ── محصولات: عددهای نامعتبر ──
  for (const p of products) {
    const bad = badProductNumbers(p);
    if (!bad.length) continue;
    const fixable = bad.every((b) => b.fixable);
    issues.push({
      key: `num:${p.id}`,
      severity: "error",
      area: "products",
      title: `عدد نامعتبر در «${p.name || "بدون نام"}»`,
      detail:
        `فیلدهای ${bad.map((b) => FIELD_LABEL[b.key] ?? b.key).join("، ")} به‌صورت عدد ذخیره نشده‌اند` +
        (fixable
          ? " (متنِ عددی است و می‌تواند بی‌خطر به عدد تبدیل شود)."
          : " و مقدار درستشان معلوم نیست؛ لطفاً محصول را باز کنید و عدد درست را وارد کنید."),
      fix: fixable ? { kind: "coerce-product-numbers", productId: p.id } : undefined,
      ref: { productId: p.id },
    });
  }

  // ── محصولات: موجودی منفی (برنامه هرگز منفی نمی‌سازد؛ معمولاً از ورود فایل) ──
  for (const p of products) {
    const stock = strictNumber(p.stock);
    if (stock !== null && stock < 0) {
      issues.push({
        key: `neg:${p.id}`,
        severity: "warning",
        area: "products",
        title: `موجودی منفی: «${p.name}»`,
        detail: `موجودی ${stock} ثبت شده است. شمارش واقعی انبار را در فرم محصول وارد کنید.`,
        ref: { productId: p.id },
      });
    }
  }

  // ── دسته‌بندی‌هایی که محصول دارند ولی در فهرست دسته‌ها نیستند ──
  const catNames = new Set(categories.map((c) => c.name));
  const orphanCats = new Map<string, number>();
  for (const p of products) {
    const c = (p.category || "").trim();
    if (c && !catNames.has(c)) orphanCats.set(c, (orphanCats.get(c) || 0) + 1);
  }
  for (const [name, count] of orphanCats) {
    issues.push({
      key: `cat:${name}`,
      severity: "warning",
      area: "categories",
      title: `دستهٔ «${name}» در فهرست دسته‌ها نیست`,
      detail: `${count.toLocaleString("fa-IR")} محصول این دسته را دارند ولی در فیلتر دسته‌ها دیده نمی‌شوند. با اصلاح، همین دسته به فهرست اضافه می‌شود (محصولی تغییر نمی‌کند).`,
      fix: { kind: "add-category", name },
    });
  }

  // ── واحدهایی که محصول دارد ولی تعریف نشده‌اند ──
  const unitNames = new Set(units.map((u) => u.name));
  const orphanUnits = new Map<string, number>();
  for (const p of products) {
    const u = (p.unit || "").trim();
    if (u && !unitNames.has(u)) orphanUnits.set(u, (orphanUnits.get(u) || 0) + 1);
  }
  for (const [name, count] of orphanUnits) {
    issues.push({
      key: `unit:${name}`,
      severity: "info",
      area: "products",
      title: `واحد «${name}» تعریف نشده است`,
      detail: `${count.toLocaleString("fa-IR")} محصول این واحد را دارند ولی در فهرست واحدها نیست و در فرم محصول قابل انتخاب نیست. با اصلاح، این واحد (با مقدار اعشاری) به فهرست واحدها اضافه می‌شود.`,
      fix: { kind: "add-unit", name },
    });
  }

  // ── بارکد تکراری ──
  const byCode = new Map<string, Product[]>();
  for (const p of products) {
    const code = (p.code || "").trim();
    if (!code) continue;
    byCode.set(code, [...(byCode.get(code) || []), p]);
  }
  for (const [code, list] of byCode) {
    if (list.length < 2) continue;
    issues.push({
      key: `code:${code}`,
      severity: "warning",
      area: "products",
      title: `بارکد تکراری ${code}`,
      detail: `این بارکد روی ${list.map((p) => `«${p.name}»`).join("، ")} ثبت است؛ اسکن فقط یکی را پیدا می‌کند. کد یکی را در فرم محصول عوض کنید.`,
      ref: { productId: list[0].id },
    });
  }

  // ── کالای تکراری (همان نام و همان واحد) — معمولاً از «کالای جدید» در فاکتور خرید ──
  const byName = new Map<string, Product[]>();
  for (const p of products) {
    const n = normName(p.name);
    if (!n) continue;
    const k = `${n}|${p.unit || "عدد"}`;
    byName.set(k, [...(byName.get(k) || []), p]);
  }
  for (const [k, list] of byName) {
    if (list.length < 2) continue;
    const stocks = list.map((p) => `${Number(p.stock) || 0}`).join(" + ");
    issues.push({
      key: `dup:${k}`,
      severity: "warning",
      area: "products",
      title: `کالای تکراری: «${list[0].name}» (${list.length.toLocaleString("fa-IR")} ردیف)`,
      detail: `موجودی بین چند ردیف پخش شده (${stocks}) و فروش هر بار از یکی کم می‌شود. اگر واقعاً یک کالا هستند، موجودی را در یکی جمع و دیگری را حذف کنید؛ اگر فرق دارند، نامشان را متمایز کنید.`,
      ref: { productId: list[0].id },
    });
  }

  // ── فاکتور خریدی که واحد ردیفش با واحد فعلی کالا فرق دارد ──
  for (const pu of purchases) {
    for (const it of pu.items ?? []) {
      const prod = it.productId ? byId.get(it.productId) : undefined;
      if (!prod || !unitsConvertible(it.unit, prod.unit)) continue;
      // ردیف‌های جدید واحد کالا را در لحظهٔ خرید دارند؛ ورود گرمی آگاهانه بوده و درست تبدیل شده
      if (it.productUnit) continue;
      issues.push({
        key: `pu-unit:${pu.id}:${it.productId}`,
        severity: "info",
        area: "purchases",
        title: `واحد خرید «${it.name}» با واحد کالا فرق دارد`,
        detail: `این خرید با واحد «${it.unit}» ثبت شده ولی واحد فعلی کالا «${prod.unit}» است (احتمالاً واحد کالا بعداً عوض شده). اگر موجودی این کالا درست به نظر نمی‌رسد، شمارش واقعی را در فرم محصول وارد کنید.`,
        ref: { purchaseId: pu.id, productId: prod.id },
      });
    }
  }

  // ── جمع ذخیره‌شدهٔ فاکتور با جمع اقلام نمی‌خواند ──
  for (const inv of invoices) {
    const t = invoiceTotals(inv).total;
    if (typeof inv.total === "number" && Math.abs(inv.total - t) >= 1) {
      issues.push({
        key: `inv-total:${inv.id}`,
        severity: "warning",
        area: "invoices",
        title: `جمع فاکتور فروش با اقلامش نمی‌خواند`,
        detail: `جمع ذخیره‌شده ${inv.total.toLocaleString("fa-IR")} ولی جمع اقلام (با تخفیف و مالیات) ${t.toLocaleString("fa-IR")} است. چاپ و نمایش همیشه از اقلام حساب می‌شوند؛ با اصلاح فقط عدد ذخیره‌شده با اقلام یکی می‌شود (اقلام، بدهی مشتری و موجودی تغییر نمی‌کنند).`,
        fix: { kind: "recalc-invoice-total", invoiceId: inv.id },
        ref: { invoiceId: inv.id },
      });
    }
  }
  for (const pu of purchases) {
    const t = purchaseTotals(pu).total;
    if (typeof pu.total === "number" && Math.abs(pu.total - t) >= 1) {
      issues.push({
        key: `pu-total:${pu.id}`,
        severity: "warning",
        area: "purchases",
        title: `جمع فاکتور خرید با اقلامش نمی‌خواند`,
        detail: `جمع ذخیره‌شده ${pu.total.toLocaleString("fa-IR")} ولی جمع اقلام ${t.toLocaleString("fa-IR")} است. با اصلاح فقط عدد ذخیره‌شده با اقلام یکی می‌شود.`,
        fix: { kind: "recalc-purchase-total", purchaseId: pu.id },
        ref: { purchaseId: pu.id },
      });
    }
  }

  const rank: Record<HealthSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
