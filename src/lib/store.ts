import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
  code: string;
  stock: number;
  description?: string;
  lowStockThreshold?: number;
  /** قیمت خرید — برای محاسبه سود و زیان (اختیاری) */
  buyPrice?: number;
  /** قیمت مصرف‌کننده (اختیاری) */
  consumerPrice?: number;
  /** قیمت فروشنده/همکار (اختیاری) */
  sellerPrice?: number;
  /** درصد تخفیف پیشنهادی (اختیاری) */
  discountPercent?: number;
  /** واحد فروش: «عدد» یا واحدهای وزنی وقتی فروش وزنی فعال باشد */
  unit?: string;
  /** قیمت عمده/کارتنی (اختیاری) — برای فروش تعداد بالا */
  wholesalePrice?: number;
  /** حداقل تعداد برای اعمال خودکار قیمت عمده (اختیاری) */
  wholesaleMinQty?: number;
};

export const COUNT_UNIT = "عدد";
export const WEIGHT_UNITS = ["کیلوگرم", "گرم"] as const;

export function isWeightUnit(unit?: string): boolean {
  return !!unit && (WEIGHT_UNITS as readonly string[]).includes(unit);
}

export type Category = {
  id: string;
  name: string;
  color?: string;
};

export type InvoiceItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  /** قیمت خرید در لحظه فروش — برای گزارش سود */
  buyPrice?: number;
  /** واحد فروش (عدد / کیلوگرم / گرم) */
  unit?: string;
};

export type CustomerInfo = {
  firstName?: string;
  lastName?: string;
  phone?: string;
};

export type PaymentMethod = "cash" | "card" | "credit";

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "نقد",
  card: "کارت",
  credit: "نسیه",
};

export type Invoice = {
  id: string;
  createdAt: number;
  items: InvoiceItem[];
  total: number;
  customer?: CustomerInfo;
  shopName?: string;
  paymentMethod?: PaymentMethod;
};

// ─── Customers / Debtors ─────────────────────────────────────────────────────

export type CustomerTx = {
  id: string;
  /** debt = بدهی جدید، payment = پرداخت/تسویه */
  type: "debt" | "payment";
  amount: number;
  note?: string;
  at: number;
  /** اگر بدهی از ثبت فاکتور نسیه ایجاد شده باشد */
  invoiceId?: string;
};

export type Customer = {
  id: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  note?: string;
  createdAt: number;
  txs: CustomerTx[];
};

/** مانده حساب مشتری: مثبت یعنی بدهکار است */
export function customerBalance(c: Customer): number {
  return c.txs.reduce((s, t) => s + (t.type === "debt" ? t.amount : -t.amount), 0);
}

export function customerFullName(c: Customer): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
}

// ─── Storage Keys ────────────────────────────────────────────────────────────

const PRODUCTS_KEY = "acc.products.v2";
const CATEGORIES_KEY = "acc.categories.v1";
const INVOICE_KEY = "acc.currentInvoice.v2";
const HISTORY_KEY = "acc.invoices.v2";
const SETTINGS_KEY = "acc.settings.v1";
const CUSTOMERS_KEY = "acc.customers.v1";
export const STORAGE_SCOPE_KEY = "kamali.auth.scope.v1";

// Mapping of localStorage key -> cloud column name in user_data
const CLOUD_FIELDS: Record<
  string,
  "products" | "categories" | "invoices" | "current_invoice" | "settings" | "customers"
> = {
  [PRODUCTS_KEY]: "products",
  [CATEGORIES_KEY]: "categories",
  [HISTORY_KEY]: "invoices",
  [INVOICE_KEY]: "current_invoice",
  [SETTINGS_KEY]: "settings",
  [CUSTOMERS_KEY]: "customers",
};

export type AppSettings = {
  invoiceFontSize: number;
  shopName: string;
  /** فعال‌سازی فروش وزنی (کیلوگرم/گرم) — پیش‌فرض غیرفعال */
  weightUnits?: boolean;
  // ─── پروفایل عمومی فروشگاه (اختیاری) — برای صفحه عمومی /store/[id] ───
  /** آدرس فروشگاه */
  storeAddress?: string;
  /** شماره تماس‌ها (یک یا چند شماره) */
  storePhones?: string[];
  /** ساعات کاری */
  businessHours?: string;
  /** آیدی/لینک اینستاگرام */
  instagram?: string;
  /** آیدی/لینک تلگرام */
  telegram?: string;
  /** شماره/لینک واتساپ بیزینس */
  whatsapp?: string;
  /** آیدی یا شماره روبیکا */
  rubika?: string;
  /** آیدی یا شماره ایتا */
  eitaa?: string;
  /** آیدی یا شماره بله */
  bale?: string;
  /** توضیح کوتاه فروشگاه */
  storeDescription?: string;
  /** آدرس لوگو یا تصویر فروشگاه */
  logoUrl?: string;
};

const DEFAULT_SETTINGS: AppSettings = {
  shopName: "فروشگاه من",
  invoiceFontSize: 13,
  weightUnits: false,
};

function getStorageScope() {
  if (typeof window === "undefined") return "anon";
  return localStorage.getItem(STORAGE_SCOPE_KEY) || "anon";
}

function scopedKey(key: string, scope = getStorageScope()) {
  return `${key}:${scope}`;
}

export function setStorageScope(scope: string | null) {
  if (typeof window === "undefined") return;
  const nextScope = scope || "anon";
  localStorage.setItem(STORAGE_SCOPE_KEY, nextScope);
  window.dispatchEvent(
    new CustomEvent("store-change", { detail: { scopeChanged: true, scope: nextScope } }),
  );
}

// ─── Default categories ──────────────────────────────────────────────────────

const DEFAULT_CATEGORIES: Category[] = [
  { id: "cat-1", name: "مواد غذایی", color: "#22c55e" },
  { id: "cat-2", name: "نوشیدنی", color: "#3b82f6" },
  { id: "cat-3", name: "لبنیات", color: "#f59e0b" },
  { id: "cat-4", name: "لوازم تحریر", color: "#8b5cf6" },
  { id: "cat-5", name: "آرایشی", color: "#ec4899" },
  { id: "cat-6", name: "خدمات", color: "#6b7280" },
];

// ─── Core helpers ────────────────────────────────────────────────────────────

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(scopedKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalOnly<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  const keyWithScope = scopedKey(key);
  localStorage.setItem(keyWithScope, JSON.stringify(value));
  window.dispatchEvent(
    new CustomEvent("store-change", { detail: { key: keyWithScope, baseKey: key } }),
  );
}

function write<T>(key: string, value: T) {
  writeLocalOnly(key, value);
  scheduleCloudPush(key, value);
}

// ─── Cloud sync ──────────────────────────────────────────────────────────────

let cloudUserId: string | null = null;
const pendingPush: Record<string, unknown> = {};
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCloudPush(key: string, value: unknown) {
  const field = CLOUD_FIELDS[key];
  if (!field || !cloudUserId) return;
  pendingPush[field] = value;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flushCloudPush, 600);
}

async function flushCloudPush() {
  pushTimer = null;
  if (!cloudUserId) return;
  const userId = cloudUserId;
  const payload: Record<string, unknown> = {
    ...pendingPush,
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  for (const k of Object.keys(pendingPush)) delete pendingPush[k];
  try {
    const { error } = await supabase
      .from("user_data")
      .upsert(payload as never, { onConflict: "user_id" });
    // If the customers column doesn't exist yet in this deployment, retry without
    // it so syncing of products/invoices/settings is never blocked.
    if (error && /customers/.test(error.message) && "customers" in payload) {
      delete payload.customers;
      await supabase.from("user_data").upsert(payload as never, { onConflict: "user_id" });
    }
  } catch (e) {
    console.warn("[store] cloud push failed", e);
  }
}

export async function hydrateFromCloud(userId: string) {
  cloudUserId = userId;
  try {
    const { data, error } = await supabase
      .from("user_data")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      // First device for this user: seed cloud row with whatever exists locally
      const seed = {
        user_id: userId,
        products: read<Product[]>(PRODUCTS_KEY, []),
        categories: read<Category[]>(CATEGORIES_KEY, DEFAULT_CATEGORIES),
        invoices: read<Invoice[]>(HISTORY_KEY, []),
        current_invoice: read<Invoice | null>(INVOICE_KEY, null),
        settings: read<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS),
      };
      await supabase.from("user_data").insert(seed);
      return;
    }
    // Overwrite local cache with cloud data
    if (data.products != null) writeLocalOnly(PRODUCTS_KEY, data.products);
    if (data.categories != null) writeLocalOnly(CATEGORIES_KEY, data.categories);
    if (data.invoices != null) writeLocalOnly(HISTORY_KEY, data.invoices);
    if (data.current_invoice != null) writeLocalOnly(INVOICE_KEY, data.current_invoice);
    if (data.settings != null) writeLocalOnly(SETTINGS_KEY, data.settings);
    const cloudCustomers = (data as Record<string, unknown>).customers;
    if (cloudCustomers != null) writeLocalOnly(CUSTOMERS_KEY, cloudCustomers);
  } catch (e) {
    console.warn("[store] hydrate failed", e);
  }
}

export function stopCloudSync() {
  cloudUserId = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  for (const k of Object.keys(pendingPush)) delete pendingPush[k];
}

// Re-flush pending changes when the browser regains connectivity
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (cloudUserId && Object.keys(pendingPush).length > 0) {
      flushCloudPush();
    }
  });
}

// ─── React hook ──────────────────────────────────────────────────────────────

export function useStore<T>(key: string, fallback: T): [T, (v: T | ((p: T) => T)) => void] {
  const [state, setState] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    const onChange = (e: Event) => {
      const currentKey = scopedKey(key);
      if (e instanceof StorageEvent) {
        if (e.key === STORAGE_SCOPE_KEY || e.key === currentKey || e.key === null) {
          setState(read(key, fallback));
        }
        return;
      }
      const detail = (e as CustomEvent<{ key?: string; baseKey?: string; scopeChanged?: boolean }>)
        .detail;
      if (detail?.scopeChanged || detail?.key === currentKey || detail?.baseKey === key) {
        setState(read(key, fallback));
      }
    };
    window.addEventListener("store-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("store-change", onChange);
      window.removeEventListener("storage", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (v: T | ((p: T) => T)) => {
    setState((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      write(key, next);
      return next;
    });
  };
  return [state, set];
}

// ─── Products ────────────────────────────────────────────────────────────────

export const products = {
  useAll: () => useStore<Product[]>(PRODUCTS_KEY, []),
  getAll: () => read<Product[]>(PRODUCTS_KEY, []),
  save: (list: Product[]) => write(PRODUCTS_KEY, list),
  findByCode: (code: string) => read<Product[]>(PRODUCTS_KEY, []).find((p) => p.code === code),
  findById: (id: string) => read<Product[]>(PRODUCTS_KEY, []).find((p) => p.id === id),
  update: (updated: Product) => {
    const list = read<Product[]>(PRODUCTS_KEY, []);
    write(
      PRODUCTS_KEY,
      list.map((p) => (p.id === updated.id ? updated : p)),
    );
  },
  decreaseStock: (productId: string, qty: number) => {
    const list = read<Product[]>(PRODUCTS_KEY, []);
    write(
      PRODUCTS_KEY,
      list.map((p) => (p.id === productId ? { ...p, stock: Math.max(0, p.stock - qty) } : p)),
    );
  },
};

// ─── Categories ──────────────────────────────────────────────────────────────

export const categories = {
  useAll: () => useStore<Category[]>(CATEGORIES_KEY, DEFAULT_CATEGORIES),
  getAll: () => {
    const stored = read<Category[] | null>(CATEGORIES_KEY, null);
    return stored ?? DEFAULT_CATEGORIES;
  },
  save: (list: Category[]) => write(CATEGORIES_KEY, list),
};

// ─── Invoice (multi-tab) ─────────────────────────────────────────────────────
// INVOICE_KEY now stores `{ open: Invoice[], activeId: string }`.
// Legacy data shape (single Invoice) is migrated on read.

type InvoiceBoard = { open: Invoice[]; activeId: string };

function normalizeBoard(raw: unknown): InvoiceBoard {
  if (raw && typeof raw === "object" && Array.isArray((raw as any).open)) {
    const b = raw as InvoiceBoard;
    if (b.open.length === 0) {
      const fresh = emptyInvoice();
      return { open: [fresh], activeId: fresh.id };
    }
    const activeId = b.open.some((i) => i.id === b.activeId) ? b.activeId : b.open[0].id;
    return { open: b.open, activeId };
  }
  // Legacy single invoice -> wrap
  if (raw && typeof raw === "object" && Array.isArray((raw as any).items)) {
    const inv = raw as Invoice;
    return { open: [inv], activeId: inv.id };
  }
  const fresh = emptyInvoice();
  return { open: [fresh], activeId: fresh.id };
}

function readBoard(): InvoiceBoard {
  const raw = read<unknown>(INVOICE_KEY, null as unknown);
  return normalizeBoard(raw);
}

function writeBoard(b: InvoiceBoard) {
  write(INVOICE_KEY, b);
}

function useBoard(): [
  InvoiceBoard,
  (v: InvoiceBoard | ((p: InvoiceBoard) => InvoiceBoard)) => void,
] {
  const [raw, setRaw] = useStore<unknown>(INVOICE_KEY, null);
  const board = normalizeBoard(raw);
  const set = (v: InvoiceBoard | ((p: InvoiceBoard) => InvoiceBoard)) => {
    setRaw((prev: unknown) => {
      const prevBoard = normalizeBoard(prev);
      return typeof v === "function" ? (v as (p: InvoiceBoard) => InvoiceBoard)(prevBoard) : v;
    });
  };
  return [board, set];
}

export const invoice = {
  // Active (current) invoice — keeps legacy API surface
  useCurrent: (): [Invoice, (v: Invoice | ((p: Invoice) => Invoice)) => void] => {
    const [board, setBoard] = useBoard();
    const active = board.open.find((i) => i.id === board.activeId) ?? board.open[0];
    const set = (v: Invoice | ((p: Invoice) => Invoice)) => {
      setBoard((prev) => {
        const next =
          typeof v === "function"
            ? (v as (p: Invoice) => Invoice)(
                prev.open.find((i) => i.id === prev.activeId) ?? prev.open[0],
              )
            : v;
        return {
          activeId: next.id,
          open: prev.open.some((i) => i.id === next.id)
            ? prev.open.map((i) => (i.id === next.id ? next : i))
            : [...prev.open, next],
        };
      });
    };
    return [active, set];
  },
  getCurrent: (): Invoice => {
    const b = readBoard();
    return b.open.find((i) => i.id === b.activeId) ?? b.open[0];
  },
  save: (inv: Invoice) => {
    const b = readBoard();
    const open = b.open.some((i) => i.id === inv.id)
      ? b.open.map((i) => (i.id === inv.id ? inv : i))
      : [...b.open, inv];
    writeBoard({ open, activeId: inv.id });
  },

  // Tabs API
  useTabs: (): [
    InvoiceBoard,
    {
      openNew: () => void;
      switchTo: (id: string) => void;
      close: (id: string) => void;
    },
  ] => {
    const [board, setBoard] = useBoard();
    return [
      board,
      {
        openNew: () =>
          setBoard((prev) => {
            const fresh = emptyInvoice();
            return { open: [...prev.open, fresh], activeId: fresh.id };
          }),
        switchTo: (id: string) =>
          setBoard((prev) =>
            prev.open.some((i) => i.id === id) ? { ...prev, activeId: id } : prev,
          ),
        close: (id: string) =>
          setBoard((prev) => {
            const filtered = prev.open.filter((i) => i.id !== id);
            if (filtered.length === 0) {
              const fresh = emptyInvoice();
              return { open: [fresh], activeId: fresh.id };
            }
            const activeId = prev.activeId === id ? filtered[0].id : prev.activeId;
            return { open: filtered, activeId };
          }),
      },
    ];
  },

  useHistory: () => useStore<Invoice[]>(HISTORY_KEY, []),
  getHistory: () => read<Invoice[]>(HISTORY_KEY, []),
  archive: (inv: Invoice) => {
    const hist = read<Invoice[]>(HISTORY_KEY, []);
    inv.items.forEach((item) => products.decreaseStock(item.productId, item.quantity));
    write(HISTORY_KEY, [inv, ...hist]);
    // Remove archived invoice from the open board (and ensure at least one tab remains)
    const b = readBoard();
    const filtered = b.open.filter((i) => i.id !== inv.id);
    if (filtered.length === 0) {
      const fresh = emptyInvoice();
      writeBoard({ open: [fresh], activeId: fresh.id });
    } else {
      writeBoard({ open: filtered, activeId: filtered[0].id });
    }
  },
  updateHistory: (updated: Invoice) => {
    const hist = read<Invoice[]>(HISTORY_KEY, []);
    write(
      HISTORY_KEY,
      hist.map((inv) => (inv.id === updated.id ? updated : inv)),
    );
  },
  deleteFromHistory: (id: string) => {
    const hist = read<Invoice[]>(HISTORY_KEY, []);
    write(
      HISTORY_KEY,
      hist.filter((inv) => inv.id !== id),
    );
  },
};

// ─── Settings ────────────────────────────────────────────────────────────────

export const settings = {
  useAll: () => useStore<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS),
  get: () => read<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS),
  save: (s: AppSettings) => write(SETTINGS_KEY, s),
};

// ─── Customers (debtors/creditors) ───────────────────────────────────────────

export const customers = {
  useAll: () => useStore<Customer[]>(CUSTOMERS_KEY, []),
  getAll: () => read<Customer[]>(CUSTOMERS_KEY, []),
  save: (list: Customer[]) => write(CUSTOMERS_KEY, list),

  add: (c: Omit<Customer, "id" | "createdAt" | "txs">): Customer => {
    const created: Customer = { ...c, id: cryptoId(), createdAt: Date.now(), txs: [] };
    write(CUSTOMERS_KEY, [created, ...read<Customer[]>(CUSTOMERS_KEY, [])]);
    return created;
  },

  update: (updated: Customer) => {
    const list = read<Customer[]>(CUSTOMERS_KEY, []);
    write(
      CUSTOMERS_KEY,
      list.map((c) => (c.id === updated.id ? updated : c)),
    );
  },

  remove: (id: string) => {
    write(
      CUSTOMERS_KEY,
      read<Customer[]>(CUSTOMERS_KEY, []).filter((c) => c.id !== id),
    );
  },

  addTx: (customerId: string, tx: Omit<CustomerTx, "id" | "at"> & { at?: number }) => {
    const list = read<Customer[]>(CUSTOMERS_KEY, []);
    write(
      CUSTOMERS_KEY,
      list.map((c) =>
        c.id === customerId
          ? { ...c, txs: [{ ...tx, id: cryptoId(), at: tx.at ?? Date.now() }, ...c.txs] }
          : c,
      ),
    );
  },

  /**
   * ثبت خودکار بدهی برای فاکتور نسیه. مشتری موجود (بر اساس تلفن یا نام) پیدا
   * می‌شود و در غیر این صورت ساخته می‌شود.
   */
  recordInvoiceDebt: (info: CustomerInfo, inv: Invoice) => {
    const name = [info.firstName, info.lastName].filter(Boolean).join(" ").trim();
    if (!name && !info.phone?.trim()) return;
    const list = read<Customer[]>(CUSTOMERS_KEY, []);
    let target = list.find(
      (c) =>
        (info.phone?.trim() && c.phone === info.phone.trim()) ||
        (name && customerFullName(c) === name),
    );
    if (!target) {
      target = {
        id: cryptoId(),
        firstName: info.firstName?.trim() || name || "مشتری",
        lastName: info.lastName?.trim() || undefined,
        phone: info.phone?.trim() || undefined,
        createdAt: Date.now(),
        txs: [],
      };
      list.unshift(target);
    }
    const tx: CustomerTx = {
      id: cryptoId(),
      type: "debt",
      amount: inv.total,
      note: "فاکتور نسیه",
      at: inv.createdAt || Date.now(),
      invoiceId: inv.id,
    };
    write(
      CUSTOMERS_KEY,
      list.map((c) => (c.id === target!.id ? { ...c, txs: [tx, ...c.txs] } : c)),
    );
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function emptyInvoice(): Invoice {
  return { id: cryptoId(), createdAt: Date.now(), items: [], total: 0 };
}

export function recalc(inv: Invoice): Invoice {
  // گرد کردن برای جلوگیری از خطای اعشار در فروش وزنی (۲٫۵ × قیمت)
  const total = Math.round(inv.items.reduce((s, i) => s + i.price * i.quantity, 0));
  return { ...inv, total };
}

export function cryptoId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function addProductToInvoice(inv: Invoice, p: Product): Invoice {
  const existing = inv.items.find((i) => i.productId === p.id);
  const effectivePrice = applyProductDiscount(p);
  let items;
  if (existing) {
    items = inv.items.map((i) => (i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i));
  } else {
    items = [
      ...inv.items,
      {
        productId: p.id,
        name: p.name,
        price: effectivePrice,
        quantity: 1,
        buyPrice: p.buyPrice,
        unit: p.unit,
      },
    ];
  }
  return recalc({ ...inv, items });
}

/**
 * افزودن محصول به فاکتور با مقدار و واحد مشخص (برای ثبت صوتی استفاده می‌شود).
 * تابع موجود `addProductToInvoice` دست‌نخورده می‌ماند؛ این نسخه مقدار دلخواه را
 * می‌گیرد: برای محصول وزنی مقدار را جمع می‌کند و برای محصول عددی هم همین‌طور.
 */
export function addProductToInvoiceQty(inv: Invoice, p: Product, quantity: number): Invoice {
  const qty = quantity > 0 ? quantity : 1;
  const effectivePrice = applyProductDiscount(p);
  const existing = inv.items.find((i) => i.productId === p.id);
  let items;
  if (existing) {
    items = inv.items.map((i) => (i.productId === p.id ? { ...i, quantity: i.quantity + qty } : i));
  } else {
    items = [
      ...inv.items,
      {
        productId: p.id,
        name: p.name,
        price: effectivePrice,
        quantity: qty,
        buyPrice: p.buyPrice,
        unit: p.unit,
      },
    ];
  }
  return recalc({ ...inv, items });
}

/**
 * قیمت موثر پس از اعمال درصد تخفیف محصول (در صورت وجود).
 * اگر تخفیفی نباشد، خود `price` برمی‌گردد.
 */
export function applyProductDiscount(p: Product): number {
  const d = Math.max(0, Math.min(100, Number(p.discountPercent) || 0));
  if (!d) return p.price;
  return Math.round(p.price * (100 - d) / 100);
}

/**
 * ساخت لینک عمومی صفحه فروشگاه برای یک کاربر مشخص.
 * شناسه فروشگاه همان شناسه کاربر (user id) است.
 */
export function storePublicUrl(userId: string): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://secure-signup-pal.lovable.app";
  return `${origin}/store/${userId}`;
}

/** فرمت عدد با جداکننده هزارگان (ارقام فارسی) */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("fa-IR").format(n);
}

export function formatToman(n: number): string {
  return formatNumber(n) + " تومان";
}

// ─── Jalali (Persian) date helpers ─────────────────────────────────────────
// Use the Persian calendar via Intl so day/month/year/time are all accurate.
const _jDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric", month: "2-digit", day: "2-digit",
});
const _jDateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const _jLong = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  weekday: "long", year: "numeric", month: "long", day: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
export function formatJalaliDate(ts: number | string | Date): string {
  try { return _jDate.format(new Date(ts)); } catch { return ""; }
}
export function formatJalaliDateTime(ts: number | string | Date): string {
  try { return _jDateTime.format(new Date(ts)); } catch { return ""; }
}
export function formatJalaliLong(ts: number | string | Date): string {
  try { return _jLong.format(new Date(ts)); } catch { return ""; }
}

/**
 * تبدیل ورودی کاربر به عدد: ارقام فارسی/عربی را به انگلیسی تبدیل و
 * جداکننده‌ها را حذف می‌کند. اعشار (برای واحدهای وزنی) پشتیبانی می‌شود.
 */
export function parseNumberInput(s: string): number {
  if (!s) return 0;
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let out = "";
  for (const ch of String(s)) {
    const fi = fa.indexOf(ch);
    const ai = ar.indexOf(ch);
    if (fi >= 0) out += String(fi);
    else if (ai >= 0) out += String(ai);
    else if ((ch >= "0" && ch <= "9") || ch === "." || ch === "/") out += ch === "/" ? "." : ch;
    // ، ٬ , و فاصله به‌عنوان جداکننده نادیده گرفته می‌شوند
  }
  const n = parseFloat(out);
  return Number.isFinite(n) ? n : 0;
}

/** نمایش زنده‌ی عدد با جداکننده هزارگان داخل input (ارقام فارسی) */
export function formatNumberInput(s: string): string {
  const n = parseNumberInput(s);
  if (!n) return s.trim() === "" ? "" : s;
  return formatNumber(n);
}

export function stockStatus(p: Product): "ok" | "low" | "out" {
  if (p.stock <= 0) return "out";
  const threshold = p.lowStockThreshold ?? 5;
  if (p.stock <= threshold) return "low";
  return "ok";
}
