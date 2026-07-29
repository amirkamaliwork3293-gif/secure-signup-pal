/**
 * محاسبات قیمت طلا — مطابق فرمول رایج بازار طلا و جواهر ایران:
 *
 *   قیمت پایه (خام) = وزن (گرم) × نرخ هر گرم طلا در همان عیار
 *   اجرت ساخت      = قیمت پایه × درصد اجرت   (برای طلای دست‌دوم/آب‌شده معمولاً صفر)
 *   سود فروشنده     = (قیمت پایه + اجرت) × درصد سود
 *   مالیات ارزش‌افزوده = (اجرت + سود) × درصد مالیات   ← طبق قانون جدید، فقط روی اجرت+سود بسته می‌شود، نه اصل طلا
 *   قیمت نهایی       = قیمت پایه + اجرت + سود + مالیات
 *
 * نرخ مرجع بازار همیشه به‌صورت «قیمت هر گرم طلای ۱۸ عیار (۷۵۰)» اعلام می‌شود.
 * برای عیارهای دیگر، نرخ با نسبت عیار استاندارد (عیار مینیمال/millesimal fineness) تبدیل می‌شود.
 *
 * درصدهای اجرت/سود/مالیات از فروشگاهی به فروشگاه دیگر و از قطعه‌ای به قطعه دیگر فرق می‌کند؛
 * اعداد پیش‌فرض این فایل رایج‌ترین مقادیر بازارند، اما همیشه در فرم قابل ویرایش‌اند.
 */

/** عیار مینیمال استاندارد (از هزار) برای رایج‌ترین عیارهای بازار ایران */
export const KARAT_FINENESS: Record<number, number> = {
  24: 999,
  22: 916,
  21: 875,
  18: 750,
  14: 585,
  10: 417,
};

export const COMMON_KARATS = [24, 21, 18, 14] as const;

/** پیش‌فرض‌های رایج بازار — همیشه در فرم قابل تغییرند، ثابت نیستند */
export const DEFAULT_WAGE_PERCENT = 7;
export const DEFAULT_PROFIT_PERCENT = 7;
export const DEFAULT_TAX_PERCENT = 9;

/** ۱ مثقال طلا = ۴.۳۳۱۸ گرم (واحد سنتی بازار طلای ایران) */
export const GRAMS_PER_MESGHAL = 4.3318;

export type GoldCalcInput = {
  /** نرخ روز هر گرم طلای ۱۸ عیار (تومان) */
  pricePerGram18: number;
  /** وزن به گرم */
  weightGrams: number;
  /** عیار قطعه (پیش‌فرض ۱۸) */
  karat?: number;
  /** درصد اجرت ساخت — برای طلای دست‌دوم/آب‌شده صفر بگذارید */
  wagePercent?: number;
  /** درصد سود فروشنده */
  profitPercent?: number;
  /** درصد مالیات بر ارزش افزوده (فقط روی اجرت+سود) */
  taxPercent?: number;
};

export type GoldCalcResult = {
  pricePerGramKarat: number;
  basePrice: number;
  wage: number;
  profit: number;
  tax: number;
  total: number;
};

/** نرخ هر گرم برای یک عیار دلخواه، با تبدیل نسبت به نرخ مرجع ۱۸ عیار */
export function pricePerGramForKarat(pricePerGram18: number, karat: number): number {
  const fine18 = KARAT_FINENESS[18];
  const fineTarget = KARAT_FINENESS[karat] ?? Math.round((karat / 24) * 999);
  return (pricePerGram18 / fine18) * fineTarget;
}

export function computeGoldPrice(input: GoldCalcInput): GoldCalcResult {
  const karat = input.karat ?? 18;
  const wagePercent = Math.max(0, input.wagePercent ?? DEFAULT_WAGE_PERCENT);
  const profitPercent = Math.max(0, input.profitPercent ?? DEFAULT_PROFIT_PERCENT);
  const taxPercent = Math.max(0, input.taxPercent ?? DEFAULT_TAX_PERCENT);
  const weight = Math.max(0, input.weightGrams || 0);

  const pricePerGramKarat =
    karat === 18 ? input.pricePerGram18 : pricePerGramForKarat(input.pricePerGram18, karat);

  const basePrice = Math.round(weight * pricePerGramKarat);
  const wage = Math.round((basePrice * wagePercent) / 100);
  const profit = Math.round(((basePrice + wage) * profitPercent) / 100);
  const tax = Math.round(((wage + profit) * taxPercent) / 100);
  const total = basePrice + wage + profit + tax;

  return { pricePerGramKarat: Math.round(pricePerGramKarat), basePrice, wage, profit, tax, total };
}

/** انواع رایج سکه طلا در بازار ایران — این‌ها بر اساس وزن+عیار محاسبه نمی‌شوند، نرخشان مستقیماً از بازار گرفته می‌شود */
export const COIN_TYPES = [
  { id: "emami", label: "سکه امامی (تمام)" },
  { id: "bahar", label: "سکه بهار آزادی (تمام)" },
  { id: "half", label: "نیم سکه" },
  { id: "quarter", label: "ربع سکه" },
  { id: "gerami", label: "سکه گرمی" },
] as const;

export type CoinTypeId = (typeof COIN_TYPES)[number]["id"];
