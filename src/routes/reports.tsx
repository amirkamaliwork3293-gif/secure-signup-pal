import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  invoice, products, formatToman, formatNumber, PAYMENT_LABEL,
  formatJalaliDate,
  type Invoice, type PaymentMethod,
} from "@/lib/store";
import {
  BarChart3, Calendar, CalendarDays, CalendarRange, Wallet, CreditCard, Clock,
  TrendingUp, TrendingDown, Package, FileCheck,
} from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "گزارش سود و درآمد | کمالی حسابداری" },
      { name: "description", content: "گزارش روزانه، ماهانه و سالانه درآمد و سود به تفکیک محصول." },
    ],
  }),
  component: ReportsPage,
});

type Range = "today" | "month" | "year" | "all";

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function startOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function startOfYear(d = new Date()) {
  const x = new Date(d);
  x.setMonth(0, 1);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
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
    by[m].count += 1;
    by[m].total += inv.total;
    total += inv.total;
  }
  return { by, total, count: list.length };
}

type ProfitSummary = {
  profit: number;
  /** تعداد اقلامی که قیمت خرید نداشتند و در سود لحاظ نشدند */
  missingCost: number;
  perProduct: { productId: string; name: string; qty: number; revenue: number; profit: number; hasCost: boolean }[];
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
    for (const item of inv.items) {
      const cost = item.buyPrice ?? productBuy.get(item.productId);
      const revenue = item.price * item.quantity;
      const hasCost = typeof cost === "number" && cost > 0;
      const itemProfit = hasCost ? (item.price - cost!) * item.quantity : 0;
      if (hasCost) profit += itemProfit;
      else missingCost++;

      const prev = per.get(item.productId) ?? {
        productId: item.productId, name: item.name, qty: 0, revenue: 0, profit: 0, hasCost: false,
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

  const perProduct = Array.from(per.values()).sort((a, b) => b.profit - a.profit);
  return { profit: Math.round(profit), missingCost, perProduct };
}

function daysInMonthBreakdown(list: Invoice[]) {
  const map = new Map<string, number>();
  for (const inv of list) {
    const d = new Date(inv.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    map.set(key, (map.get(key) ?? 0) + inv.total);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 31);
}

const RANGE_LABEL: Record<Range, string> = {
  today: "امروز", month: "این ماه", year: "امسال", all: "کل",
};

function ReportsPageInner() {
  const [history] = invoice.useHistory();
  const [range, setRange] = useState<Range>("today");

  const filtered = useMemo(() => {
    if (range === "all") return history;
    const from = range === "today" ? startOfDay() : range === "month" ? startOfMonth() : startOfYear();
    return history.filter((i) => i.createdAt >= from);
  }, [history, range]);

  const summary = summarize(filtered);
  const profitSummary = useMemo(() => computeProfit(filtered), [filtered]);

  const daily = useMemo(() => {
    const from = startOfMonth();
    return daysInMonthBreakdown(history.filter((i) => i.createdAt >= from));
  }, [history]);

  const maxDay = Math.max(1, ...daily.map(([, v]) => v));

  const RangeButton = ({ value, icon: Icon }: { value: Range; icon: typeof Calendar }) => (
    <button
      type="button"
      onClick={() => setRange(value)}
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

  const profitPositive = profitSummary.profit >= 0;

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
      </div>

      {/* درآمد + سود */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <section className="rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-elegant">
          <div className="text-xs opacity-80">مجموع درآمد ({RANGE_LABEL[range]})</div>
          <div className="mt-1 text-lg font-bold">{formatToman(summary.total)}</div>
          <div className="mt-0.5 text-xs opacity-80">{formatNumber(summary.count)} فاکتور</div>
        </section>
        <section className={`rounded-2xl border p-4 shadow-card ${profitPositive ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {profitPositive ? <TrendingUp className="h-3.5 w-3.5 text-green-600" /> : <TrendingDown className="h-3.5 w-3.5 text-destructive" />}
            سود ({RANGE_LABEL[range]})
          </div>
          <div className={`mt-1 text-lg font-bold ${profitPositive ? "text-green-600" : "text-destructive"}`}>
            {formatToman(profitSummary.profit)}
          </div>
          {profitSummary.missingCost > 0 && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {formatNumber(profitSummary.missingCost)} قلم بدون قیمت خرید
            </div>
          )}
        </section>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
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
      </div>

      {summary.by.unknown.count > 0 && (
        <div className="mb-4 rounded-xl border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          {formatNumber(summary.by.unknown.count)} فاکتور بدون روش پرداخت ثبت شده:{" "}
          <span className="font-semibold text-foreground">{formatToman(summary.by.unknown.total)}</span>
        </div>
      )}

      {/* سود به تفکیک محصول */}
      <section className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Package className="h-4 w-4 text-primary" />
          سود به تفکیک محصول ({RANGE_LABEL[range]})
        </h2>
        {profitSummary.perProduct.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">فروشی در این بازه ثبت نشده است.</div>
        ) : (
          <ul className="space-y-1.5">
            {profitSummary.perProduct.slice(0, 20).map((p) => (
              <li key={p.productId} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatNumber(p.qty)} فروش · درآمد {formatToman(p.revenue)}
                  </div>
                </div>
                {p.hasCost ? (
                  <span className={`shrink-0 font-bold ${p.profit >= 0 ? "text-green-600" : "text-destructive"}`}>
                    {p.profit >= 0 ? "+" : ""}{formatToman(p.profit)}
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
            💡 برای محاسبه دقیق سود، «قیمت خرید» محصولات را در بخش محصولات (قیمت‌های تکمیلی) وارد کنید.
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
            {daily.map(([key, value]) => {
              const [y, m, d] = key.split("-").map(Number);
              const dateLabel = new Date(y, m - 1, d).toLocaleDateString("fa-IR");
              const pct = (value / maxDay) * 100;
              return (
                <li key={key} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{dateLabel}</span>
                    <span className="font-semibold text-primary">{formatToman(value)}</span>
                  </div>
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

function SummaryCard({
  icon, label, total, count,
}: { icon: React.ReactNode; label: string; total: number; count: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-base font-bold">{formatToman(total)}</div>
      <div className="text-[11px] text-muted-foreground">
        {formatNumber(count)} فاکتور
      </div>
    </div>
  );
}

function ReportsPage() {
  return <AuthGuard><ReportsPageInner /></AuthGuard>;
}
