import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  products,
  invoice,
  addProductToInvoiceQty,
  formatToman,
  formatNumber,
  stockStatus,
  isWeightUnit,
  type Product,
  type Invoice,
} from "@/lib/store";
import { parseVoiceText, type ParsedItem, type ParsedCandidate } from "@/lib/voice/persian-nlu";
import { createRecognizer, type Recognizer } from "@/lib/voice/speech";
import { parseVoiceInvoiceLLM } from "@/lib/api/voice.functions";
import {
  Mic,
  MicOff,
  CheckCircle2,
  AlertCircle,
  Plus,
  X,
  Loader2,
  Keyboard,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/voice")({
  head: () => ({
    meta: [
      { title: "ثبت صوتی | کمالی حسابداری" },
      { name: "description", content: "افزودن کالا به فاکتور با گفتار فارسی — بدون تایپ." },
    ],
  }),
  component: VoicePage,
});

type ResolvedItem = {
  key: string;
  rawClause: string;
  productPhrase: string;
  quantity: number;
  unit: string;
  candidates: ParsedCandidate[];
  status: "added" | "choose" | "unknown" | "out";
  needsUnitConfirm?: boolean;
};

function vibrate(ms: number) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(ms);
}

function VoicePageInner() {
  const [allProducts] = products.useAll();
  const recognizerRef = useRef<Recognizer | null>(null);
  const [engine, setEngine] = useState<"native" | "web" | "none">("none");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResolvedItem[]>([]);
  const [manualMode, setManualMode] = useState(false);
  const [manualText, setManualText] = useState("");
  const [llmBusy, setLlmBusy] = useState(false);

  useEffect(() => {
    const rec = createRecognizer();
    recognizerRef.current = rec;
    setEngine(rec.engine);
    if (rec.engine === "none") setManualMode(true);
    return () => {
      void rec.stop();
    };
  }, []);

  // افزودن یک آیتم مشخص به فاکتور جاری (با بررسی موجودی)
  const addToInvoice = (product: Product, quantity: number): "ok" | "out" => {
    if (stockStatus(product) === "out") return "out";
    const current = invoice.getCurrent();
    const next = addProductToInvoiceQty(current, product, quantity);
    invoice.save(next);
    vibrate(40);
    return "ok";
  };

  // اعمال مشتری/روش پرداخت روی فاکتور جاری (اختیاری)
  const applyMeta = (customerName?: string, paymentMethod?: Invoice["paymentMethod"]) => {
    if (!customerName && !paymentMethod) return;
    const current = invoice.getCurrent();
    const patched: Invoice = { ...current };
    if (customerName) patched.customer = { ...(current.customer ?? {}), firstName: customerName };
    if (paymentMethod) patched.paymentMethod = paymentMethod;
    invoice.save(patched);
  };

  // تبدیل ParsedItem به ResolvedItem و افزودن خودکار آیتم‌های مطمئن
  const resolveItem = (item: ParsedItem): ResolvedItem => {
    const key = Math.random().toString(36).slice(2);
    const base = {
      key,
      rawClause: item.rawClause,
      productPhrase: item.productPhrase,
      quantity: item.quantity,
      unit: item.unit,
      candidates: item.candidates,
      needsUnitConfirm: item.needsUnitConfirm,
    };
    if (item.confidence === "none" || item.candidates.length === 0) {
      return { ...base, status: "unknown" };
    }
    if (item.confidence === "high") {
      const res = addToInvoice(item.candidates[0].product, item.quantity);
      return { ...base, status: res === "out" ? "out" : "added" };
    }
    return { ...base, status: "choose" };
  };

  const processTranscript = async (text: string) => {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed) return;
    setTranscript(trimmed);

    const parsed = parseVoiceText(trimmed, allProducts);
    applyMeta(parsed.customerName, parsed.paymentMethod);

    let resolved = parsed.items.map(resolveItem);

    // اگر همه‌ی آیتم‌ها نامشخص بودند و آنلاین هستیم → تلاش با مدل زبانی (در صورت وجود کلید)
    const allWeak = resolved.length === 0 || resolved.every((r) => r.status === "unknown");
    const online = typeof navigator === "undefined" || navigator.onLine;
    if (allWeak && online) {
      setLlmBusy(true);
      try {
        const llm = await parseVoiceInvoiceLLM({
          data: { transcript: trimmed, productNames: allProducts.map((p) => p.name) },
        });
        if (llm.available && llm.items.length > 0) {
          applyMeta(llm.customerName, llm.paymentMethod);
          // هر آیتم LLM را با همان منطق محلی روی محصول پیشنهادی تطبیق و افزوده می‌کنیم
          resolved = llm.items.map((it) => {
            const clause = `${formatNumber(it.quantity)} ${it.unit} ${it.productName}`;
            const r = parseVoiceText(clause, allProducts);
            return r.items[0]
              ? resolveItem(r.items[0])
              : ({
                  key: Math.random().toString(36).slice(2),
                  rawClause: it.productName,
                  productPhrase: it.productName,
                  quantity: it.quantity,
                  unit: it.unit,
                  candidates: [],
                  status: "unknown",
                } as ResolvedItem);
          });
        }
      } catch {
        /* بی‌سروصدا محلی می‌مانیم */
      } finally {
        setLlmBusy(false);
      }
    }

    setResults(resolved);
  };

  const startListening = async () => {
    const rec = recognizerRef.current;
    if (!rec) return;
    setError(null);
    setResults([]);
    setTranscript("");
    setListening(true);
    await rec.start({
      onPartial: (t) => setTranscript(t),
      onResult: (t) => {
        setListening(false);
        void processTranscript(t);
      },
      onError: (msg) => {
        setListening(false);
        setError(msg);
      },
      onEnd: () => setListening(false),
    });
  };

  const stopListening = async () => {
    setListening(false);
    await recognizerRef.current?.stop();
  };

  // انتخاب یک محصول از میان گزینه‌های پیشنهادی برای یک آیتم
  const pickCandidate = (item: ResolvedItem, product: Product) => {
    const r = parseVoiceText(item.rawClause || product.name, [product]);
    const qty = r.items[0]?.quantity ?? item.quantity ?? 1;
    const res = addToInvoice(product, qty);
    setResults((prev) =>
      prev.map((x) =>
        x.key === item.key
          ? {
              ...x,
              status: res === "out" ? "out" : "added",
              quantity: qty,
              unit: product.unit ?? item.unit,
            }
          : x,
      ),
    );
  };

  const discardItem = (key: string) => setResults((prev) => prev.filter((x) => x.key !== key));

  return (
    <Layout>
      <h1 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <Mic className="h-5 w-5 text-primary" />
        ثبت صوتی فاکتور
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        دکمه را نگه دارید یا بزنید و نام و مقدار کالا را بگویید — مثلاً «دو ربع گوجه و نیم کیلو
        پنیر».
      </p>

      {/* دکمه میکروفون */}
      {!manualMode && (
        <div className="mb-4 flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 shadow-card">
          <button
            type="button"
            onClick={() => (listening ? stopListening() : startListening())}
            className={`grid h-24 w-24 place-items-center rounded-full text-primary-foreground shadow-elegant transition ${
              listening ? "animate-pulse bg-destructive" : "bg-gradient-primary"
            }`}
            aria-label={listening ? "توقف ضبط" : "شروع ضبط"}
          >
            {listening ? <MicOff className="h-10 w-10" /> : <Mic className="h-10 w-10" />}
          </button>
          <div className="text-center text-sm font-medium">
            {listening ? "در حال شنیدن… دوباره بزنید تا متوقف شود" : "برای صحبت بزنید"}
          </div>
          <button
            type="button"
            onClick={() => setManualMode(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Keyboard className="h-3.5 w-3.5" />
            ورود دستی متن
          </button>
        </div>
      )}

      {/* حالت دستی (یا وقتی تشخیص گفتار پشتیبانی نمی‌شود) */}
      {manualMode && (
        <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          {engine === "none" && (
            <p className="mb-2 text-xs text-amber-600">
              تشخیص گفتار روی این دستگاه در دسترس نیست؛ متن را دستی وارد کنید.
            </p>
          )}
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            rows={2}
            placeholder="مثلاً: سه تا نان و نیم کیلو پنیر"
            className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                void processTranscript(manualText);
              }}
              className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
            >
              تبدیل به فاکتور
            </button>
            {engine !== "none" && (
              <button
                type="button"
                onClick={() => setManualMode(false)}
                className="rounded-xl border border-border px-3 py-2.5 text-sm"
              >
                میکروفون
              </button>
            )}
          </div>
        </div>
      )}

      {/* نوار «شنیده شد» */}
      {transcript && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-border bg-accent/50 px-3 py-2 text-sm">
          <Mic className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <span className="text-muted-foreground">شنیده شد: </span>
            <span className="font-medium">{transcript}</span>
          </div>
          <button
            onClick={() => {
              setTranscript("");
              setResults([]);
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* خطا */}
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      {llmBusy && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          <Loader2 className="h-4 w-4 animate-spin" />
          در حال تحلیل هوشمند…
        </div>
      )}

      {/* نتایج */}
      <ul className="space-y-2">
        {results.map((item) => (
          <li key={item.key} className="rounded-2xl border border-border bg-card p-3 shadow-card">
            {item.status === "added" && <AddedRow item={item} />}
            {item.status === "out" && (
              <div className="flex items-start gap-2 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="flex-1">
                  <div className="font-semibold">
                    اتمام موجودی: {item.candidates[0]?.product.name ?? item.productPhrase}
                  </div>
                  <button
                    onClick={() => discardItem(item.key)}
                    className="mt-1 text-xs text-muted-foreground underline"
                  >
                    حذف
                  </button>
                </div>
              </div>
            )}
            {item.status === "choose" && (
              <ChooseRow
                item={item}
                onPick={(p) => pickCandidate(item, p)}
                onDiscard={() => discardItem(item.key)}
              />
            )}
            {item.status === "unknown" && (
              <UnknownRow item={item} onDiscard={() => discardItem(item.key)} />
            )}
          </li>
        ))}
      </ul>

      {results.length > 0 && (
        <Link
          to="/"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          مشاهده فاکتور
        </Link>
      )}
    </Layout>
  );
}

function unitLabel(item: ResolvedItem, product?: Product): string {
  const unit = product?.unit ?? item.unit;
  return isWeightUnit(unit) ? ` ${unit}` : unit === "عدد" ? " عدد" : "";
}

function AddedRow({ item }: { item: ResolvedItem }) {
  const p = item.candidates[0]?.product;
  return (
    <div className="flex items-start gap-2 text-sm">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <div className="flex-1">
        <div className="font-semibold text-foreground">به فاکتور اضافه شد ✓</div>
        <div className="text-foreground/80">
          {p?.name ?? item.productPhrase} — {formatNumber(item.quantity)}
          {unitLabel(item, p)}
          {p && <> · {formatToman(p.price)}</>}
        </div>
      </div>
    </div>
  );
}

function ChooseRow({
  item,
  onPick,
  onDiscard,
}: {
  item: ResolvedItem;
  onPick: (p: Product) => void;
  onDiscard: () => void;
}) {
  return (
    <div>
      <div className="mb-2 text-sm">
        <span className="text-muted-foreground">کدام محصول؟ </span>
        <span className="font-medium">«{item.productPhrase}»</span>
        {item.needsUnitConfirm && (
          <span className="mr-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
            واحد را بررسی کنید
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {item.candidates.map((c) => (
          <button
            key={c.product.id}
            onClick={() => onPick(c.product)}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
          >
            {c.product.name}
            <span className="mr-1 text-xs text-muted-foreground">
              {formatToman(c.product.price)}
            </span>
          </button>
        ))}
        <button
          onClick={onDiscard}
          className="rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
        >
          نادیده بگیر
        </button>
      </div>
    </div>
  );
}

function UnknownRow({ item, onDiscard }: { item: ResolvedItem; onDiscard: () => void }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="flex-1">
        <div className="font-semibold">محصولی برای «{item.productPhrase}» پیدا نشد</div>
        <div className="mt-2 flex gap-2">
          <Link
            to="/products"
            search={{ code: item.productPhrase }}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            افزودن محصول
          </Link>
          <button
            onClick={onDiscard}
            className="rounded-lg border border-border px-3 py-1.5 text-xs"
          >
            نادیده بگیر
          </button>
        </div>
      </div>
    </div>
  );
}

function VoicePage() {
  return (
    <AuthGuard>
      <VoicePageInner />
    </AuthGuard>
  );
}
