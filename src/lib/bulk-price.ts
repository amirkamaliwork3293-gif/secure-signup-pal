import type { Product } from "@/lib/store";

export type PriceField = "price" | "buyPrice" | "consumerPrice" | "sellerPrice" | "wholesalePrice";

export const PRICE_FIELD_LABEL: Record<PriceField, string> = {
  price: "قیمت فروش",
  buyPrice: "قیمت خرید",
  consumerPrice: "قیمت مصرف‌کننده",
  sellerPrice: "قیمت همکار",
  wholesalePrice: "قیمت عمده",
};

export type BulkPriceMode = "percent" | "amount";
export type BulkPriceDirection = "up" | "down";

export function applyPriceDelta(
  current: number,
  mode: BulkPriceMode,
  direction: BulkPriceDirection,
  value: number,
  roundTo: number,
): number {
  const v = Math.max(0, Number(value) || 0);
  if (v <= 0) return Math.max(0, Math.round(current || 0));
  const signed = direction === "down" ? -v : v;
  let next =
    mode === "percent"
      ? (Number(current) || 0) * (1 + signed / 100)
      : (Number(current) || 0) + signed;
  next = Math.max(0, Math.round(next));
  if (roundTo > 0) {
    next = Math.round(next / roundTo) * roundTo;
    next = Math.max(0, next);
  }
  return next;
}

function readField(p: Product, field: PriceField): number {
  if (field === "price") return Number(p.price) || 0;
  return Number(p[field]) || 0;
}

function writeField(p: Product, field: PriceField, value: number): Product {
  if (field === "price") return { ...p, price: value };
  if (value <= 0) {
    const next = { ...p };
    delete next[field];
    return next;
  }
  return { ...p, [field]: value };
}

/**
 * اعمال تغییر قیمت روی فهرست محصولات.
 * فیلد «قیمت فروش» همیشه به‌روز می‌شود؛ فیلدهای اختیاری فقط اگر از قبل مقدار داشته باشند
 * (مگر اینکه applyEmpty هم روشن باشد).
 */
export function applyBulkPriceChange(
  list: Product[],
  ids: Set<string>,
  opts: {
    mode: BulkPriceMode;
    direction: BulkPriceDirection;
    value: number;
    roundTo: number;
    fields: PriceField[];
    applyEmpty: boolean;
  },
): Product[] {
  const fields = opts.fields.length ? opts.fields : (["price"] as PriceField[]);
  return list.map((p) => {
    if (!ids.has(p.id)) return p;
    let next = p;
    for (const f of fields) {
      const cur = readField(p, f);
      if (f !== "price" && cur <= 0 && !opts.applyEmpty) continue;
      next = writeField(
        next,
        f,
        applyPriceDelta(cur, opts.mode, opts.direction, opts.value, opts.roundTo),
      );
    }
    return next;
  });
}
