/**
 * اتصال فاکتورها (فروش و خرید) به مشتری — منبع واحد و قطعی.
 *
 * قاعده‌ها (دادهٔ مالی واقعی؛ هرگز حدس نمی‌زنیم):
 *  ۱) فاکتوری که شناسهٔ مشتری دارد (customer.customerId / supplierCustomerId)
 *     فقط و فقط مال همان مشتری است — حتی اگر بعداً نام یا تلفن مشتری عوض شود.
 *  ۲) فاکتورهای قدیمی بدون شناسه فقط وقتی به یک مشتری نسبت داده می‌شوند که
 *     دقیقاً «یک» مشتری با آن بخواند (تلفن یکسان، یا اگر تلفنی روی فاکتور نیست،
 *     نام کامل یکسان). اگر دو مشتری هم‌نام باشند، فاکتور به هیچ‌کدام چسبانده
 *     نمی‌شود و در «سلامت داده‌ها» برای تصمیم کاربر می‌ماند — قبلاً زیر هر دو
 *     نمایش داده می‌شد.
 *  ۳) این ماژول چیزی نمی‌نویسد. اتصال دائمی فقط با تأیید کاربر انجام می‌شود.
 *
 * همهٔ جست‌وجوها با ایندکس (Map) انجام می‌شود تا با هزاران مشتری و فاکتور سریع بماند.
 */
import type { Customer, CustomerInfo, Invoice, Purchase } from "./store";
import { normalizePhoneDigits, normalizeSearchText } from "./search.ts";

export type MatchResult =
  | { kind: "id"; customer: Customer }
  | { kind: "phone"; customer: Customer }
  | { kind: "name"; customer: Customer }
  | { kind: "ambiguous"; candidates: Customer[] }
  | { kind: "none" };

function phoneKey(p?: string | null): string {
  const d = normalizePhoneDigits(p);
  return d.length >= 10 ? d.slice(-10) : "";
}

function nameKey(p?: { firstName?: string; lastName?: string } | null): string {
  if (!p) return "";
  const first = normalizeSearchText(p.firstName);
  const last = normalizeSearchText(p.lastName);
  return [first, last].filter(Boolean).join(" ");
}

/** نام با ترتیب برعکس (نام خانوادگی + نام) — برای «طاهری علی» = «علی طاهری» */
function swappedNameKey(p?: { firstName?: string; lastName?: string } | null): string {
  if (!p) return "";
  const first = normalizeSearchText(p.firstName);
  const last = normalizeSearchText(p.lastName);
  return first && last ? `${last} ${first}` : "";
}

export type CustomerIndex = {
  byId: Map<string, Customer>;
  byPhone: Map<string, Customer[]>;
  byName: Map<string, Customer[]>;
};

export function buildCustomerIndex(list: readonly Customer[]): CustomerIndex {
  const byId = new Map<string, Customer>();
  const byPhone = new Map<string, Customer[]>();
  const byName = new Map<string, Customer[]>();
  const push = (m: Map<string, Customer[]>, k: string, c: Customer) => {
    if (!k) return;
    const arr = m.get(k);
    if (arr) {
      if (!arr.includes(c)) arr.push(c);
    } else m.set(k, [c]);
  };
  for (const c of list) {
    byId.set(c.id, c);
    push(byPhone, phoneKey(c.phone), c);
    push(byName, nameKey(c), c);
    push(byName, swappedNameKey(c), c);
  }
  return { byId, byPhone, byName };
}

/**
 * مشتریِ مطابق با اطلاعات یک فاکتور/فرم. فقط نتیجهٔ یکتا «پیدا شده» حساب می‌شود.
 * - شناسه: قطعی.
 * - تلفن: اگر روی فاکتور تلفن هست، فقط تلفن تصمیم می‌گیرد (نام هم‌نام کافی نیست).
 * - نام کامل: فقط وقتی تلفنی روی فاکتور نیست.
 */
export function matchCustomer(
  info: Pick<CustomerInfo, "customerId" | "firstName" | "lastName" | "phone"> | null | undefined,
  idx: CustomerIndex,
): MatchResult {
  if (!info) return { kind: "none" };
  if (info.customerId) {
    const c = idx.byId.get(info.customerId);
    if (c) return { kind: "id", customer: c };
  }
  const pk = phoneKey(info.phone);
  // تلفن کوتاه/نامعتبر روی فاکتور: مثل قبل به هیچ مشتری‌ای نسبت داده نمی‌شود
  if (info.phone?.trim() && !pk) return { kind: "none" };
  if (pk) {
    const hits = idx.byPhone.get(pk) ?? [];
    if (hits.length === 1) return { kind: "phone", customer: hits[0] };
    if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
    // تلفن روی فاکتور با هیچ مشتری‌ای نمی‌خواند: به نامِ هم‌نام نسبت داده نمی‌شود
    return { kind: "none" };
  }
  const nk = nameKey(info);
  if (!nk) return { kind: "none" };
  const hits = idx.byName.get(nk) ?? [];
  if (hits.length === 1) return { kind: "name", customer: hits[0] };
  if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
  return { kind: "none" };
}

export function invoiceCustomerInfo(inv: Invoice): CustomerInfo | undefined {
  const c = inv.customer;
  if (!c) return undefined;
  if (!c.customerId && !nameKey(c) && !phoneKey(c.phone) && !c.phone?.trim()) return undefined;
  return c;
}

export function purchaseSupplierInfo(p: Purchase): CustomerInfo | undefined {
  const parts = (p.supplierName || "").trim().split(/\s+/).filter(Boolean);
  const info: CustomerInfo = {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
    phone: p.supplierPhone?.trim() || undefined,
    customerId: p.supplierCustomerId || undefined,
  };
  if (!info.customerId && !info.firstName && !info.phone) return undefined;
  return info;
}

export type CustomerDocs = { invoices: Invoice[]; purchases: Purchase[] };

export type CustomerDocIndex = {
  /** فاکتورهای هر مشتری (قطعی: با شناسه، یا قدیمی با تطبیق یکتا) — جدیدترین اول */
  byCustomer: Map<string, CustomerDocs>;
  /** فاکتورهای قدیمی که چند مشتری با آن می‌خوانند — نیاز به تصمیم کاربر */
  ambiguous: { kind: "invoice" | "purchase"; doc: Invoice | Purchase; candidates: Customer[] }[];
  /** فاکتورهایی که شناسه‌شان به مشتریِ حذف‌شده اشاره می‌کند (سابقه حفظ می‌شود) */
  orphanLinked: number;
};

/**
 * یک‌بار پیمایش همهٔ فاکتورها → فاکتورهای هر مشتری. O(n) با ایندکس.
 * فاکتور قدیمی که با تطبیق یکتا نسبت داده شده «legacy» علامت نمی‌خورد چون
 * نتیجهٔ نمایش همان است؛ برای اتصال دائمی از linkSuggestions استفاده کنید.
 */
export function buildCustomerDocIndex(
  list: readonly Customer[],
  invoices: readonly Invoice[],
  purchases: readonly Purchase[] = [],
  idx: CustomerIndex = buildCustomerIndex(list),
): CustomerDocIndex {
  const byCustomer = new Map<string, CustomerDocs>();
  const ambiguous: CustomerDocIndex["ambiguous"] = [];
  let orphanLinked = 0;
  const bucket = (id: string) => {
    let b = byCustomer.get(id);
    if (!b) {
      b = { invoices: [], purchases: [] };
      byCustomer.set(id, b);
    }
    return b;
  };
  for (const inv of invoices) {
    const info = invoiceCustomerInfo(inv);
    if (!info) continue;
    if (info.customerId && !idx.byId.has(info.customerId)) {
      orphanLinked++;
      continue;
    }
    const m = matchCustomer(info, idx);
    if (m.kind === "ambiguous")
      ambiguous.push({ kind: "invoice", doc: inv, candidates: m.candidates });
    else if (m.kind !== "none") bucket(m.customer.id).invoices.push(inv);
  }
  for (const p of purchases) {
    const info = purchaseSupplierInfo(p);
    if (!info) continue;
    if (info.customerId && !idx.byId.has(info.customerId)) {
      orphanLinked++;
      continue;
    }
    const m = matchCustomer(info, idx);
    if (m.kind === "ambiguous")
      ambiguous.push({ kind: "purchase", doc: p, candidates: m.candidates });
    else if (m.kind !== "none") bucket(m.customer.id).purchases.push(p);
  }
  for (const b of byCustomer.values()) {
    b.invoices.sort((a, c) => c.createdAt - a.createdAt);
    b.purchases.sort((a, c) => c.createdAt - a.createdAt);
  }
  return { byCustomer, ambiguous, orphanLinked };
}

export type LinkSuggestion = {
  kind: "invoice" | "purchase";
  docId: string;
  createdAt: number;
  total: number;
  /** نام/تلفنی که روی خود فاکتور چاپ شده */
  label: string;
  phone?: string;
  /** مشتری پیشنهادی (تطبیق یکتا) */
  suggested?: Customer;
  /** چند مشتری محتمل — کاربر باید انتخاب کند */
  candidates: Customer[];
  reason: "phone" | "name" | "ambiguous";
};

/**
 * فاکتورهای قدیمی بدون شناسهٔ مشتری که می‌توانند دائمی وصل شوند.
 * فاکتور بدون هیچ مشتری محتمل فهرست نمی‌شود (مشتری متفرقه/حذف‌شده).
 */
export function linkSuggestions(
  list: readonly Customer[],
  invoices: readonly Invoice[],
  purchases: readonly Purchase[],
): LinkSuggestion[] {
  const idx = buildCustomerIndex(list);
  const out: LinkSuggestion[] = [];
  const consider = (
    kind: "invoice" | "purchase",
    docId: string,
    createdAt: number,
    total: number,
    info: CustomerInfo | undefined,
  ) => {
    if (!info || info.customerId) return;
    const m = matchCustomer(info, idx);
    const label = [info.firstName, info.lastName].filter(Boolean).join(" ").trim();
    const base = { kind, docId, createdAt, total, label, phone: info.phone };
    if (m.kind === "phone" || m.kind === "name") {
      out.push({ ...base, suggested: m.customer, candidates: [m.customer], reason: m.kind });
    } else if (m.kind === "ambiguous") {
      out.push({ ...base, candidates: m.candidates, reason: "ambiguous" });
    }
  };
  for (const inv of invoices) {
    consider("invoice", inv.id, inv.createdAt, Number(inv.total) || 0, invoiceCustomerInfo(inv));
  }
  for (const p of purchases) {
    consider("purchase", p.id, p.createdAt, Number(p.total) || 0, purchaseSupplierInfo(p));
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
