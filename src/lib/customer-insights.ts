/**
 * آمار و بینش پروندهٔ مشتری (CRM) — توابع خالص و سریع.
 * ورودی فقط فاکتورهای همین مشتری است (از buildCustomerDocIndex)، پس با هزاران
 * مشتری و فاکتور هم هزینهٔ باز کردن پرونده کوچک می‌ماند.
 */
import type { Customer, CustomerTx, Invoice, PaymentMethod, Product, Purchase } from "./store";
import { discountFactor, invoiceTotals, lineTotal, purchaseTotals } from "./invoice-math.ts";
import { normalizeSearchText } from "./search.ts";

const DAY = 86_400_000;

export type CustomerStatus = "new" | "active" | "slipping" | "lost" | "none";

export type CustomerInsights = {
  invoiceCount: number;
  salesTotal: number;
  avgInvoice: number;
  /** سود ناخالص (فقط اقلامی که قیمت خرید دارند) */
  profit: number;
  profitKnown: boolean;
  firstAt: number | null;
  lastAt: number | null;
  daysSinceLast: number | null;
  /** میانگین فاصلهٔ خریدها (روز) — حداقل سه فاکتور لازم است */
  avgGapDays: number | null;
  /** مانده‌ی پرداخت‌نشدهٔ فاکتورهای نسیه/چک (از روی خود فاکتورها) */
  invoiceRemaining: number;
  paymentMix: Partial<Record<PaymentMethod, number>>;
  topProducts: { productId: string; name: string; unit?: string; qty: number; revenue: number }[];
  /** ۱۲ ماه اخیر (قدیم → جدید) */
  monthly: { key: string; total: number }[];
  purchaseCount: number;
  purchaseTotal: number;
  status: CustomerStatus;
};

export function monthKey(ts: number, toJalali: (t: number) => { jy: number; jm: number } | null) {
  const j = toJalali(ts);
  return j ? `${j.jy}/${String(j.jm).padStart(2, "0")}` : "";
}

/** وضعیت مشتری بر اساس آخرین خرید و ریتم معمولش */
export function customerStatus(
  invoiceCount: number,
  daysSinceLast: number | null,
  avgGapDays: number | null,
  createdDaysAgo: number,
): CustomerStatus {
  if (invoiceCount === 0 || daysSinceLast == null) return createdDaysAgo <= 30 ? "new" : "none";
  if (invoiceCount <= 1 && daysSinceLast <= 30) return "new";
  const rhythm = Math.max(avgGapDays ?? 30, 7);
  if (daysSinceLast <= rhythm * 1.5 && daysSinceLast <= 90) return "active";
  if (daysSinceLast <= Math.max(rhythm * 3, 120)) return "slipping";
  return "lost";
}

export function customerInsights(
  customer: Customer,
  invoices: readonly Invoice[],
  purchases: readonly Purchase[],
  products: readonly Product[],
  toJalali: (t: number) => { jy: number; jm: number } | null,
  now = Date.now(),
): CustomerInsights {
  const buy = new Map(products.map((p) => [p.id, p.buyPrice]));
  let salesTotal = 0;
  let profit = 0;
  let profitKnown = false;
  let invoiceRemaining = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  const paymentMix: Partial<Record<PaymentMethod, number>> = {};
  const prod = new Map<
    string,
    { productId: string; name: string; unit?: string; qty: number; revenue: number }
  >();
  const byMonth = new Map<string, number>();
  const times: number[] = [];

  for (const inv of invoices) {
    const t = invoiceTotals(inv);
    salesTotal += t.total;
    invoiceRemaining += t.remaining;
    const pm = inv.paymentMethod ?? "cash";
    paymentMix[pm] = (paymentMix[pm] ?? 0) + 1;
    times.push(inv.createdAt);
    firstAt = firstAt == null ? inv.createdAt : Math.min(firstAt, inv.createdAt);
    lastAt = lastAt == null ? inv.createdAt : Math.max(lastAt, inv.createdAt);
    const mk = monthKey(inv.createdAt, toJalali);
    if (mk) byMonth.set(mk, (byMonth.get(mk) ?? 0) + t.total);
    const factor = discountFactor(inv);
    for (const it of inv.items) {
      const revenue = lineTotal(it) * factor;
      const cost = it.buyPrice ?? buy.get(it.productId);
      if (typeof cost === "number" && cost > 0) {
        profit += revenue - cost * it.quantity;
        profitKnown = true;
      }
      const key = it.productId || it.name;
      const cur = prod.get(key) ?? {
        productId: it.productId,
        name: it.name,
        unit: it.unit,
        qty: 0,
        revenue: 0,
      };
      cur.qty += Number(it.quantity) || 0;
      cur.revenue += revenue;
      cur.name = it.name || cur.name;
      prod.set(key, cur);
    }
  }

  times.sort((a, b) => a - b);
  let avgGapDays: number | null = null;
  if (times.length >= 3) {
    avgGapDays = Math.round((times[times.length - 1] - times[0]) / DAY / (times.length - 1));
  }
  const daysSinceLast = lastAt == null ? null : Math.max(0, Math.floor((now - lastAt) / DAY));

  // ۱۲ ماه اخیر شمسی (قدیم → جدید)
  const monthly: { key: string; total: number }[] = [];
  const nowJ = toJalali(now);
  if (nowJ) {
    let y = nowJ.jy;
    let m = nowJ.jm;
    for (let i = 0; i < 12; i++) {
      const key = `${y}/${String(m).padStart(2, "0")}`;
      monthly.unshift({ key, total: Math.round(byMonth.get(key) ?? 0) });
      m -= 1;
      if (m === 0) {
        m = 12;
        y -= 1;
      }
    }
  }

  let purchaseTotal = 0;
  for (const p of purchases) purchaseTotal += purchaseTotals(p).total;

  return {
    invoiceCount: invoices.length,
    salesTotal,
    avgInvoice: invoices.length ? Math.round(salesTotal / invoices.length) : 0,
    profit: Math.round(profit),
    profitKnown,
    firstAt,
    lastAt,
    daysSinceLast,
    avgGapDays,
    invoiceRemaining,
    paymentMix,
    topProducts: [...prod.values()]
      .map((p) => ({ ...p, revenue: Math.round(p.revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5),
    monthly,
    purchaseCount: purchases.length,
    purchaseTotal,
    status: customerStatus(
      invoices.length,
      daysSinceLast,
      avgGapDays,
      Math.floor((now - (customer.createdAt || now)) / DAY),
    ),
  };
}

export type LedgerRow = { tx: CustomerTx; balance: number };

/**
 * دفتر حساب با ماندهٔ جاری: از قدیم به جدید جمع زده می‌شود و جدیدترین اول برمی‌گردد.
 * مانده مثبت = بدهکار به فروشگاه، منفی = طلبکار.
 */
export function ledgerWithBalance(customer: Pick<Customer, "txs">): LedgerRow[] {
  const asc = [...(customer.txs ?? [])].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  let bal = 0;
  const rows = asc.map((tx) => {
    bal += tx.type === "debt" ? tx.amount : -tx.amount;
    return { tx, balance: bal };
  });
  return rows.reverse();
}

export type DocFilter = {
  q?: string;
  kind?: "all" | "sales" | "purchases";
  payment?: "all" | PaymentMethod | "open";
  /** روز اخیر؛ ۰ یعنی همه */
  days?: number;
};

export type CustomerDoc = { kind: "sale"; doc: Invoice } | { kind: "purchase"; doc: Purchase };

export function filterCustomerDocs(
  invoices: readonly Invoice[],
  purchases: readonly Purchase[],
  f: DocFilter,
  now = Date.now(),
): CustomerDoc[] {
  const q = normalizeSearchText(f.q);
  const since = f.days ? now - f.days * DAY : 0;
  const out: CustomerDoc[] = [];
  const textOk = (parts: (string | undefined)[]) =>
    !q || parts.some((p) => normalizeSearchText(p).includes(q));
  if (f.kind !== "purchases") {
    for (const inv of invoices) {
      if (inv.createdAt < since) continue;
      if (f.payment === "open") {
        if (invoiceTotals(inv).remaining <= 0) continue;
      } else if (f.payment && f.payment !== "all" && (inv.paymentMethod ?? "cash") !== f.payment) {
        continue;
      }
      if (!textOk([inv.id, inv.notes, ...inv.items.map((i) => i.name)])) continue;
      out.push({ kind: "sale", doc: inv });
    }
  }
  if (f.kind !== "sales") {
    for (const p of purchases) {
      if (p.createdAt < since) continue;
      if (f.payment === "open") continue;
      if (f.payment && f.payment !== "all" && (p.paymentMethod ?? "cash") !== f.payment) continue;
      if (!textOk([p.id, p.note, ...p.items.map((i) => i.name)])) continue;
      out.push({ kind: "purchase", doc: p });
    }
  }
  return out.sort((a, b) => b.doc.createdAt - a.doc.createdAt);
}

/** متن «صورت‌حساب» برای ارسال به مشتری (پیامک/واتساپ/اشتراک) */
export function statementText(
  customer: Customer,
  shopName: string,
  fmtMoney: (n: number) => string,
  fmtDate: (t: number) => string,
  limit = 8,
): string {
  const rows = ledgerWithBalance(customer);
  const balance = rows[0]?.balance ?? 0;
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  const lines = [
    `صورت‌حساب ${name} — ${shopName || "فروشگاه"}`,
    `تاریخ: ${fmtDate(Date.now())}`,
    "─────────────",
    ...rows
      .slice(0, limit)
      .reverse()
      .map(
        (r) =>
          `${fmtDate(r.tx.at)}  ${r.tx.type === "debt" ? "بدهی" : "پرداخت"} ${fmtMoney(r.tx.amount)}${r.tx.note ? ` (${r.tx.note})` : ""}`,
      ),
    rows.length > limit ? `… و ${(rows.length - limit).toLocaleString("fa-IR")} ردیف قدیمی‌تر` : "",
    "─────────────",
    balance > 0
      ? `مانده بدهی شما: ${fmtMoney(balance)}`
      : balance < 0
        ? `مانده طلب شما از ما: ${fmtMoney(-balance)}`
        : "حساب شما تسویه است. سپاس 🌷",
  ];
  return lines.filter(Boolean).join("\n");
}
