/**
 * تولید و فرمول ساخت محصول.
 *
 * ایده: بعضی کالاها (مثلاً شیک نوتلا) از مواد اولیه ساخته می‌شوند.
 * با ثبت فروش آن کالا، موجودی مواد فرمول به‌اندازه‌ی مصرف کم می‌شود.
 * کسب‌وکارهایی که تولید ندارند این بخش را در تنظیمات خاموش نگه می‌دارند.
 */
import type { InvoiceItem, Product } from "./store";

export type RecipeIngredient = {
  productId: string;
  /** نام در لحظه‌ی ثبت فرمول — اگر ماده بعداً حذف شد همچنان خوانا بماند */
  name: string;
  /** مقدار لازم برای ساخت ۱ واحد از محصول نهایی */
  quantity: number;
  unit: string;
};

export type ProductionUsage = {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
};

export type ProductionEvent = {
  id: string;
  createdAt: number;
  kind: "sale" | "produce";
  outputProductId: string;
  outputName: string;
  outputQty: number;
  outputUnit?: string;
  invoiceId?: string;
  ingredients: ProductionUsage[];
  note?: string;
};

/** خانواده‌ی تبدیل واحدهای رایج — واحدهای سفارشی بدون تبدیل، همان‌طور مصرف می‌شوند */
const UNIT_BASE: Record<string, { family: string; factor: number }> = {
  گرم: { family: "mass", factor: 1 },
  کیلوگرم: { family: "mass", factor: 1000 },
  میلی‌لیتر: { family: "volume", factor: 1 },
  میلیلیتر: { family: "volume", factor: 1 },
  لیتر: { family: "volume", factor: 1000 },
};

export function convertQuantity(
  qty: number,
  fromUnit: string | undefined,
  toUnit: string | undefined,
): number {
  if (!Number.isFinite(qty)) return 0;
  const from = (fromUnit || "").trim();
  const to = (toUnit || "").trim();
  if (!from || !to || from === to) return qty;
  const a = UNIT_BASE[from];
  const b = UNIT_BASE[to];
  if (a && b && a.family === b.family) return (qty * a.factor) / b.factor;
  return qty;
}

export function productHasRecipe(p?: Product | null): boolean {
  return !!p?.recipe && p.recipe.length > 0;
}

/**
 * مواد لازم برای ساخت `qty` واحد از محصول.
 * فرمول یک‌سطحی است (مواد اولیه)؛ اگر ماده خودش فرمول داشته باشد
 * موجودی همان ماده کم می‌شود تا کاربر بتواند نیمه‌ساخته را جدا تولید کند.
 */
export function expandRecipeForQty(
  product: Product | undefined,
  qty: number,
  catalog: Product[],
): ProductionUsage[] {
  if (!product?.recipe?.length || !qty) return [];
  const byId = new Map(catalog.map((p) => [p.id, p]));
  return product.recipe
    .filter((ing) => ing.productId && ing.quantity > 0)
    .map((ing) => {
      const target = byId.get(ing.productId);
      const unit = target?.unit || ing.unit;
      const quantity = convertQuantity(ing.quantity * qty, ing.unit, unit);
      return {
        productId: ing.productId,
        name: target?.name || ing.name,
        quantity,
        unit,
      };
    });
}

/**
 * اختلاف موجودی برای اقلام فاکتور فروش:
 * مقدار مثبت یعنی باید از انبار کم شود.
 *
 * - موجودی خود محصول نهایی همیشه کم می‌شود.
 * - اگر فرمول داشته باشد و موجودی نهایی کافی نباشد (ساخت هنگام فروش)،
 *   کسری از روی مواد اولیه تأمین می‌شود.
 * - اگر قبلاً با «تولید دسته» ساخته شده باشد، مواد دوباره کسر نمی‌شوند.
 */
export function stockDeltasForSoldItems(
  items: InvoiceItem[],
  catalog: Product[],
): Map<string, number> {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const remainingFg = new Map(catalog.map((p) => [p.id, p.stock || 0]));
  const map = new Map<string, number>();
  const add = (id: string, qty: number) => {
    if (!id || !qty) return;
    const prod = byId.get(id);
    if (prod && prod.trackStock === false) return;
    map.set(id, (map.get(id) || 0) + qty);
  };
  for (const it of items) {
    if (!it.productId) continue;
    add(it.productId, it.quantity);
    const prod = byId.get(it.productId);
    if (!prod?.recipe?.length) continue;
    const have = remainingFg.get(it.productId) || 0;
    const fromStock = Math.min(have, it.quantity);
    remainingFg.set(it.productId, have - fromStock);
    const assembled = it.quantity - fromStock;
    if (assembled <= 0) continue;
    for (const u of expandRecipeForQty(prod, assembled, catalog)) {
      add(u.productId, u.quantity);
    }
  }
  return map;
}

/** مواد اولیه‌ای که واقعاً هنگام این فروش کسر می‌شوند (بدون تولید ازپیش‌انجام‌شده). */
export function ingredientsUsedOnSale(
  items: InvoiceItem[],
  catalog: Product[],
): { product: Product; qty: number; ingredients: ProductionUsage[] }[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const remainingFg = new Map(catalog.map((p) => [p.id, p.stock || 0]));
  const out: { product: Product; qty: number; ingredients: ProductionUsage[] }[] = [];
  for (const it of items) {
    if (!it.productId) continue;
    const prod = byId.get(it.productId);
    if (!prod?.recipe?.length) continue;
    const have = remainingFg.get(it.productId) || 0;
    const fromStock = Math.min(have, it.quantity);
    remainingFg.set(it.productId, have - fromStock);
    const assembled = it.quantity - fromStock;
    if (assembled <= 0) continue;
    out.push({
      product: prod,
      qty: assembled,
      ingredients: expandRecipeForQty(prod, assembled, catalog),
    });
  }
  return out;
}

export function canProduce(
  product: Product,
  qty: number,
  catalog: Product[],
): { ok: boolean; missing: ProductionUsage[] } {
  const usage = expandRecipeForQty(product, qty, catalog);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const missing: ProductionUsage[] = [];
  for (const u of usage) {
    const have = byId.get(u.productId)?.stock ?? 0;
    if (have + 1e-9 < u.quantity) {
      missing.push({ ...u, quantity: u.quantity - have });
    }
  }
  return { ok: missing.length === 0, missing };
}

export function consumptionByIngredient(
  events: ProductionEvent[],
): { productId: string; name: string; quantity: number; unit: string }[] {
  const map = new Map<
    string,
    { productId: string; name: string; quantity: number; unit: string }
  >();
  for (const e of events) {
    for (const ing of e.ingredients) {
      const prev = map.get(ing.productId);
      if (prev) {
        prev.quantity += ing.quantity;
        prev.name = ing.name || prev.name;
      } else {
        map.set(ing.productId, { ...ing });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.quantity - a.quantity);
}

export const SUGGESTED_PRODUCTION_UNITS = [
  { name: "عدد", allowDecimal: false },
  { name: "گرم", allowDecimal: true },
  { name: "کیلوگرم", allowDecimal: true },
  { name: "لیتر", allowDecimal: true },
  { name: "میلی‌لیتر", allowDecimal: true },
] as const;
