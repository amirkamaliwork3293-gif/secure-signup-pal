import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  products, invoice, formatToman, formatNumber, formatJalaliDate, type Product,
} from "@/lib/store";
import { productStats, inventoryValue } from "@/lib/analytics";
import { Boxes, AlertTriangle, CalendarClock, TrendingUp, Ban, Search } from "lucide-react";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "انبار و موجودی کالا | KAMIX" },
      { name: "description", content: "دید کامل از موجودی، ارزش انبار، کالاهای رو به اتمام، نزدیک انقضا و کالاهای راکد." },
      { property: "og:title", content: "انبار و موجودی کالا | KAMIX" },
      { property: "og:description", content: "ارزش انبار، کالاهای رو به اتمام و راکد را یکجا ببینید." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InventoryPage,
});

const DAY = 86_400_000;

type Tab = "all" | "low" | "expiry" | "dead" | "top";

const TAB_LABEL: Record<Tab, string> = {
  all: "همه کالاها", low: "رو به اتمام", expiry: "نزدیک انقضا", dead: "راکد", top: "پرگردش",
};

function InventoryPageInner() {
  const [list] = products.useAll();
  const [history] = invoice.useHistory();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");

  const value = useMemo(() => inventoryValue(list), [list]);
  const stats = useMemo(() => productStats(history, list), [history, list]);
  const soldQty = useMemo(() => new Map(stats.map((s) => [s.productId, s.qty])), [stats]);

  const low = useMemo(
    () => list.filter((p) => p.stock <= (p.lowStockThreshold ?? 3)),
    [list],
  );
  const nearExpiry = useMemo(
    () => list.filter((p) => p.expiryAt && p.expiryAt - Date.now() < 30 * DAY).sort((a, b) => (a.expiryAt! - b.expiryAt!)),
    [list],
  );
  const dead = useMemo(() => list.filter((p) => !soldQty.get(p.id)), [list, soldQty]);
  const top = useMemo(
    () => [...list].sort((a, b) => (soldQty.get(b.id) ?? 0) - (soldQty.get(a.id) ?? 0)).slice(0, 20),
    [list, soldQty],
  );

  const base = tab === "low" ? low : tab === "expiry" ? nearExpiry : tab === "dead" ? dead : tab === "top" ? top : list;
  const shown = useMemo(() => {
    const s = q.trim();
    if (!s) return base;
    return base.filter((p) => p.name.includes(s) || p.code?.includes(s) || p.category?.includes(s));
  }, [base, q]);

  const count: Record<Tab, number> = {
    all: list.length, low: low.length, expiry: nearExpiry.length, dead: dead.length, top: top.length,
  };

  return (
    <Layout>
      <h1 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <Boxes className="h-5 w-5 text-primary" /> انبار و موجودی
      </h1>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Card label="ارزش خرید موجودی" value={formatToman(value.cost)} />
        <Card label="ارزش فروش موجودی" value={formatToman(value.sale)} tone="primary" />
        <Card label="سود بالقوه انبار" value={formatToman(value.potentialProfit)} tone="good" />
        <Card label="مجموع موجودی" value={`${formatNumber(value.units)} واحد`} />
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs ${tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}
          >
            {TAB_LABEL[t]} ({formatNumber(count[t])})
          </button>
        ))}
      </div>

      <label className="mb-3 flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جستجو در کالاها…"
          className="w-full bg-transparent text-sm outline-none"
        />
      </label>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          کالایی در این بخش نیست.
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((p) => (
            <Row key={p.id} p={p} sold={soldQty.get(p.id) ?? 0} />
          ))}
        </ul>
      )}
    </Layout>
  );
}

function Row({ p, sold }: { p: Product; sold: number }) {
  const lowLimit = p.lowStockThreshold ?? 3;
  const isLow = p.stock <= lowLimit;
  const expDays = p.expiryAt ? Math.ceil((p.expiryAt - Date.now()) / DAY) : null;
  const unit = p.unit || "عدد";
  return (
    <li className="rounded-2xl border border-border bg-card p-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{p.name}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {p.category || "بدون دسته"}{p.code ? ` · ${p.code}` : ""}
          </div>
        </div>
        <div className="shrink-0 text-left">
          <div className="text-sm font-bold text-primary">{formatToman(p.price)}</div>
          {!!p.buyPrice && <div className="text-[10px] text-muted-foreground">خرید {formatToman(p.buyPrice)}</div>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className={`rounded-lg px-2 py-1 ${isLow ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground"}`}>
          {isLow && <AlertTriangle className="mb-0.5 ml-1 inline h-3 w-3" />}
          موجودی {formatNumber(p.stock)} {unit}
        </span>
        <span className={`rounded-lg px-2 py-1 ${sold > 0 ? "bg-secondary text-muted-foreground" : "bg-muted text-muted-foreground"}`}>
          {sold > 0 ? <><TrendingUp className="mb-0.5 ml-1 inline h-3 w-3" />فروش {formatNumber(sold)}</> : <><Ban className="mb-0.5 ml-1 inline h-3 w-3" />بدون فروش</>}
        </span>
        {!!p.buyPrice && (
          <span className="rounded-lg bg-secondary px-2 py-1 text-muted-foreground">
            ارزش {formatToman(p.stock * p.buyPrice)}
          </span>
        )}
        {expDays !== null && (
          <span className={`rounded-lg px-2 py-1 ${expDays < 0 ? "bg-destructive/10 text-destructive" : expDays < 30 ? "bg-amber-500/10 text-amber-600" : "bg-secondary text-muted-foreground"}`}>
            <CalendarClock className="mb-0.5 ml-1 inline h-3 w-3" />
            {expDays < 0 ? "منقضی شده" : `${formatNumber(expDays)} روز تا انقضا`} · {formatJalaliDate(p.expiryAt!)}
          </span>
        )}
      </div>
    </li>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: "primary" | "good" }) {
  return (
    <div className={`rounded-2xl border p-3 shadow-card ${tone === "good" ? "border-green-500/30 bg-green-500/5" : tone === "primary" ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-base font-bold ${tone === "good" ? "text-green-600" : tone === "primary" ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function InventoryPage() {
  return (
    <AuthGuard>
      <InventoryPageInner />
    </AuthGuard>
  );
}
