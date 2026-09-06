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

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
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
  Receipt,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import {
  addProductToInvoiceQty,
  addCustomInvoiceLine,
  customerBalance,
  customerFullName,
  customers as customersStore,
  cryptoId,
  COUNT_UNIT,
  dueReminderCount,
  emptyExpense,
  emptyManualLedger,
  expenses as expensesStore,
  formatJalaliDateTime,
  formatNumber,
  formatToman,
  inventoryTrackingEnabled,
  invoice,
  manualLedger as ledgerStore,
  products as productsStore,
  reminders as remindersStore,
  settings,
  stockStatus,
  type Customer,
  type Product,
} from "@/lib/store";
import { markAssistantOpened } from "@/lib/onboarding";
import { generateUniqueCode } from "@/lib/barcode-code";
import {
  parseAssistantCommand,
  resolveCustomerTx,
  type AssistantIntent,
  type CustomerLedgerRole,
} from "@/lib/voice/assistant-nlu";
import { createRecognizer, type Recognizer, type SpeechEngine } from "@/lib/voice/speech";
import type { ParsedCandidate, ParsedItem } from "@/lib/voice/persian-nlu";
import type { ParsedProductItem } from "@/lib/voice/product-nlu";

/** صفحه‌هایی که خودشان میکروفون اختصاصی دارند — دکمه‌ی شناور در آن‌ها پنهان است */
const HIDDEN_ON = ["/voice", "/voice-products"];

type ChoosePayload =
  | {
      type: "customer";
      options: Customer[];
      amount: number;
      role: CustomerLedgerRole;
      settleAll: boolean;
      name: string;
      at?: number;
      phone?: string;
      settlementDate?: string;
    }
  | { type: "product-price"; options: ParsedCandidate[]; price: number; phrase: string }
  | { type: "invoice-item"; options: ParsedCandidate[]; item: ParsedItem }
  | { type: "open-invoice"; options: Customer[]; name: string };

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

function ledgerLabel(role: CustomerLedgerRole): string {
  if (role === "debtor") return "بدهی";
  if (role === "creditor") return "طلبکاری";
  return "تسویه";
}

function productUnitLabel(item: ParsedProductItem): string {
  const unit = item.unit;
  return unit === COUNT_UNIT ? " عدد" : ` ${unit}`;
}

const FAB_SIZE = 56;
const FAB_PAD = 10;
const FAB_NAV = 84;
const FAB_POS_KEY = "acc.assistantFabPos.v1";
const FAB_HOLD_MS = 220;
const FAB_DRAG_PX = 10;

type FabPos = { left: number; top: number; custom: boolean };

function clampFabPos(left: number, top: number): { left: number; top: number } {
  const vw = typeof window === "undefined" ? 360 : window.innerWidth;
  const vh = typeof window === "undefined" ? 640 : window.innerHeight;
  const maxL = Math.max(FAB_PAD, vw - FAB_SIZE - FAB_PAD);
  const maxT = Math.max(FAB_PAD, vh - FAB_SIZE - FAB_PAD);
  return {
    left: Math.min(maxL, Math.max(FAB_PAD, left)),
    top: Math.min(maxT, Math.max(FAB_PAD, top)),
  };
}

function defaultFabPos(raised: boolean): FabPos {
  const vh = typeof window === "undefined" ? 640 : window.innerHeight;
  const extra = raised ? 108 : 0;
  return { ...clampFabPos(FAB_PAD + 6, vh - FAB_SIZE - FAB_NAV - extra), custom: false };
}

function readFabPos(): FabPos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FAB_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<FabPos>;
    if (typeof p.left !== "number" || typeof p.top !== "number") return null;
    return { ...clampFabPos(p.left, p.top), custom: p.custom !== false };
  } catch {
    return null;
  }
}

function writeFabPos(pos: FabPos) {
  try {
    localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

function DraggableAssistantFab({ raised, onOpen }: { raised: boolean; onOpen: () => void }) {
  const [pos, setPos] = useState<FabPos | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    moved: boolean;
    active: boolean;
    timer: number | null;
  } | null>(null);

  useEffect(() => {
    const saved = readFabPos();
    setPos(saved ?? defaultFabPos(raised));
    // فقط یک‌بار از حافظه بخوان؛ بعداً اگر سفارشی نبود با raised به‌روز می‌شود
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPos((prev) => {
      if (!prev || prev.custom) return prev;
      return defaultFabPos(raised);
    });
  }, [raised]);

  useEffect(() => {
    const onResize = () => {
      setPos((prev) => {
        if (!prev) return prev;
        if (!prev.custom) return defaultFabPos(raised);
        const next = { ...prev, ...clampFabPos(prev.left, prev.top) };
        writeFabPos(next);
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [raised]);

  const beginDrag = () => {
    if (!drag.current) return;
    drag.current.active = true;
    setDragging(true);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button != null && e.button !== 0) return;
    const current = pos ?? defaultFabPos(raised);
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: current.left,
      origTop: current.top,
      moved: false,
      active: false,
      timer: window.setTimeout(beginDrag, FAB_HOLD_MS),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active && Math.hypot(dx, dy) >= FAB_DRAG_PX) {
      if (d.timer != null) {
        window.clearTimeout(d.timer);
        d.timer = null;
      }
      d.active = true;
      setDragging(true);
    }
    if (!d.active) return;
    e.preventDefault();
    d.moved = true;
    const next = { ...clampFabPos(d.origLeft + dx, d.origTop + dy), custom: true };
    setPos(next);
  };

  const endPointer = (e: PointerEvent<HTMLButtonElement>, openIfTap: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.timer != null) window.clearTimeout(d.timer);
    const wasDrag = d.active && d.moved;
    drag.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (wasDrag) {
      setPos((prev) => {
        const next = prev ?? defaultFabPos(raised);
        writeFabPos({ ...next, custom: true });
        return { ...next, custom: true };
      });
      return;
    }
    if (openIfTap) onOpen();
  };

  if (!pos) return null;

  return (
    <button
      type="button"
      data-tour="smart-assistant"
      aria-label="دستیار هوشمند صوتی"
      title="دستیار هوشمند — برای جابجایی نگه دارید"
      className={`ai-fab${dragging ? " is-dragging" : ""}`}
      style={{ left: pos.left, top: pos.top, right: "auto", bottom: "auto" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, true)}
      onPointerCancel={(e) => endPointer(e, false)}
      onContextMenu={(e) => e.preventDefault()}
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
  );
}

export function SmartAssistant() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [allProducts] = productsStore.useAll();
  const [allCustomers] = customersStore.useAll();
  const [allExpenses] = expensesStore.useAll();
  const [allLedger] = ledgerStore.useAll();
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
      manualLedger: allLedger,
    }),
    [allProducts, allCustomers, history, allExpenses, allLedger],
  );

  // ─── عملیات نوشتن در store (همه با امضای موجود خودِ store) ─────────────────

  const addCustomerTx = (
    c: Customer,
    amount: number,
    txType: "debt" | "payment",
    note: string,
    at?: number,
  ) => {
    customersStore.addTx(c.id, { type: txType, amount, note, at });
    vibrate(40);
  };

  const applyCustomerExtras = (
    customerId: string,
    extra?: { phone?: string; settlementDate?: string },
  ) => {
    if (!extra?.phone && !extra?.settlementDate) return;
    const latest = customersStore.getAll().find((x) => x.id === customerId);
    if (!latest) return;
    const next = {
      ...latest,
      phone: extra.phone || latest.phone,
      settlementDate:
        extra.settlementDate && customerBalance(latest) > 0
          ? extra.settlementDate
          : latest.settlementDate,
    };
    if (next.phone === latest.phone && next.settlementDate === latest.settlementDate) return;
    customersStore.update(next);
  };

  const createCustomerWithTx = (
    name: string,
    amount: number,
    txType: "debt" | "payment",
    note: string,
    at?: number,
    extra?: { phone?: string; settlementDate?: string },
  ): Customer => {
    const parts = name.split(" ").filter(Boolean);
    const created = customersStore.add({
      firstName: parts[0] || "مشتری",
      lastName: parts.slice(1).join(" ") || undefined,
      note: "ساخته‌شده با دستیار صوتی",
      phone: extra?.phone,
      settlementDate: extra?.settlementDate,
    });
    addCustomerTx(created, amount, txType, note, at);
    applyCustomerExtras(created.id, extra);
    return created;
  };

  const applyLedger = (
    customer: Customer | undefined,
    role: CustomerLedgerRole,
    amount: number,
    settleAll: boolean,
    name: string,
    at?: number,
    extra?: { phone?: string; settlementDate?: string },
  ): Card => {
    const resolved = resolveCustomerTx(role, amount, settleAll, customer);
    if ("error" in resolved) {
      return { key: newKey(), heard: name, status: "unknown", title: resolved.error };
    }
    let target = customer;
    let createdNew = false;
    if (!target) {
      if (role === "settle") {
        return {
          key: newKey(),
          heard: name,
          status: "unknown",
          title: `مشتری‌ای با نام «${name}» پیدا نشد؛ برای تسویه باید از قبل در فهرست باشد.`,
        };
      }
      target = createCustomerWithTx(
        name,
        resolved.amount,
        resolved.type,
        resolved.note,
        at,
        extra,
      );
      createdNew = true;
    } else {
      addCustomerTx(target, resolved.amount, resolved.type, resolved.note, at);
      applyCustomerExtras(target.id, extra);
    }
    const latest = customersStore.getAll().find((x) => x.id === target.id) ?? target;
    const who = customerFullName(latest);
    const dateBit = at ? ` — ${formatJalaliDateTime(at)}` : "";
    const dueBit = latest.settlementDate ? ` — تسویه تا ${latest.settlementDate}` : "";
    const phoneBit = latest.phone ? ` — ${latest.phone}` : "";
    return {
      key: newKey(),
      heard: name,
      status: "done",
      title: `${formatToman(resolved.amount)} ${ledgerLabel(role)} برای «${who}» ثبت شد${dateBit}${dueBit}${phoneBit}`,
      detail: createdNew
        ? "این مشتری در فهرست نبود — مشتری جدید ساخته شد."
        : role === "settle"
          ? customerBalance(latest) === 0
            ? "حساب تسویه شد."
            : undefined
          : undefined,
    };
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

  const addNewProducts = (items: ParsedProductItem[]): Product[] => {
    const valid = items.filter((i) => i.name.trim() && i.price && i.price > 0);
    if (valid.length === 0) return [];
    const list = productsStore.getAll();
    const taken = new Set(list.map((p) => p.code).filter(Boolean));
    const created: Product[] = valid.map((item) => ({
      id: cryptoId(),
      name: item.name.trim(),
      price: item.price!,
      stock: item.stock,
      unit: item.unit || COUNT_UNIT,
      category: "",
      code: generateUniqueCode(taken),
    }));
    productsStore.save([...created, ...list]);
    vibrate(40);
    return created;
  };

  const openCustomerInvoices = (name: string) => {
    void recognizerRef.current?.stop();
    setOpen(false);
    setCards([]);
    setTranscript("");
    navigate({ to: "/invoices", search: { q: name } });
  };

  const addToInvoice = (product: Product, quantity: number, unitPrice?: number): "ok" | "out" => {
    if (inventoryTrackingEnabled() && stockStatus(product) === "out") return "out";
    const current = invoice.getCurrent();
    invoice.save(addProductToInvoiceQty(current, product, quantity, { unitPrice }));
    vibrate(40);
    return "ok";
  };

  const addCustomInvoiceItem = (item: ParsedItem) => {
    invoice.save(
      addCustomInvoiceLine(invoice.getCurrent(), {
        name: item.productPhrase,
        price: item.unitPrice ?? 0,
        quantity: item.quantity,
        unit: item.unit,
      }),
    );
    vibrate(40);
  };

  // ─── تبدیل نیت به کارت نتیجه ───────────────────────────────────────────────

  const cardsForInvoiceItems = (heard: string, items: ParsedItem[]): Card[] =>
    items.map((item) => {
      const best = item.candidates[0];
      if (item.confidence === "none" || !best) {
        if (item.productPhrase.trim()) {
          addCustomInvoiceItem(item);
          const priceBit = item.unitPrice
            ? ` · ${formatToman(item.unitPrice)}`
            : " — قیمت را در فاکتور می‌توانید عوض کنید";
          return {
            key: newKey(),
            heard,
            status: "done" as const,
            title: "به فاکتور اضافه شد",
            detail: `${item.productPhrase} — ${formatNumber(item.quantity)} ${item.unit}${priceBit}`,
          };
        }
        return {
          key: newKey(),
          heard,
          status: "unknown" as const,
          title: `کالایی برای «${item.productPhrase}» پیدا نشد`,
          detail: "می‌توانید متن را ویرایش کنید.",
        };
      }
      if (item.confidence === "high") {
        const res = addToInvoice(best.product, item.quantity, item.unitPrice);
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
          detail: `${best.product.name} — ${formatNumber(item.quantity)} ${item.unit} · ${formatToman(item.unitPrice ?? best.product.price)}`,
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
        const extras = { phone: intent.phone, settlementDate: intent.settlementDate };
        if (intent.candidates.length === 0) {
          return [
            applyLedger(
              undefined,
              intent.role,
              intent.amount,
              intent.settleAll,
              intent.customerName,
              intent.at,
              extras,
            ),
          ];
        }
        if (intent.clearWinner) {
          return [
            applyLedger(
              intent.candidates[0].customer,
              intent.role,
              intent.amount,
              intent.settleAll,
              intent.customerName,
              intent.at,
              extras,
            ),
          ];
        }
        return [
          {
            key: newKey(),
            heard,
            status: "choose",
            title: `کدام مشتری؟ «${intent.customerName}» — ${
              intent.settleAll ? "تسویه کامل" : formatToman(intent.amount)
            } ${ledgerLabel(intent.role)}`,
            choose: {
              type: "customer",
              options: intent.candidates.map((c) => c.customer),
              amount: intent.amount,
              role: intent.role,
              settleAll: intent.settleAll,
              name: intent.customerName,
              at: intent.at,
              phone: intent.phone,
              settlementDate: intent.settlementDate,
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
          at: intent.at,
        });
        vibrate(40);
        return [
          {
            key: newKey(),
            heard,
            status: "done",
            title: `هزینه «${intent.title}» به مبلغ ${formatToman(intent.amount)} ثبت شد`,
            detail:
              [
                intent.dateSpoken ? formatJalaliDateTime(intent.at) : "",
                recurringLabel(intent.recurringDays).replace(/^ — /, ""),
              ]
                .filter(Boolean)
                .join(" · ") || undefined,
          },
        ];
      }

      case "manual_ledger": {
        const kindLabel =
          intent.entryKind === "profit" ? "سود" : intent.entryKind === "note" ? "یادداشت" : "فروش";
        ledgerStore.add({
          ...emptyManualLedger(intent.entryKind),
          kind: intent.entryKind,
          amount: intent.amount,
          title: intent.title,
          at: intent.at,
          source: "assistant",
        });
        vibrate(40);
        return [
          {
            key: newKey(),
            heard,
            status: "done",
            title: `${kindLabel} روزانه «${intent.title}» به مبلغ ${formatToman(intent.amount)} در گزارش ثبت شد`,
            detail: intent.dateSpoken
              ? formatJalaliDateTime(intent.at)
              : "در بخش گزارش سود و درآمد، دفتر فروش دستی قابل مشاهده است.",
          },
        ];
      }

      case "product_add": {
        const ready = intent.items.filter((i) => i.name.trim() && i.price && i.price > 0);
        const weak = intent.items.filter((i) => !i.name.trim() || !i.price || i.price <= 0);
        const created = addNewProducts(ready);
        const cards: Card[] = created.map((p, idx) => {
          const src = ready[idx];
          return {
            key: newKey(),
            heard,
            status: "done" as const,
            title: `محصول «${p.name}» اضافه شد`,
            detail: [
              src?.stock ? `${formatNumber(src.stock)}${productUnitLabel(src)}` : "",
              formatToman(p.price),
            ]
              .filter(Boolean)
              .join(" · "),
          };
        });
        for (const item of weak) {
          cards.push({
            key: newKey(),
            heard,
            status: "unknown",
            title: `برای «${item.name || heard}» قیمت یا نام کامل نبود`,
            detail: "متن را ویرایش کنید؛ مثلاً «۱۵۰ عدد پیراهن با قیمت ۲۰۰ هزار تومان اضافه شود».",
          });
        }
        return cards.length > 0
          ? cards
          : [
              {
                key: newKey(),
                heard,
                status: "unknown",
                title: "مشخصات محصول را نفهمیدم.",
              },
            ];
      }

      case "open_invoice": {
        if (intent.candidates.length > 1 && !intent.clearWinner) {
          return [
            {
              key: newKey(),
              heard,
              status: "choose",
              title: `فاکتور کدام مشتری باز شود؟ «${intent.customerName}»`,
              choose: {
                type: "open-invoice",
                options: intent.candidates.map((c) => c.customer),
                name: intent.customerName,
              },
            },
          ];
        }
        const name =
          intent.clearWinner && intent.candidates[0]
            ? customerFullName(intent.candidates[0].customer)
            : intent.customerName;
        if (intent.invoices.length === 0) {
          return [
            {
              key: newKey(),
              heard,
              status: "unknown",
              title: `فاکتوری برای «${name}» پیدا نشد`,
              detail: "می‌توانید در بخش فاکتورها با همین نام جستجو کنید.",
            },
          ];
        }
        openCustomerInvoices(name);
        return [
          {
            key: newKey(),
            heard,
            status: "done",
            title: `فاکتورهای «${name}» باز شد`,
            detail: `${formatNumber(intent.invoices.length)} فاکتور پیدا شد.`,
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
    const { amount, role, settleAll, name, at, phone, settlementDate } = card.choose;
    const result = applyLedger(customer, role, amount, settleAll, name, at, {
      phone,
      settlementDate,
    });
    replaceCard(card.key, {
      status: result.status,
      title: result.title,
      detail: result.detail,
    });
  };

  const pickNewCustomer = (card: Card) => {
    if (card.choose?.type !== "customer") return;
    const { amount, role, settleAll, name, at, phone, settlementDate } = card.choose;
    if (role === "settle") return;
    const result = applyLedger(undefined, role, amount, settleAll, name, at, {
      phone,
      settlementDate,
    });
    replaceCard(card.key, {
      status: result.status,
      title: result.title,
      detail: result.detail,
    });
  };

  const pickOpenInvoice = (card: Card, customer: Customer) => {
    if (card.choose?.type !== "open-invoice") return;
    const name = customerFullName(customer);
    replaceCard(card.key, {
      status: "done",
      title: `فاکتورهای «${name}» باز شد`,
    });
    openCustomerInvoices(name);
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
    const res = addToInvoice(product, item.quantity, item.unitPrice);
    replaceCard(card.key, {
      status: res === "out" ? "unknown" : "done",
      title: res === "out" ? `موجودی «${product.name}» تمام شده است` : "به فاکتور اضافه شد",
      detail:
        res === "out"
          ? undefined
          : `${product.name} — ${formatNumber(item.quantity)} ${product.unit ?? item.unit} · ${formatToman(item.unitPrice ?? product.price)}`,
    });
  };

  if (HIDDEN_ON.includes(pathname)) return null;

  const fab = (
    <DraggableAssistantFab
      raised={reminderToastVisible}
      onOpen={() => {
        markAssistantOpened();
        setOpen(true);
      }}
    />
  );

  return (
    <>
      {typeof document !== "undefined" ? createPortal(fab, document.body) : fab}

      <Drawer
        shouldScaleBackground={false}
        open={open}
        onOpenChange={(v) => {
          if (v) {
            markAssistantOpened();
            setOpen(true);
          } else closeSheet();
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
              دستور بدهید یا سؤال بپرسید — مثلاً «امروز صد میلیون فروش داشتم»، «پنجاه میلیون سود
              کردم»، «امروز چقدر سود داشتم»، «این ماه چقدر فروختم»، «آقای کمالی چقدر بدهکاره»، «۲ تا
              نون»، یا «یادآوری پرداخت بدهی ساعت ۱۳:۳۰ تاریخ ۴ تیر ۱۴۰۵».
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
                        {/گزارش/.test(`${card.title} ${card.detail ?? ""}`) && (
                          <Link
                            to="/reports"
                            onClick={closeSheet}
                            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
                          >
                            <BarChart3 className="h-3.5 w-3.5" />
                            مشاهده گزارش
                          </Link>
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
                        <Link
                          to="/reports"
                          onClick={closeSheet}
                          className="mt-2 mr-2 inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                          گزارش کامل
                        </Link>
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
                        {card.choose.type === "customer" && card.choose.role !== "settle" && (
                          <button
                            onClick={() => pickNewCustomer(card)}
                            className="rounded-xl border border-dashed border-primary/50 px-3 py-2 text-sm text-primary"
                          >
                            مشتری جدید «{card.choose.name}»
                          </button>
                        )}

                        {card.choose.type === "open-invoice" &&
                          card.choose.options.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => pickOpenInvoice(card, c)}
                              className="rounded-xl border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
                            >
                              {customerFullName(c) || "مشتری"}
                            </button>
                          ))}

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
                          <Link
                            to="/invoices"
                            search={{ q: card.heard }}
                            onClick={closeSheet}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs"
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            فاکتورها
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
