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
  manualLedgerTotals,
  stockStatus,
  toJalali,
  type Customer,
  type Expense,
  type Invoice,
  type ManualLedgerEntry,
  type Product,
} from "@/lib/store";
import { discountFactor, invoiceTotals, lineTotal } from "@/lib/invoice-math";
import { scoreProduct } from "@/lib/voice/persian-nlu";

export type QueryKind =
  | "most_profitable"
  | "least_profitable"
  | "best_customers"
  | "top_selling"
  | "debtors"
  | "creditors"
  | "today_sales"
  | "month_expenses"
  | "profit"
  | "net_profit"
  | "sales"
  | "expenses"
  | "invoice_count"
  | "customer_status"
  | "low_stock"
  | "snapshot";

/** بازه‌ی گزارش. اگر کاربر نگفته باشد، هر نیت پیش‌فرض خودش را دارد. */
export type QueryRange = "today" | "yesterday" | "week" | "month" | "year" | "all";

export type QuerySpec = {
  kind: QueryKind;
  range?: QueryRange;
  /** برای پرسش وضعیت یک مشتری مشخص («آقای کمالی چقدر بدهکاره») */
  customerName?: string;
};

export type QueryContext = {
  products: Product[];
  invoices: Invoice[];
  customers: Customer[];
  expenses: Expense[];
  manualLedger?: ManualLedgerEntry[];
  /** «اکنون» — فقط برای تست/محاسبه‌ی بازه‌ها */
  now?: number;
};

const RANGE_LABEL: Record<QueryRange, string> = {
  today: "امروز",
  yesterday: "دیروز",
  week: "این هفته",
  month: "این ماه",
  year: "امسال",
  all: "از ابتدا",
};

const DAY_MS = 86_400_000;

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

/** شروع هفته‌ی ایرانی (شنبه) */
function jalaliWeekStart(now = Date.now()): number {
  const today = tehranDayStart(now);
  const j = toJalali(now);
  if (!j) return today;
  const daysSinceSaturday = (j.dow + 1) % 7;
  return today - daysSinceSaturday * DAY_MS;
}

/** اول فروردین سال جاری شمسی */
function jalaliYearStart(now = Date.now()): number {
  const j = toJalali(now);
  if (!j) return tehranDayStart(now);
  try {
    return jalaliToTimestamp(j.jy, 1, 1, 0, 0);
  } catch {
    return tehranDayStart(now);
  }
}

function rangeBounds(range: QueryRange, now: number): { from: number; to: number } {
  const today = tehranDayStart(now);
  const endToday = today + DAY_MS;
  switch (range) {
    case "today":
      return { from: today, to: endToday };
    case "yesterday":
      return { from: today - DAY_MS, to: today };
    case "week":
      return { from: jalaliWeekStart(now), to: endToday };
    case "month":
      return { from: jalaliMonthStart(now), to: endToday };
    case "year":
      return { from: jalaliYearStart(now), to: endToday };
    case "all":
      return { from: 0, to: Number.POSITIVE_INFINITY };
  }
}

function invoicesInRange(invoices: Invoice[], range: QueryRange, now: number): Invoice[] {
  if (range === "all") return invoices;
  const { from, to } = rangeBounds(range, now);
  return invoices.filter((i) => i.createdAt >= from && i.createdAt < to);
}

function expensesInRange(expenseList: Expense[], range: QueryRange, now: number): Expense[] {
  if (range === "all") return expenseList;
  const { from, to } = rangeBounds(range, now);
  return expenseList.filter((e) => e.at >= from && e.at < to);
}

function ledgerInRange(
  list: ManualLedgerEntry[] | undefined,
  range: QueryRange,
  now: number,
): ManualLedgerEntry[] {
  if (!list?.length) return [];
  if (range === "all") return list;
  const { from, to } = rangeBounds(range, now);
  return list.filter((e) => e.at >= from && e.at < to);
}

function defaultRangeFor(kind: QueryKind): QueryRange {
  switch (kind) {
    case "profit":
    case "net_profit":
    case "sales":
    case "today_sales":
    case "invoice_count":
    case "snapshot":
      return "today";
    case "expenses":
    case "month_expenses":
      return "month";
    default:
      return "all";
  }
}

function resolveRange(kind: QueryKind, spoken?: QueryRange): QueryRange {
  if (spoken) return spoken;
  return defaultRangeFor(kind);
}

function rangePhrase(range: QueryRange): string {
  return RANGE_LABEL[range];
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

function totalProfit(
  productList: Product[],
  invoices: Invoice[],
): {
  profit: number;
  sales: number;
  count: number;
  missingCost: boolean;
} {
  const rows = productProfitRows(productList, invoices);
  const withCost = rows.filter((r) => r.hasCost);
  return {
    profit: withCost.reduce((s, r) => s + r.profit, 0),
    sales: invoices.reduce((s, i) => s + invoiceTotals(i).total, 0),
    count: invoices.length,
    missingCost: rows.length > 0 && withCost.length === 0,
  };
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

/** خلاصه‌ی طلبکاران (مانده‌ی منفی = ما به مشتری بدهکاریم) */
export function creditorsSummary(customerList: Customer[], limit = 3): DebtorsSummary {
  const creditors = customerList
    .map((c) => ({ name: customerFullName(c) || "مشتری", balance: customerBalance(c) }))
    .filter((d) => d.balance < 0)
    .sort((a, b) => a.balance - b.balance);
  return {
    count: creditors.length,
    total: creditors.reduce((s, d) => s + -d.balance, 0),
    top: creditors.slice(0, Math.max(1, limit)),
  };
}

function matchCustomerByName(name: string, list: Customer[]): Customer | null {
  const phrase = name.trim();
  if (!phrase) return null;
  const scored = list
    .map((c) => ({
      customer: c,
      score: Math.max(
        scoreProduct(phrase, customerFullName(c)),
        scoreProduct(phrase, c.firstName || ""),
        c.lastName ? scoreProduct(phrase, c.lastName) : 0,
      ),
    }))
    .filter((c) => c.score > 0.3)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.customer ?? null;
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

function salesTotal(
  invoices: Invoice[],
  range: QueryRange,
  now: number,
): { total: number; count: number } {
  const scoped = invoicesInRange(invoices, range, now);
  return {
    total: scoped.reduce((s, i) => s + invoiceTotals(i).total, 0),
    count: scoped.length,
  };
}

/** جمع هزینه‌های ماه جاری شمسی */
export function thisMonthExpensesTotal(expenseList: Expense[], now = Date.now()): number {
  const from = jalaliMonthStart(now);
  return expenseList.filter((e) => e.at >= from).reduce((s, e) => s + (e.amount || 0), 0);
}

function expensesTotal(expenseList: Expense[], range: QueryRange, now: number): number {
  return expensesInRange(expenseList, range, now).reduce((s, e) => s + (e.amount || 0), 0);
}

// ─── متن پاسخ (فارسی، آماده‌ی نمایش) ─────────────────────────────────────────

function productLine(r: ProductProfitRow, mode: "profit" | "qty"): string {
  if (mode === "qty")
    return `«${r.name}» — ${formatNumber(r.qty)} فروش، درآمد ${formatToman(r.revenue)}`;
  return `«${r.name}» — سود ${formatToman(r.profit)} از ${formatNumber(r.qty)} فروش`;
}

function rankingScopeNote(range: QueryRange): string {
  return range === "all" ? "" : ` (${rangePhrase(range)})`;
}

export function mostProfitableProductsText(
  productList: Product[],
  invoices: Invoice[],
  limit = 3,
  range: QueryRange = "all",
): string {
  if (invoices.length === 0) return "هنوز فاکتور فروشی ثبت نشده تا سود محاسبه شود.";
  const rows = mostProfitableProducts(productList, invoices, limit);
  if (rows.length === 0) return topSellingProductsText(productList, invoices, limit, true, range);
  const head = `پرسودترین کالا${rankingScopeNote(range)}: ${productLine(rows[0], "profit")}`;
  const rest = rows.slice(1).map((r, i) => `${formatNumber(i + 2)}. ${productLine(r, "profit")}`);
  return [head, ...rest].join("\n");
}

export function leastProfitableProductsText(
  productList: Product[],
  invoices: Invoice[],
  limit = 3,
  range: QueryRange = "all",
): string {
  if (invoices.length === 0) return "هنوز فاکتور فروشی ثبت نشده تا سود محاسبه شود.";
  const rows = leastProfitableProducts(productList, invoices, limit);
  if (rows.length === 0) return topSellingProductsText(productList, invoices, limit, true, range);
  const head = `کم‌سودترین کالا${rankingScopeNote(range)}: ${productLine(rows[0], "profit")}`;
  const rest = rows.slice(1).map((r, i) => `${formatNumber(i + 2)}. ${productLine(r, "profit")}`);
  return [head, ...rest].join("\n");
}

export function topSellingProductsText(
  productList: Product[],
  invoices: Invoice[],
  limit = 3,
  becauseNoCost = false,
  range: QueryRange = "all",
): string {
  if (invoices.length === 0) return "هنوز فاکتور فروشی ثبت نشده است.";
  const rows = topSellingProducts(productList, invoices, limit);
  if (rows.length === 0) return "در فاکتورهای ثبت‌شده قلمی برای محاسبه پیدا نشد.";
  const note = becauseNoCost
    ? "برای محاسبه‌ی سود، «قیمت خرید» کالاها ثبت نشده — فعلاً بر اساس بیشترین فروش:\n"
    : "";
  const head = `پرفروش‌ترین کالا${rankingScopeNote(range)}: ${productLine(rows[0], "qty")}`;
  const rest = rows.slice(1).map((r, i) => `${formatNumber(i + 2)}. ${productLine(r, "qty")}`);
  return note + [head, ...rest].join("\n");
}

export function bestCustomersText(
  customerList: Customer[],
  invoices: Invoice[],
  limit = 3,
  range: QueryRange = "all",
): string {
  const rows = bestCustomers(customerList, invoices, limit);
  if (rows.length === 0) return "هنوز فاکتوری به نام مشتری ثبت نشده تا بهترین مشتری مشخص شود.";
  const line = (r: CustomerSalesRow) =>
    `${r.name} — ${formatToman(r.total)} در ${formatNumber(r.count)} فاکتور`;
  const head = `بهترین مشتری${rankingScopeNote(range)}: ${line(rows[0])}`;
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

export function creditorsText(customerList: Customer[], limit = 3): string {
  const s = creditorsSummary(customerList, limit);
  if (s.count === 0) return "هیچ طلبکاری ندارید — به کسی بدهکار نیستید. 👌";
  const head = `${formatNumber(s.count)} طلبکار دارید — جمع طلب آن‌ها ${formatToman(s.total)}`;
  const rest = s.top.map((d) => `• ${d.name}: ${formatToman(-d.balance)}`);
  return [head, ...rest].join("\n");
}

export function todaysSalesText(
  invoices: Invoice[],
  now = Date.now(),
  ledger?: ManualLedgerEntry[],
): string {
  const { total, count } = todaysSalesTotal(invoices, now);
  const man = manualLedgerTotals(ledgerInRange(ledger, "today", now)).sales;
  if (count === 0 && man <= 0) return "امروز هنوز فاکتور یا فروش دستی‌ای ثبت نشده است.";
  if (count === 0) return `فروش امروز: ${formatToman(man)} (ثبت دستی، بدون فاکتور)`;
  if (man <= 0) return `فروش امروز: ${formatToman(total)} در ${formatNumber(count)} فاکتور`;
  return `فروش امروز: ${formatToman(total + man)} — فاکتور ${formatToman(total)} (${formatNumber(count)} فاکتور) + دستی ${formatToman(man)}`;
}

export function thisMonthExpensesText(expenseList: Expense[], now = Date.now()): string {
  const total = thisMonthExpensesTotal(expenseList, now);
  if (total <= 0) return "برای این ماه هزینه‌ای ثبت نشده است.";
  return `جمع هزینه‌های این ماه: ${formatToman(total)}`;
}

export function salesText(
  invoices: Invoice[],
  range: QueryRange,
  now: number,
  ledger?: ManualLedgerEntry[],
): string {
  const { total, count } = salesTotal(invoices, range, now);
  const man = manualLedgerTotals(ledgerInRange(ledger, range, now)).sales;
  const label = rangePhrase(range);
  if (count === 0 && man <= 0) {
    return range === "today"
      ? "امروز هنوز فاکتور یا فروش دستی‌ای ثبت نشده است."
      : `${label} فاکتور یا فروش دستی‌ای ثبت نشده است.`;
  }
  if (count === 0) return `فروش ${label}: ${formatToman(man)} (ثبت دستی، بدون فاکتور)`;
  if (man <= 0) return `فروش ${label}: ${formatToman(total)} در ${formatNumber(count)} فاکتور`;
  return `فروش ${label}: ${formatToman(total + man)} — فاکتور ${formatToman(total)} (${formatNumber(count)} فاکتور) + دستی ${formatToman(man)}`;
}

export function expensesText(expenseList: Expense[], range: QueryRange, now: number): string {
  const total = expensesTotal(expenseList, range, now);
  const label = rangePhrase(range);
  if (total <= 0) {
    return range === "month"
      ? "برای این ماه هزینه‌ای ثبت نشده است."
      : `${label} هزینه‌ای ثبت نشده است.`;
  }
  return `جمع هزینه‌های ${label}: ${formatToman(total)}`;
}

export function profitText(
  productList: Product[],
  invoices: Invoice[],
  range: QueryRange,
  now: number,
  ledger?: ManualLedgerEntry[],
): string {
  const scoped = invoicesInRange(invoices, range, now);
  const man = manualLedgerTotals(ledgerInRange(ledger, range, now));
  const label = rangePhrase(range);
  if (scoped.length === 0 && man.profit <= 0 && man.sales <= 0) {
    return range === "today"
      ? "امروز هنوز فاکتور یا سود دستی‌ای ثبت نشده تا سود محاسبه شود."
      : `${label} فاکتور یا سود دستی‌ای ثبت نشده تا سود محاسبه شود.`;
  }
  const s =
    scoped.length > 0
      ? totalProfit(productList, scoped)
      : { profit: 0, sales: 0, count: 0, missingCost: false };
  const combined = s.profit + man.profit;
  const parts: string[] = [];
  if (scoped.length > 0 && !s.missingCost) parts.push(`فاکتور ${formatToman(s.profit)}`);
  if (man.profit > 0) parts.push(`دستی ${formatToman(man.profit)}`);
  if (scoped.length > 0 && s.missingCost && man.profit <= 0) {
    return (
      `${label} فروش ${formatToman(s.sales)} بود، ولی چون قیمت خرید کالاها ثبت نشده سود فاکتور قابل محاسبه نیست.` +
      (man.sales > 0 ? ` فروش دستی: ${formatToman(man.sales)}.` : "")
    );
  }
  if (parts.length === 0) {
    return man.sales > 0
      ? `${label} فروش دستی ${formatToman(man.sales)} ثبت شده، ولی سود دستی نوشته نشده است.`
      : `سود ${label} هنوز قابل محاسبه نیست.`;
  }
  const extra = scoped.length > 0 ? ` (از ${formatNumber(s.count)} فاکتور)` : "";
  return (
    `سود ${label}: ${formatToman(combined)}${extra}` +
    (parts.length > 1 ? ` — ${parts.join(" + ")}` : "")
  );
}

export function netProfitText(
  productList: Product[],
  invoices: Invoice[],
  expenseList: Expense[],
  range: QueryRange,
  now: number,
  ledger?: ManualLedgerEntry[],
): string {
  const scopedInv = invoicesInRange(invoices, range, now);
  const exp = expensesTotal(expenseList, range, now);
  const man = manualLedgerTotals(ledgerInRange(ledger, range, now));
  const label = rangePhrase(range);
  if (scopedInv.length === 0 && exp <= 0 && man.profit <= 0 && man.sales <= 0) {
    return `${label} هنوز فروش یا هزینه‌ای ثبت نشده است.`;
  }
  const s =
    scopedInv.length > 0
      ? totalProfit(productList, scopedInv)
      : { profit: 0, sales: 0, count: 0, missingCost: false };
  if (s.missingCost && scopedInv.length > 0 && man.profit <= 0) {
    return `${label} فروش ${formatToman(s.sales)} و هزینه ${formatToman(exp)} بود، ولی بدون قیمت خرید نمی‌توان سود خالص فاکتور را حساب کرد.`;
  }
  const net = s.profit + man.profit - exp;
  const sign = net < 0 ? "زیان" : "سود خالص";
  const manBit = man.profit > 0 ? ` + سود دستی ${formatToman(man.profit)}` : "";
  return `${sign} ${label}: ${formatToman(Math.abs(net))} — سود فروش ${formatToman(s.profit)}${manBit} منهای هزینه ${formatToman(exp)}`;
}

export function invoiceCountText(invoices: Invoice[], range: QueryRange, now: number): string {
  const { total, count } = salesTotal(invoices, range, now);
  const label = rangePhrase(range);
  if (count === 0) return `${label} فاکتوری ثبت نشده است.`;
  return `${label} ${formatNumber(count)} فاکتور ثبت شده — جمع فروش ${formatToman(total)}`;
}

export function customerStatusText(customerList: Customer[], name: string): string {
  const c = matchCustomerByName(name, customerList);
  if (!c) return `مشتری‌ای با نام «${name}» پیدا نشد.`;
  const full = customerFullName(c);
  const balance = customerBalance(c);
  if (balance > 0) return `«${full}» بدهکار است — مانده ${formatToman(balance)}`;
  if (balance < 0) return `«${full}» طلبکار است — طلب ایشان ${formatToman(-balance)}`;
  return `حساب «${full}» تسویه است — مانده صفر.`;
}

export function lowStockText(productList: Product[]): string {
  const out = productList.filter((p) => stockStatus(p) === "out");
  const low = productList.filter((p) => stockStatus(p) === "low");
  if (out.length === 0 && low.length === 0) return "همه‌ی کالاها موجودی کافی دارند. 👌";
  const lines: string[] = [];
  if (out.length > 0) {
    lines.push(
      `${formatNumber(out.length)} کالا تمام شده: ${out
        .slice(0, 4)
        .map((p) => p.name)
        .join("، ")}`,
    );
  }
  if (low.length > 0) {
    lines.push(
      `${formatNumber(low.length)} کالا رو به اتمام: ${low
        .slice(0, 4)
        .map((p) => `${p.name} (${formatNumber(p.stock)})`)
        .join("، ")}`,
    );
  }
  return lines.join("\n");
}

export function snapshotText(
  productList: Product[],
  invoices: Invoice[],
  expenseList: Expense[],
  customerList: Customer[],
  range: QueryRange,
  now: number,
  ledger?: ManualLedgerEntry[],
): string {
  const scoped = invoicesInRange(invoices, range, now);
  const s = totalProfit(productList, scoped);
  const exp = expensesTotal(expenseList, range, now);
  const man = manualLedgerTotals(ledgerInRange(ledger, range, now));
  const debts = debtorsSummary(customerList, 1);
  const label = rangePhrase(range);
  const profitPart =
    s.missingCost && man.profit <= 0
      ? `سود فاکتور: نامشخص (قیمت خرید ثبت نشده)`
      : `سود: ${formatToman(s.profit + man.profit)}`;
  const salesLine =
    man.sales > 0
      ? `فروش ${formatToman(s.sales + man.sales)} — فاکتور ${formatToman(s.sales)} در ${formatNumber(s.count)} فاکتور + دستی ${formatToman(man.sales)}`
      : `فروش ${formatToman(s.sales)} در ${formatNumber(s.count)} فاکتور`;
  return [
    `گزارش ${label}:`,
    salesLine,
    profitPart,
    `هزینه ${formatToman(exp)}`,
    debts.count > 0
      ? `${formatNumber(debts.count)} بدهکار — جمع ${formatToman(debts.total)}`
      : "بدهکاری ندارید",
  ].join("\n");
}

/** پاسخ آماده برای یک نیت پرسشی — هیچ داده‌ای تغییر نمی‌کند (فقط خواندن) */
export function buildQueryAnswer(spec: QuerySpec, ctx: QueryContext): string {
  const now = ctx.now ?? Date.now();
  const range = resolveRange(spec.kind, spec.range);
  const invoices = invoicesInRange(ctx.invoices, range, now);

  switch (spec.kind) {
    case "most_profitable":
      return mostProfitableProductsText(ctx.products, invoices, 3, range);
    case "least_profitable":
      return leastProfitableProductsText(ctx.products, invoices, 3, range);
    case "best_customers":
      return bestCustomersText(ctx.customers, invoices, 3, range);
    case "top_selling":
      return topSellingProductsText(ctx.products, invoices, 3, false, range);
    case "debtors":
      return debtorsText(ctx.customers);
    case "creditors":
      return creditorsText(ctx.customers);
    case "today_sales":
      return todaysSalesText(ctx.invoices, now, ctx.manualLedger);
    case "month_expenses":
      return thisMonthExpensesText(ctx.expenses, now);
    case "profit":
      return profitText(ctx.products, ctx.invoices, range, now, ctx.manualLedger);
    case "net_profit":
      return netProfitText(ctx.products, ctx.invoices, ctx.expenses, range, now, ctx.manualLedger);
    case "sales":
      return salesText(ctx.invoices, range, now, ctx.manualLedger);
    case "expenses":
      return expensesText(ctx.expenses, range, now);
    case "invoice_count":
      return invoiceCountText(ctx.invoices, range, now);
    case "customer_status":
      return customerStatusText(ctx.customers, spec.customerName || "");
    case "low_stock":
      return lowStockText(ctx.products);
    case "snapshot":
      return snapshotText(
        ctx.products,
        ctx.invoices,
        ctx.expenses,
        ctx.customers,
        range,
        now,
        ctx.manualLedger,
      );
  }
}
