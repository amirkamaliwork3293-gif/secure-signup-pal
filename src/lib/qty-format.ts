import { COUNT_UNIT, formatNumber } from "@/lib/store";
import { KG_UNIT, roundQty, splitKgGrams } from "@/lib/units";

/** متن کوتاه مقدار با واحد برای فهرست‌ها: «۱ کیلو و ۳۰۰ گرم»، «۵۰۰ گرم»، «۳» */
export function formatQtyWithUnit(qty: number, unit?: string): string {
  const u = unit || COUNT_UNIT;
  if (u === KG_UNIT) {
    const { kg, g } = splitKgGrams(qty);
    if (kg && g) return `${formatNumber(kg)} کیلو و ${formatNumber(g)} گرم`;
    if (g) return `${formatNumber(g)} گرم`;
    return `${formatNumber(kg)} کیلوگرم`;
  }
  return u === COUNT_UNIT ? formatNumber(roundQty(qty)) : `${formatNumber(roundQty(qty))} ${u}`;
}
