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

export type PaymentMethod = "cash" | "card" | "credit" | "check";

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "نقد",
  card: "کارت",
  credit: "نسیه",
  check: "چک",
};

export type Invoice = {
  id: string;
  createdAt: number;
  items: InvoiceItem[];
  total: number;
  customer?: CustomerInfo;
  shopName?: string;
  paymentMethod?: PaymentMethod;
  /** مبلغ نقد پرداخت‌شده (برای نسیهٔ جزئی یا فاکتور چک با پیش‌پرداخت نقدی) */
  paidAmount?: number;
  /** مبلغ چک صادرشده توسط مشتری (برای روش پرداخت «چک») */
  checkAmount?: number;
  /** شماره چک — اختیاری */
  checkNumber?: string;
  /** تاریخ سررسید چک (ISO) — اختیاری */
  checkDueDate?: string;
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
// Persisted set of cloud field names that have local changes not yet confirmed
// synced to the server. Survives reloads so offline edits are never dropped.
const CLOUD_DIRTY_KEY = "acc.cloudDirty.v1";

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

// Reverse map: cloud column name -> local storage key
const FIELD_TO_LOCAL_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(CLOUD_FIELDS).map(([k, v]) => [v, k]),
);

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
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 5000;

function readDirtySet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(scopedKey(CLOUD_DIRTY_KEY));
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeDirtySet(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    if (set.size === 0) localStorage.removeItem(scopedKey(CLOUD_DIRTY_KEY));
    else localStorage.setItem(scopedKey(CLOUD_DIRTY_KEY), JSON.stringify([...set]));
  } catch {}
}

function markDirty(fields: string[]) {
  const set = readDirtySet();
  for (const f of fields) set.add(f);
  writeDirtySet(set);
}

function clearDirty(fields: string[]) {
  const set = readDirtySet();
  for (const f of fields) set.delete(f);
  writeDirtySet(set);
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (cloudUserId && Object.keys(pendingPush).length > 0) {
      flushCloudPush();
    }
  }, retryDelay);
  // Exponential backoff, capped at 5 minutes
  retryDelay = Math.min(retryDelay * 2, 5 * 60 * 1000);
}

function scheduleCloudPush(key: string, value: unknown) {
  const field = CLOUD_FIELDS[key];
  if (!field || !cloudUserId) return;
  pendingPush[field] = value;
  // Persist dirty marker immediately so a page reload before the debounced
  // flush still knows this field has unsynced local changes.
  markDirty([field]);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flushCloudPush, 600);
}

async function flushCloudPush() {
  pushTimer = null;
  if (!cloudUserId) return;
  const fieldsToPush = { ...pendingPush };
  const fieldNames = Object.keys(fieldsToPush);
  if (fieldNames.length === 0) return;
  const userId = cloudUserId;
  const payload: Record<string, unknown> = {
    ...fieldsToPush,
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  try {
    let { error } = await supabase
      .from("user_data")
      .upsert(payload as never, { onConflict: "user_id" });
    // If the customers column doesn't exist yet in this deployment, retry without
    // it so syncing of products/invoices/settings is never blocked.
    if (error && /customers/.test(error.message) && "customers" in payload) {
      delete payload.customers;
      const retry = await supabase
        .from("user_data")
        .upsert(payload as never, { onConflict: "user_id" });
      error = retry.error;
    }
    if (error) throw error;
    // Success: clear only the field values we actually pushed, and only if
    // they haven't been re-written to a newer value while the upsert was in
    // flight. Any newer writes stay pending and will trigger another flush.
    const confirmed: string[] = [];
    for (const f of fieldNames) {
      if (pendingPush[f] === fieldsToPush[f]) {
        delete pendingPush[f];
        confirmed.push(f);
      }
    }
    clearDirty(confirmed);
    retryDelay = 5000;
  } catch (e) {
    console.warn("[store] cloud push failed", e);
    // Failure: keep values in pendingPush and dirty markers persisted, then
    // retry with exponential backoff. The online listener also retries.
    for (const f of fieldNames) {
      if (!(f in pendingPush)) pendingPush[f] = fieldsToPush[f];
    }
    scheduleRetry();
  }
}

export async function hydrateFromCloud(userId: string) {
  cloudUserId = userId;
  // Restore any unsynced local changes from a previous session so they get
  // re-pushed and are never overwritten by cloud data below.
  const dirty = readDirtySet();
  for (const field of dirty) {
    const localKey = FIELD_TO_LOCAL_KEY[field];
    if (!localKey) continue;
    try {
      const raw = localStorage.getItem(scopedKey(localKey));
      if (raw != null) pendingPush[field] = JSON.parse(raw);
    } catch {}
  }
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
    // Overwrite local cache with cloud data — but NEVER for fields that have
    // unsynced local changes (dirty), otherwise offline edits would be lost.
    const overwrite = (field: string, key: string, value: unknown) => {
      if (value == null) return;
      if (dirty.has(field)) return;
      writeLocalOnly(key, value);
    };
    overwrite("products", PRODUCTS_KEY, data.products);
    overwrite("categories", CATEGORIES_KEY, data.categories);
    overwrite("invoices", HISTORY_KEY, data.invoices);
    overwrite("current_invoice", INVOICE_KEY, data.current_invoice);
    overwrite("settings", SETTINGS_KEY, data.settings);
    overwrite("customers", CUSTOMERS_KEY, (data as Record<string, unknown>).customers);
  } catch (e) {
    console.warn("[store] hydrate failed", e);
  } finally {
    // Flush any restored offline edits back to the cloud.
    if (Object.keys(pendingPush).length > 0) {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(flushCloudPush, 600);
    }
  }
}

export function stopCloudSync() {
  cloudUserId = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  for (const k of Object.keys(pendingPush)) delete pendingPush[k];
  // Do NOT clear the persisted dirty set here — it must survive sign-out /
  // reload so a subsequent sign-in can still resync offline edits.
}

// Re-flush pending changes when the browser regains connectivity
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (!cloudUserId) return;
    retryDelay = 5000;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (Object.keys(pendingPush).length > 0) {
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
    // تاریخ/ساعت فاکتور را در لحظه‌ی ثبت نهایی می‌زنیم، نه در لحظه‌ی باز شدن تب
    // هم روی آبجکت اصلی می‌نویسیم تا فراخوان‌های بعدی (مثل ثبت بدهی مشتری) هم
    // همین تاریخ را ببینند و بین «تاریخچه» و «دفتر بدهی مشتری» اختلاف نیفتد.
    const finalizedAt = Date.now();
    inv.createdAt = finalizedAt;
    const stamped: Invoice = { ...inv, createdAt: finalizedAt };
    write(HISTORY_KEY, [stamped, ...hist]);
    // Remove archived invoice from the open board (and ensure at least one tab remains)
    const b = readBoard();
    const filtered = b.open.filter((i) => i.id !== stamped.id);
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
  recordInvoiceDebt: (info: CustomerInfo, inv: Invoice, opts?: { amount?: number; note?: string }) => {
    const name = [info.firstName, info.lastName].filter(Boolean).join(" ").trim();
    if (!name && !info.phone?.trim()) return;
    const debtAmount = Math.max(0, Math.round(opts?.amount ?? inv.total));
    if (debtAmount <= 0) return;
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
      amount: debtAmount,
      note: opts?.note ?? "فاکتور نسیه",
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
  let items;
  if (existing) {
    items = inv.items.map((i) =>
      i.productId === p.id ? applyAutoWholesale({ ...i, quantity: i.quantity + 1 }, p) : i,
    );
  } else {
    const effectivePrice = applyProductDiscount(p);
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
  const existing = inv.items.find((i) => i.productId === p.id);
  let items;
  if (existing) {
    items = inv.items.map((i) =>
      i.productId === p.id ? applyAutoWholesale({ ...i, quantity: i.quantity + qty }, p) : i,
    );
  } else {
    const effectivePrice = applyProductDiscount(p);
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
    // If starting quantity already meets wholesale threshold, snap to wholesale
    items = items.map((i) => (i.productId === p.id ? applyAutoWholesale(i, p) : i));
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
 * اگر برای محصول قیمت عمده و حداقل تعداد تعریف شده باشد و تعداد ردیف به آن حد رسیده باشد
 * و قیمت فعلی همچنان قیمت تک‌فروشی (با/بدون تخفیف) باشد، قیمت را به عمده تبدیل می‌کند.
 * ویرایش دستی قیمت توسط کاربر حفظ می‌شود (فقط از قیمت پایه به عمده سوییچ می‌کند).
 */
export function applyAutoWholesale(item: InvoiceItem, p: Product): InvoiceItem {
  const wp = Number(p.wholesalePrice) || 0;
  const minQty = Number(p.wholesaleMinQty) || 0;
  if (!wp || !minQty) return item;
  const retail = applyProductDiscount(p);
  // Only auto-switch if current price is still the retail price (user hasn't manually customized)
  if (item.quantity >= minQty && item.price === retail) {
    return { ...item, price: wp };
  }
  return item;
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
// Deterministic Gregorian↔Jalali conversion (jalaali-js algorithm by Behrang Noruzi Niya)
// Independent of the host ICU calendar so results are identical across browsers/OSes and
// always match the official Iranian Solar Hijri calendar.

function div(a: number, b: number): number { return ~~(a / b); }

/** Convert Gregorian (gy, gm, gd) → Julian Day Number */
function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * ((gm + 9) % 12) + 2, 5)
    + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** Is a given Jalali year a leap year (Khayyam-Borkowski algorithm)? */
function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  if (jy < jp || jy >= breaks[bl - 1]) throw new Error("Invalid Jalali year " + jy);
  let jump = 0;
  let jm: number;
  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(jump % 33, 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div((n % 33) + 3, 4);
  if (jump % 33 === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = (((n + 1) % 33) - 1) % 4;
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** Convert Julian Day Number → Jalali (jy, jm, jd) */
function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      const jm = 1 + div(k, 31);
      const jd = (k % 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  const jm = 7 + div(k, 30);
  const jd = (k % 30) + 1;
  return { jy, jm, jd };
}

/** Convert Julian Day Number → Gregorian (gy, gm, gd) */
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div((j % 1461), 4) * 5 + 308;
  const gd = div(i % 153, 5) + 1;
  const gm = ((div(i, 153)) % 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** Extract Gregorian y/m/d/h/m in Asia/Tehran regardless of host timezone. */
function tehranParts(d: Date): { y: number; m: number; day: number; h: number; min: number; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let h = parseInt(map.hour, 10);
  if (h === 24) h = 0; // some ICU builds return "24" for midnight
  return {
    y: parseInt(map.year, 10),
    m: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    h,
    min: parseInt(map.minute, 10),
    dow: dowMap[map.weekday] ?? 0,
  };
}

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
function toFa(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
}
function pad2(n: number): string { return n < 10 ? "0" + n : String(n); }

const JMONTHS_LONG = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const JMONTHS_SHORT = JMONTHS_LONG; // Persian months don't have a distinct short form
const WEEKDAYS_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

function toJalali(ts: number | string | Date): { jy: number; jm: number; jd: number; h: number; min: number; dow: number } | null {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const g = tehranParts(d);
  const jdn = g2d(g.y, g.m, g.day);
  const j = d2j(jdn);
  return { jy: j.jy, jm: j.jm, jd: j.jd, h: g.h, min: g.min, dow: g.dow };
}

export function formatJalaliDate(ts: number | string | Date): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${toFa(j.jy)}/${toFa(pad2(j.jm))}/${toFa(pad2(j.jd))}`;
}
export function formatJalaliDateTime(ts: number | string | Date): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${toFa(j.jy)}/${toFa(pad2(j.jm))}/${toFa(pad2(j.jd))}، ${toFa(pad2(j.h))}:${toFa(pad2(j.min))}`;
}
export function formatJalaliLong(ts: number | string | Date): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${WEEKDAYS_FA[j.dow]} ${toFa(j.jd)} ${JMONTHS_LONG[j.jm - 1]} ${toFa(j.jy)}، ساعت ${toFa(pad2(j.h))}:${toFa(pad2(j.min))}`;
}
export function formatJalaliShort(ts: number | string | Date): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${toFa(j.jd)} ${JMONTHS_SHORT[j.jm - 1]}`;
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
