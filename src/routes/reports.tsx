import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { invoice, formatToman, PAYMENT_LABEL, type Invoice, type PaymentMethod } from "@/lib/store";
import { BarChart3, Calendar, CalendarDays, Wallet, CreditCard, Clock } from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "گزارش درآمد | حساب‌بان" },
      { name: "description", content: "گزارش روزانه و ماهانه درآمد به تفکیک روش پرداخت." },
    ],
  }),
  component: ReportsPage,
});

type Range = "today" | "month" | "all";

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

function summarize(list: Invoice[]) {
  const by: Record<PaymentMethod | "unknown", { count: number; total: number }> = {
    cash: { count: 0, total: 0 },
    card: { count: 0, total: 0 },
    credit: { count: 0, total: 0 },
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

function ReportsPageInner() {
  const [history] = invoice.useHistory();
  const [range, setRange] = useState<Range>("today");

  const filtered = useMemo(() => {
    if (range === "all") return history;
    const from = range === "today" ? startOfDay() : startOfMonth();
    return history.filter((i) => i.createdAt >= from);
  }, [history, range]);

  const summary = summarize(filtered);
  const daily = useMemo(() => {
    const from = startOfMonth();
    return daysInMonthBreakdown(history.filter((i) => i.createdAt >= from));
  }, [history]);

  const maxDay = Math.max(1, ...daily.map(([, v]) => v));

  const RangeButton = ({ value, label, icon: Icon }: { value: Range; label: string; icon: typeof Calendar }) => (
    <button
      type="button"
      onClick={() => setRange(value)}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
        range === value
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-background border border-border text-muted-foreground hover:bg-accent"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <Layout>
      <h1 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <BarChart3 className="h-5 w-5 text-primary" />
        گزارش درآمد
      </h1>

      <div className="mb-4 flex gap-2">
        <RangeButton value="today" label="امروز" icon={Calendar} />
        <RangeButton value="month" label="این ماه" icon={CalendarDays} />
        <RangeButton value="all" label="کل" icon={Clock} />
      </div>

      <section className="mb-4 rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-elegant">
        <div className="text-xs opacity-80">مجموع درآمد</div>
        <div className="mt-1 text-2xl font-bold">{formatToman(summary.total)}</div>
        <div className="mt-0.5 text-xs opacity-80">
          {summary.count.toLocaleString("fa-IR")} فاکتور
        </div>
      </section>

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
          {summary.by.unknown.count.toLocaleString("fa-IR")} فاکتور بدون روش پرداخت ثبت شده:{" "}
          <span className="font-semibold text-foreground">{formatToman(summary.by.unknown.total)}</span>
        </div>
      )}

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
        {count.toLocaleString("fa-IR")} فاکتور
      </div>
    </div>
  );
}

function ReportsPage() {
  return <AuthGuard><ReportsPageInner /></AuthGuard>;
}
