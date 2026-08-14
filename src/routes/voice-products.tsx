import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  products,
  cryptoId,
  formatToman,
  formatNumber,
  getUnitDefs,
  COUNT_UNIT,
  isWeightUnit,
  type Product,
} from "@/lib/store";
import { generateUniqueCode } from "@/lib/barcode-code";
import {
  parseProductVoiceText,
  type ParsedProductItem,
} from "@/lib/voice/product-nlu";
import { createRecognizer, type Recognizer, type SpeechEngine } from "@/lib/voice/speech";
import { parseVoiceProductLLM } from "@/lib/api/voice.functions";
import { VoiceMicIcon } from "@/components/VoiceMicIcon";
import {
  Mic,
  MicOff,
  CheckCircle2,
  AlertCircle,
  Pencil,
  X,
  Loader2,
  Keyboard,
  Sparkles,
  Package,
} from "lucide-react";

export const Route = createFileRoute("/voice-products")({
  head: () => ({
    meta: [
      { title: "ثبت صوتی محصولات | KAMIX" },
      { name: "description", content: "افزودن محصول با گفتار فارسی — نام، موجودی و قیمت." },
    ],
  }),
  component: VoiceProductsPage,
});

type ResolvedProduct = ParsedProductItem & {
  key: string;
  status: "added" | "partial" | "failed";
  productId?: string;
};

function vibrate(ms: number) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(ms);
}

function VoiceProductsPageInner() {
  const [list, setList] = products.useAll();
  const recognizerRef = useRef<Recognizer | null>(null);
  const [engine, setEngine] = useState<SpeechEngine>("none");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResolvedProduct[]>([]);
  const [manualMode, setManualMode] = useState(false);
  const [manualText, setManualText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  useEffect(() => {
    const rec = createRecognizer();
    recognizerRef.current = rec;
    setEngine(rec.engine);
    if (rec.engine === "none") setManualMode(true);
    return () => {
      void rec.stop();
    };
  }, []);

  const addProductsBatch = (items: ParsedProductItem[]): Product[] => {
    const valid = items.filter((i) => i.name.trim() && i.price && i.price > 0);
    if (valid.length === 0) return [];

    const taken = new Set(list.map((p) => p.code).filter(Boolean));
    const created: Product[] = valid.map((item) => {
      const product: Product = {
        id: cryptoId(),
        name: item.name.trim(),
        price: item.price!,
        stock: item.stock,
        unit: item.unit || COUNT_UNIT,
        category: "",
        code: generateUniqueCode(taken),
      };
      return product;
    });

    setList([...created, ...list]);
    vibrate(40);
    setAddedCount((c) => c + created.length);
    return created;
  };

  const resolveItems = (parsedItems: ParsedProductItem[]): ResolvedProduct[] => {
    const highConf = parsedItems.filter((i) => i.confidence === "high");
    const partial = parsedItems.filter((i) => i.confidence !== "high");
    const created = addProductsBatch(highConf);

    const resolved: ResolvedProduct[] = [];
    let ci = 0;
    for (const item of parsedItems) {
      const key = Math.random().toString(36).slice(2);
      if (item.confidence === "high") {
        const product = created[ci++];
        resolved.push({
          ...item,
          key,
          status: product ? "added" : "failed",
          productId: product?.id,
        });
      } else {
        resolved.push({ ...item, key, status: "partial" });
      }
    }
    return resolved;
  };

  const processTranscript = async (text: string) => {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed) return;
    setTranscript(trimmed);

    const unitDefs = getUnitDefs();
    const parsed = parseProductVoiceText(trimmed, unitDefs);
    let resolved = resolveItems(parsed.items);

    const allWeak =
      resolved.length === 0 || resolved.every((r) => r.status === "partial" || r.status === "failed");
    const online = typeof navigator === "undefined" || navigator.onLine;

    if (allWeak && online) {
      setLlmBusy(true);
      try {
        const llm = await parseVoiceProductLLM({
          data: {
            transcript: trimmed,
            unitNames: unitDefs.map((u) => u.name),
          },
        });
        if (llm.available && llm.items.length > 0) {
          const localItems: ParsedProductItem[] = llm.items.map((it) => ({
            rawClause: it.name,
            name: it.name,
            stock: it.stock,
            unit: it.unit,
            price: it.price,
            confidence: it.name && it.price > 0 ? "high" : "partial",
          }));
          resolved = resolveItems(localItems);
        }
      } catch {
        /* محلی می‌مانیم */
      } finally {
        setLlmBusy(false);
      }
    }

    if (resolved.length === 0) {
      resolved = [
        {
          key: Math.random().toString(36).slice(2),
          rawClause: trimmed,
          name: trimmed,
          stock: 0,
          unit: COUNT_UNIT,
          confidence: "partial",
          status: "partial",
        },
      ];
    }

    setResults(resolved);
  };

  const startListening = async () => {
    const rec = recognizerRef.current;
    if (!rec) return;
    setError(null);
    setNotice(null);
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
      onUnavailable: (msg) => {
        setListening(false);
        setError(null);
        setNotice(msg);
        setManualMode(true);
      },
      onEnd: () => setListening(false),
    });
  };

  const stopListening = async () => {
    setListening(false);
    await recognizerRef.current?.stop();
  };

  const confirmPartial = (item: ResolvedProduct) => {
    const created = addProductsBatch([item]);
    if (created.length > 0) {
      setResults((prev) =>
        prev.map((x) =>
          x.key === item.key ? { ...x, status: "added" as const, productId: created[0].id } : x,
        ),
      );
    }
  };

  const discardItem = (key: string) => setResults((prev) => prev.filter((x) => x.key !== key));

  return (
    <Layout>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <VoiceMicIcon className="pointer-events-none" />
          ثبت صوتی محصولات
        </h1>
        <Link
          to="/products"
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Package className="h-3.5 w-3.5" />
          لیست محصولات
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        نام، تعداد و قیمت را بگویید — مثلاً «بیست عدد پیراهن مشکی دویست و پنجاه هزار تومن» یا «ده
        گیلو سیب زمینی سیصد هزار».
      </p>

      {!manualMode && (
        <div className="mb-4 flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 shadow-card">
          <button
            type="button"
            onClick={() => (listening ? stopListening() : startListening())}
            className="flex flex-col items-center gap-3 transition"
            aria-label={listening ? "توقف ضبط" : "شروع ضبط"}
          >
            <VoiceMicIcon size="lg" active={listening} />
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

      {manualMode && (
        <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          {notice ? (
            <p className="mb-2 text-xs text-amber-600">{notice}</p>
          ) : (
            engine === "none" && (
              <p className="mb-2 text-xs text-amber-600">
                تشخیص گفتار روی این دستگاه در دسترس نیست؛ متن را دستی وارد کنید.
              </p>
            )
          )}
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            rows={2}
            placeholder="مثلاً: ۲۰ پیراهن مشکی ۲۵۰ هزار تومن"
            className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void processTranscript(manualText)}
              className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
            >
              تبدیل به محصول
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

      <ul className="space-y-2">
        {results.map((item) => (
          <li key={item.key} className="rounded-2xl border border-border bg-card p-3 shadow-card">
            {item.status === "added" && <AddedRow item={item} />}
            {item.status === "partial" && (
              <PartialRow
                item={item}
                onConfirm={() => confirmPartial(item)}
                onDiscard={() => discardItem(item.key)}
              />
            )}
            {item.status === "failed" && (
              <FailedRow item={item} onDiscard={() => discardItem(item.key)} />
            )}
          </li>
        ))}
      </ul>

      {results.length > 0 && (
        <Link
          to="/products"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          مشاهده محصولات
          {addedCount > 0 && (
            <span className="rounded-md bg-primary-foreground/20 px-2 py-0.5 text-xs">
              {formatNumber(addedCount)} اضافه شد
            </span>
          )}
        </Link>
      )}
    </Layout>
  );
}

function unitLabel(item: ResolvedProduct): string {
  const unit = item.unit;
  return isWeightUnit(unit) ? ` ${unit}` : unit === COUNT_UNIT ? " عدد" : ` ${unit}`;
}

function AddedRow({ item }: { item: ResolvedProduct }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <div className="flex-1">
        <div className="font-semibold text-foreground">محصول اضافه شد ✓</div>
        <div className="text-foreground/80">
          {item.name}
          {item.stock > 0 && (
            <>
              {" "}
              — {formatNumber(item.stock)}
              {unitLabel(item)}
            </>
          )}
          {item.price !== undefined && item.price > 0 && <> · {formatToman(item.price)}</>}
        </div>
      </div>
    </div>
  );
}

function PartialRow({
  item,
  onConfirm,
  onDiscard,
}: {
  item: ResolvedProduct;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const missingPrice = !item.price || item.price <= 0;
  const missingName = !item.name.trim();
  return (
    <div className="text-sm">
      <div className="mb-2 flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="flex-1">
          <div className="font-semibold">نیاز به تایید</div>
          <div className="mt-1 space-y-0.5 text-foreground/80">
            {!missingName && <div>نام: {item.name}</div>}
            {item.stock > 0 && (
              <div>
                موجودی: {formatNumber(item.stock)}
                {unitLabel(item)}
              </div>
            )}
            {!missingPrice && item.price !== undefined && <div>قیمت: {formatToman(item.price)}</div>}
            {(missingName || missingPrice) && (
              <div className="text-xs text-amber-600">
                {missingName && "نام محصول تشخیص داده نشد. "}
                {missingPrice && "قیمت تشخیص داده نشد."}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        {!missingName && !missingPrice && (
          <button
            onClick={onConfirm}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            تایید و افزودن
          </button>
        )}
        <Link
          to="/products"
          search={{ code: item.name }}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs"
        >
          <Pencil className="h-3.5 w-3.5" />
          ویرایش دستی
        </Link>
        <button
          onClick={onDiscard}
          className="rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          نادیده بگیر
        </button>
      </div>
    </div>
  );
}

function FailedRow({ item, onDiscard }: { item: ResolvedProduct; onDiscard: () => void }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="flex-1">
        <div className="font-semibold">افزودن ناموفق</div>
        <div className="text-foreground/80">{item.name || item.rawClause}</div>
        <button
          onClick={onDiscard}
          className="mt-1 text-xs text-muted-foreground underline"
        >
          حذف
        </button>
      </div>
    </div>
  );
}

function VoiceProductsPage() {
  return (
    <AuthGuard>
      <VoiceProductsPageInner />
    </AuthGuard>
  );
}
