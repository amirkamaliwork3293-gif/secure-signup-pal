import { AuthGuard } from "@/components/AuthGuard";
import { RequireActiveSubscription } from "@/components/RequireActiveSubscription";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  products,
  invoice,
  addProductToInvoiceQty,
  addCustomInvoiceLine,
  formatToman,
  formatNumber,
  stockStatus,
  inventoryTrackingEnabled,
  isWeightUnit,
  customers,
  customerFullName,
  recalc,
  type Product,
  type Invoice,
  type Customer,
  type CustomerInfo,
} from "@/lib/store";
import { invoiceTotals, lineTotal } from "@/lib/invoice-math";
import { parseVoiceText, type ParsedItem, type ParsedCandidate } from "@/lib/voice/persian-nlu";
import {
  customerHasInfo,
  customerInfoFromVoice,
  maybeFillCustomerPhone,
  type VoiceCustomerHit,
} from "@/lib/voice/invoice-customer";
import { filterAndRankSearch, personNameSearchFields } from "@/lib/search";
import { createRecognizer, type Recognizer, type SpeechEngine } from "@/lib/voice/speech";
import { parseVoiceInvoiceLLM } from "@/lib/api/voice.functions";
import { InvoicePreviewModal } from "@/components/InvoicePreviewModal";
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
  Eye,
  Pencil,
  Trash2,
  Minus,
  User,
  Receipt,
} from "lucide-react";

export const Route = createFileRoute("/voice")({
  head: () => ({
    meta: [
      { title: "ثبت صوتی | KAMIX" },
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
  unitPrice?: number;
};

function vibrate(ms: number) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(ms);
}

function VoicePageInner() {
  const [allProducts] = products.useAll();
  const [allCustomers] = customers.useAll();
  const [inv, setInv] = invoice.useCurrent();
  const recognizerRef = useRef<Recognizer | null>(null);
  const [engine, setEngine] = useState<SpeechEngine>("none");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResolvedItem[]>([]);
  const [manualMode, setManualMode] = useState(false);
  const [manualText, setManualText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const [customerChoices, setCustomerChoices] = useState<VoiceCustomerHit[]>([]);
  const [editingDraft, setEditingDraft] = useState(false);
  const [printPreview, setPrintPreview] = useState(false);
  // تشخیص فنی — فقط داخل اپ نیتیو (APK) برای فهمیدن علت کار نکردن میکروفون
  const [capInfo, setCapInfo] = useState<{ native: boolean; plugins: string[] } | null>(null);

  useEffect(() => {
    const rec = createRecognizer();
    recognizerRef.current = rec;
    setEngine(rec.engine);
    if (rec.engine === "none") setManualMode(true);

    // آیا پل صوتی نیتیو KamaliVoice واقعاً داخل APK تزریق شده؟
    // این یک رابط خام WebView است (addJavascriptInterface)، نه یک پلاگین Capacitor،
    // پس باید مستقیماً روی window چک شود.
    try {
      const cap = (
        window as unknown as {
          Capacitor?: {
            isNativePlatform?: () => boolean;
            Plugins?: Record<string, unknown>;
            PluginHeaders?: Array<{ name: string }>;
          };
          KamaliVoice?: { start?: unknown };
        }
      ).Capacitor;
      const kamaliVoice = (window as unknown as { KamaliVoice?: { start?: unknown } }).KamaliVoice;
      const native = !!cap?.isNativePlatform?.() || !!kamaliVoice;
      const headers = cap?.PluginHeaders?.map((h) => h.name) ?? [];
      const keys = cap?.Plugins ? Object.keys(cap.Plugins) : [];
      const plugins = (headers.length ? headers : keys).slice();
      if (kamaliVoice && typeof kamaliVoice.start === "function") plugins.push("KamaliVoice");
      if (native) setCapInfo({ native, plugins: plugins.sort() });
    } catch {
      /* ignore */
    }

    return () => {
      void rec.stop();
    };
  }, []);

  // افزودن یک آیتم مشخص به فاکتور جاری (با بررسی موجودی)
  const addToInvoice = (product: Product, quantity: number, unitPrice?: number): "ok" | "out" => {
    if (inventoryTrackingEnabled() && stockStatus(product) === "out") return "out";
    const current = invoice.getCurrent();
    const next = addProductToInvoiceQty(current, product, quantity, { unitPrice });
    invoice.save(next);
    vibrate(40);
    return "ok";
  };

  const addCustomLine = (item: ParsedItem) => {
    const current = invoice.getCurrent();
    invoice.save(
      addCustomInvoiceLine(current, {
        name: item.productPhrase,
        price: item.unitPrice ?? 0,
        quantity: item.quantity,
        unit: item.unit,
      }),
    );
    vibrate(40);
  };

  // اعمال مشتری/تلفن/روش پرداخت روی پیش‌نویس فاکتور جاری — ثبت نهایی اینجا نیست
  const applyMeta = (
    customerName?: string,
    customerPhone?: string,
    paymentMethod?: Invoice["paymentMethod"],
  ) => {
    if (!customerName && !customerPhone && !paymentMethod) return;
    const current = invoice.getCurrent();
    const patched: Invoice = { ...current };
    if (customerName || customerPhone) {
      const resolved = customerInfoFromVoice(
        customerName,
        customerPhone,
        customers.getAll(),
        current.customer,
      );
      patched.customer = resolved.info;
      if (resolved.clearWinner) {
        maybeFillCustomerPhone(resolved.candidates[0]?.customer, customerPhone);
        setCustomerChoices([]);
      } else if (resolved.candidates.length > 0) {
        setCustomerChoices(resolved.candidates);
      } else {
        setCustomerChoices([]);
      }
    }
    if (paymentMethod) patched.paymentMethod = paymentMethod;
    invoice.save(patched);
  };

  const pickCustomer = (c: Customer) => {
    const current = invoice.getCurrent();
    const phone = current.customer?.phone || c.phone;
    invoice.save({
      ...current,
      customer: { firstName: c.firstName, lastName: c.lastName, phone },
    });
    if (phone && !c.phone) maybeFillCustomerPhone(c, phone);
    setCustomerChoices([]);
  };

  const updateDraftQty = (productId: string, delta: number) => {
    setInv((prev) => {
      const items = prev.items
        .map((i) => (i.productId === productId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0);
      return recalc({ ...prev, items });
    });
  };

  const setDraftQty = (productId: string, quantity: number) => {
    setInv((prev) => {
      const items = prev.items
        .map((i) => (i.productId === productId ? { ...i, quantity } : i))
        .filter((i) => i.quantity > 0);
      return recalc({ ...prev, items });
    });
  };

  const setDraftPrice = (productId: string, price: number) => {
    if (price < 0) return;
    setInv((prev) =>
      recalc({
        ...prev,
        items: prev.items.map((i) =>
          i.productId === productId
            ? { ...i, price, discountPercent: undefined, originalPrice: undefined }
            : i,
        ),
      }),
    );
  };

  const removeDraftLine = (productId: string) => {
    setInv((prev) => recalc({ ...prev, items: prev.items.filter((i) => i.productId !== productId) }));
  };

  const saveDraftCustomer = (next: CustomerInfo) => {
    setInv((prev) => ({ ...prev, customer: next }));
  };

  const selectDraftCustomer = (c: Customer) => {
    saveDraftCustomer({ firstName: c.firstName, lastName: c.lastName, phone: c.phone });
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
      unitPrice: item.unitPrice,
    };
    if (item.confidence === "none" || item.candidates.length === 0) {
      if (item.productPhrase.trim()) {
        addCustomLine(item);
        return { ...base, status: "added" };
      }
      return { ...base, status: "unknown" };
    }
    if (item.confidence === "high") {
      const res = addToInvoice(item.candidates[0].product, item.quantity, item.unitPrice);
      return { ...base, status: res === "out" ? "out" : "added" };
    }
    return { ...base, status: "choose" };
  };

  const processTranscript = async (text: string) => {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed) return;
    setTranscript(trimmed);

    try {
      const parsed = parseVoiceText(trimmed, allProducts);
      applyMeta(parsed.customerName, parsed.customerPhone, parsed.paymentMethod);

      let resolved = parsed.items.map(resolveItem);

      // اگر همه‌ی آیتم‌ها نامشخص بودند و آنلاین هستیم → تلاش با مدل زبانی (در صورت وجود کلید)
      const allWeak = resolved.length === 0 || resolved.every((r) => r.status === "unknown");
      const online = typeof navigator === "undefined" || navigator.onLine;
      const customerOnly = resolved.length === 0 && !!(parsed.customerName || parsed.customerPhone);
      if (allWeak && online && !customerOnly) {
        setLlmBusy(true);
        try {
          const llm = await parseVoiceInvoiceLLM({
            data: { transcript: trimmed, productNames: allProducts.map((p) => p.name) },
          });
          if (llm.available && llm.items.length > 0) {
            applyMeta(llm.customerName, parsed.customerPhone, llm.paymentMethod);
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

      // اگر بعد از تلاش محلی و LLM چیزی استخراج نشد، یک سطر «پیدا نشد» نشان بده
      // (مگر این‌که فقط نام/تلفن مشتری گفته شده باشد)
      if (resolved.length === 0 && !(parsed.customerName || parsed.customerPhone)) {
        resolved = [{
          key: Math.random().toString(36).slice(2),
          rawClause: trimmed,
          productPhrase: trimmed,
          quantity: 1,
          unit: "عدد",
          candidates: [],
          status: "unknown",
        }];
      }

      setResults(resolved);
    } catch (e) {
      console.error(e);
      setError("در تحلیل گفتار خطایی رخ داد. لطفاً دوباره بگویید یا متن را دستی وارد کنید.");
    }
  };

  const startListening = async () => {
    const rec = recognizerRef.current;
    if (!rec) return;
    setError(null);
    setNotice(null);
    setResults([]);
    setCustomerChoices([]);
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
      // میکروفون در دسترس نیست/اجازه داده نشد → بدون اجبار، به ورود دستی برمی‌گردیم
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

  // انتخاب یک محصول از میان گزینه‌های پیشنهادی برای یک آیتم
  const pickCandidate = (item: ResolvedItem, product: Product) => {
    const r = parseVoiceText(item.rawClause || product.name, [product]);
    const qty = r.items[0]?.quantity ?? item.quantity ?? 1;
    const res = addToInvoice(product, qty, r.items[0]?.unitPrice);
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

  /** انصراف از ثبت صوتی: کالا و مشتری همین تب فاکتور پاک می‌شود، صفحه عوض نمی‌شود */
  const discardVoiceDraft = () => {
    const current = invoice.getCurrent();
    invoice.save(recalc({ ...current, items: [], customer: {} }));
    setResults([]);
    setCustomerChoices([]);
    setTranscript("");
    setEditingDraft(false);
    setError(null);
  };

  return (
    <Layout>
      <h1 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <Mic className="h-5 w-5 text-primary" />
        ثبت صوتی فاکتور
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        کالا را بگویید — مثلاً «دو تا تیشرت و سه تا شلوار». اگر کالا در فهرست نباشد هم می‌توانید
        با قیمت ثبت کنید. ثبت نهایی در بخش فاکتور است.
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
            placeholder="مثلاً: دو تا تیشرت و سه تا شلوار برای آقای امیر احمدی"
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
            type="button"
            onClick={discardVoiceDraft}
            className="text-muted-foreground hover:text-destructive"
            aria-label="پاک کردن شنیده‌شده و پیش‌نویس صوتی"
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

      {customerChoices.length > 0 && (
        <div className="mt-3 rounded-2xl border border-border bg-card p-3 shadow-card">
          <div className="mb-2 text-sm">
            <span className="text-muted-foreground">کدام مشتری؟ </span>
            <span className="font-medium">
              «{[inv.customer?.firstName, inv.customer?.lastName].filter(Boolean).join(" ")}»
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {customerChoices.map((hit) => (
              <button
                key={hit.customer.id}
                type="button"
                onClick={() => pickCustomer(hit.customer)}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
              >
                {customerFullName(hit.customer)}
                {hit.customer.phone && (
                  <span className="mr-1 text-xs text-muted-foreground" dir="ltr">
                    {hit.customer.phone}
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomerChoices([])}
              className="rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
            >
              همین نام بماند
            </button>
          </div>
        </div>
      )}

      {(inv.items.length > 0 || customerHasInfo(inv.customer)) && (
        <VoiceDraftPreview
          inv={inv}
          customers={allCustomers}
          editing={editingDraft}
          onToggleEdit={() => setEditingDraft((v) => !v)}
          onShowPrint={() => setPrintPreview(true)}
          onQty={updateDraftQty}
          onSetQty={setDraftQty}
          onRemove={removeDraftLine}
          onSetPrice={setDraftPrice}
          onCustomer={saveDraftCustomer}
          onPickCustomer={selectDraftCustomer}
          onDiscardAll={discardVoiceDraft}
        />
      )}

      {(results.length > 0 || inv.items.length > 0 || customerHasInfo(inv.customer)) && (
        <Link
          to="/"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          <Receipt className="h-4 w-4" />
          ادامه و ثبت نهایی در فاکتور
        </Link>
      )}

      {printPreview && (
        <InvoicePreviewModal
          inv={inv}
          heading="پیش‌نمایش فاکتور"
          onClose={() => setPrintPreview(false)}
        />
      )}

      {/* تشخیص فنی — فقط داخل اپ نیتیو نمایش داده می‌شود (برای رفع اشکال میکروفون) */}
      {capInfo && (
        <details className="mt-6 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium">تشخیص فنی میکروفون</summary>
          <div className="mt-2 space-y-1 leading-6">
            <div>
              موتور تشخیص گفتار: <b dir="ltr">{engine}</b>
            </div>
            <div>
              داخل اپ نیتیو: <b>{capInfo.native ? "بله" : "خیر"}</b>
            </div>
            <div>
              پل صوتی نیتیو (KamaliVoice):{" "}
              <b>{capInfo.plugins.includes("KamaliVoice") ? "موجود ✓" : "یافت نشد ✗"}</b>
            </div>
            <div className="break-all">
              پلاگین‌های نصب‌شده:{" "}
              <b dir="ltr">{capInfo.plugins.length ? capInfo.plugins.join(", ") : "—"}</b>
            </div>
          </div>
        </details>
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
          {(item.unitPrice || p) && <> · {formatToman(item.unitPrice ?? p!.price)}</>}
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
        <div className="mt-1 text-xs text-muted-foreground">
          تا ثبت نهایی فاکتور در همین صفحه بمانید؛ نام را دوباره بگویید یا کالا را دستی ویرایش کنید.
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
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

function VoiceDraftPreview({
  inv,
  customers: customerList,
  editing,
  onToggleEdit,
  onShowPrint,
  onQty,
  onSetQty,
  onRemove,
  onSetPrice,
  onCustomer,
  onPickCustomer,
  onDiscardAll,
}: {
  inv: Invoice;
  customers: Customer[];
  editing: boolean;
  onToggleEdit: () => void;
  onShowPrint: () => void;
  onQty: (productId: string, delta: number) => void;
  onSetQty: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onSetPrice: (productId: string, price: number) => void;
  onCustomer: (c: CustomerInfo) => void;
  onPickCustomer: (c: Customer) => void;
  onDiscardAll: () => void;
}) {
  const [q, setQ] = useState("");
  const totals = invoiceTotals(inv);
  const cust = inv.customer ?? {};
  const matches =
    q.trim().length > 0
      ? filterAndRankSearch(customerList, q, (c) => [...personNameSearchFields(c), c.phone ?? ""]).slice(
          0,
          6,
        )
      : [];

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Eye className="h-4 w-4 text-primary" />
          پیش‌نمایش فاکتور
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onToggleEdit}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs"
          >
            <Pencil className="h-3.5 w-3.5" />
            {editing ? "بستن ویرایش" : "ویرایش دستی"}
          </button>
          <button
            type="button"
            onClick={onShowPrint}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs"
          >
            <Eye className="h-3.5 w-3.5" />
            مشاهده کامل
          </button>
          <button
            type="button"
            onClick={onDiscardAll}
            className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
            aria-label="انصراف و پاک کردن همه چیزهایی که در ثبت صوتی اضافه شد"
            title="انصراف — پاک کردن کالا و مشتری این پیش‌نویس"
          >
            <X className="h-3.5 w-3.5" />
            انصراف
          </button>
        </div>
      </div>

      {inv.items.length === 0 ? (
        <p className="mb-3 text-xs text-muted-foreground">هنوز کالایی به فاکتور اضافه نشده است.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {inv.items.map((item) => (
            <li
              key={item.productId}
              className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{item.name}</div>
                <div className="text-xs text-muted-foreground">
                  {editing ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      defaultValue={String(item.price || "")}
                      onBlur={(e) => {
                        const n = Number(e.target.value.replace(/[,٬]/g, ""));
                        if (Number.isFinite(n) && n >= 0) onSetPrice(item.productId, n);
                      }}
                      className="mt-1 w-28 rounded-lg border border-input bg-background px-1.5 py-1 text-xs"
                      aria-label="قیمت واحد"
                    />
                  ) : (
                    <>
                      {formatToman(item.price)}
                      {item.unit && isWeightUnit(item.unit) ? ` / ${item.unit}` : ""}
                    </>
                  )}
                </div>
              </div>
              {editing ? (
                <div className="flex items-center gap-1">
                  {isWeightUnit(item.unit) ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={String(item.quantity)}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(",", "."));
                        if (Number.isFinite(n) && n > 0) onSetQty(item.productId, n);
                      }}
                      className="w-16 rounded-lg border border-input bg-background px-1.5 py-1 text-center text-xs"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onQty(item.productId, -1)}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-border"
                        aria-label="کم کردن"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="min-w-6 text-center text-xs font-medium">
                        {formatNumber(item.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onQty(item.productId, 1)}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-border"
                        aria-label="زیاد کردن"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(item.productId)}
                    className="grid h-7 w-7 place-items-center rounded-lg text-destructive"
                    aria-label="حذف کالا"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="shrink-0 text-xs text-muted-foreground">
                  {formatNumber(item.quantity)}
                  {item.unit && isWeightUnit(item.unit) ? ` ${item.unit}` : " عدد"} ·{" "}
                  {formatToman(lineTotal(item))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mb-3 rounded-xl border border-dashed border-border bg-background p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
          <User className="h-3.5 w-3.5 text-primary" />
          مشتری و تلفن
        </div>
        {editing ? (
          <div className="space-y-2">
            <div className="relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جستجو در مشتریان ذخیره‌شده..."
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {matches.length > 0 && (
                <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-40 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                  {matches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onPickCustomer(c);
                        setQ("");
                      }}
                      className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-right text-xs last:border-0 hover:bg-accent"
                    >
                      <span className="truncate font-medium">{customerFullName(c)}</span>
                      {c.phone && (
                        <span dir="ltr" className="shrink-0 text-muted-foreground">
                          {c.phone}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={cust.firstName ?? ""}
                onChange={(e) => onCustomer({ ...cust, firstName: e.target.value })}
                placeholder="نام"
                className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                value={cust.lastName ?? ""}
                onChange={(e) => onCustomer({ ...cust, lastName: e.target.value })}
                placeholder="نام خانوادگی"
                className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <input
              value={cust.phone ?? ""}
              onChange={(e) => onCustomer({ ...cust, phone: e.target.value })}
              placeholder="شماره تلفن"
              inputMode="tel"
              dir="ltr"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        ) : customerHasInfo(cust) ? (
          <div className="text-sm">
            <span className="font-medium">
              {[cust.firstName, cust.lastName].filter(Boolean).join(" ") || "مشتری"}
            </span>
            {cust.phone && (
              <span className="mr-2 text-muted-foreground" dir="ltr">
                {cust.phone}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">مشتری گفته نشده — می‌توانید دستی وارد کنید.</p>
        )}
      </div>

      <div className="text-sm font-semibold">
        جمع کل: {formatToman(totals.total)}
        {inv.items.length > 0 && (
          <span className="mr-2 text-xs font-normal text-muted-foreground">
            ({formatNumber(inv.items.length)} قلم)
          </span>
        )}
      </div>
    </div>
  );
}

function VoicePage() {
  return (
    <AuthGuard>
      <RequireActiveSubscription feature="ثبت صوتی">
        <VoicePageInner />
      </RequireActiveSubscription>
    </AuthGuard>
  );
}
