import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Layout } from "@/components/Layout";
import { formatToman } from "@/lib/store";
import { getGoldPrices, type GoldQuote } from "@/lib/gold.functions";
import { createRecognizer, type Recognizer, type SpeechEngine } from "@/lib/voice/speech";
import { parseGoldVoice } from "@/lib/voice/gold-speech";
import { RefreshCw, Mic, Loader2, TrendingUp, TrendingDown, Coins, Copy, Check } from "lucide-react";

export const Route = createFileRoute("/gold")({
  head: () => ({
    meta: [
      { title: "طلا و نرخ لحظه‌ای | KAMIX" },
      { name: "description", content: "نرخ لحظه‌ای طلا، سکه و ارز به همراه ماشین‌حساب فاکتور طلافروشی با ثبت صوتی فارسی." },
      { property: "og:title", content: "بخش طلا — نرخ لحظه‌ای و فاکتور طلا | KAMIX" },
      { property: "og:description", content: "نرخ لحظه‌ای طلا و سکه، محاسبه وزن، اجرت، سود و مالیات فاکتور طلافروشی." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GoldPage,
});

const GRAM_18_KEYS = ["IR_GOLD_18K", "GOLD_18", "IR_GOLD_18"];

function pickGram18(items: GoldQuote[]): GoldQuote | undefined {
  return (
    items.find((i) => GRAM_18_KEYS.includes(i.key.toUpperCase())) ||
    items.find((i) => i.name.includes("18") && i.name.includes("گرم")) ||
    items.find((i) => i.group === "gold")
  );
}

function GoldInner() {
  const [items, setItems] = useState<GoldQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // ماشین‌حساب
  const [rate, setRate] = useState<number>(0);
  const [rateTouched, setRateTouched] = useState(false);
  const [grams, setGrams] = useState<string>("");
  const [suut, setSuut] = useState<string>("");
  const [karat, setKarat] = useState<string>("18");
  const [wage, setWage] = useState<string>("7");
  const [profit, setProfit] = useState<string>("7");
  const [taxOn, setTaxOn] = useState(true);
  const [copied, setCopied] = useState(false);

  // صوت
  const recRef = useRef<Recognizer | null>(null);
  const [engine, setEngine] = useState<SpeechEngine>("none");
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getGoldPrices();
      if (res.ok) {
        setItems(res.items);
        setUpdatedAt(res.updatedAt);
        const g = pickGram18(res.items);
        if (g && !rateTouched) setRate(g.price);
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [rateTouched]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const rec = createRecognizer();
    recRef.current = rec;
    setEngine(rec.engine);
    return () => { void rec.stop(); };
  }, []);

  const applyVoice = (text: string) => {
    setHeard(text);
    const p = parseGoldVoice(text);
    let applied = false;
    if (p.grams !== null) { setGrams(String(p.grams)); applied = true; }
    if (p.suut !== null) { setSuut(String(p.suut)); applied = true; }
    if (p.karat !== null) { setKarat(String(p.karat)); applied = true; }
    if (p.wagePercent !== null) { setWage(String(p.wagePercent)); applied = true; }
    setVoiceMsg(applied ? null : "چیزی تشخیص داده نشد — مثلاً بگویید: «دو گرم و دو سوت عیار ۱۸ اجرت ۷ درصد»");
  };

  const startListening = async () => {
    const rec = recRef.current;
    if (!rec) return;
    setVoiceMsg(null);
    setHeard("");
    setListening(true);
    await rec.start({
      onPartial: (t) => setHeard(t),
      onResult: (t) => { setListening(false); applyVoice(t); },
      onError: (m) => { setListening(false); setVoiceMsg(m); },
      onUnavailable: (m) => { setListening(false); setVoiceMsg(m); },
      onEnd: () => setListening(false),
    });
  };

  const weight = (parseFloat(grams || "0") || 0) + (parseFloat(suut || "0") || 0) / 1000;
  const k = parseFloat(karat || "18") || 18;
  const ratePerGram = rate * (k / 18);
  const base = ratePerGram * weight;
  const wageAmount = base * ((parseFloat(wage || "0") || 0) / 100);
  const profitAmount = (base + wageAmount) * ((parseFloat(profit || "0") || 0) / 100);
  const taxAmount = taxOn ? (wageAmount + profitAmount) * 0.09 : 0;
  const total = base + wageAmount + profitAmount + taxAmount;

  const summary = `وزن: ${weight.toLocaleString("fa-IR")} گرم | عیار ${k}\nقیمت طلا: ${formatToman(Math.round(base))}\nاجرت: ${formatToman(Math.round(wageAmount))}\nسود: ${formatToman(Math.round(profitAmount))}\nمالیات: ${formatToman(Math.round(taxAmount))}\nجمع کل: ${formatToman(Math.round(total))}`;

  const golds = items.filter((i) => i.group === "gold");
  const coins = items.filter((i) => i.group === "coin");
  const currencies = items.filter((i) => i.group === "currency");

  return (
    <Layout>
      <h1 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <Coins className="h-5 w-5 text-primary" /> طلا — نرخ لحظه‌ای و فاکتور
      </h1>

      {/* نرخ لحظه‌ای */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">نرخ لحظه‌ای بازار</div>
          <button
            onClick={() => void load()}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            بروزرسانی
          </button>
        </div>

        {error && (
          <div className="rounded-xl bg-destructive/10 p-3 text-xs leading-6 text-destructive">{error}</div>
        )}

        {!error && (
          <div className="space-y-4">
            {[
              { title: "طلا", rows: golds },
              { title: "سکه", rows: coins },
              { title: "ارز", rows: currencies },
            ].map(({ title, rows }) =>
              rows.length ? (
                <div key={title}>
                  <div className="mb-2 text-xs text-muted-foreground">{title}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {rows.map((q) => (
                      <div key={q.key} className="rounded-xl border border-border/60 bg-background p-3">
                        <div className="truncate text-xs text-muted-foreground">{q.name}</div>
                        <div className="mt-1 text-sm font-bold">{q.price.toLocaleString("fa-IR")} <span className="text-[10px] font-normal text-muted-foreground">{q.unit}</span></div>
                        {q.changePercent !== null && (
                          <div className={`mt-0.5 flex items-center gap-1 text-[10px] ${q.changePercent >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {q.changePercent >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {Math.abs(q.changePercent).toLocaleString("fa-IR")}٪
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
            {updatedAt && (
              <div className="text-[10px] text-muted-foreground">
                آخرین بروزرسانی: {new Date(updatedAt).toLocaleTimeString("fa-IR")}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ماشین‌حساب فاکتور طلا */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">محاسبه فاکتور طلا</div>
          {engine !== "none" && (
            <button
              onClick={() => (listening ? void recRef.current?.stop() : void startListening())}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                listening ? "bg-red-500 text-white" : "border border-border hover:bg-accent"
              }`}
            >
              <Mic className="h-3.5 w-3.5" />
              {listening ? "در حال شنیدن…" : "ثبت صوتی"}
            </button>
          )}
        </div>

        {(heard || voiceMsg) && (
          <div className="mb-3 rounded-xl bg-muted p-2.5 text-xs leading-6">
            {heard && <div>شنیدم: «{heard}»</div>}
            {voiceMsg && <div className="text-muted-foreground">{voiceMsg}</div>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="نرخ هر گرم طلای ۱۸ (تومان)" value={rate ? String(rate) : ""} onChange={(v) => { setRateTouched(true); setRate(parseFloat(v) || 0); }} />
          <Field label="عیار" value={karat} onChange={setKarat} />
          <Field label="وزن (گرم)" value={grams} onChange={setGrams} />
          <Field label="سوت (هزارم گرم)" value={suut} onChange={setSuut} />
          <Field label="اجرت (٪)" value={wage} onChange={setWage} />
          <Field label="سود فروشنده (٪)" value={profit} onChange={setProfit} />
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={taxOn} onChange={(e) => setTaxOn(e.target.checked)} className="h-4 w-4" />
          احتساب مالیات بر ارزش افزوده ۹٪ (روی اجرت و سود)
        </label>

        <div className="mt-4 space-y-1.5 rounded-xl bg-muted p-3 text-xs">
          <Row label="وزن نهایی" value={`${weight.toLocaleString("fa-IR")} گرم`} />
          <Row label="ارزش طلا" value={formatToman(Math.round(base))} />
          <Row label="اجرت" value={formatToman(Math.round(wageAmount))} />
          <Row label="سود" value={formatToman(Math.round(profitAmount))} />
          <Row label="مالیات" value={formatToman(Math.round(taxAmount))} />
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-bold">
            <span>جمع کل</span>
            <span className="text-primary">{formatToman(Math.round(total))}</span>
          </div>
        </div>

        <button
          onClick={() => {
            void navigator.clipboard?.writeText(summary);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "کپی شد" : "کپی فاکتور طلا"}
        </button>
      </section>
    </Layout>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted-foreground">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function GoldPage() {
  return (
    <AuthGuard>
      <GoldInner />
    </AuthGuard>
  );
}
