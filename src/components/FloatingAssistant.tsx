import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { askReportAssistant, type ReportInsightsSummary } from "@/lib/insights.functions";
import { customerBalance, customers, products, invoice, type Invoice } from "@/lib/store";
import { Bot, Send, Loader2, AlertCircle, X, Sparkles } from "lucide-react";

type Range = "today" | "month" | "year" | "all";

const RANGE_LABEL: Record<Range, string> = {
  today: "امروز",
  month: "این ماه",
  year: "امسال",
  all: "کل",
};

const SUGGESTED_QUESTIONS = [
  "امروز چقدر سود کردم؟",
  "پرفروش‌ترین محصول چیه؟",
  "کدوم محصولات راکد شدن؟",
  "وضعیت بدهکارها چطوره؟",
];

function startOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime();
}
function startOfMonth(d = new Date()) {
  const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x.getTime();
}
function startOfYear(d = new Date()) {
  const x = new Date(d); x.setMonth(0, 1); x.setHours(0, 0, 0, 0); return x.getTime();
}

function buildSummary(history: Invoice[], range: Range): ReportInsightsSummary {
  const from =
    range === "all" ? -Infinity
    : range === "today" ? startOfDay()
    : range === "month" ? startOfMonth()
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
  const perProduct = new Map<string, { name: string; qty: number; revenue: number; profit: number; hasCost: boolean }>();
  let profit = 0;
  let missingCostCount = 0;

  for (const inv of filtered) {
    for (const item of inv.items) {
      soldIds.add(item.productId);
      const cost = item.buyPrice ?? buyPriceById.get(item.productId);
      const hasCost = typeof cost === "number" && cost > 0;
      const itemProfit = hasCost ? (item.price - cost!) * item.quantity : 0;
      if (hasCost) profit += itemProfit; else missingCostCount++;
      const prev = perProduct.get(item.productId) ?? { name: item.name, qty: 0, revenue: 0, profit: 0, hasCost: false };
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
    .sort((a, b) => b.revenue - a.revenue).slice(0, 5)
    .map((p) => ({ name: p.name, qty: p.qty, revenue: p.revenue, profit: p.hasCost ? Math.round(p.profit) : null }));

  const stagnantProducts = allProducts
    .filter((p) => p.stock > 0 && !soldIds.has(p.id))
    .sort((a, b) => b.stock - a.stock).slice(0, 5)
    .map((p) => ({ name: p.name, stock: p.stock }));

  const allCustomers = customers.getAll();
  let totalReceivable = 0;
  let debtorCount = 0;
  for (const c of allCustomers) {
    const b = customerBalance(c);
    if (b > 0) { totalReceivable += b; debtorCount++; }
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

export function FloatingAssistant() {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<Range>("all");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [history] = invoice.useHistory();
  const ask = useServerFn(askReportAssistant);
  const scrollRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => buildSummary(history, range), [history, range]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, loading]);

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
    <>
      {/* دکمه شناور */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="دستیار هوشمند"
          className="fixed z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-primary text-primary-foreground shadow-elegant transition hover:scale-105 active:scale-95"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)", insetInlineEnd: "16px" }}
        >
          <Bot className="h-6 w-6" />
          <span className="absolute -top-1 -left-1 grid h-4 w-4 place-items-center rounded-full bg-background text-primary shadow">
            <Sparkles className="h-2.5 w-2.5" />
          </span>
        </button>
      )}

      {/* پنل چت */}
      {open && (
        <div
          className="fixed z-50 flex flex-col rounded-2xl border border-border bg-background shadow-elegant animate-in fade-in slide-in-from-bottom-4"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)",
            insetInlineEnd: "12px",
            insetInlineStart: "12px",
            maxWidth: "420px",
            marginInlineStart: "auto",
            height: "min(70vh, 560px)",
          }}
        >
          {/* هدر */}
          <div className="flex items-center justify-between gap-2 rounded-t-2xl border-b border-border bg-gradient-primary px-4 py-3 text-primary-foreground">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-white/20">
                <Bot className="h-4 w-4" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-bold">دستیار هوشمند</div>
                <div className="text-[10px] opacity-80">بر اساس داده‌های فروشگاه شما</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="بستن"
              className="grid h-8 w-8 place-items-center rounded-lg text-primary-foreground/90 hover:bg-white/15"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* بازه زمانی */}
          <div className="flex gap-1 border-b border-border bg-muted/30 px-2 py-2">
            {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                  range === r
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>

          {/* پیام‌ها */}
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {turns.length === 0 && (
              <>
                <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground">
                  سلام! 👋 من دستیار هوشمند فروشگاهت هستم. هر سؤالی درباره فروش، سود، مشتری‌ها یا محصولات داری بپرس.
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
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
              </>
            )}

            {turns.map((t, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground">
                    {t.question}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-border bg-card px-3 py-1.5 text-xs leading-relaxed text-foreground">
                    {t.answer}
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> در حال فکر کردن...
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* فرم ورودی */}
          <form
            onSubmit={(e) => { e.preventDefault(); submit(question); }}
            className="flex items-center gap-2 border-t border-border bg-background p-2"
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="سؤالت رو بنویس..."
              disabled={loading}
              className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </div>
      )}
    </>
  );
}