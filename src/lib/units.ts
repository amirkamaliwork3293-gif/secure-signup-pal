/**
 * تبدیل واحدهای مقدار (وزن/حجم) — منبع واحد برای انبار، فروش، خرید و تولید.
 *
 * قاعدهٔ طلایی: «موجودی» همیشه به واحد خود کالا (product.unit) نگه داشته می‌شود.
 * اگر ردیف فروش/خرید با واحد دیگری از همان خانواده ثبت شده باشد (مثلاً خرید ۵۰۰ گرم
 * برای کالای کیلوگرمی)، مقدار پیش از اثر روی موجودی به واحد کالا تبدیل می‌شود.
 *
 * واحدهای ناشناس یا خانوادهٔ متفاوت (عدد ↔ کیلوگرم، متر، بسته ...) تبدیل نمی‌شوند و
 * مقدار همان‌طور می‌ماند — همان رفتار قبلی برنامه، تا دادهٔ قدیمی هیچ‌وقت عوض نشود.
 *
 * این فایل هیچ وابستگی‌ای به store ندارد تا در تست‌ها مستقیم اجرا شود.
 */

export const KG_UNIT = "کیلوگرم";
export const GRAM_UNIT = "گرم";

const UNIT_BASE: Record<string, { family: string; factor: number }> = {
  [GRAM_UNIT]: { family: "mass", factor: 1 },
  [KG_UNIT]: { family: "mass", factor: 1000 },
  میلی‌لیتر: { family: "volume", factor: 1 },
  میلیلیتر: { family: "volume", factor: 1 },
  لیتر: { family: "volume", factor: 1000 },
};

function norm(unit: string | undefined): string {
  return (unit || "").trim();
}

/** خانوادهٔ واحد («mass» / «volume») یا null برای واحدهای بدون تبدیل */
export function unitFamily(unit: string | undefined): string | null {
  return UNIT_BASE[norm(unit)]?.family ?? null;
}

/** آیا دو واحد قابل تبدیل به هم‌اند (و واقعاً متفاوت‌اند)؟ */
export function unitsConvertible(a: string | undefined, b: string | undefined): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y || x === y) return false;
  const fa = UNIT_BASE[x];
  const fb = UNIT_BASE[y];
  return !!fa && !!fb && fa.family === fb.family && fa.factor !== fb.factor;
}

/**
 * گرد کردن مقدار تا ۶ رقم اعشار تا خطای ممیز شناور (مثل ۱٫۳ − ۱ = ۰٫۲۹۹۹۹۹)
 * در موجودی انباشته نشود.
 */
export function roundQty(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e6) / 1e6;
}

/** تبدیل مقدار از یک واحد به واحد دیگر؛ واحد ناشناس/نامرتبط → همان مقدار */
export function convertQuantity(
  qty: number,
  fromUnit: string | undefined,
  toUnit: string | undefined,
): number {
  if (!Number.isFinite(qty)) return 0;
  const from = norm(fromUnit);
  const to = norm(toUnit);
  if (!from || !to || from === to) return qty;
  const a = UNIT_BASE[from];
  const b = UNIT_BASE[to];
  if (a && b && a.family === b.family) return roundQty((qty * a.factor) / b.factor);
  return qty;
}

/**
 * قیمت «هر واحدِ fromUnit» → قیمت «هر واحدِ toUnit».
 * مثال: ۲۰۰ تومان هر گرم → ۲۰۰٬۰۰۰ تومان هر کیلوگرم.
 */
export function convertUnitPrice(
  price: number,
  fromUnit: string | undefined,
  toUnit: string | undefined,
): number {
  if (!Number.isFinite(price)) return 0;
  if (!unitsConvertible(fromUnit, toUnit)) return price;
  // مقدار ۱ واحدِ toUnit چند واحدِ fromUnit است
  const perTarget = convertQuantity(1, toUnit, fromUnit);
  // قیمت گرمیِ کالای ارزان ممکن است کسری از تومان باشد؛ تا ۴ رقم اعشار نگه داشته می‌شود
  // (جمع ردیف‌ها همیشه با lineTotal گرد می‌شود).
  const v = price * perTarget;
  return Number.isInteger(v) ? v : Math.round(v * 1e4) / 1e4;
}

/** مقدار کیلوگرمی اعشاری → کیلو + گرم باقیمانده (برای ورودی دوخانه‌ای) */
export function splitKgGrams(qtyKg: number): { kg: number; g: number } {
  const q = Math.max(0, roundQty(Number(qtyKg) || 0));
  let kg = Math.floor(q);
  let g = Math.round((q - kg) * 1000);
  if (g >= 1000) {
    kg += 1;
    g -= 1000;
  }
  return { kg, g };
}

/** کیلو + گرم → مقدار اعشاری کیلوگرم (گرم بیش از ۹۹۹ هم مجاز است: ۱۵۰۰ گرم = ۱٫۵) */
export function joinKgGrams(kg: number, g: number): number {
  const k = Math.max(0, Math.floor(Number(kg) || 0));
  const gr = Math.max(0, Math.round(Number(g) || 0));
  return roundQty(k + gr / 1000);
}

/** واحدهای ورود جایگزین برای یک واحد کالا (مثلاً کالای کیلوگرمی را می‌توان گرمی هم خرید) */
export function alternateEntryUnits(productUnit: string | undefined): string[] {
  const u = norm(productUnit);
  const base = UNIT_BASE[u];
  if (!base) return [];
  const canonical = base.family === "mass" ? [KG_UNIT, GRAM_UNIT] : ["لیتر", "میلی‌لیتر"];
  return canonical.filter((x) => x !== u);
}
