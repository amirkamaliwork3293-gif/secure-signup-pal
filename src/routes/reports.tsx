import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  invoice,
  products,
  formatToman,
  formatNumber,
  PAYMENT_LABEL,
  formatJalaliDate,
  parseJalaliInput,
  jalaliToTimestamp,
  toJalali,
  expenses as expensesStore,
  expensesTotal,
  expensesByCategory,
  manualLedger as ledgerStore,
  manualLedgerTotals,
  emptyManualLedger,
  parseNumberInput,
  toJalaliInputDate,
  cryptoId,
  MANUAL_LEDGER_LABEL,
  type Invoice,
  type PaymentMethod,
  type ManualLedgerEntry,
  type ManualLedgerKind,
} from "@/lib/store";
import { discountFactor, lineTotal, invoiceTotals } from "@/lib/invoice-math";
import { JalaliDateSelect } from "@/components/JalaliPickers";
import {
  BarChart3,
  Calendar,
  CalendarDays,
  CalendarRange,
  Wallet,
  CreditCard,
  Clock,
  TrendingUp,
  TrendingDown,
  Package,
  FileCheck,
  CalendarSearch,
  PieChart,
  NotebookPen,
  Plus,
  Pencil,
  Trash2,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "گزارش سود و درآمد | KAMIX" },
      { name: "description", content: "گزارش روزانه، ماهانه و سالانه درآمد و سود به تفکیک محصول." },
    ],
  }),
  component: ReportsPage,
});

type Range = "today" | "month" | "year" | "all" | "custom";

function startOfDay() {
  const j = toJalali(Date.now());
  if (!j) return 0;
  return jalaliToTimestamp(j.jy, j.jm, j.jd, 0, 0);
}
// بازه‌ی ماه/سال بر اساس تقویم شمسی محاسبه می‌شود (نه میلادی) چون تاریخ‌ها در کل
// برنامه شمسی نمایش داده و ذخیره می‌شوند.
function startOfMonth(d = new Date()) {
  const j = toJalali(d.getTime());
  if (!j) return 0;
  return jalaliToTimestamp(j.jy, j.jm, 1, 0, 0);
}
function startOfYear(d = new Date()) {
  const j = toJalali(d.getTime());
  if (!j) return 0;
  return jalaliToTimestamp(j.jy, 1, 1, 0, 0);
}

function summarize(list: Invoice[]) {
  const by: Record<PaymentMethod | "unknown", { count: number; total: number }> = {
    cash: { count: 0, total: 0 },
    card: { count: 0, total: 0 },
    credit: { count: 0, total: 0 },
    check: { count: 0, total: 0 },
    unknown: { count: 0, total: 0 },
  };
  let total = 0;
  for (const inv of list) {
    const m = (inv.paymentMethod ?? "unknown") as keyof typeof by;
    // مبلغ همیشه از روی اقلام و تخفیف بازمحاسبه می‌شود تا فاکتورهای قدیمی یا
    // ویرایش‌شده هم دقیقاً همان عددی را نشان بدهند که روی فاکتور چاپ می‌شود.
    const t = invoiceTotals(inv).total;
    by[m].count += 1;
    by[m].total += t;
    total += t;
  }
  return { by, total, count: list.length };
}

type ProfitSummary = {
  profit: number;
  /** تعداد اقلامی که قیمت خرید نداشتند و در سود لحاظ نشدند */
  missingCost: number;
  perProduct: {
    productId: string;
    name: string;
    qty: number;
    revenue: number;
    profit: number;
    hasCost: boolean;
  }[];
};

/**
 * محاسبه سود: (قیمت فروش − قیمت خرید) × تعداد
 * قیمت خرید در لحظه فروش روی آیتم ذخیره می‌شود؛ برای فاکتورهای قدیمی از قیمت
 * خرید فعلی محصول استفاده می‌شود.
 */
function computeProfit(list: Invoice[]): ProfitSummary {
  const productBuy = new Map<string, number | undefined>();
  for (const p of products.getAll()) productBuy.set(p.id, p.buyPrice);

  const per = new Map<string, ProfitSummary["perProduct"][number]>();
  let profit = 0;
  let missingCost = 0;

  for (const inv of list) {
    // تخفیفِ کل فاکتور روی ردیف‌ها سرشکن می‌شود تا درآمد و سودِ گزارش با پولی
    // که واقعاً دریافت شده بخواند (قبلاً تخفیف نادیده گرفته می‌شد و سود بیشتر
    // از واقعیت نشان داده می‌شد).
    const factor = discountFactor(inv);
    for (const item of inv.items) {
      const cost = item.buyPrice ?? productBuy.get(item.productId);
      const revenue = lineTotal(item) * factor;
      const hasCost = typeof cost === "number" && cost > 0;
      const itemProfit = hasCost ? revenue - cost! * item.quantity : 0;
      if (hasCost) profit += itemProfit;
      else missingCost++;

      const prev = per.get(item.productId) ?? {
        productId: item.productId,
        name: item.name,
        qty: 0,
        revenue: 0,
        profit: 0,
        hasCost: false,
      };
      per.set(item.productId, {
        ...prev,
        name: item.name,
        qty: prev.qty + item.quantity,
        revenue: prev.revenue + revenue,
        profit: prev.profit + itemProfit,
        hasCost: prev.hasCost || hasCost,
      });
    }
  }

  const perProduct = Array.from(per.values())
    .map((p) => ({ ...p, revenue: Math.round(p.revenue), profit: Math.round(p.profit) }))
    .sort((a, b) => b.profit - a.profit);
  return { profit: Math.round(profit), missingCost, perProduct };
}

type DayRow = { key: string; invoice: number; manualSales: number; manualProfit: number };

function daysInMonthBreakdown(list: Invoice[], ledger: ManualLedgerEntry[]): DayRow[] {
  const map = new Map<string, Omit<DayRow, "key">>();
  const bump = (key: string) => {
    const prev = map.get(key) ?? { invoice: 0, manualSales: 0, manualProfit: 0 };
    map.set(key, prev);
    return prev;
  };
  for (const inv of list) {
    bump(formatJalaliDate(inv.createdAt)).invoice += invoiceTotals(inv).total;
  }
  for (const e of ledger) {
    const row = bump(formatJalaliDate(e.at));
    if (e.kind === "sales") row.manualSales += e.amount || 0;
    else if (e.kind === "profit") row.manualProfit += e.amount || 0;
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => (a.key < b.key ? 1 : -1))
    .slice(0, 31);
}

const RANGE_LABEL: Record<Range, string> = {
  today: "امروز",
  month: "این ماه",
  year: "امسال",
  all: "کل",
  custom: "بازه دلخواه",
};

function ReportsPageInner() {
  const [history] = invoice.useHistory();
  const [expenseList] = expensesStore.useAll();
  const [ledgerList] = ledgerStore.useAll();
  const [range, setRange] = useState<Range>("today");
  const [fromStr, setFromStr] = useState<string>("");
  const [toStr, setToStr] = useState<string>("");
  const [rangeErr, setRangeErr] = useState<string | null>(null);

  const customRange = useMemo(() => {
    if (range !== "custom") return null;
    const from = parseJalaliInput(fromStr);
    const to = parseJalaliInput(toStr);
    if (!from || !to) return null;
    const fromTs = jalaliToTimestamp(from.jy, from.jm, from.jd, 0, 0);
    const toTs = jalaliToTimestamp(to.jy, to.jm, to.jd, 23, 59) + 59_999;
    if (fromTs > toTs) return null;
    return { fromTs, toTs };
  }, [range, fromStr, toStr]);

  const filtered = useMemo(() => {
    if (range === "all") return history;
    if (range === "custom") {
      if (!customRange) return [];
      return history.filter(
        (i) => i.createdAt >= customRange.fromTs && i.createdAt <= customRange.toTs,
      );
    }
    const from =
      range === "today" ? startOfDay() : range === "month" ? startOfMonth() : startOfYear();
    return history.filter((i) => i.createdAt >= from);
  }, [history, range, customRange]);

  const summary = summarize(filtered);
  const profitSummary = useMemo(() => computeProfit(filtered), [filtered]);

  const filteredExpenses = useMemo(() => {
    if (range === "all") return expenseList;
    if (range === "custom") {
      if (!customRange) return [];
      return expenseList.filter((e) => e.at >= customRange.fromTs && e.at <= customRange.toTs);
    }
    const from =
      range === "today" ? startOfDay() : range === "month" ? startOfMonth() : startOfYear();
    return expenseList.filter((e) => e.at >= from);
  }, [expenseList, range, customRange]);

  const expensesSum = useMemo(() => expensesTotal(filteredExpenses), [filteredExpenses]);
  const expenseCats = useMemo(() => expensesByCategory(filteredExpenses), [filteredExpenses]);

  const filteredLedger = useMemo(() => {
    if (range === "all") return ledgerList;
    if (range === "custom") {
      if (!customRange) return [];
      return ledgerList.filter((e) => e.at >= customRange.fromTs && e.at <= customRange.toTs);
    }
    const from =
      range === "today" ? startOfDay() : range === "month" ? startOfMonth() : startOfYear();
    return ledgerList.filter((e) => e.at >= from);
  }, [ledgerList, range, customRange]);

  const ledgerTotals = useMemo(() => manualLedgerTotals(filteredLedger), [filteredLedger]);
  const combinedSales = summary.total + ledgerTotals.sales;
  const combinedProfit = profitSummary.profit + ledgerTotals.profit;
  const netProfit = combinedProfit - expensesSum;

  const daily = useMemo(() => {
    const from = startOfMonth();
    return daysInMonthBreakdown(
      history.filter((i) => i.createdAt >= from),
      ledgerList.filter((e) => e.at >= from),
    );
  }, [history, ledgerList]);

  const maxDay = Math.max(1, ...daily.map((d) => d.invoice + d.manualSales));

  const RangeButton = ({ value, icon: Icon }: { value: Range; icon: typeof Calendar }) => (
    <button
      type="button"
      onClick={() => {
        setRange(value);
        if (value === "custom") {
          setFromStr((prev) => prev || toJalaliInputDate(startOfMonth()));
          setToStr((prev) => prev || toJalaliInputDate(Date.now()));
        }
      }}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium transition ${
        range === value
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-background border border-border text-muted-foreground hover:bg-accent"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {RANGE_LABEL[value]}
    </button>
  );

  const profitPositive = combinedProfit >= 0;

  return (
    <Layout>
      <h1 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <BarChart3 className="h-5 w-5 text-primary" />
        گزارش سود و درآمد
      </h1>

      <div className="mb-4 flex gap-2">
        <RangeButton value="today" icon={Calendar} />
        <RangeButton value="month" icon={CalendarDays} />
        <RangeButton value="year" icon={CalendarRange} />
        <RangeButton value="all" icon={Clock} />
        <RangeButton value="custom" icon={CalendarSearch} />
      </div>

      {range === "custom" && (
        <div className="mb-4 rounded-2xl border border-border bg-card p-3 shadow-card">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
            <CalendarSearch className="h-3.5 w-3.5 text-primary" />
            انتخاب بازه (تاریخ شمسی)
          </div>
          <div className="flex flex-col gap-3">
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">از تاریخ</span>
              <JalaliDateSelect
                value={fromStr}
                onChange={(v) => {
                  setFromStr(v);
                  setRangeErr(null);
                }}
                yearsBack={5}
                yearsForward={0}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">تا تاریخ</span>
              <JalaliDateSelect
                value={toStr}
                onChange={(v) => {
                  setToStr(v);
                  setRangeErr(null);
                }}
                yearsBack={5}
                yearsForward={0}
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const today = toJalaliInputDate(Date.now());
                  setFromStr(today);
                  setToStr(today);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent"
              >
                فقط امروز
              </button>
              <button
                type="button"
                onClick={() => {
                  setFromStr(toJalaliInputDate(startOfMonth()));
                  setToStr(toJalaliInputDate(Date.now()));
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent"
              >
                از اول ماه
              </button>
              <button
                type="button"
                onClick={() => {
                  setFromStr(toJalaliInputDate(startOfYear()));
                  setToStr(toJalaliInputDate(Date.now()));
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent"
              >
                از اول سال
              </button>
            </div>
          </div>
          {range === "custom" && !customRange && (fromStr || toStr) && (
            <div className="mt-2 text-[11px] text-destructive">
              بازه نامعتبر است. تاریخ شروع باید قبل از تاریخ پایان باشد.
            </div>
          )}
          {customRange && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              نمایش از {formatJalaliDate(customRange.fromTs)} تا{" "}
              {formatJalaliDate(customRange.toTs)}
            </div>
          )}
          {rangeErr && <div className="mt-2 text-[11px] text-destructive">{rangeErr}</div>}
        </div>
      )}

      {/* درآمد + سود — فاکتور و ثبت دستی با هم */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <section className="rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-elegant">
          <div className="text-xs opacity-80">مجموع درآمد ({RANGE_LABEL[range]})</div>
          <div className="mt-1 text-lg font-bold">{formatToman(combinedSales)}</div>
          <div className="mt-0.5 text-xs opacity-80">
            {formatNumber(summary.count)} فاکتور
            {ledgerTotals.sales > 0 ? ` + ${formatToman(ledgerTotals.sales)} دستی` : ""}
          </div>
        </section>
        <section
          className={`rounded-2xl border p-4 shadow-card ${profitPositive ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}
        >
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {profitPositive ? (
              <TrendingUp className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-destructive" />
            )}
            سود ({RANGE_LABEL[range]})
          </div>
          <div
            className={`mt-1 text-lg font-bold ${profitPositive ? "text-green-600" : "text-destructive"}`}
          >
            {formatToman(combinedProfit)}
          </div>
          {profitSummary.missingCost > 0 && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {formatNumber(profitSummary.missingCost)} قلم بدون قیمت خرید
            </div>
          )}
          {ledgerTotals.profit > 0 && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              شامل {formatToman(ledgerTotals.profit)} سود دستی
            </div>
          )}
        </section>
      </div>

      {/* هزینه‌ها و سود خالص */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Wallet className="h-3.5 w-3.5 text-primary" />
            هزینه‌ها ({RANGE_LABEL[range]})
          </div>
          <div className="mt-1 text-lg font-bold text-destructive">{formatToman(expensesSum)}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {formatNumber(filteredExpenses.length)} مورد
          </div>
        </section>
        <section
          className={`rounded-2xl border p-4 shadow-card ${netProfit >= 0 ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}
        >
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {netProfit >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-destructive" />
            )}
            سود خالص (پس از هزینه‌ها)
          </div>
          <div
            className={`mt-1 text-lg font-bold ${netProfit >= 0 ? "text-green-600" : "text-destructive"}`}
          >
            {formatToman(netProfit)}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            سود فروش (فاکتور + دستی) − هزینه‌ها
          </div>
        </section>
      </div>

      {expenseCats.length > 0 && (
        <section className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <PieChart className="h-4 w-4 text-primary" />
            هزینه به تفکیک دسته ({RANGE_LABEL[range]})
          </h2>
          <ul className="space-y-2">
            {expenseCats.map(({ category, total: t }) => (
              <li key={category} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{category}</span>
                  <span className="font-semibold text-destructive">{formatToman(t)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive/70"
                    style={{ width: `${(t / Math.max(1, expensesSum)) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label={PAYMENT_LABEL.cash}
          total={summary.by.cash.total}
          count={summary.by.cash.count}
        />
        <SummaryCard
          icon={<CreditCard className="h-4 w-4" />}
          label={PAYMENT_LABEL.card}
          total={summary.by.card.total}
          count={summary.by.card.count}
        />
        <SummaryCard
          icon={<Clock className="h-4 w-4" />}
          label={PAYMENT_LABEL.credit}
          total={summary.by.credit.total}
          count={summary.by.credit.count}
        />
        <SummaryCard
          icon={<FileCheck className="h-4 w-4" />}
          label={PAYMENT_LABEL.check}
          total={summary.by.check.total}
          count={summary.by.check.count}
        />
      </div>

      {summary.by.unknown.count > 0 && (
        <div className="mb-4 rounded-xl border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          {formatNumber(summary.by.unknown.count)} فاکتور بدون روش پرداخت ثبت شده:{" "}
          <span className="font-semibold text-foreground">
            {formatToman(summary.by.unknown.total)}
          </span>
        </div>
      )}

      <ManualLedgerPanel rangeLabel={RANGE_LABEL[range]} entries={filteredLedger} />

      {/* سود به تفکیک محصول */}
      <section className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Package className="h-4 w-4 text-primary" />
          سود به تفکیک محصول ({RANGE_LABEL[range]})
        </h2>
        {profitSummary.perProduct.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            فروشی در این بازه ثبت نشده است.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {profitSummary.perProduct.slice(0, 20).map((p) => (
              <li
                key={p.productId}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatNumber(p.qty)} فروش · درآمد {formatToman(p.revenue)}
                  </div>
                </div>
                {p.hasCost ? (
                  <span
                    className={`shrink-0 font-bold ${p.profit >= 0 ? "text-green-600" : "text-destructive"}`}
                  >
                    {p.profit >= 0 ? "+" : ""}
                    {formatToman(p.profit)}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground">بدون قیمت خرید</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {profitSummary.missingCost > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            💡 برای محاسبه دقیق سود، «قیمت خرید» محصولات را در بخش محصولات (قیمت‌های تکمیلی) وارد
            کنید.
          </p>
        )}
      </section>
      <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <h2 className="mb-3 text-sm font-semibold">درآمد روزانه (۳۰ روز اخیر)</h2>
        {daily.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            داده‌ای برای نمایش وجود ندارد.
          </div>
        ) : (
          <ul className="space-y-2">
            {daily.map((row) => {
              const value = row.invoice + row.manualSales;
              const pct = (value / maxDay) * 100;
              return (
                <li key={row.key} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{row.key}</span>
                    <span className="font-semibold text-primary">{formatToman(value)}</span>
                  </div>
                  {(row.manualSales > 0 || row.manualProfit > 0) && (
                    <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                      {row.invoice > 0 && <span>فاکتور {formatToman(row.invoice)}</span>}
                      {row.manualSales > 0 && <span>دستی {formatToman(row.manualSales)}</span>}
                      {row.manualProfit > 0 && (
                        <span className="text-green-600">
                          سود دستی {formatToman(row.manualProfit)}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Layout>
  );
}

const KIND_HINT: Record<ManualLedgerKind, string> = {
  sales: "مبلغ فروش روز را بدون فاکتور بنویسید؛ در جمع درآمد ماه دیده می‌شود.",
  profit: "سود نقدی یا سود تخمینی روز را بنویسید؛ به سود فاکتورها اضافه می‌شود.",
  note: "یادداشت آزاد (با یا بدون مبلغ) برای مرور ماهانه.",
};

function ManualLedgerPanel({
  rangeLabel,
  entries,
}: {
  rangeLabel: string;
  entries: ManualLedgerEntry[];
}) {
  const [kind, setKind] = useState<ManualLedgerKind>("sales");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dateStr, setDateStr] = useState(() => toJalaliInputDate(Date.now()));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const totals = manualLedgerTotals(entries);
  const sorted = useMemo(() => [...entries].sort((a, b) => b.at - a.at), [entries]);

  const resetForm = (nextKind: ManualLedgerKind = kind) => {
    setKind(nextKind);
    setAmount("");
    setTitle("");
    setNote("");
    setDateStr(toJalaliInputDate(Date.now()));
    setEditingId(null);
    setFormErr(null);
  };

  const startEdit = (e: ManualLedgerEntry) => {
    setOpen(true);
    setEditingId(e.id);
    setKind(e.kind);
    setAmount(e.amount ? String(e.amount) : "");
    setTitle(e.title === MANUAL_LEDGER_LABEL[e.kind] ? "" : e.title);
    setNote(e.note ?? "");
    setDateStr(toJalaliInputDate(e.at));
    setFormErr(null);
  };

  const save = () => {
    const n = Math.max(0, Math.round(parseNumberInput(amount)));
    if (kind !== "note" && n <= 0) {
      setFormErr("مبلغ را وارد کنید.");
      return;
    }
    if (kind === "note" && n <= 0 && !title.trim() && !note.trim()) {
      setFormErr("برای یادداشت، متن یا مبلغ بنویسید.");
      return;
    }
    const jd = parseJalaliInput(dateStr) ?? toJalali(Date.now());
    if (!jd) {
      setFormErr("تاریخ نامعتبر است.");
      return;
    }
    const at = jalaliToTimestamp(jd.jy, jd.jm, jd.jd, 12, 0);
    const payload: ManualLedgerEntry = {
      ...(editingId
        ? (entries.find((x) => x.id === editingId) ?? emptyManualLedger(kind))
        : emptyManualLedger(kind)),
      id: editingId || cryptoId(),
      kind,
      amount: n,
      title: title.trim() || MANUAL_LEDGER_LABEL[kind],
      note: note.trim() || undefined,
      at,
      source: "manual",
      createdAt: editingId
        ? (entries.find((x) => x.id === editingId)?.createdAt ?? Date.now())
        : Date.now(),
    };
    if (editingId) ledgerStore.update(payload);
    else ledgerStore.add(payload);
    resetForm(kind);
    setOpen(false);
  };

  return (
    <section className="mb-4 rounded-2xl border border-primary/20 bg-card p-4 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <NotebookPen className="h-4 w-4 text-primary" />
            دفتر فروش و سود دستی
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            اگر فاکتور نمی‌زنید، فروش یا سود روز را همین‌جا بنویسید. در گزارش ماهانه و دستیار هوشمند
            هم جمع می‌شود.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (open) resetForm();
            setOpen((v) => !v);
          }}
          className="flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          {open ? "بستن" : "ثبت روز"}
        </button>
      </div>

      {(totals.sales > 0 || totals.profit > 0 || totals.count > 0) && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-background px-2.5 py-2 text-center">
            <div className="text-[10px] text-muted-foreground">فروش دستی ({rangeLabel})</div>
            <div className="mt-0.5 text-xs font-bold text-primary">{formatToman(totals.sales)}</div>
          </div>
          <div className="rounded-xl bg-background px-2.5 py-2 text-center">
            <div className="text-[10px] text-muted-foreground">سود دستی ({rangeLabel})</div>
            <div className="mt-0.5 text-xs font-bold text-green-600">
              {formatToman(totals.profit)}
            </div>
          </div>
          <div className="rounded-xl bg-background px-2.5 py-2 text-center">
            <div className="text-[10px] text-muted-foreground">تعداد ثبت</div>
            <div className="mt-0.5 text-xs font-bold">{formatNumber(totals.count)}</div>
          </div>
        </div>
      )}

      {open && (
        <div className="mb-3 space-y-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3">
          <div className="grid grid-cols-3 gap-1.5">
            {(["sales", "profit", "note"] as ManualLedgerKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setFormErr(null);
                }}
                className={`rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
                  kind === k
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                {k === "sales" ? "فروش" : k === "profit" ? "سود" : "یادداشت"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{KIND_HINT[kind]}</p>
          <label className="block text-[11px] text-muted-foreground">
            تاریخ
            <div className="mt-1">
              <JalaliDateSelect
                value={dateStr}
                onChange={setDateStr}
                yearsBack={2}
                yearsForward={0}
              />
            </div>
          </label>
          <label className="block text-[11px] text-muted-foreground">
            مبلغ (تومان){kind === "note" ? " — اختیاری" : ""}
            <input
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setFormErr(null);
              }}
              placeholder="مثلاً ۱۰۰۰۰۰۰۰۰"
              inputMode="numeric"
              dir="ltr"
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "note" ? "عنوان یادداشت" : "عنوان اختیاری (مثلاً فروش بازار)"}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="توضیح کوتاه (اختیاری)"
            rows={2}
            className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          {formErr && <div className="text-[11px] text-destructive">{formErr}</div>}
          <button
            type="button"
            onClick={save}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {editingId ? "ذخیره تغییرات" : "ثبت در دفتر"}
          </button>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-5 text-center text-xs text-muted-foreground">
          در این بازه ثبت دستی‌ای نیست. «ثبت روز» را بزنید یا به دستیار بگویید «امروز صد میلیون فروش
          داشتم».
        </div>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((e) => (
            <li
              key={e.id}
              className="flex items-start gap-2 rounded-xl border border-border bg-background px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                      e.kind === "profit"
                        ? "bg-green-500/15 text-green-700 dark:text-green-400"
                        : e.kind === "sales"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {e.kind === "sales" ? "فروش" : e.kind === "profit" ? "سود" : "یادداشت"}
                  </span>
                  <span className="truncate font-medium">{e.title}</span>
                  {e.source === "assistant" && (
                    <span className="text-[10px] text-muted-foreground">دستیار</span>
                  )}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {formatJalaliDate(e.at)}
                  {e.note ? ` · ${e.note}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {e.amount > 0 && (
                  <span
                    className={`text-xs font-bold ${e.kind === "profit" ? "text-green-600" : "text-foreground"}`}
                  >
                    {formatToman(e.amount)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => startEdit(e)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="ویرایش"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("این ثبت دستی حذف شود؟")) ledgerStore.remove(e.id);
                  }}
                  className="grid h-7 w-7 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                  aria-label="حذف"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SummaryCard({
  icon,
  label,
  total,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  total: number;
  count: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-base font-bold">{formatToman(total)}</div>
      <div className="text-[11px] text-muted-foreground">{formatNumber(count)} فاکتور</div>
    </div>
  );
}

function ReportsPage() {
  return (
    <AuthGuard>
      <ReportsPageInner />
    </AuthGuard>
  );
}
