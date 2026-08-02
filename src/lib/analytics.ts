/**
 * analytics.ts — محاسبات تحلیلی کالاها و مشتریان
 *
 * همه‌ی محاسبات از روی فاکتورهای آرشیوشده انجام می‌شود؛ سود هر قلم از اختلاف
 * قیمت فروش و قیمت خرید (ذخیره‌شده روی خود آیتم یا قیمت خرید فعلی کالا) به‌دست می‌آید.
 */
import type { Invoice, Product } from "@/lib/store";

export type ProductStat = {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  profit: number;
  hasCost: boolean;
  /** حاشیه سود درصدی */
  margin: number;
  invoices: number;
  lastAt: number;
};

export type CustomerStat = {
  key: string;
  name: string;
  phone?: string;
  invoices: number;
  revenue: number;
  profit: number;
  avg: number;
  lastAt: number;
};

export function productStats(list: Invoice[], allProducts: Product[]): ProductStat[] {
  const buy = new Map<string, number | undefined>();
  for (const p of allProducts) buy.set(p.id, p.buyPrice);

  const map = new Map<string, ProductStat & { _invIds: Set<string> }>();
  for (const inv of list) {
    for (const item of inv.items) {
      const cost = item.buyPrice ?? buy.get(item.productId);
      const hasCost = typeof cost === "number" && cost > 0;
      const revenue = item.price * item.quantity;
      const profit = hasCost ? (item.price - cost!) * item.quantity : 0;
      const prev = map.get(item.productId) ?? {
        productId: item.productId, name: item.name, qty: 0, revenue: 0, profit: 0,
        hasCost: false, margin: 0, invoices: 0, lastAt: 0, _invIds: new Set<string>(),
      };
      prev._invIds.add(inv.id);
      map.set(item.productId, {
        ...prev,
        name: item.name,
        qty: prev.qty + item.quantity,
        revenue: prev.revenue + revenue,
        profit: prev.profit + profit,
        hasCost: prev.hasCost || hasCost,
        lastAt: Math.max(prev.lastAt, inv.createdAt),
      });
    }
  }

  return Array.from(map.values()).map((s) => ({
    productId: s.productId,
    name: s.name,
    qty: s.qty,
    revenue: Math.round(s.revenue),
    profit: Math.round(s.profit),
    hasCost: s.hasCost,
    margin: s.revenue > 0 ? Math.round((s.profit / s.revenue) * 100) : 0,
    invoices: s._invIds.size,
    lastAt: s.lastAt,
  }));
}

export function customerName(inv: Invoice): string {
  const c = inv.customer;
  const n = `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim();
  return n || "مشتری متفرقه";
}

export function customerStats(list: Invoice[], allProducts: Product[]): CustomerStat[] {
  const buy = new Map<string, number | undefined>();
  for (const p of allProducts) buy.set(p.id, p.buyPrice);

  const map = new Map<string, CustomerStat>();
  for (const inv of list) {
    const phone = inv.customer?.phone?.trim() || "";
    const name = customerName(inv);
    if (!phone && name === "مشتری متفرقه") continue;
    const key = phone || name;

    let profit = 0;
    for (const item of inv.items) {
      const cost = item.buyPrice ?? buy.get(item.productId);
      if (typeof cost === "number" && cost > 0) profit += (item.price - cost) * item.quantity;
    }

    const prev = map.get(key) ?? {
      key, name, phone: phone || undefined, invoices: 0, revenue: 0, profit: 0, avg: 0, lastAt: 0,
    };
    const invoices = prev.invoices + 1;
    const revenue = prev.revenue + inv.total;
    map.set(key, {
      ...prev,
      name: name !== "مشتری متفرقه" ? name : prev.name,
      invoices,
      revenue,
      profit: Math.round(prev.profit + profit),
      avg: Math.round(revenue / invoices),
      lastAt: Math.max(prev.lastAt, inv.createdAt),
    });
  }
  return Array.from(map.values());
}

export const topBy = <T,>(list: T[], key: (x: T) => number, n = 5): T[] =>
  [...list].sort((a, b) => key(b) - key(a)).slice(0, n);

export const bottomBy = <T,>(list: T[], key: (x: T) => number, n = 5): T[] =>
  [...list].sort((a, b) => key(a) - key(b)).slice(0, n);

/** ارزش انبار: بهای تمام‌شده و ارزش فروش موجودی فعلی */
export function inventoryValue(list: Product[]) {
  let cost = 0;
  let sale = 0;
  let units = 0;
  for (const p of list) {
    const stock = Math.max(0, Number(p.stock) || 0);
    units += stock;
    cost += stock * (Number(p.buyPrice) || 0);
    sale += stock * (Number(p.price) || 0);
  }
  return { cost: Math.round(cost), sale: Math.round(sale), units, potentialProfit: Math.round(sale - cost) };
}
