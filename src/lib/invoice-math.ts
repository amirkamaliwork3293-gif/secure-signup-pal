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
 *  ۴) مبلغ قابل پرداخت (total) = جمع اقلام − تخفیف.
 *  ۵) مانده = total − پرداخت نقدی − مبلغ چک (هرگز منفی نمی‌شود).
 *
 * مالیات: فاکتور فروش عادی مالیات ندارد. تنها بخش دارای مالیات، ماشین‌حساب
 * طلا (routes/gold.tsx) است که فاکتور ذخیره‌شده نمی‌سازد و محاسبه‌ی مستقل دارد.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Invoice, InvoiceItem } from "@/lib/store";

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

// ─── فاکتور خرید (از تامین‌کننده) ───────────────────────────────────────────
// تخفیف/نسیه‌ی جداگانه ندارد، ولی قاعده‌ی گرد کردنِ ردیف باید همان باشد تا جمعِ
// چاپ‌شده روی فاکتور خرید هم دقیقاً با جمع ستون‌ها بخواند.

/** جمع یک ردیف فاکتور خرید — گرد شده */
export function purchaseLineTotal(item: { buyPrice: number; quantity: number }): number {
  return Math.round((Number(item.buyPrice) || 0) * (Number(item.quantity) || 0));
}

/** جمع کل فاکتور خرید */
export function purchaseTotal(items: readonly { buyPrice: number; quantity: number }[] | undefined): number {
  return (items ?? []).reduce((s, it) => s + purchaseLineTotal(it), 0);
}

/**
 * ضریب سرشکن‌کردن تخفیفِ کلِ فاکتور روی تک‌تک ردیف‌ها (۱ = بدون تخفیف).
 * برای گزارش‌ها لازم است: اگر روی فاکتور ۱٬۰۰۰٬۰۰۰ تومانی ۱۵٪ تخفیف داده شده،
 * درآمد واقعی ۸۵۰٬۰۰۰ است و سود هم باید از همان عدد حساب شود، نه از قیمت
 * فهرست. بدون این ضریب، سودِ گزارش‌شده به‌اندازه‌ی کل تخفیف‌ها بیش‌برآورد می‌شد.
 */
export function discountFactor(inv: Invoice): number {
  const subtotal = itemsSubtotal(inv.items);
  if (subtotal <= 0) return 1;
  const discount = discountOf(subtotal, inv.discountPercent, inv.discountAmount);
  return (subtotal - discount) / subtotal;
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
  /** مبلغ قابل پرداخت پس از تخفیف */
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
  const total = subtotal - discount;
  const paid = Math.min(total, Math.max(0, Math.round(Number(inv.paidAmount) || 0)));
  const checkAmount = Math.min(total - paid, Math.max(0, Math.round(Number(inv.checkAmount) || 0)));
  // مانده فقط برای فاکتورهای نسیه/چک معنا دارد. در فاکتور نقدی/کارتی کل مبلغ در
  // همان لحظه پرداخت شده، پس مانده صفر است (paidAmount در آن حالت ذخیره نمی‌شود).
  const deferred = inv.paymentMethod === "credit" || inv.paymentMethod === "check";
  return {
    subtotal,
    discount,
    discountPercent: Math.max(0, Math.min(100, Number(inv.discountPercent) || 0)),
    total,
    paid,
    checkAmount,
    remaining: deferred ? Math.max(0, total - paid - checkAmount) : 0,
  };
}
