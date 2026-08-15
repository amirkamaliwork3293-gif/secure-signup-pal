/**
 * توابع تحلیلی محلی «دستیار هوشمند صوتی».
 *
 * همه‌ی محاسبات فقط روی آرایه‌های موجود در حافظه انجام می‌شود — هیچ فراخوانی
 * شبکه/AI در این فایل وجود ندارد. فرمول سود دقیقاً همان فرمول صفحه‌ی گزارش است
 * ((قیمت فروش − قیمت خرید) × تعداد، با سرشکن‌شدن تخفیف کل فاکتور) تا عددی که
 * دستیار می‌گوید با عددی که در /reports دیده می‌شود یکی باشد.
 *
 * هر تابع تحلیلی یک همتای «…Text» دارد که متن فارسی آماده‌ی نمایش (با
 * formatToman/formatNumber) تولید می‌کند.
 */

import {
  customerBalance,
  customerFullName,
  formatNumber,
  formatToman,
  invoicesOfCustomer,
  jalaliToTimestamp,
  toJalali,
  type Customer,
  type Expense,
  type Invoice,
  type Product,
} from "@/lib/store";
import { discountFactor, invoiceTotals, lineTotal } from "@/lib/invoice-math";

export type QueryKind =
  | "most_profitable"
  | "least_profitable"
  | "best_customers"
  | "top_selling"
  | "debtors"
  | "today_sales"
  | "month_expenses";

export type QueryContext = {
  products: Product[];
  invoices: Invoice[];
  customers: Customer[];
  expenses: Expense[];
  /** «اکنون» — فقط برای تست/محاسبه‌ی بازه‌ها */
  now?: number;
};

// ─── بازه‌های زمانی ───────────────────────────────────────────────────────────

/** شروع امروز به وقت تهران (مستقل از تنظیم ساعت دستگاه) */
function tehranDayStart(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return new Date(parts + "T00:00:00+03:30").getTime();
}

/** شروع ماه جاری شمسی */
function jalaliMonthStart(now = Date.now()): number {
  const j = toJalali(now);
  if (!j) return tehranDayStart(now);
  try {
    return jalaliToTimestamp(j.jy, j.jm, 1, 0, 0);
  } catch {
    return tehranDayStart(now);
  }
}

// ─── سود به تفکیک کالا ────────────────────────────────────────────────────────

export type ProductProfitRow = {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  profit: number;
  /** آیا قیمت خرید داشت؟ (بدون آن سود قابل محاسبه نیست) */
  hasCost: boolean;
};

/**
 * سود و فروش هر کالا در کل فاکتورهای داده‌شده.
 * قیمت خرید اول از خود ردیف فاکتور (لحظه‌ی فروش) و در نبودش از کالای فعلی
 * خوانده می‌شود — مثل صفحه‌ی گزارش.
 */
export function productProfitRows(productList: Product[], invoices: Invoice[]): ProductProfitRow[] {
  const productBuy = new Map<string, number | undefined>();
  for (const p of productList) productBuy.set(p.id, p.buyPrice);

  const per = new Map<string, ProductProfitRow>();
  for (const inv of invoices) {
    const factor = discountFactor(inv);
    for (const item of inv.items) {
      const cost = item.buyPrice ?? productBuy.get(item.productId);
      const revenue = lineTotal(item) * factor;
      const hasCost = typeof cost === "number" && cost > 0;
      const itemProfit = hasCost ? revenue - cost * item.quantity : 0;
      const key = item.productId || item.name;
      const prev =
        per.get(key) ??
        ({
          productId: item.productId,
          name: item.name,
          qty: 0,
          revenue: 0,
          profit: 0,
          hasCost: false,
        } as ProductProfitRow);
      per.set(key, {
        ...prev,
        name: item.name || prev.name,
        qty: prev.qty + item.quantity,
        revenue: prev.revenue + revenue,
        profit: prev.profit + itemProfit,
        hasCost: prev.hasCost || hasCost,
      });
    }
  }

  return [...per.values()].map((r) => ({
    ...r,
    revenue: Math.round(r.revenue),
    profit: Math.round(r.profit),
  }));
}

export function mostProfitableProducts(
  productList: Product[],
  invoices: Invoice[],
  limit = 3,
): ProductProfitRow[] {
  return productProfitRows(productList, invoices)
    .filter((r) => r.hasCost)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, Math.max(1, limit));
}

export function leastProfitableProducts(
  productList: Product[],
  invoices: Invoice[],
  limit = 3,
): ProductProfitRow[] {
  return productProfitRows(productList, invoices)
    .filter((r) => r.hasCost)
    .sort((a, b) => a.profit - b.profit)
    .slice(0, Math.max(1, limit));
}

/** پرفروش‌ترین کالاها بر اساس تعداد فروخته‌شده (نیازی به قیمت خرید ندارد) */
export function topSellingProducts(
  productList: Product[],
  invoices: Invoice[],
  limit = 3,
): ProductProfitRow[] {
  return productProfitRows(productList, invoices)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, Math.max(1, limit));
}

// ─── مشتریان ──────────────────────────────────────────────────────────────────

export type CustomerSalesRow = {
  name: string;
  /** جمع مبلغ فاکتورهای این مشتری */
  total: number;
  /** تعداد فاکتورها */
  count: number;
  /** مانده‌ی حساب (مثبت = بدهکار) — فقط برای مشتریان ثبت‌شده */
  balance?: number;
};

/**
 * بهترین مشتری‌ها بر اساس جمع مبلغ خریدها. اگر هیچ فاکتوری به مشتریان ثبت‌شده
 * وصل نبود، از نام مشتری روی خود فاکتورها جمع‌بندی می‌شود تا پاسخ خالی نماند.
 */
export function bestCustomers(
  customerList: Customer[],
  invoices: Invoice[],
  limit = 3,
): CustomerSalesRow[] {
  const rows: CustomerSalesRow[] = customerList
    .map((c) => {
      const invs = invoicesOfCustomer(c, invoices);
      return {
        name: customerFullName(c) || "مشتری",
        total: invs.reduce((s, i) => s + invoiceTotals(i).total, 0),
        count: invs.length,
        balance: customerBalance(c),
      };
    })
    .filter((r) => r.count > 0);

  if (rows.length === 0) {
    const map = new Map<string, CustomerSalesRow>();
    for (const inv of invoices) {
      const name = [inv.customer?.firstName, inv.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (!name) continue;
      const prev = map.get(name) ?? { name, total: 0, count: 0 };
      map.set(name, {
        name,
        total: prev.total + invoiceTotals(inv).total,
        count: prev.count + 1,
      });
    }
    rows.push(...map.values());
  }

  return rows.sort((a, b) => b.total - a.total).slice(0, Math.max(1, limit));
}

export type DebtorsSummary = {
  count: number;
  total: number;
  top: { name: string; balance: number }[];
};

/** خلاصه‌ی بدهکاران (مانده‌ی مثبت) */
export function debtorsSummary(customerList: Customer[], limit = 3): DebtorsSummary {
  const debtors = customerList
    .map((c) => ({ name: customerFullName(c) || "مشتری", balance: customerBalance(c) }))
    .filter((d) => d.balance > 0)
    .sort((a, b) => b.balance - a.balance);
  return {
    count: debtors.length,
    total: debtors.reduce((s, d) => s + d.balance, 0),
    top: debtors.slice(0, Math.max(1, limit)),
  };
}

// ─── فروش و هزینه ─────────────────────────────────────────────────────────────

/** فروش امروز (به وقت تهران) */
export function todaysSalesTotal(
  invoices: Invoice[],
  now = Date.now(),
): { total: number; count: number } {
  const from = tehranDayStart(now);
  const todays = invoices.filter((i) => i.createdAt >= from);
  return {
    total: todays.reduce((s, i) => s + invoiceTotals(i).total, 0),
    count: todays.length,
  };
}

/** جمع هزینه‌های ماه جاری شمسی */
export function thisMonthExpensesTotal(expenseList: Expense[], now = Date.now()): number {
  const from = jalaliMonthStart(now);
  return expenseList.filter((e) => e.at >= from).reduce((s, e) => s + (e.amount || 0), 0);
}

// ─── متن پاسخ (فارسی، آماده‌ی نمایش) ─────────────────────────────────────────

function productLine(r: ProductProfitRow, mode: "profit" | "qty"): string {
  if (mode === "qty")
    return `«${r.name}» — ${formatNumber(r.qty)} فروش، درآمد ${formatToman(r.revenue)}`;
  return `«${r.name}» — سود ${formatToman(r.profit)} از ${formatNumber(r.qty)} فروش`;
}

export function mostProfitableProductsText(
  productList: Product[],
  invoices: Invoice[],
  limit = 3,
): string {
  if (invoices.length === 0) return "هنوز فاکتور فروشی ثبت نشده تا سود محاسبه شود.";
  const rows = mostProfitableProducts(productList, invoices, limit);
  if (rows.length === 0) return topSellingProductsText(productList, invoices, limit, true);
  const head = `پرسودترین کالا: ${productLine(rows[0], "profit")}`;
  const rest = rows.slice(1).map((r, i) => `${formatNumber(i + 2)}. ${productLine(r, "profit")}`);
  return [head, ...rest].join("\n");
}

export function leastProfitableProductsText(
  productList: Product[],
  invoices: Invoice[],
  limit = 3,
): string {
  if (invoices.length === 0) return "هنوز فاکتور فروشی ثبت نشده تا سود محاسبه شود.";
  const rows = leastProfitableProducts(productList, invoices, limit);
  if (rows.length === 0) return topSellingProductsText(productList, invoices, limit, true);
  const head = `کم‌سودترین کالا: ${productLine(rows[0], "profit")}`;
  const rest = rows.slice(1).map((r, i) => `${formatNumber(i + 2)}. ${productLine(r, "profit")}`);
  return [head, ...rest].join("\n");
}

export function topSellingProductsText(
  productList: Product[],
  invoices: Invoice[],
  limit = 3,
  becauseNoCost = false,
): string {
  if (invoices.length === 0) return "هنوز فاکتور فروشی ثبت نشده است.";
  const rows = topSellingProducts(productList, invoices, limit);
  if (rows.length === 0) return "در فاکتورهای ثبت‌شده قلمی برای محاسبه پیدا نشد.";
  const note = becauseNoCost
    ? "برای محاسبه‌ی سود، «قیمت خرید» کالاها ثبت نشده — فعلاً بر اساس بیشترین فروش:\n"
    : "";
  const head = `پرفروش‌ترین کالا: ${productLine(rows[0], "qty")}`;
  const rest = rows.slice(1).map((r, i) => `${formatNumber(i + 2)}. ${productLine(r, "qty")}`);
  return note + [head, ...rest].join("\n");
}

export function bestCustomersText(
  customerList: Customer[],
  invoices: Invoice[],
  limit = 3,
): string {
  const rows = bestCustomers(customerList, invoices, limit);
  if (rows.length === 0) return "هنوز فاکتوری به نام مشتری ثبت نشده تا بهترین مشتری مشخص شود.";
  const line = (r: CustomerSalesRow) =>
    `${r.name} — ${formatToman(r.total)} در ${formatNumber(r.count)} فاکتور`;
  const head = `بهترین مشتری: ${line(rows[0])}`;
  const rest = rows.slice(1).map((r, i) => `${formatNumber(i + 2)}. ${line(r)}`);
  return [head, ...rest].join("\n");
}

export function debtorsText(customerList: Customer[], limit = 3): string {
  const s = debtorsSummary(customerList, limit);
  if (s.count === 0) return "هیچ مشتری بدهکاری ندارید. 👌";
  const head = `${formatNumber(s.count)} مشتری بدهکار دارید — جمع بدهی ${formatToman(s.total)}`;
  const rest = s.top.map((d) => `• ${d.name}: ${formatToman(d.balance)}`);
  return [head, ...rest].join("\n");
}

export function todaysSalesText(invoices: Invoice[], now = Date.now()): string {
  const { total, count } = todaysSalesTotal(invoices, now);
  if (count === 0) return "امروز هنوز فاکتوری ثبت نشده است.";
  return `فروش امروز: ${formatToman(total)} در ${formatNumber(count)} فاکتور`;
}

export function thisMonthExpensesText(expenseList: Expense[], now = Date.now()): string {
  const total = thisMonthExpensesTotal(expenseList, now);
  if (total <= 0) return "برای این ماه هزینه‌ای ثبت نشده است.";
  return `جمع هزینه‌های این ماه: ${formatToman(total)}`;
}

/** پاسخ آماده برای یک نیت پرسشی — هیچ داده‌ای تغییر نمی‌کند (فقط خواندن) */
export function buildQueryAnswer(kind: QueryKind, ctx: QueryContext): string {
  const now = ctx.now ?? Date.now();
  switch (kind) {
    case "most_profitable":
      return mostProfitableProductsText(ctx.products, ctx.invoices);
    case "least_profitable":
      return leastProfitableProductsText(ctx.products, ctx.invoices);
    case "best_customers":
      return bestCustomersText(ctx.customers, ctx.invoices);
    case "top_selling":
      return topSellingProductsText(ctx.products, ctx.invoices);
    case "debtors":
      return debtorsText(ctx.customers);
    case "today_sales":
      return todaysSalesText(ctx.invoices, now);
    case "month_expenses":
      return thisMonthExpensesText(ctx.expenses, now);
  }
}
