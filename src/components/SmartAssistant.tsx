/**
 * «دستیار هوشمند صوتی» — دکمه‌ی شناور سراسری + شیت پایین.
 *
 * معماری دقیقاً همان ثبت صوتی فاکتور/محصولات است:
 *   - موتور تشخیص گفتار: `createRecognizer()` از ‎@/lib/voice/speech‎ (دست‌نخورده)
 *   - تحلیل متن: `parseAssistantCommand` از ‎@/lib/voice/assistant-nlu‎ (محلی و قطعی)
 *   - هیچ فراخوانی شبکه/AI در این مسیر وجود ندارد.
 *
 * نکته‌ی مهم درباره‌ی میکروفون: شناساگر فقط وقتی شیت باز است ساخته می‌شود و با
 * بسته‌شدن شیت `stop()` می‌شود، تا با میکروفون صفحه‌های /voice و /voice-products
 * تداخل نکند. روی همان دو صفحه، دکمه‌ی شناور هم عمداً نمایش داده نمی‌شود.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  HelpCircle,
  Keyboard,
  Mic,
  MicOff,
  Pencil,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import {
  addProductToInvoiceQty,
  customerFullName,
  customers as customersStore,
  dueReminderCount,
  emptyExpense,
  expenses as expensesStore,
  formatJalaliDateTime,
  formatNumber,
  formatToman,
  invoice,
  products as productsStore,
  reminders as remindersStore,
  settings,
  stockStatus,
  type Customer,
  type Product,
} from "@/lib/store";
import { parseAssistantCommand, type AssistantIntent } from "@/lib/voice/assistant-nlu";
import { createRecognizer, type Recognizer, type SpeechEngine } from "@/lib/voice/speech";
import type { ParsedCandidate, ParsedItem } from "@/lib/voice/persian-nlu";

/** صفحه‌هایی که خودشان میکروفون اختصاصی دارند — دکمه‌ی شناور در آن‌ها پنهان است */
const HIDDEN_ON = ["/voice", "/voice-products"];

type ChoosePayload =
  | {
      type: "customer";
      options: Customer[];
      amount: number;
      txType: "debt" | "payment";
      name: string;
    }
  | { type: "product-price"; options: ParsedCandidate[]; price: number; phrase: string }
  | { type: "invoice-item"; options: ParsedCandidate[]; item: ParsedItem };

type Card = {
  key: string;
  /** متنی که شنیده شد (برای حالت نامشخص و ویرایش دستی) */
  heard: string;
  status: "done" | "choose" | "unknown" | "answer";
  title: string;
  detail?: string;
  choose?: ChoosePayload;
};

function vibrate(ms: number) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(ms);
}

function newKey() {
  return Math.random().toString(36).slice(2);
}

/** خواندن پاسخ با صدای دستگاه — کاملاً اختیاری و بی‌خطر */
function speak(text: string) {
  try {
    const synth = typeof window === "undefined" ? undefined : window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fa-IR";
    synth.speak(u);
  } catch {
    /* اگر موتور خواندن نبود، بی‌صدا رد می‌شویم */
  }
}

/**
 * نشان دستیار — صورت رباتی ساده با آنتن؛ چشم‌ها با انیمیشن CSS پلک می‌زنند
 * (کلاس‌های ai-mark-* در styles.css). فقط ظاهری است و هیچ رفتاری ندارد.
 */
function AssistantMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="2.7" r="1.4" fill="currentColor" className="ai-mark-antenna" />
      <path d="M12 4.1v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect
        x="3.4"
        y="6.1"
        width="17.2"
        height="13.4"
        rx="5.2"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M2 11.5v3.1M22 11.5v3.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <g className="ai-mark-eyes" fill="currentColor">
        <circle cx="8.9" cy="11.9" r="1.55" />
        <circle cx="15.1" cy="11.9" r="1.55" />
      </g>
      <path
        d="M9 15.6c1.8 1.3 4.2 1.3 6 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function recurringLabel(days?: number): string {
  if (!days || days <= 0) return "";
  if (days === 1) return " — تکرار روزانه";
  if (days === 7) return " — تکرار هفتگی";
  if (days === 30) return " — تکرار ماهانه";
  if (days === 365) return " — تکرار سالانه";
  return ` — تکرار هر ${formatNumber(days)} روز`;
}

export function SmartAssistant() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [allProducts] = productsStore.useAll();
  const [allCustomers] = customersStore.useAll();
  const [allExpenses] = expensesStore.useAll();
  const [history] = invoice.useHistory();
  const [remindersList] = remindersStore.useAll();
  const [appSettings] = settings.useAll();

  // اعلان شناور یادآوری هم‌ارتفاع همین دکمه است؛ وقتی نشان داده می‌شود دکمه یک
  // پله بالاتر می‌رود تا زیر آن پنهان نشود.
  const reminderToastVisible =
    appSettings.showRemindersFeature !== false && dueReminderCount(remindersList) > 0;

  const [open, setOpen] = useState(false);
  const recognizerRef = useRef<Recognizer | null>(null);
  const [engine, setEngine] = useState<SpeechEngine>("none");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualText, setManualText] = useState("");
  const [cards, setCards] = useState<Card[]>([]);

  // شناساگر فقط در زمان باز بودن شیت زنده است (جلوگیری از تداخل میکروفون)
  useEffect(() => {
    if (!open) return;
    const rec = createRecognizer();
    recognizerRef.current = rec;
    setEngine(rec.engine);
    if (rec.engine === "none") setManualMode(true);
    return () => {
      void rec.stop();
      recognizerRef.current = null;
    };
  }, [open]);

  const context = useMemo(
    () => ({
      products: allProducts,
      customers: allCustomers,
      invoices: history,
      expenses: allExpenses,
    }),
    [allProducts, allCustomers, history, allExpenses],
  );

  // ─── عملیات نوشتن در store (همه با امضای موجود خودِ store) ─────────────────

  const addCustomerTx = (c: Customer, amount: number, txType: "debt" | "payment") => {
    customersStore.addTx(c.id, { type: txType, amount, note: "ثبت با دستیار صوتی" });
    vibrate(40);
  };

  const createCustomerWithTx = (
    name: string,
    amount: number,
    txType: "debt" | "payment",
  ): Customer => {
    const parts = name.split(" ").filter(Boolean);
    const created = customersStore.add({
      firstName: parts[0] || "مشتری",
      lastName: parts.slice(1).join(" ") || undefined,
      note: "ساخته‌شده با دستیار صوتی",
    });
    addCustomerTx(created, amount, txType);
    return created;
  };

  const applyPriceTo = (ids: string[], price: number): number => {
    const list = productsStore.getAll();
    let changed = 0;
    const next = list.map((p) => {
      if (!ids.includes(p.id)) return p;
      changed++;
      return { ...p, price };
    });
    if (changed > 0) {
      productsStore.save(next);
      vibrate(40);
    }
    return changed;
  };

  const addToInvoice = (product: Product, quantity: number): "ok" | "out" => {
    if (stockStatus(product) === "out") return "out";
    const current = invoice.getCurrent();
    invoice.save(addProductToInvoiceQty(current, product, quantity));
    vibrate(40);
    return "ok";
  };

  // ─── تبدیل نیت به کارت نتیجه ───────────────────────────────────────────────

  const cardsForInvoiceItems = (heard: string, items: ParsedItem[]): Card[] =>
    items.map((item) => {
      const best = item.candidates[0];
      if (item.confidence === "none" || !best) {
        return {
          key: newKey(),
          heard,
          status: "unknown" as const,
          title: `کالایی برای «${item.productPhrase}» پیدا نشد`,
          detail: "می‌توانید متن را ویرایش کنید یا این کالا را در بخش محصولات اضافه کنید.",
        };
      }
      if (item.confidence === "high") {
        const res = addToInvoice(best.product, item.quantity);
        if (res === "out") {
          return {
            key: newKey(),
            heard,
            status: "unknown" as const,
            title: `موجودی «${best.product.name}» تمام شده است`,
          };
        }
        return {
          key: newKey(),
          heard,
          status: "done" as const,
          title: "به فاکتور اضافه شد",
          detail: `${best.product.name} — ${formatNumber(item.quantity)} ${item.unit} · ${formatToman(best.product.price)}`,
        };
      }
      return {
        key: newKey(),
        heard,
        status: "choose" as const,
        title: `کدام کالا؟ «${item.productPhrase}»`,
        choose: { type: "invoice-item", options: item.candidates, item },
      };
    });

  const cardsForIntent = (intent: AssistantIntent): Card[] => {
    const heard = intent.raw;
    switch (intent.kind) {
      case "customer_debt": {
        const label = intent.txType === "debt" ? "بدهی" : "پرداخت";
        if (intent.candidates.length === 0) {
          const created = createCustomerWithTx(intent.customerName, intent.amount, intent.txType);
          return [
            {
              key: newKey(),
              heard,
              status: "done",
              title: `${formatToman(intent.amount)} ${label} برای «${customerFullName(created)}» ثبت شد`,
              detail: "این مشتری در فهرست نبود — مشتری جدید ساخته شد.",
            },
          ];
        }
        if (intent.clearWinner) {
          const target = intent.candidates[0].customer;
          addCustomerTx(target, intent.amount, intent.txType);
          return [
            {
              key: newKey(),
              heard,
              status: "done",
              title: `${formatToman(intent.amount)} ${label} برای «${customerFullName(target)}» ثبت شد`,
            },
          ];
        }
        return [
          {
            key: newKey(),
            heard,
            status: "choose",
            title: `کدام مشتری؟ «${intent.customerName}» — ${formatToman(intent.amount)} ${label}`,
            choose: {
              type: "customer",
              options: intent.candidates.map((c) => c.customer),
              amount: intent.amount,
              txType: intent.txType,
              name: intent.customerName,
            },
          },
        ];
      }

      case "expense": {
        expensesStore.add({
          ...emptyExpense(),
          title: intent.title,
          amount: intent.amount,
          recurringDays: intent.recurringDays,
          at: Date.now(),
        });
        vibrate(40);
        return [
          {
            key: newKey(),
            heard,
            status: "done",
            title: `هزینه «${intent.title}» به مبلغ ${formatToman(intent.amount)} ثبت شد`,
            detail: recurringLabel(intent.recurringDays).replace(/^ — /, "") || undefined,
          },
        ];
      }

      case "product_price_edit": {
        if (intent.candidates.length === 0) {
          return [
            {
              key: newKey(),
              heard,
              status: "unknown",
              title: `کالایی با نام «${intent.productPhrase || heard}» پیدا نشد`,
              detail: "نام کالا را دقیق‌تر بگویید یا متن را ویرایش کنید.",
            },
          ];
        }
        if (intent.clearWinner && !intent.applyAllHint) {
          const target = intent.candidates[0].product;
          applyPriceTo([target.id], intent.price);
          return [
            {
              key: newKey(),
              heard,
              status: "done",
              title: `قیمت «${target.name}» به ${formatToman(intent.price)} تغییر کرد`,
            },
          ];
        }
        if (intent.applyAllHint) {
          const ids = intent.candidates.map((c) => c.product.id);
          const changed = applyPriceTo(ids, intent.price);
          return [
            {
              key: newKey(),
              heard,
              status: "done",
              title: `قیمت ${formatNumber(changed)} کالای مشابه «${intent.productPhrase}» به ${formatToman(intent.price)} تغییر کرد`,
              detail: intent.candidates.map((c) => c.product.name).join("، "),
            },
          ];
        }
        return [
          {
            key: newKey(),
            heard,
            status: "choose",
            title: `قیمت کدام کالا به ${formatToman(intent.price)} تغییر کند؟`,
            choose: {
              type: "product-price",
              options: intent.candidates,
              price: intent.price,
              phrase: intent.productPhrase,
            },
          },
        ];
      }

      case "reminder": {
        remindersStore.add({
          title: intent.title,
          dueAt: intent.dueAt,
          recurringDays: intent.recurringDays,
        });
        vibrate(40);
        const defaults: string[] = [];
        if (intent.dateDefaulted) defaults.push("تاریخ گفته نشد — «امروز» در نظر گرفته شد");
        if (intent.timeDefaulted) defaults.push("ساعت گفته نشد — ۹:۰۰ صبح در نظر گرفته شد");
        return [
          {
            key: newKey(),
            heard,
            status: "done",
            title: `یادآوری «${intent.title}» برای ${formatJalaliDateTime(intent.dueAt)} ثبت شد${recurringLabel(intent.recurringDays)}`,
            detail:
              defaults.length > 0
                ? defaults.join(" · ") + " (در صفحه‌ی یادآوری‌ها قابل اصلاح است)"
                : undefined,
          },
        ];
      }

      case "query":
        return [{ key: newKey(), heard, status: "answer", title: intent.answer }];

      case "invoice_item":
        return cardsForInvoiceItems(heard, intent.result.items);

      case "unknown":
        return [
          {
            key: newKey(),
            heard,
            status: "unknown",
            title: intent.reason,
            detail: heard ? `شنیده شد: ${heard}` : undefined,
          },
        ];
    }
  };

  // ─── پردازش یک دستور ───────────────────────────────────────────────────────

  const processTranscript = (text: string) => {
    const trimmed = (text ?? "").trim();
    if (!trimmed) return;
    setError(null);
    setTranscript(trimmed);
    try {
      const intent = parseAssistantCommand(trimmed, context);
      const next = cardsForIntent(intent);
      // دستور بعدی بالای فهرست اضافه می‌شود؛ نتیجه‌های قبلی پاک نمی‌شوند
      setCards((prev) => [...next, ...prev]);
    } catch (e) {
      setError("در تحلیل دستور خطایی رخ داد: " + String((e as Error)?.message ?? e));
    }
  };

  const startListening = async () => {
    const rec = recognizerRef.current;
    if (!rec) return;
    setError(null);
    setNotice(null);
    setTranscript("");
    setListening(true);
    await rec.start({
      onPartial: (t) => setTranscript(t),
      onResult: (t) => {
        setListening(false);
        processTranscript(t);
      },
      onError: (msg) => {
        setListening(false);
        setError(msg);
      },
      // میکروفون در دسترس نیست/اجازه داده نشد → بدون اجبار، ورود دستی متن
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

  const closeSheet = () => {
    setListening(false);
    void recognizerRef.current?.stop();
    setOpen(false);
    setCards([]);
    setTranscript("");
    setError(null);
    setNotice(null);
  };

  const discard = (key: string) => setCards((prev) => prev.filter((c) => c.key !== key));

  const replaceCard = (key: string, patch: Partial<Card>) =>
    setCards((prev) =>
      prev.map((c) => (c.key === key ? { ...c, ...patch, choose: undefined } : c)),
    );

  const editManually = (heard: string) => {
    setManualMode(true);
    setManualText(heard);
  };

  // ─── انتخاب‌ها ─────────────────────────────────────────────────────────────

  const pickCustomer = (card: Card, customer: Customer) => {
    if (card.choose?.type !== "customer") return;
    const { amount, txType } = card.choose;
    addCustomerTx(customer, amount, txType);
    replaceCard(card.key, {
      status: "done",
      title: `${formatToman(amount)} ${txType === "debt" ? "بدهی" : "پرداخت"} برای «${customerFullName(customer)}» ثبت شد`,
      detail: undefined,
    });
  };

  const pickNewCustomer = (card: Card) => {
    if (card.choose?.type !== "customer") return;
    const { amount, txType, name } = card.choose;
    const created = createCustomerWithTx(name, amount, txType);
    replaceCard(card.key, {
      status: "done",
      title: `${formatToman(amount)} ${txType === "debt" ? "بدهی" : "پرداخت"} برای «${customerFullName(created)}» ثبت شد`,
      detail: "مشتری جدید ساخته شد.",
    });
  };

  const pickProductPrice = (card: Card, product: Product) => {
    if (card.choose?.type !== "product-price") return;
    const { price } = card.choose;
    applyPriceTo([product.id], price);
    replaceCard(card.key, {
      status: "done",
      title: `قیمت «${product.name}» به ${formatToman(price)} تغییر کرد`,
      detail: undefined,
    });
  };

  const applyPriceToAll = (card: Card) => {
    if (card.choose?.type !== "product-price") return;
    const { options, price, phrase } = card.choose;
    const changed = applyPriceTo(
      options.map((o) => o.product.id),
      price,
    );
    replaceCard(card.key, {
      status: "done",
      title: `قیمت ${formatNumber(changed)} کالای مشابه «${phrase}» به ${formatToman(price)} تغییر کرد`,
      detail: options.map((o) => o.product.name).join("، "),
    });
  };

  const pickInvoiceProduct = (card: Card, product: Product) => {
    if (card.choose?.type !== "invoice-item") return;
    const { item } = card.choose;
    const res = addToInvoice(product, item.quantity);
    replaceCard(card.key, {
      status: res === "out" ? "unknown" : "done",
      title: res === "out" ? `موجودی «${product.name}» تمام شده است` : "به فاکتور اضافه شد",
      detail:
        res === "out"
          ? undefined
          : `${product.name} — ${formatNumber(item.quantity)} ${product.unit ?? item.unit} · ${formatToman(product.price)}`,
    });
  };

  if (HIDDEN_ON.includes(pathname)) return null;

  return (
    <>
      {/* دکمه‌ی شناور — بالای نوار پایین موبایل */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="دستیار هوشمند صوتی"
        title="دستیار هوشمند"
        className="ai-fab fixed left-4 z-30 h-14 w-14"
        style={{
          bottom: reminderToastVisible
            ? "calc(12rem + var(--safe-bottom))"
            : "calc(5.25rem + var(--safe-bottom))",
        }}
      >
        <span className="ai-fab-glow" aria-hidden="true" />
        <span className="ai-fab-aura" aria-hidden="true" />
        <span className="ai-fab-orbit" aria-hidden="true" />
        <span className="ai-fab-core">
          <AssistantMark className="ai-fab-mark" />
        </span>
        <span className="ai-fab-spark" aria-hidden="true">
          <Sparkles className="h-2.5 w-2.5" />
        </span>
      </button>

      <Drawer
        open={open}
        onOpenChange={(v) => {
          if (v) setOpen(true);
          else closeSheet();
        }}
      >
        <DrawerContent dir="rtl" className="max-h-[88svh]">
          <DrawerHeader className="pb-2 text-right">
            <DrawerTitle className="flex items-center gap-2 text-base">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant">
                <AssistantMark className="h-5 w-5" />
              </span>
              دستیار هوشمند
            </DrawerTitle>
            <DrawerDescription className="text-xs">
              یک دستور بگویید — مثلاً «آقای شهریاری ۲۵۰ هزار تومان بدهکار است»، «ماهانه ۴۵ میلیون
              هزینه اجاره خانه»، «یادآوری پرداخت بدهی ساعت ۱۳:۳۰» یا «پرسودترین کالای من چیه؟»
            </DrawerDescription>
          </DrawerHeader>

          <div className="overflow-y-auto px-4 pb-6">
            {/* میکروفون */}
            {!manualMode && (
              <div className="mb-4 flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 shadow-card">
                <button
                  type="button"
                  onClick={() => (listening ? void stopListening() : void startListening())}
                  className={`grid h-20 w-20 place-items-center rounded-full text-primary-foreground shadow-elegant transition ${
                    listening ? "animate-pulse bg-destructive" : "bg-gradient-primary"
                  }`}
                  aria-label={listening ? "توقف ضبط" : "شروع ضبط"}
                >
                  {listening ? <MicOff className="h-9 w-9" /> : <Mic className="h-9 w-9" />}
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

            {/* ورود دستی (یا وقتی میکروفون در دسترس نیست) */}
            {manualMode && (
              <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
                {notice ? (
                  <p className="mb-2 text-xs text-amber-600">{notice}</p>
                ) : (
                  engine === "none" && (
                    <p className="mb-2 text-xs text-amber-600">
                      تشخیص گفتار روی این دستگاه در دسترس نیست؛ متن دستور را دستی وارد کنید.
                    </p>
                  )
                )}
                <textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  rows={2}
                  placeholder="مثلاً: ماهانه ۴۵ میلیون هزینه اجاره خانه"
                  className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      processTranscript(manualText);
                      setManualText("");
                    }}
                    className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
                  >
                    اجرای دستور
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
                  onClick={() => setTranscript("")}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="پاک کردن"
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

            {/* نتایج */}
            <ul className="space-y-2">
              {cards.map((card) => (
                <li
                  key={card.key}
                  className="rounded-2xl border border-border bg-card p-3 shadow-card"
                >
                  {card.status === "done" && (
                    <div className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <div className="flex-1">
                        <div className="font-semibold text-foreground">{card.title}</div>
                        {card.detail && (
                          <div className="mt-0.5 text-foreground/80">{card.detail}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {card.status === "answer" && (
                    <div className="flex items-start gap-2 text-sm">
                      <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="flex-1">
                        <div className="whitespace-pre-line leading-6">{card.title}</div>
                        <button
                          onClick={() => speak(card.title)}
                          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground"
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                          خواندن پاسخ
                        </button>
                      </div>
                    </div>
                  )}

                  {card.status === "choose" && card.choose && (
                    <div className="text-sm">
                      <div className="mb-2 flex items-start gap-2">
                        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <div className="flex-1 font-medium">{card.title}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {card.choose.type === "customer" &&
                          card.choose.options.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => pickCustomer(card, c)}
                              className="rounded-xl border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
                            >
                              {customerFullName(c) || "مشتری"}
                            </button>
                          ))}
                        {card.choose.type === "customer" && (
                          <button
                            onClick={() => pickNewCustomer(card)}
                            className="rounded-xl border border-dashed border-primary/50 px-3 py-2 text-sm text-primary"
                          >
                            مشتری جدید «{card.choose.name}»
                          </button>
                        )}

                        {card.choose.type === "product-price" &&
                          card.choose.options.map((o) => (
                            <button
                              key={o.product.id}
                              onClick={() => pickProductPrice(card, o.product)}
                              className="rounded-xl border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
                            >
                              {o.product.name}
                              <span className="mr-1 text-xs text-muted-foreground">
                                {formatToman(o.product.price)}
                              </span>
                            </button>
                          ))}
                        {card.choose.type === "product-price" && card.choose.options.length > 1 && (
                          <button
                            onClick={() => applyPriceToAll(card)}
                            className="rounded-xl border border-dashed border-primary/50 px-3 py-2 text-sm text-primary"
                          >
                            اعمال روی همه‌ی موارد مشابه
                          </button>
                        )}

                        {card.choose.type === "invoice-item" &&
                          card.choose.options.map((o) => (
                            <button
                              key={o.product.id}
                              onClick={() => pickInvoiceProduct(card, o.product)}
                              className="rounded-xl border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
                            >
                              {o.product.name}
                              <span className="mr-1 text-xs text-muted-foreground">
                                {formatToman(o.product.price)}
                              </span>
                            </button>
                          ))}

                        <button
                          onClick={() => discard(card.key)}
                          className="rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
                        >
                          لغو
                        </button>
                      </div>
                    </div>
                  )}

                  {card.status === "unknown" && (
                    <div className="flex items-start gap-2 text-sm">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <div className="flex-1">
                        <div className="font-semibold">{card.title}</div>
                        {card.detail && (
                          <div className="mt-0.5 text-foreground/80">{card.detail}</div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            onClick={() => editManually(card.heard)}
                            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            ویرایش دستی
                          </button>
                          <Link
                            to="/products"
                            onClick={closeSheet}
                            className="rounded-lg border border-border px-3 py-1.5 text-xs"
                          >
                            بخش محصولات
                          </Link>
                          <button
                            onClick={() => discard(card.key)}
                            className="rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground"
                          >
                            نادیده بگیر
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={closeSheet}
              className="mt-4 w-full rounded-xl border border-border py-2.5 text-sm text-muted-foreground"
            >
              بستن دستیار
            </button>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
