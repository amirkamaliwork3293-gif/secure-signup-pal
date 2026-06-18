import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { askReportAssistant, type ReportInsightsSummary } from "@/lib/insights.functions";
import { customerBalance, customers, products, type Invoice } from "@/lib/store";
import { Sparkles, Send, Loader2, AlertCircle } from "lucide-react";

type Range = "today" | "month" | "year" | "all";

const RANGE_LABEL: Record<Range, string> = {
  today: "امروز",
  month: "این ماه",
  year: "امسال",
  all: "کل",
};

const SUGGESTED_QUESTIONS = [
  "امروز چقدر سود کردم؟",
  "پرفروش‌ترین محصول این بازه چیه؟",
  "کدوم محصولات راکد شدن؟",
  "وضعیت بدهکارها چطوره؟",
  "روند فروش هفته اخیر چطور بوده؟",
];

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

function buildSummary(history: Invoice[], range: Range): ReportInsightsSummary {
  const from =
    range === "all"
      ? -Infinity
      : range === "today"
        ? startOfDay()
        : range === "month"
          ? startOfMonth()
          : startOfYear();
  const filtered = range === "all" ? history : history.filter((i) => i.createdAt >= from);

  let totalRevenue = 0;
  const byPayment = { cash: 0, card: 0, credit: 0 };
  for (const inv of filtered) {
    totalRevenue += inv.total;
    const m = inv.paymentMethod;
    if (m === "cash" || m === "card" || m === "credit") byPayment[m] += inv.total;
  }

  const allProducts = products.getAll();
  const buyPriceById = new Map(allProducts.map((p) => [p.id, p.buyPrice] as const));
  const soldIds = new Set<string>();
  const perProduct = new Map<
    string,
    { name: string; qty: number; revenue: number; profit: number; hasCost: boolean }
  >();
  let profit = 0;
  let missingCostCount = 0;

  for (const inv of filtered) {
    for (const item of inv.items) {
      soldIds.add(item.productId);
      const cost = item.buyPrice ?? buyPriceById.get(item.productId);
      const hasCost = typeof cost === "number" && cost > 0;
      const itemProfit = hasCost ? (item.price - cost!) * item.quantity : 0;
      if (hasCost) profit += itemProfit;
      else missingCostCount++;

      const prev = perProduct.get(item.productId) ?? {
        name: item.name,
        qty: 0,
        revenue: 0,
        profit: 0,
        hasCost: false,
      };
      perProduct.set(item.productId, {
        name: item.name,
        qty: prev.qty + item.quantity,
        revenue: prev.revenue + item.price * item.quantity,
        profit: prev.profit + itemProfit,
        hasCost: prev.hasCost || hasCost,
      });
    }
  }

  const topProducts = Array.from(perProduct.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((p) => ({
      name: p.name,
      qty: p.qty,
      revenue: p.revenue,
      profit: p.hasCost ? Math.round(p.profit) : null,
    }));

  const stagnantProducts = allProducts
    .filter((p) => p.stock > 0 && !soldIds.has(p.id))
    .sort((a, b) => b.stock - a.stock)
    .slice(0, 5)
    .map((p) => ({ name: p.name, stock: p.stock }));

  const allCustomers = customers.getAll();
  let totalReceivable = 0;
  let debtorCount = 0;
  for (const c of allCustomers) {
    const b = customerBalance(c);
    if (b > 0) {
      totalReceivable += b;
      debtorCount++;
    }
  }

  const dayMs = 86400000;
  const today0 = startOfDay();
  const days: { label: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = today0 - i * dayMs;
    const dayEnd = dayStart + dayMs;
    const total = history
      .filter((inv) => inv.createdAt >= dayStart && inv.createdAt < dayEnd)
      .reduce((s, inv) => s + inv.total, 0);
    days.push({
      label: new Date(dayStart).toLocaleDateString("fa-IR", { month: "short", day: "numeric" }),
      total,
    });
  }

  return {
    range,
    rangeLabel: RANGE_LABEL[range],
    totalRevenue,
    invoiceCount: filtered.length,
    profit: Math.round(profit),
    missingCostCount,
    byPayment,
    topProducts,
    stagnantProducts,
    debtors: { totalReceivable, debtorCount },
    last7Days: days,
  };
}

type ChatTurn = { question: string; answer: string };

export function ReportAssistant({ history, range }: { history: Invoice[]; range: Range }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const ask = useServerFn(askReportAssistant);

  const summary = useMemo(() => buildSummary(history, range), [history, range]);

  const submit = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setError("");
    setLoading(true);
    try {
      const { answer } = await ask({ data: { question: trimmed, summary } });
      setTurns((prev) => [...prev, { question: trimmed, answer }]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت پاسخ از دستیار هوشمند.");
    }
    setLoading(false);
  };

  return (
    <section className="mb-4 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-background p-4 shadow-card">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-primary">
        <Sparkles className="h-4 w-4" />
        دستیار هوشمند گزارش‌گیری
      </h2>
      <p className="mb-3 text-[11px] text-muted-foreground">
        هر سؤالی درباره فروش، سود یا مشتری‌هات بپرس — بر اساس داده‌های واقعی فروشگاهت جواب می‌دهد.
      </p>

      {turns.length > 0 && (
        <div className="mb-3 space-y-2 max-h-72 overflow-y-auto">
          {turns.map((t, i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-end">
                <div className="rounded-2xl rounded-tr-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground max-w-[85%]">
                  {t.question}
                </div>
              </div>
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-3 py-1.5 text-xs leading-relaxed text-foreground max-w-[90%] whitespace-pre-wrap">
                  {t.answer}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {turns.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => submit(q)}
              disabled={loading}
              className="rounded-full border border-primary/30 bg-background px-3 py-1.5 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-2 flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="مثلاً: امروز چقدر سود کردم؟"
          disabled={loading}
          className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </section>
  );
}