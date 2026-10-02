/**
 * تبدیل اعداد یک محصول وقتی کاربر واحدش را بین واحدهای هم‌خانواده عوض می‌کند
 * (کیلوگرم ↔ گرم، لیتر ↔ میلی‌لیتر) و صریحاً تأیید می‌کند که اعداد هم تبدیل شوند.
 *
 * فقط فیلدهایی تبدیل می‌شوند که کاربر در همان فرم دستی عوض نکرده باشد؛ عددی که
 * کاربر خودش تایپ کرده، همان می‌ماند. موجودی از نسخهٔ فعلی حافظه (current) تبدیل
 * می‌شود تا فروش هم‌زمان گم نشود.
 */
import type { Product } from "./store";
import { convertQuantity, convertUnitPrice } from "./units.ts";

const PRICE_KEYS = ["price", "buyPrice", "consumerPrice", "sellerPrice", "wholesalePrice"] as const;
const QTY_KEYS = ["lowStockThreshold", "wholesaleMinQty"] as const;

export function convertProductUnit(edited: Product, original: Product, current: Product): Product {
  const from = original.unit;
  const to = edited.unit;
  const out: Product = { ...edited };
  if (edited.stock === original.stock) {
    out.stock = convertQuantity(Number(current.stock) || 0, from, to);
  }
  for (const k of PRICE_KEYS) {
    const v = edited[k];
    // قیمت‌های محصول در برنامه عدد صحیح تومان‌اند
    if (typeof v === "number" && v > 0 && v === original[k]) {
      out[k] = Math.max(1, Math.round(convertUnitPrice(v, from, to)));
    }
  }
  for (const k of QTY_KEYS) {
    const v = edited[k];
    if (typeof v === "number" && v > 0 && v === original[k]) out[k] = convertQuantity(v, from, to);
  }
  // فرمول: «مواد لازم برای یک واحد» — یک واحد جدید چند واحد قدیمی است
  if (edited.recipe?.length && JSON.stringify(edited.recipe) === JSON.stringify(original.recipe)) {
    const factor = convertQuantity(1, to, from);
    out.recipe = edited.recipe.map((ing) => ({
      ...ing,
      quantity: Math.round(ing.quantity * factor * 1e6) / 1e6,
    }));
  }
  return out;
}
