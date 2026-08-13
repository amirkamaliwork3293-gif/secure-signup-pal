/**
 * بررسی سلامت محاسبات مبالغ فاکتور (تخفیف، مالیات، نسیه، چک، مقدار وزنی، گرد کردن).
 * اجرا:  node scripts/test-invoice-math.mjs
 * (بدون فریم‌ورک تست — فقط assert؛ اگر عددی خراب شود، همین‌جا می‌ترکد.)
 */
import assert from "node:assert/strict";
import {
  invoiceTotals,
  lineTotal,
  itemsSubtotal,
  discountFactor,
  netLineRevenue,
  purchaseLineTotal,
  purchaseTotal,
  taxOf,
} from "../src/lib/invoice-math.ts";

const inv = (items, extra = {}) => ({ id: "x", createdAt: 0, items, total: 0, ...extra });
const item = (price, quantity) => ({ productId: "p", name: "کالا", price, quantity });

// ── ۱) فاکتور ساده ──────────────────────────────────────────────────────────
{
  const t = invoiceTotals(inv([item(1000, 3), item(2500, 2)]));
  assert.equal(t.subtotal, 8000);
  assert.equal(t.discount, 0);
  assert.equal(t.total, 8000);
  assert.equal(t.remaining, 0, "فاکتور نقدی مانده ندارد");
}

// ── ۲) فقط تخفیف درصدی ─────────────────────────────────────────────────────
{
  const t = invoiceTotals(inv([item(100_000, 1)], { discountPercent: 15 }));
  assert.equal(t.subtotal, 100_000);
  assert.equal(t.discount, 15_000);
  assert.equal(t.total, 85_000);
}

// ── ۳) تخفیف مبلغی، و کلمپ شدن تخفیفِ بزرگ‌تر از جمع اقلام ─────────────────
{
  const t = invoiceTotals(inv([item(50_000, 1)], { discountAmount: 12_000 }));
  assert.equal(t.total, 38_000);

  const over = invoiceTotals(inv([item(50_000, 1)], { discountAmount: 999_999 }));
  assert.equal(over.discount, 50_000, "تخفیف هرگز از جمع اقلام بیشتر نمی‌شود");
  assert.equal(over.total, 0, "جمع کل هرگز منفی نمی‌شود");
}

// ── ۴) درصد بر مبلغ اولویت دارد (هر دو پر باشد) ────────────────────────────
{
  const t = invoiceTotals(inv([item(200_000, 1)], { discountPercent: 10, discountAmount: 999 }));
  assert.equal(t.discount, 20_000);
}

// ── ۵) فقط نسیه (بدون تخفیف) ───────────────────────────────────────────────
{
  const t = invoiceTotals(
    inv([item(300_000, 1)], { paymentMethod: "credit", paidAmount: 100_000 }),
  );
  assert.equal(t.total, 300_000);
  assert.equal(t.paid, 100_000);
  assert.equal(t.remaining, 200_000);
}

// ── ۶) تخفیف + نسیه با هم (سناریوی اصلیِ گزارش‌شده) ────────────────────────
{
  const t = invoiceTotals(
    inv([item(1_000_000, 2)], {
      discountPercent: 20,
      paymentMethod: "credit",
      paidAmount: 500_000,
    }),
  );
  assert.equal(t.subtotal, 2_000_000);
  assert.equal(t.discount, 400_000);
  assert.equal(t.total, 1_600_000, "تخفیف باید پیش از محاسبه‌ی مانده اعمال شود");
  assert.equal(t.remaining, 1_100_000, "مانده = جمع کلِ پس از تخفیف − پرداخت نقدی");
}

// ── ۷) پرداخت بیشتر از مبلغ فاکتور نباید مانده‌ی منفی بسازد ────────────────
{
  const t = invoiceTotals(
    inv([item(50_000, 1)], { paymentMethod: "credit", paidAmount: 80_000 }),
  );
  assert.equal(t.paid, 50_000);
  assert.equal(t.remaining, 0);
}

// ── ۸) چک: نقد + چک، مانده صفر ─────────────────────────────────────────────
{
  const t = invoiceTotals(
    inv([item(1_000_000, 1)], { paymentMethod: "check", paidAmount: 300_000, checkAmount: 700_000 }),
  );
  assert.equal(t.checkAmount, 700_000);
  assert.equal(t.remaining, 0);
}

// ── ۹) فروش وزنی: جمعِ ردیف‌های چاپ‌شده باید دقیقاً جمع کل شود ─────────────
{
  const items = [item(12_345, 2.5), item(9_999, 1.333)];
  const t = invoiceTotals(inv(items));
  const printed = items.reduce((s, it) => s + lineTotal(it), 0);
  assert.equal(t.subtotal, printed, "ستون «جمع» چاپی باید با جمع اقلام بخواند");
  assert.equal(lineTotal(items[0]), 30_863); // round(30862.5)
  assert.equal(Number.isInteger(t.total), true, "مبلغ نهایی همیشه عدد صحیح است");
}

// ── ۱۰) تخفیف روی مبلغ اعشاری، و ورودی‌های نامعتبر ─────────────────────────
{
  const t = invoiceTotals(inv([item(33_333, 3)], { discountPercent: 7 }));
  assert.equal(t.subtotal, 99_999);
  assert.equal(t.discount, 7000); // round(6999.93)
  assert.equal(t.total, 92_999);

  const bad = invoiceTotals(
    inv([item(10_000, 1)], { discountPercent: -5, discountAmount: -100, paidAmount: -50 }),
  );
  assert.equal(bad.discount, 0);
  assert.equal(bad.paid, 0);

  const over100 = invoiceTotals(inv([item(10_000, 1)], { discountPercent: 250 }));
  assert.equal(over100.discount, 10_000, "درصد تخفیف به ۱۰۰ محدود می‌شود");
}

// ── ۱۱) فاکتور خالی ────────────────────────────────────────────────────────
{
  const t = invoiceTotals(inv([]));
  assert.equal(t.subtotal, 0);
  assert.equal(t.total, 0);
  assert.equal(itemsSubtotal(undefined), 0);
}

// ── ۱۲) سرشکن‌شدن تخفیف روی ردیف‌ها (مبنای گزارش سود) ─────────────────────
{
  const i = inv([item(600_000, 1), item(400_000, 1)], { discountPercent: 10 });
  assert.equal(discountFactor(i), 0.9);
  assert.equal(netLineRevenue(i, i.items[0]), 540_000);
  assert.equal(netLineRevenue(i, i.items[1]), 360_000);
  assert.equal(
    netLineRevenue(i, i.items[0]) + netLineRevenue(i, i.items[1]),
    invoiceTotals(i).total,
    "مجموع درآمد خالص ردیف‌ها باید دقیقاً جمع کل فاکتور شود",
  );
  assert.equal(discountFactor(inv([])), 1, "فاکتور خالی ضریب ۱ دارد (تقسیم بر صفر نشود)");
}

// ── ۱۳) فاکتور خرید ────────────────────────────────────────────────────────
{
  const items = [{ buyPrice: 7_500, quantity: 3 }, { buyPrice: 1_234, quantity: 2.5 }];
  assert.equal(purchaseLineTotal(items[1]), 3_085); // round(3085)
  assert.equal(purchaseTotal(items), 22_500 + 3_085);
  assert.equal(purchaseTotal(undefined), 0);
}

// ── ۱۴) فقط مالیات درصدی ───────────────────────────────────────────────────
{
  const t = invoiceTotals(inv([item(100_000, 1)], { taxPercent: 9 }));
  assert.equal(t.subtotal, 100_000);
  assert.equal(t.discount, 0);
  assert.equal(t.tax, 9_000);
  assert.equal(t.taxPercent, 9);
  assert.equal(t.total, 109_000, "جمع کل = جمع اقلام + مالیات");

  const none = invoiceTotals(inv([item(100_000, 1)]));
  assert.equal(none.tax, 0, "بدون درصد مالیات، مالیاتی وجود ندارد");
  assert.equal(none.total, 100_000);
}

// ── ۱۵) تخفیف + مالیات با هم: مالیات روی مبلغ پس از تخفیف ──────────────────
{
  const t = invoiceTotals(inv([item(100_000, 2)], { discountPercent: 10, taxPercent: 9 }));
  assert.equal(t.subtotal, 200_000);
  assert.equal(t.discount, 20_000);
  assert.equal(t.tax, 16_200, "مالیات = ٪۹ از (۲۰۰٬۰۰۰ − ۲۰٬۰۰۰)");
  assert.equal(t.total, 196_200, "جمع کل = جمع اقلام − تخفیف + مالیات");
}

// ── ۱۶) مالیات + نسیه: مانده باید از جمع کلِ با مالیات حساب شود ────────────
{
  const t = invoiceTotals(
    inv([item(1_000_000, 1)], { taxPercent: 10, paymentMethod: "credit", paidAmount: 500_000 }),
  );
  assert.equal(t.total, 1_100_000);
  assert.equal(t.paid, 500_000);
  assert.equal(t.remaining, 600_000, "مانده = جمع کل (با مالیات) − پرداخت نقدی");
}

// ── ۱۷) مالیات: گرد کردن و ورودی‌های نامعتبر ───────────────────────────────
{
  const t = invoiceTotals(inv([item(33_333, 1)], { taxPercent: 9 }));
  assert.equal(t.tax, 3_000); // round(2999.97)
  assert.equal(Number.isInteger(t.total), true, "مبلغ نهایی همیشه عدد صحیح است");

  const bad = invoiceTotals(inv([item(10_000, 1)], { taxPercent: -5 }));
  assert.equal(bad.tax, 0, "درصد مالیات منفی نادیده گرفته می‌شود");

  const over100 = invoiceTotals(inv([item(10_000, 1)], { taxPercent: 250 }));
  assert.equal(over100.tax, 10_000, "درصد مالیات به ۱۰۰ محدود می‌شود");

  assert.equal(taxOf(0, 9), 0, "مبنای صفر، مالیات صفر");
  assert.equal(taxOf(100_000, undefined), 0);
}

// ── ۱۸) مالیات نباید درآمد/سود گزارش‌ها را تغییر دهد ───────────────────────
{
  const i = inv([item(600_000, 1), item(400_000, 1)], { discountPercent: 10, taxPercent: 9 });
  assert.equal(discountFactor(i), 0.9, "ضریب سرشکن فقط تابع تخفیف است، نه مالیات");
  assert.equal(
    netLineRevenue(i, i.items[0]) + netLineRevenue(i, i.items[1]),
    invoiceTotals(i).total - invoiceTotals(i).tax,
    "درآمد خالص ردیف‌ها = جمع کل منهای مالیات",
  );
}

console.log("✅ همه‌ی سناریوهای محاسبه‌ی فاکتور درست است (۱۸ گروه بررسی)");
