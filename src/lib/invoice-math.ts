/**
 * ─────────────────────────────────────────────────────────────────────────────
 * منبع واحد و رسمی محاسبات مبالغ فاکتور فروش.
 *
 * ⚠️ هیچ‌جای برنامه نباید جمع/تخفیف/مانده‌ی فاکتور را دستی حساب کند.
 * هر صفحه‌ای (فاکتور فروش، تاریخچه، فاکتور مشتری، چاپ A4، چاپ حرارتی، PDF،
 * اشتراک‌گذاری، اکسل) باید از همین توابع استفاده کند؛ در غیر این صورت عددِ
 * روی صفحه با عددِ چاپ‌شده فرق می‌کند — اتفاقی که قبلاً افتاده بود.
 *
 * قواعد ثابت (تغییرشان یعنی تغییر اعداد همه‌ی فاکتورها — با احتیاط):
 *  ۱) جمع هر ردیف = round(قیمت واحد × مقدار)
 *     گرد کردن در سطح ردیف انجام می‌شود تا ستون «جمع» چاپ‌شده دقیقاً با جمع کل
 *     جور دربیاید (فروش وزنی مثل ۲٫۵ کیلو اعشار تولید می‌کند).
 *  ۲) جمع اقلام (subtotal) = مجموع جمعِ ردیف‌های گردشده.
 *  ۳) تخفیف: اگر درصد وارد شده باشد اولویت با درصد است، وگرنه مبلغ ثابت.
 *     تخفیف هرگز از جمع اقلام بیشتر نمی‌شود و منفی نمی‌شود.
 *  ۴) مالیات (اختیاری): درصدی روی «جمع اقلام − تخفیف» — یعنی مبنای مالیات،
 *     مبلغ پس از تخفیف است (روال معمول مالیات بر ارزش افزوده).
 *     مالیات = round((subtotal − discount) × taxPercent / 100)
 *  ۵) مبلغ قابل پرداخت (total) = جمع اقلام − تخفیف + مالیات.
 *  ۶) مانده = total − پرداخت نقدی − مبلغ چک (هرگز منفی نمی‌شود).
 *
 * توجه: ماشین‌حساب طلا (routes/gold.tsx) محاسبه‌ی مالیات مستقل خودش را دارد
 * و فاکتور ذخیره‌شده نمی‌سازد؛ به این فایل ربطی ندارد.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Invoice, InvoiceItem, InvoiceCheque } from "@/lib/store";

/** جمع یک ردیف فاکتور — همیشه گرد شده (قاعده‌ی ۱) */
export function lineTotal(item: Pick<InvoiceItem, "price" | "quantity">): number {
  return Math.round((Number(item.price) || 0) * (Number(item.quantity) || 0));
}

/** جمع اقلام پیش از تخفیف (قاعده‌ی ۲) */
export function itemsSubtotal(items: readonly InvoiceItem[] | undefined): number {
  return (items ?? []).reduce((s, it) => s + lineTotal(it), 0);
}

/** مبلغ تخفیف فاکتور بر اساس درصد یا مبلغ ثابت (قاعده‌ی ۳) */
export function discountOf(
  subtotal: number,
  discountPercent?: number | null,
  discountAmount?: number | null,
): number {
  const pct = Math.max(0, Math.min(100, Number(discountPercent) || 0));
  const raw =
    pct > 0
      ? Math.round((subtotal * pct) / 100)
      : Math.max(0, Math.round(Number(discountAmount) || 0));
  return Math.min(Math.max(0, subtotal), raw);
}

/**
 * مبلغ مالیات فاکتور بر اساس درصد (قاعده‌ی ۴).
 * مبنا (base) باید «جمع اقلام پس از تخفیف» باشد؛ درصد به بازه‌ی ۰ تا ۱۰۰ محدود می‌شود.
 */
export function taxOf(base: number, taxPercent?: number | null): number {
  const pct = Math.max(0, Math.min(100, Number(taxPercent) || 0));
  if (pct <= 0 || base <= 0) return 0;
  return Math.round((base * pct) / 100);
}

// ─── فاکتور خرید (از تامین‌کننده) ───────────────────────────────────────────
// تخفیف/نسیه‌ی جداگانه ندارد، ولی قاعده‌ی گرد کردنِ ردیف باید همان باشد تا جمعِ
// چاپ‌شده روی فاکتور خرید هم دقیقاً با جمع ستون‌ها بخواند.

/** جمع یک ردیف فاکتور خرید — گرد شده */
export function purchaseLineTotal(item: { buyPrice: number; quantity: number }): number {
  return Math.round((Number(item.buyPrice) || 0) * (Number(item.quantity) || 0));
}

/** جمع کل فاکتور خرید */
export function purchaseTotal(
  items: readonly { buyPrice: number; quantity: number }[] | undefined,
): number {
  return (items ?? []).reduce((s, it) => s + purchaseLineTotal(it), 0);
}

/** جمع اقلام، تخفیف و مبلغ نهایی فاکتور خرید (با تخفیف کل، اگر ثبت شده باشد) */
export function purchaseTotals(p: {
  items?: readonly { buyPrice: number; quantity: number }[];
  discountPercent?: number | null;
  discountAmount?: number | null;
}): { subtotal: number; discount: number; discountPercent: number; total: number } {
  const subtotal = purchaseTotal(p.items);
  const discount = discountOf(subtotal, p.discountPercent, p.discountAmount);
  const pct = Math.max(0, Math.min(100, Number(p.discountPercent) || 0));
  return { subtotal, discount, discountPercent: pct, total: subtotal - discount };
}

/**
 * ضریب سرشکن‌کردن تخفیفِ کلِ فاکتور روی تک‌تک ردیف‌ها (۱ = بدون تخفیف).
 * برای گزارش‌ها لازم است: اگر روی فاکتور ۱٬۰۰۰٬۰۰۰ تومانی ۱۵٪ تخفیف داده شده،
 * درآمد واقعی ۸۵۰٬۰۰۰ است و سود هم باید از همان عدد حساب شود، نه از قیمت
 * فهرست. بدون این ضریب، سودِ گزارش‌شده به‌اندازه‌ی کل تخفیف‌ها بیش‌برآورد می‌شد.
 *
 * مالیات عمداً در این ضریب لحاظ نمی‌شود: مالیات درآمد فروشنده نیست (از مشتری
 * گرفته و به دولت پرداخت می‌شود)، پس نباید سود/درآمد گزارش‌ها را باد کند.
 */
export function discountFactor(inv: Invoice): number {
  const subtotal = itemsSubtotal(inv.items);
  if (subtotal <= 0) return 1;
  const discount = discountOf(subtotal, inv.discountPercent, inv.discountAmount);
  return (subtotal - discount) / subtotal;
}

/**
 * فهرست چک‌های یک فاکتور. فاکتورهای قدیمی که فقط checkAmount/checkNumber دارند
 * به یک برگ چک واحد تبدیل می‌شوند تا بقیه برنامه فقط با آرایه کار کند.
 */
export function invoiceCheques(
  inv: Pick<Invoice, "cheques" | "checkAmount" | "checkNumber" | "checkDueDate">,
): InvoiceCheque[] {
  if (Array.isArray(inv.cheques) && inv.cheques.length > 0) {
    return inv.cheques.filter(Boolean);
  }
  const amount = Math.max(0, Math.round(Number(inv.checkAmount) || 0));
  if (amount > 0 || inv.checkNumber || inv.checkDueDate) {
    return [
      {
        id: "legacy",
        amount,
        serial: inv.checkNumber || undefined,
        dueDate: inv.checkDueDate || undefined,
      },
    ];
  }
  return [];
}

/** مجموع مبلغ برگ‌های چک (بدون سقف جمع فاکتور) */
export function chequeAmountSum(
  inv: Pick<Invoice, "cheques" | "checkAmount" | "checkNumber" | "checkDueDate">,
): number {
  const list = invoiceCheques(inv);
  const fromList = list.reduce((s, c) => s + Math.max(0, Math.round(Number(c.amount) || 0)), 0);
  if (fromList > 0) return fromList;
  return Math.max(0, Math.round(Number(inv.checkAmount) || 0));
}

/** همگام‌سازی فیلدهای قدیمی تک‌چکی از روی فهرست چک‌ها */
export function withSyncedChequeFields(inv: Invoice): Invoice {
  const list = (inv.cheques ?? []).filter(
    (c) => (Number(c.amount) || 0) > 0 || c.serial || c.sayadi || c.dueDate || c.bankName,
  );
  if (list.length === 0) {
    return {
      ...inv,
      cheques: undefined,
      checkAmount: undefined,
      checkNumber: undefined,
      checkDueDate: undefined,
    };
  }
  const sum = list.reduce((s, c) => s + Math.max(0, Math.round(Number(c.amount) || 0)), 0);
  const dated = list
    .map((c) => c.dueDate)
    .filter((d): d is string => !!d)
    .sort();
  const firstId = list.find((c) => c.serial?.trim() || c.sayadi?.trim());
  return {
    ...inv,
    cheques: list,
    checkAmount: sum > 0 ? sum : inv.checkAmount || undefined,
    checkNumber: firstId?.serial?.trim() || firstId?.sayadi?.trim() || undefined,
    checkDueDate: dated[0] || undefined,
  };
}

/** برچسب یک برگ چک برای چاپ و اشتراک */
export function chequeLineLabel(
  c: InvoiceCheque,
  index: number,
  dueFmt: (d?: string) => string,
): string {
  const n = index + 1;
  const bits = [
    `چک ${n.toLocaleString("fa-IR")}`,
    c.bankName,
    c.serial ? `سریال ${c.serial}` : "",
    c.sayadi ? `صیادی ${c.sayadi}` : "",
    c.dueDate ? `سررسید ${dueFmt(c.dueDate)}` : "",
  ].filter(Boolean);
  return bits.join(" — ");
}

/** درآمد خالص یک ردیف پس از سرشکن‌شدن تخفیفِ کل فاکتور */
export function netLineRevenue(inv: Invoice, item: InvoiceItem): number {
  return lineTotal(item) * discountFactor(inv);
}

export type InvoiceTotals = {
  /** جمع اقلام پیش از تخفیف */
  subtotal: number;
  /** مبلغ تخفیف اعمال‌شده (۰ یعنی بدون تخفیف) */
  discount: number;
  /** درصد تخفیف — فقط اگر کاربر درصدی وارد کرده باشد */
  discountPercent: number;
  /** مبلغ مالیات اعمال‌شده روی «جمع اقلام − تخفیف» (۰ یعنی بدون مالیات) */
  tax: number;
  /** درصد مالیات — فقط اگر کاربر درصدی وارد کرده باشد */
  taxPercent: number;
  /** مبلغ قابل پرداخت پس از تخفیف و مالیات */
  total: number;
  /** پرداخت نقدی ثبت‌شده (حداکثر تا سقف مبلغ قابل پرداخت) */
  paid: number;
  /** مبلغ چک ثبت‌شده */
  checkAmount: number;
  /** مانده‌ی پرداخت‌نشده — فقط برای فاکتور نسیه/چک؛ نقد و کارت همیشه صفر است */
  remaining: number;
};

/**
 * محاسبه‌ی کامل مبالغ یک فاکتور. تنها تابعی که برای نمایش/چاپ باید صدا زده شود.
 * مبالغ همیشه از روی اقلام بازمحاسبه می‌شوند تا فاکتورهای قدیمی یا داده‌ی
 * دستکاری‌شده هم درست نمایش داده شوند (نه از روی فیلد ذخیره‌شده‌ی total).
 */
export function invoiceTotals(inv: Invoice): InvoiceTotals {
  const subtotal = itemsSubtotal(inv.items);
  const discount = discountOf(subtotal, inv.discountPercent, inv.discountAmount);
  const tax = taxOf(subtotal - discount, inv.taxPercent);
  const total = subtotal - discount + tax;
  const paid = Math.min(total, Math.max(0, Math.round(Number(inv.paidAmount) || 0)));
  const checkAmount = Math.min(total - paid, Math.max(0, chequeAmountSum(inv)));
  // مانده فقط برای فاکتورهای نسیه/چک معنا دارد. در فاکتور نقدی/کارتی کل مبلغ در
  // همان لحظه پرداخت شده، پس مانده صفر است (paidAmount در آن حالت ذخیره نمی‌شود).
  const deferred = inv.paymentMethod === "credit" || inv.paymentMethod === "check";
  return {
    subtotal,
    discount,
    discountPercent: Math.max(0, Math.min(100, Number(inv.discountPercent) || 0)),
    tax,
    taxPercent: Math.max(0, Math.min(100, Number(inv.taxPercent) || 0)),
    total,
    paid,
    checkAmount,
    remaining: deferred ? Math.max(0, total - paid - checkAmount) : 0,
  };
}
