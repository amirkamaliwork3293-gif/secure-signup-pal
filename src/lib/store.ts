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
  buyPrice?: number;
  unit?: string;
};

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

// ─── Storage Keys ────────────────────────────────────────────────────────────

const PRODUCTS_KEY   = "acc.products.v2";
const CATEGORIES_KEY = "acc.categories.v1";
const INVOICE_KEY    = "acc.currentInvoice.v2";
const HISTORY_KEY    = "acc.invoices.v2";
const SETTINGS_KEY   = "acc.settings.v1";
export const STORAGE_SCOPE_KEY = "kamali.auth.scope.v1";

// Mapping of localStorage key -> cloud column name in user_data
const CLOUD_FIELDS: Record<string, "products" | "categories" | "invoices" | "current_invoice" | "settings"> = {
  [PRODUCTS_KEY]: "products",
  [CATEGORIES_KEY]: "categories",
  [HISTORY_KEY]: "invoices",
  [INVOICE_KEY]: "current_invoice",
  [SETTINGS_KEY]: "settings",
};

export type AppSettings = {
  invoiceFontSize: number;
  shopName: string;
};

const DEFAULT_SETTINGS: AppSettings = { shopName: "فروشگاه من", invoiceFontSize: 13 };

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
  window.dispatchEvent(new CustomEvent("store-change", { detail: { scopeChanged: true, scope: nextScope } }));
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
  window.dispatchEvent(new CustomEvent("store-change", { detail: { key: keyWithScope, baseKey: key } }));
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
  const payload = { ...pendingPush, user_id: userId, updated_at: new Date().toISOString() };
  for (const k of Object.keys(pendingPush)) delete pendingPush[k];
  try {
    await supabase.from("user_data").upsert(payload, { onConflict: "user_id" });
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
  } catch (e) {
    console.warn("[store] hydrate failed", e);
  }
}

export function stopCloudSync() {
  cloudUserId = null;
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  for (const k of Object.keys(pendingPush)) delete pendingPush[k];
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
      const detail = (e as CustomEvent<{ key?: string; baseKey?: string; scopeChanged?: boolean }>).detail;
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
  useAll:      ()         => useStore<Product[]>(PRODUCTS_KEY, []),
  getAll:      ()         => read<Product[]>(PRODUCTS_KEY, []),
  save:        (list: Product[]) => write(PRODUCTS_KEY, list),
  findByCode:  (code: string) => read<Product[]>(PRODUCTS_KEY, []).find((p) => p.code === code),
  findById:    (id: string)   => read<Product[]>(PRODUCTS_KEY, []).find((p) => p.id === id),
  update:      (updated: Product) => {
    const list = read<Product[]>(PRODUCTS_KEY, []);
    write(PRODUCTS_KEY, list.map((p) => (p.id === updated.id ? updated : p)));
  },
  decreaseStock: (productId: string, qty: number) => {
    const list = read<Product[]>(PRODUCTS_KEY, []);
    write(PRODUCTS_KEY, list.map((p) =>
      p.id === productId ? { ...p, stock: Math.max(0, p.stock - qty) } : p
    ));
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

function useBoard(): [InvoiceBoard, (v: InvoiceBoard | ((p: InvoiceBoard) => InvoiceBoard)) => void] {
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
        const next = typeof v === "function" ? (v as (p: Invoice) => Invoice)(
          prev.open.find((i) => i.id === prev.activeId) ?? prev.open[0],
        ) : v;
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
  useTabs: (): [InvoiceBoard, {
    openNew: () => void;
    switchTo: (id: string) => void;
    close: (id: string) => void;
  }] => {
    const [board, setBoard] = useBoard();
    return [board, {
      openNew: () => setBoard((prev) => {
        const fresh = emptyInvoice();
        return { open: [...prev.open, fresh], activeId: fresh.id };
      }),
      switchTo: (id: string) => setBoard((prev) =>
        prev.open.some((i) => i.id === id) ? { ...prev, activeId: id } : prev,
      ),
      close: (id: string) => setBoard((prev) => {
        const filtered = prev.open.filter((i) => i.id !== id);
        if (filtered.length === 0) {
          const fresh = emptyInvoice();
          return { open: [fresh], activeId: fresh.id };
        }
        const activeId = prev.activeId === id ? filtered[0].id : prev.activeId;
        return { open: filtered, activeId };
      }),
    }];
  },

  useHistory: () => useStore<Invoice[]>(HISTORY_KEY, []),
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
    write(HISTORY_KEY, hist.map((inv) => (inv.id === updated.id ? updated : inv)));
  },
  deleteFromHistory: (id: string) => {
    const hist = read<Invoice[]>(HISTORY_KEY, []);
    write(HISTORY_KEY, hist.filter((inv) => inv.id !== id));
  },
};

// ─── Settings ────────────────────────────────────────────────────────────────

export const settings = {
  useAll: () => useStore<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS),
  get:    () => read<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS),
  save:   (s: AppSettings) => write(SETTINGS_KEY, s),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function emptyInvoice(): Invoice {
  return { id: cryptoId(), createdAt: Date.now(), items: [], total: 0 };
}

export function recalc(inv: Invoice): Invoice {
  const total = inv.items.reduce((s, i) => s + i.price * i.quantity, 0);
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
      i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i,
    );
  } else {
    items = [...inv.items, { productId: p.id, name: p.name, price: p.price, quantity: 1 }];
  }
  return recalc({ ...inv, items });
}

export function formatToman(n: number): string {
  return new Intl.NumberFormat("fa-IR").format(n) + " تومان";
}

export function stockStatus(p: Product): "ok" | "low" | "out" {
  if (p.stock <= 0) return "out";
  const threshold = p.lowStockThreshold ?? 5;
  if (p.stock <= threshold) return "low";
  return "ok";
}
