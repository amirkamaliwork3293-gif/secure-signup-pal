/**
 * اثر فاکتور خرید روی انبار — تابع‌های خالص (بدون store) تا تست‌پذیر باشند.
 *
 * ردیف خرید ممکن است با واحدی غیر از واحد کالا ثبت شده باشد (مثلاً ۵۰۰ گرم برای
 * کالای کیلوگرمی). موجودی و «قیمت خرید» کالا همیشه به واحد خود کالا نگه داشته می‌شوند،
 * پس مقدار و قیمت ردیف پیش از اعمال به واحد کالا تبدیل می‌شوند.
 * خریدهای قدیمی که واحد ردیفشان با کالا یکی است دقیقاً مثل قبل رفتار می‌کنند.
 */
import type { Product, PurchaseItem } from "./store";
import { convertQuantity, convertUnitPrice, roundQty, unitsConvertible } from "./units.ts";

/** مقدار یک ردیف خرید به واحد موجودی کالا */
export function purchaseQtyInProductUnit(
  item: Pick<PurchaseItem, "quantity" | "unit">,
  product: Pick<Product, "unit"> | undefined,
): number {
  const qty = Number(item.quantity) || 0;
  if (!product) return qty;
  return convertQuantity(qty, item.unit, product.unit);
}

/** قیمت خرید هر واحدِ کالا از روی ردیف خرید (قیمت هر گرم → قیمت هر کیلوگرم) */
export function purchaseUnitCostInProductUnit(
  item: Pick<PurchaseItem, "buyPrice" | "unit">,
  product: Pick<Product, "unit"> | undefined,
): number {
  const price = Number(item.buyPrice) || 0;
  if (!product) return price;
  return convertUnitPrice(price, item.unit, product.unit);
}

/**
 * مجموع افزایش موجودی هر کالا برای اقلام یک فاکتور خرید (به واحد کالا).
 * ردیف بدون productId (کالای تازه که هنوز ساخته نشده) در نظر گرفته نمی‌شود.
 */
export function purchaseStockDeltas(
  items: readonly PurchaseItem[],
  catalog: readonly Product[],
): Map<string, number> {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const map = new Map<string, number>();
  for (const it of items) {
    if (!it.productId) continue;
    const qty = purchaseQtyInProductUnit(it, byId.get(it.productId));
    if (!qty) continue;
    map.set(it.productId, roundQty((map.get(it.productId) || 0) + qty));
  }
  return map;
}

/** اختلاف موجودی برای ویرایش فاکتور خرید: مثبت = باید به انبار اضافه شود */
export function purchaseEditStockDeltas(
  oldItems: readonly PurchaseItem[],
  newItems: readonly PurchaseItem[],
  catalog: readonly Product[],
): Map<string, number> {
  const before = purchaseStockDeltas(oldItems, catalog);
  const after = purchaseStockDeltas(newItems, catalog);
  const out = new Map<string, number>();
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const d = roundQty((after.get(id) || 0) - (before.get(id) || 0));
    if (d) out.set(id, d);
  }
  return out;
}

/** موجودی جدید پس از اعمال اختلاف (هرگز منفی نمی‌شود؛ خطای اعشار گرد می‌شود) */
export function applyStockDelta(stock: number, delta: number): number {
  return Math.max(0, roundQty((Number(stock) || 0) + delta));
}

/**
 * تعویض واحد ورود یک ردیف خرید (مثلاً کیلوگرم ← گرم). مقدار و قیمت هر واحد
 * طوری تبدیل می‌شوند که جمع ردیف تغییر نکند: ۰٫۵ کیلو × ۲۰۰٬۰۰۰ = ۵۰۰ گرم × ۲۰۰.
 */
export function switchPurchaseLineUnit(item: PurchaseItem, toUnit: string): PurchaseItem {
  if (!unitsConvertible(item.unit, toUnit)) return { ...item, unit: toUnit };
  return {
    ...item,
    unit: toUnit,
    quantity: convertQuantity(Number(item.quantity) || 0, item.unit, toUnit),
    buyPrice: convertUnitPrice(Number(item.buyPrice) || 0, item.unit, toUnit),
    sellPrice:
      item.sellPrice != null ? convertUnitPrice(item.sellPrice, item.unit, toUnit) : item.sellPrice,
  };
}

/** ردیف خرید تازه برای کالای موجود — واحد کالا در لحظهٔ خرید ثبت می‌شود */
export function newPurchaseLine(p: Product): PurchaseItem {
  return {
    productId: p.id,
    name: p.name,
    quantity: 1,
    buyPrice: p.buyPrice ?? 0,
    unit: p.unit,
    productUnit: p.unit || "عدد",
    category: p.category,
  };
}
