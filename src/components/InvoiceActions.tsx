/**
 * InvoiceActions.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * سه‌گانه عملیات فاکتور: پرینت، دانلود PDF، اشتراک‌گذاری
 */

import { useState } from "react";
import { Printer, Download, Share2, Loader2, Receipt } from "lucide-react";
import type { Invoice } from "@/lib/store";
import { settings, formatJalaliDate, formatJalaliDateTime, PAYMENT_LABEL, formatNumber } from "@/lib/store";
import { printHtml, savePdf, OLD_APP_MESSAGE } from "@/lib/print";
import { buildInvoicePdf } from "@/lib/invoice-pdf";

// ─── HTML فاکتور ────────────────────────────────────────────────────────────

export function buildInvoiceHTML(inv: Invoice, fontSize: number = 13): string {
  const date = formatJalaliDateTime(inv.createdAt);
  const customer = inv.customer;
  const customerName =
    customer
      ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "—"
      : "—";

  const rows = inv.items
    .map(
      (item, i) => `<tr>
        <td>${(i + 1).toLocaleString("fa-IR")}</td>
        <td>${item.name}</td>
        <td>${item.quantity.toLocaleString("fa-IR")}</td>
        <td>${new Intl.NumberFormat("fa-IR").format(item.price)}</td>
        <td>${new Intl.NumberFormat("fa-IR").format(item.price * item.quantity)}</td>
      </tr>`
    )
    .join("");

  const shopName = inv.shopName || "فروشگاه";

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>فاکتور ${inv.id.toUpperCase()}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Vazirmatn',Tahoma,sans-serif;font-size:${fontSize}px;color:#111;padding:24px 32px;direction:rtl}
  .header{text-align:center;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:16px}
  .header h1{font-size:${Math.round(fontSize * 1.54)}px;font-weight:700}
  .header p{font-size:${Math.round(fontSize * 0.85)}px;color:#555;margin-top:4px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:16px;font-size:${Math.round(fontSize * 0.92)}px}
  .meta span{color:#555}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  th{background:#f0f0f0;font-weight:600;padding:7px 10px;border:1px solid #ccc;text-align:right;font-size:${Math.round(fontSize * 0.92)}px}
  td{padding:6px 10px;border:1px solid #ccc;font-size:${Math.round(fontSize * 0.92)}px}
  tr:nth-child(even) td{background:#fafafa}
  .total-row td{font-weight:700;background:#f0f0f0!important}
  .footer{text-align:center;font-size:${Math.round(fontSize * 0.85)}px;color:#888;margin-top:20px;border-top:1px solid #ddd;padding-top:10px}
  @media print{body{padding:12px}}
</style>
</head>
<body>
<div class="header">
  <h1>${shopName}</h1>
  <p>سیستم حسابداری کمالی | فاکتور فروش</p>
</div>
<div class="meta">
  <div><span>شماره: </span><strong>${inv.id.toUpperCase()}</strong></div>
  <div><span>تاریخ: </span><strong>${date}</strong></div>
  <div><span>مشتری: </span><strong>${customerName}</strong></div>
  <div><span>تلفن: </span><strong>${customer?.phone || "—"}</strong></div>
  ${inv.paymentMethod ? `<div><span>روش پرداخت: </span><strong>${PAYMENT_LABEL[inv.paymentMethod]}</strong></div>` : ""}
</div>
<table>
  <thead><tr><th>#</th><th>نام کالا</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr class="total-row">
      <td colspan="4">جمع کل</td>
      <td>${new Intl.NumberFormat("fa-IR").format(inv.total)} تومان</td>
    </tr>
    ${inv.paidAmount ? `<tr><td colspan="4">پرداخت نقدی</td><td>${new Intl.NumberFormat("fa-IR").format(inv.paidAmount)} تومان</td></tr>` : ""}
    ${inv.checkAmount ? `<tr><td colspan="4">مبلغ چک${inv.checkNumber ? ` (شماره ${inv.checkNumber})` : ""}${inv.checkDueDate ? ` — سررسید ${new Intl.DateTimeFormat("fa-IR-u-ca-persian",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"Asia/Tehran"}).format(new Date(inv.checkDueDate))}` : ""}</td><td>${new Intl.NumberFormat("fa-IR").format(inv.checkAmount)} تومان</td></tr>` : ""}
    ${inv.paymentMethod === "credit" && inv.paidAmount != null ? `<tr><td colspan="4">مانده نسیه</td><td>${new Intl.NumberFormat("fa-IR").format(Math.max(0, inv.total - (inv.paidAmount || 0)))} تومان</td></tr>` : ""}
  </tfoot>
</table>
<div class="footer">با تشکر از خرید شما — ${shopName}</div>
</body>
</html>`;
}

// ─── HTML فاکتور حرارتی (۸۰ میلی‌متر) — مخصوص پرینتر فیش/رسید ─────────────
export function buildThermalInvoiceHTML(inv: Invoice): string {
  const date = formatJalaliDateTime(inv.createdAt);
  const customer = inv.customer;
  const customerName = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
    : "";
  const shopName = inv.shopName || "فروشگاه";
  const fmt = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
  const rows = inv.items
    .map(
      (it) => `
      <div class="row">
        <div class="name">${it.name}</div>
        <div class="line"><span>${it.quantity.toLocaleString("fa-IR")} × ${fmt(it.price)}</span><span>${fmt(it.price * it.quantity)}</span></div>
      </div>`
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="utf-8"/>
<title>فیش ${inv.id.toUpperCase()}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Vazirmatn',Tahoma,sans-serif;color:#000;direction:rtl;width:80mm;padding:6px 8px;font-size:12px;line-height:1.55}
  .center{text-align:center}
  .shop{font-weight:700;font-size:14px}
  .muted{color:#444;font-size:10.5px}
  .sep{border-top:1px dashed #000;margin:6px 0}
  .meta{font-size:11px}
  .meta div{display:flex;justify-content:space-between;gap:6px}
  .row{padding:3px 0}
  .name{font-weight:700}
  .line{display:flex;justify-content:space-between;font-size:11px;color:#222}
  .total{display:flex;justify-content:space-between;font-weight:700;font-size:13px;margin-top:4px}
  .foot{font-size:10.5px;text-align:center;margin-top:6px}
  @media print { body { width: 80mm; } }
</style></head><body>
<div class="center shop">${shopName}</div>
<div class="center muted">فاکتور فروش</div>
<div class="sep"></div>
<div class="meta">
  <div><span>شماره:</span><span>${inv.id.toUpperCase()}</span></div>
  <div><span>تاریخ:</span><span>${date}</span></div>
  ${customerName ? `<div><span>مشتری:</span><span>${customerName}</span></div>` : ""}
  ${customer?.phone ? `<div><span>تلفن:</span><span>${customer.phone}</span></div>` : ""}
  ${inv.paymentMethod ? `<div><span>پرداخت:</span><span>${PAYMENT_LABEL[inv.paymentMethod]}</span></div>` : ""}
</div>
<div class="sep"></div>
${rows}
<div class="sep"></div>
<div class="total"><span>جمع کل</span><span>${fmt(inv.total)} تومان</span></div>
${inv.paidAmount ? `<div class="line"><span>پرداخت نقدی</span><span>${fmt(inv.paidAmount)}</span></div>` : ""}
${inv.checkAmount ? `<div class="line"><span>مبلغ چک${inv.checkNumber ? ` (${inv.checkNumber})` : ""}</span><span>${fmt(inv.checkAmount)}</span></div>` : ""}
${inv.paymentMethod === "credit" && inv.paidAmount != null ? `<div class="line"><span>مانده نسیه</span><span>${fmt(Math.max(0, inv.total - (inv.paidAmount || 0)))}</span></div>` : ""}
<div class="foot">با تشکر از خرید شما</div>
</body></html>`;
}

// ─── متن ساده برای اشتراک‌گذاری ───────────────────────────────────────────

function buildShareText(inv: Invoice): string {
  const date = formatJalaliDate(inv.createdAt);
  const customer = inv.customer;
  const customerName =
    customer
      ? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
      : "";
  const lines = [
    `🧾 فاکتور ${inv.shopName || "فروشگاه"}`,
    `📅 تاریخ: ${date}`,
    customerName ? `👤 مشتری: ${customerName}` : "",
    `─────────────────`,
    ...inv.items.map(
      (item) =>
        `• ${item.name}  ×${item.quantity}  =  ${new Intl.NumberFormat("fa-IR").format(item.price * item.quantity)} تومان`
    ),
    `─────────────────`,
    `💰 جمع کل: ${new Intl.NumberFormat("fa-IR").format(inv.total)} تومان`,
  ].filter(Boolean);
  return lines.join("\n");
}

// ─── Props ───────────────────────────────────────────────────────────────────

type Props = {
  inv: Invoice;
  /** اندازه دکمه‌ها */
  size?: "sm" | "md";
  /** اگر true باشه label زیر آیکون نشون داده میشه */
  showLabels?: boolean;
};

// ─── کامپوننت ────────────────────────────────────────────────────────────────

export function InvoiceActions({ inv, size = "md", showLabels = false }: Props) {
  const [appSettings] = settings.useAll();
  const fontSize = appSettings.invoiceFontSize ?? 13;
  const [busy, setBusy] = useState(false);

  // ── چاپ (وب: iframe — اپ اندروید: پلاگین چاپ نیتیو) ───────────────────────
  const handlePrint = async () => {
    const html = buildInvoiceHTML(inv, fontSize);
    const ok = await printHtml(html, `فاکتور ${inv.id.toUpperCase()}`);
    if (!ok) alert(OLD_APP_MESSAGE);
  };

  // ── چاپ حرارتی ۸۰ میلی‌متر ────────────────────────────────────────────────
  const handleThermalPrint = async () => {
    const html = buildThermalInvoiceHTML(inv);
    const ok = await printHtml(html, `فیش ${inv.id.toUpperCase()}`);
    if (!ok) alert(OLD_APP_MESSAGE);
  };

  // ── دانلود PDF — وب: دانلود مستقیم، اپ اندروید: ذخیره + اشتراک ────────────
  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const pdf = await buildInvoicePdf(inv);
      const ok = await savePdf(pdf, `invoice-${inv.id.toUpperCase()}.pdf`);
      if (!ok) alert(OLD_APP_MESSAGE);
    } catch (e) {
      console.warn("[invoice] pdf failed", e);
      alert("خطا در ساخت PDF فاکتور.");
    } finally {
      setBusy(false);
    }
  };

  // ── اشتراک‌گذاری ──────────────────────────────────────────────────────────
  const handleShare = async () => {
    const text = buildShareText(inv);

    if (navigator.share) {
      try {
        await navigator.share({
          title: `فاکتور ${inv.shopName || "فروشگاه"}`,
          text,
        });
        return;
      } catch {
        // ادامه به fallback
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      alert("متن فاکتور کپی شد!");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("متن فاکتور کپی شد!");
    }
  };

  const btnBase =
    size === "sm"
      ? "grid place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition"
      : "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition";

  const btnSize = size === "sm" ? "h-8 w-8" : "flex-1";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-4 w-4";

  return (
    <>
      <button
        type="button"
        onClick={handlePrint}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""}`}
        title="پرینت فاکتور (A4)"
      >
        <Printer className={iconSize} />
        {showLabels && <span>پرینت</span>}
      </button>

      <button
        type="button"
        onClick={handleThermalPrint}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""}`}
        title="چاپ حرارتی ۸۰ میلی‌متر (فیش/رسید)"
      >
        <Receipt className={iconSize} />
        {showLabels && <span>چاپ حرارتی</span>}
      </button>

      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""} disabled:opacity-50`}
        title="دانلود PDF فاکتور"
      >
        {busy ? <Loader2 className={`${iconSize} animate-spin`} /> : <Download className={iconSize} />}
        {showLabels && <span>دانلود</span>}
      </button>

      <button
        type="button"
        onClick={handleShare}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-primary/10 text-primary hover:bg-primary/20" : ""}`}
        title="ارسال فاکتور"
      >
        <Share2 className={iconSize} />
        {showLabels && <span>ارسال</span>}
      </button>
    </>
  );
}
