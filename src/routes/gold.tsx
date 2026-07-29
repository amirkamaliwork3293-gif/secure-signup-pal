import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import { invoice, addProductToInvoiceQty, formatToman, formatNumber, type Product } from "@/lib/store";
import { createRecognizer, type Recognizer, type SpeechEngine } from "@/lib/voice/speech";
import { parseGoldVoice } from "@/lib/gold/gold-voice";
import {
  computeGoldPrice,
  COMMON_KARATS,
  COIN_TYPES,
  type CoinTypeId,
} from "@/lib/gold/gold-calc";
import { loadGoldPrefs, saveGoldPrefs } from "@/lib/gold/gold-prefs";
import { fetchGoldLivePrice } from "@/lib/api/gold.functions";
import { Mic, MicOff, Loader2, RefreshCw, Plus, Gem, Keyboard, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/gold")({
  head: () => ({
    meta: [
      { title: "محاسبه‌گر طلا | KAMIX" },
      { name: "description", content: "محاسبه قیمت طلای وزنی و سکه با نرخ روز — با تایپ یا گفتار." },
    ],
  }),
  component: GoldPage,
});

type Mode = "weight" | "coin";

function GoldPageInner() {
  const prefs = loadGoldPrefs();

  const [mode, setMode] = useState<Mode>("weight");
  const [weight, setWeight] = useState("");
  const [karat, setKarat] = useState(prefs.karat);
  const [wagePercent, setWagePercent] = useState(String(prefs.wagePercent));
  const [profitPercent, setProfitPercent] = useState(String(prefs.profitPercent));
  const [taxPercent, setTaxPercent] = useState(String(prefs.taxPercent));
  const [secondHand, setSecondHand] = useState(false);
  const [pricePerGram18, setPricePerGram18] = useState(
    prefs.pricePerGram18 ? String(prefs.pricePerGram18) : "",
  );

  const [coinType, setCoinType] = useState<CoinTypeId>("emami");
  const [coinQty, setCoinQty] = useState("1");
  const [coinPrice, setCoinPrice] = useState("");
  const [coinPrices, setCoinPrices] = useState<Partial<Record<CoinTypeId, number>>>({});

  const [liveAvailable, setLiveAvailable] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(null);

  // ورودی صوتی/متنی
  const recognizerRef = useRef<Recognizer | null>(null);
  const [engine, setEngine] = useState<SpeechEngine>("none");
  const [listening, setListening] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualText, setManualText] = useState("");
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const rec = createRecognizer();
    recognizerRef.current = rec;
    setEngine(rec.engine);
    if (rec.engine === "none") setManualMode(true);
    return () => {
      void rec.stop();
    };
  }, []);

  const loadLivePrice = async () => {
    setLiveLoading(true);
    try {
      const res = await fetchGoldLivePrice();
      if (res.available && res.pricePerGram18) {
        setPricePerGram18(String(res.pricePerGram18));
        saveGoldPrefs({ pricePerGram18: res.pricePerGram18 });
        setCoinPrices(res.coinPrices ?? {});
        setLiveAvailable(true);
        setLiveUpdatedAt(res.updatedAt ?? null);
      } else {
        setLiveAvailable(false);
      }
    } catch {
      setLiveAvailable(false);
    } finally {
      setLiveLoading(false);
    }
  };

  useEffect(() => {
    void loadLivePrice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // اگر نرخ سکه‌ی همان نوع از سرویس زنده موجود بود، در فیلد قیمت سکه پیش‌فرض بگذار
  useEffect(() => {
    if (mode === "coin" && coinPrices[coinType]) {
      setCoinPrice(String(coinPrices[coinType]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinType, mode]);

  const applyParsed = (p: ReturnType<typeof parseGoldVoice>) => {
    if (p.coinType) {
      setMode("coin");
      setCoinType(p.coinType);
      if (p.coinQuantity) setCoinQty(String(p.coinQuantity));
      return;
    }
    setMode("weight");
    if (p.weightGrams) setWeight(String(Math.round(p.weightGrams * 1000) / 1000));
    if (p.karat) setKarat(p.karat);
    if (p.wagePercent !== undefined) setWagePercent(String(p.wagePercent));
    if (p.profitPercent !== undefined) setProfitPercent(String(p.profitPercent));
    if (p.taxPercent !== undefined) setTaxPercent(String(p.taxPercent));
    if (p.secondHand) setSecondHand(true);
  };

  const processTranscript = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parsed = parseGoldVoice(trimmed);
    const gotSomething =
      parsed.weightGrams || parsed.karat || parsed.coinType || parsed.wagePercent !== undefined;
    if (!gotSomething) {
      setVoiceNotice(`متوجه نشدم: «${trimmed}». می‌توانید دستی وارد کنید.`);
      return;
    }
    setVoiceNotice(null);
    applyParsed(parsed);
  };

  const startListening = async () => {
    const rec = recognizerRef.current;
    if (!rec) return;
    setVoiceNotice(null);
    setListening(true);
    await rec.start({
      onResult: (t) => {
        setListening(false);
        processTranscript(t);
      },
      onError: (msg) => {
        setListening(false);
        setVoiceNotice(msg);
      },
      onUnavailable: (msg) => {
        setListening(false);
        setVoiceNotice(msg);
        setManualMode(true);
      },
    });
  };

  const stopListening = async () => {
    await recognizerRef.current?.stop();
    setListening(false);
  };

  // ─── محاسبه ───────────────────────────────────────────────────────────────
  const weightNum = Number(weight) || 0;
  const priceNum = Number(pricePerGram18) || 0;
  const result =
    weightNum > 0 && priceNum > 0
      ? computeGoldPrice({
          pricePerGram18: priceNum,
          weightGrams: weightNum,
          karat,
          wagePercent: Number(wagePercent) || 0,
          profitPercent: Number(profitPercent) || 0,
          taxPercent: Number(taxPercent) || 0,
        })
      : null;

  const coinQtyNum = Number(coinQty) || 0;
  const coinPriceNum = Number(coinPrice) || 0;
  const coinTotal = coinQtyNum > 0 && coinPriceNum > 0 ? Math.round(coinQtyNum * coinPriceNum) : null;

  const persistPercents = () => {
    saveGoldPrefs({
      wagePercent: Number(wagePercent) || 0,
      profitPercent: Number(profitPercent) || 0,
      taxPercent: Number(taxPercent) || 0,
      karat,
      pricePerGram18: priceNum,
    });
  };

  const addResultToInvoice = () => {
    const total = mode === "weight" ? result?.total : coinTotal;
    if (!total || total <= 0) return;
    persistPercents();

    const name =
      mode === "weight"
        ? `طلا ${karat} عیار ${formatNumber(weightNum)} گرم${secondHand ? " (دست دوم)" : ""}`
        : `${COIN_TYPES.find((c) => c.id === coinType)?.label ?? "سکه"} × ${formatNumber(coinQtyNum)}`;

    const syntheticProduct: Product = {
      id: `gold-${Date.now()}`,
      name,
      price: total,
      category: "طلا",
      code: "GOLD",
      stock: 999999,
    };

    const current = invoice.getCurrent();
    const next = addProductToInvoiceQty(current, syntheticProduct, 1);
    invoice.save(next);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center gap-2">
        <Gem className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold">محاسبه‌گر طلا</h1>
      </div>

      {/* نرخ روز */}
      <div className="mb-4 rounded-2xl border border-border bg-card p-3 shadow-card">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">نرخ هر گرم طلای ۱۸ عیار (تومان)</span>
          <button
            type="button"
            onClick={() => void loadLivePrice()}
            disabled={liveLoading}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            {liveLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            بروزرسانی
          </button>
        </div>
        <input
          type="number"
          inputMode="numeric"
          value={pricePerGram18}
          onChange={(e) => setPricePerGram18(e.target.value)}
          onBlur={persistPercents}
          placeholder="مثلاً 8500000"
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        {liveAvailable ? (
          <p className="mt-1.5 text-xs text-success">
            نرخ لحظه‌ای دریافت شد{liveUpdatedAt ? ` · ${new Date(liveUpdatedAt).toLocaleTimeString("fa-IR")}` : ""}
          </p>
        ) : (
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            سرویس نرخ لحظه‌ای هنوز روی این سایت فعال نشده — نرخ روز را خودتان اینجا وارد کنید؛
            دفعه‌ی بعد همین عدد پیش‌فرض می‌ماند.
          </p>
        )}
      </div>

      {/* حالت: طلای وزنی / سکه */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode("weight")}
          className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
            mode === "weight" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
          }`}
        >
          طلای وزنی
        </button>
        <button
          type="button"
          onClick={() => setMode("coin")}
          className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
            mode === "coin" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
          }`}
        >
          سکه
        </button>
      </div>

      {/* ورودی صوتی */}
      <div className="mb-4 rounded-2xl border border-border bg-card p-3 shadow-card">
        {!manualMode ? (
          <button
            type="button"
            onClick={() => (listening ? void stopListening() : void startListening())}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold ${
              listening ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"
            }`}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {listening ? "در حال شنیدن… (برای توقف بزنید)" : "بگویید: مثلاً «پنج گرم طلای هجده عیار با ده درصد اجرت»"}
          </button>
        ) : (
          <div>
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              rows={2}
              placeholder="مثلاً: سه مثقال طلای بیست و یک عیار دست دوم"
              className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => processTranscript(manualText)}
              className="mt-2 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
            >
              اعمال
            </button>
          </div>
        )}
        {engine !== "none" && (
          <button
            type="button"
            onClick={() => setManualMode((v) => !v)}
            className="mt-2 flex w-full items-center justify-center gap-1 text-xs text-muted-foreground"
          >
            <Keyboard className="h-3.5 w-3.5" />
            {manualMode ? "استفاده از میکروفون" : "ورود با تایپ"}
          </button>
        )}
        {voiceNotice && <p className="mt-2 text-xs text-muted-foreground">{voiceNotice}</p>}
      </div>

      {mode === "weight" ? (
        <div className="mb-4 space-y-3 rounded-2xl border border-border bg-card p-3 shadow-card">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">وزن (گرم)</label>
            <input
              type="number"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="مثلاً 5.2"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">عیار</label>
            <div className="grid grid-cols-4 gap-2">
              {COMMON_KARATS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKarat(k)}
                  className={`rounded-xl border py-2 text-sm font-semibold transition ${
                    karat === k ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-background p-2.5">
            <span className="text-sm">طلای دست دوم / آب‌شده (بدون اجرت ساخت)</span>
            <input
              type="checkbox"
              checked={secondHand}
              onChange={(e) => {
                setSecondHand(e.target.checked);
                if (e.target.checked) setWagePercent("0");
              }}
              className="h-5 w-5 accent-primary"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">اجرت ٪</label>
              <input
                type="number"
                inputMode="decimal"
                value={wagePercent}
                onChange={(e) => setWagePercent(e.target.value)}
                onBlur={persistPercents}
                className="w-full rounded-xl border border-input bg-background px-2 py-2 text-center text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">سود ٪</label>
              <input
                type="number"
                inputMode="decimal"
                value={profitPercent}
                onChange={(e) => setProfitPercent(e.target.value)}
                onBlur={persistPercents}
                className="w-full rounded-xl border border-input bg-background px-2 py-2 text-center text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">مالیات ٪</label>
              <input
                type="number"
                inputMode="decimal"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                onBlur={persistPercents}
                className="w-full rounded-xl border border-input bg-background px-2 py-2 text-center text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          {result && (
            <div className="space-y-1.5 rounded-xl bg-accent/40 p-3 text-sm">
              <Row label="قیمت پایه (خام)" value={result.basePrice} />
              <Row label="اجرت ساخت" value={result.wage} />
              <Row label="سود فروشنده" value={result.profit} />
              <Row label="مالیات بر ارزش افزوده" value={result.tax} />
              <div className="mt-1 flex items-center justify-between border-t border-border pt-1.5 text-base font-bold">
                <span>جمع نهایی</span>
                <span>{formatToman(result.total)}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-4 space-y-3 rounded-2xl border border-border bg-card p-3 shadow-card">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">نوع سکه</label>
            <div className="grid grid-cols-1 gap-2">
              {COIN_TYPES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCoinType(c.id)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    coinType === c.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {c.label}
                  {coinPrices[c.id] && <span className="text-xs">{formatToman(coinPrices[c.id]!)}</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">تعداد</label>
              <input
                type="number"
                inputMode="numeric"
                value={coinQty}
                onChange={(e) => setCoinQty(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">نرخ هر عدد (تومان)</label>
              <input
                type="number"
                inputMode="numeric"
                value={coinPrice}
                onChange={(e) => setCoinPrice(e.target.value)}
                placeholder="نرخ بازار سکه"
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            سکه بر خلاف طلای وزنی، اجرت ساخت ندارد و مستقیماً به نرخ روز بازار (حباب/تقاضا) معامله می‌شود؛
            نرخ هر عدد را طبق نرخ اعلامی خودتان وارد کنید.
          </p>

          {coinTotal !== null && (
            <div className="flex items-center justify-between rounded-xl bg-accent/40 p-3 text-base font-bold">
              <span>جمع نهایی</span>
              <span>{formatToman(coinTotal)}</span>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={addResultToInvoice}
        disabled={mode === "weight" ? !result : coinTotal === null}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
      >
        {added ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {added ? "به فاکتور اضافه شد ✓" : "افزودن به فاکتور جاری"}
      </button>

      {added && (
        <Link
          to="/"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold"
        >
          مشاهده فاکتور
        </Link>
      )}
    </Layout>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground">{formatToman(value)}</span>
    </div>
  );
}

function GoldPage() {
  return (
    <AuthGuard>
      <GoldPageInner />
    </AuthGuard>
  );
}
