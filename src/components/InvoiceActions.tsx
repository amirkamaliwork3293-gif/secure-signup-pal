/**
 * InvoiceActions.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * دوتایی عملیات فاکتور: پرینت (A4/حرارتی — شامل ذخیره‌ی PDF از طریق دیالوگ چاپ مرورگر)، اشتراک‌گذاری
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Printer, Share2, Receipt, FileDown, MessageSquare } from "lucide-react";
import { InvoiceMessageDialog } from "@/components/InvoiceMessageDialog";
import type { Invoice } from "@/lib/store";
import { settings, formatJalaliDate, formatJalaliDateTime, PAYMENT_LABEL, formatAmount, formatNumber, currencyLabel } from "@/lib/store";
import { invoiceTotals, lineTotal } from "@/lib/invoice-math";
import {
  printHtml,
  OLD_APP_MESSAGE,
  isNativeApp,
  saveBase64File,
  downloadBlob,
  printFitAssets,
  PAPER_SIZES,
  normalizePaperSize,
  type PaperSize,
} from "@/lib/print";
import {
  normalizeTemplate,
  buildTemplatedInvoiceHTML,
  itemUnitLabel,
  type InvoiceTemplate,
} from "@/lib/invoice-template";
import { COUNT_UNIT } from "@/lib/store";

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── HTML فاکتور ────────────────────────────────────────────────────────────

/** واحد نمایشی کنار تعداد — فقط وقتی واحد غیر از «عدد» باشد */
function qtyWithUnit(item: Invoice["items"][number]): string {
  const unit = itemUnitLabel(item.unit);
  const q = item.quantity.toLocaleString("fa-IR");
  return unit && unit !== COUNT_UNIT ? `${q} ${unit}` : q;
}

export function buildInvoiceHTML(
  inv: Invoice,
  fontSize: number = 13,
  template?: Partial<InvoiceTemplate> | null,
  paper: PaperSize = "A4",
): string {
  const tpl = normalizeTemplate(template);
  if (tpl.enabled) return buildTemplatedInvoiceHTML(inv, tpl, fontSize, paper);
  const date = formatJalaliDateTime(inv.createdAt);
  const customer = inv.customer;
  const customerName =
    customer
      ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "—"
      : "—";

  const t = invoiceTotals(inv);
  const rows = inv.items
    .map(
      (item, i) => `<tr>
        <td class="idx">${(i + 1).toLocaleString("fa-IR")}</td>
        <td class="name">${escHtml(item.name)}${
          item.discountPercent
            ? ` <span class="off">٪${item.discountPercent.toLocaleString("fa-IR")} تخفیف</span>`
            : ""
        }</td>
        <td class="qty">${qtyWithUnit(item)}</td>
        <td class="price">${
          item.originalPrice
            ? `<s>${formatAmount(item.originalPrice)}</s> `
            : ""
        }${formatAmount(item.price)}</td>
        <td class="sum">${formatAmount(lineTotal(item))}</td>
      </tr>`
    )
    .join("");

  const shopName = inv.shopName || "فروشگاه";
  const fs = fontSize;
  const compact = paper === "A5";
  const fit = printFitAssets(paper);
  const checkDue = inv.checkDueDate
    ? new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "Asia/Tehran",
      }).format(new Date(inv.checkDueDate))
    : "";

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>فاکتور ${escHtml(inv.id.toUpperCase())}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap');
  ${fit.css}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Vazirmatn',Tahoma,sans-serif;font-size:${fs}px;color:#1a2332;direction:rtl;padding:${compact ? 8 : 14}px;background:#fff}
  .sheet{border:1px solid #c9d4e0;border-radius:12px;overflow:hidden;background:#fff}
  .hero{display:flex;align-items:center;gap:12px;padding:${compact ? "10px 12px" : "14px 16px"};background:linear-gradient(135deg,#0b3d5c 0%,#145a86 55%,#1a6fa3 100%);color:#fff}
  .hero .logo{width:${compact ? 46 : 58}px;height:${compact ? 46 : 58}px;object-fit:contain;border-radius:10px;background:#fff;flex-shrink:0;padding:3px}
  .hero .who{flex:1;min-width:0}
  .hero h1{font-size:${Math.round(fs * 1.45)}px;font-weight:700;letter-spacing:-.02em;word-break:break-word;line-height:1.25}
  .hero .sub{font-size:${Math.round(fs * 0.78)}px;opacity:.88;margin-top:3px;word-break:break-word}
  .badge{flex-shrink:0;text-align:center;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);border-radius:10px;padding:8px 12px;min-width:92px}
  .badge .k{font-size:${Math.round(fs * 0.7)}px;opacity:.8}
  .badge .v{font-size:${Math.round(fs * 0.95)}px;font-weight:700;margin-top:2px;color:#f3d48b}
  .meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;border-bottom:1px solid #e4ebf2;background:#f6f9fc}
  .meta .cell{padding:${compact ? "6px 10px" : "8px 12px"};border-left:1px solid #e4ebf2;min-width:0}
  .meta .cell .k{display:block;font-size:${Math.round(fs * 0.72)}px;color:#6b7c8f;margin-bottom:2px}
  .meta .cell .v{font-weight:600;font-size:${Math.round(fs * 0.9)}px;word-break:break-word}
  .note{margin:0;padding:8px 12px;background:#fff8e8;border-bottom:1px solid #f0e2b8;font-size:${Math.round(fs * 0.85)}px;color:#5c4a12;word-break:break-word}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  thead th{background:#0b3d5c;color:#fff;font-weight:600;padding:${compact ? "6px 6px" : "8px 8px"};font-size:${Math.round(fs * 0.82)}px;text-align:center}
  tbody td{padding:${compact ? "5px 6px" : "7px 8px"};border-bottom:1px solid #e8eef4;font-size:${Math.round(fs * 0.86)}px;text-align:center;word-break:break-word;overflow-wrap:anywhere}
  tbody tr:nth-child(even) td{background:#f7fafc}
  td.idx{width:8%;color:#6b7c8f}
  td.name{text-align:right;width:40%}
  td.qty{width:14%;white-space:nowrap}
  td.price,td.sum{width:19%}
  .off{color:#0f9d58;font-size:.82em;font-weight:700}
  s{color:#9aa8b5;margin-left:4px}
  .bottom{display:flex;gap:12px;align-items:stretch;padding:${compact ? "8px 10px 10px" : "12px 14px 14px"};flex-wrap:wrap}
  .signs{flex:1;min-width:140px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .signs .box{border:1px dashed #c9d4e0;border-radius:8px;padding:8px 10px 28px;font-size:${Math.round(fs * 0.78)}px;color:#6b7c8f}
  .sums{margin-right:auto;min-width:min(100%,220px);border:1px solid #d5e0ea;border-radius:10px;overflow:hidden}
  .sums .row{display:flex;justify-content:space-between;gap:12px;padding:5px 10px;font-size:${Math.round(fs * 0.86)}px;border-bottom:1px solid #eef3f7}
  .sums .row:last-child{border-bottom:0}
  .sums .row.grand{background:#0b3d5c;color:#fff;font-weight:700;font-size:${Math.round(fs * 0.95)}px}
  .sums .row.due{color:#b42318;font-weight:700;background:#fff1f0}
  .foot{text-align:center;font-size:${Math.round(fs * 0.75)}px;color:#8a97a6;padding:8px 10px 4px;letter-spacing:.02em}
</style>
</head>
<body>
<div id="print-root">
<div class="sheet">
  <div class="hero">
    ${inv.shopLogoUrl ? `<img class="logo" src="${escHtml(inv.shopLogoUrl)}" alt="لوگو"/>` : ""}
    <div class="who">
      <h1>${escHtml(shopName)}</h1>
      <div class="sub">${escHtml([inv.shopAddress, inv.shopPhone ? `تلفن: ${inv.shopPhone}` : ""].filter(Boolean).join("  ·  ") || "فاکتور فروش کالا و خدمات")}</div>
    </div>
    <div class="badge">
      <div class="k">فاکتور فروش</div>
      <div class="v">${escHtml(inv.id.toUpperCase())}</div>
    </div>
  </div>
  <div class="meta">
    <div class="cell"><span class="k">تاریخ</span><span class="v">${escHtml(date)}</span></div>
    <div class="cell"><span class="k">مشتری</span><span class="v">${escHtml(customerName)}</span></div>
    <div class="cell"><span class="k">تلفن مشتری</span><span class="v">${escHtml(customer?.phone || "—")}</span></div>
    <div class="cell"><span class="k">روش پرداخت</span><span class="v">${escHtml(inv.paymentMethod ? PAYMENT_LABEL[inv.paymentMethod] : "—")}</span></div>
  </div>
  ${inv.notes ? `<div class="note"><strong>توضیحات: </strong>${escHtml(inv.notes)}</div>` : ""}
  <table>
    <thead><tr><th>#</th><th>شرح کالا / خدمات</th><th>تعداد</th><th>مبلغ واحد</th><th>مبلغ کل</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="bottom">
    <div class="signs">
      <div class="box">مهر و امضای فروشنده</div>
      <div class="box">امضای خریدار</div>
    </div>
    <div class="sums">
      ${t.discount || t.tax ? `<div class="row"><span>جمع اقلام</span><span>${formatAmount(t.subtotal)} ${currencyLabel()}</span></div>` : ""}
      ${t.discount ? `<div class="row"><span>تخفیف${t.discountPercent ? ` (${formatNumber(t.discountPercent)}٪)` : ""}</span><span>${formatAmount(t.discount)} ${currencyLabel()}</span></div>` : ""}
      ${t.tax ? `<div class="row"><span>مالیات${t.taxPercent ? ` (${formatNumber(t.taxPercent)}٪)` : ""}</span><span>${formatAmount(t.tax)} ${currencyLabel()}</span></div>` : ""}
      <div class="row grand"><span>جمع کل</span><span>${formatAmount(t.total)} ${currencyLabel()}</span></div>
      ${t.paid ? `<div class="row"><span>پرداخت نقدی</span><span>${formatAmount(t.paid)} ${currencyLabel()}</span></div>` : ""}
      ${t.checkAmount ? `<div class="row"><span>مبلغ چک${inv.checkNumber ? ` (${escHtml(inv.checkNumber)})` : ""}${checkDue ? ` — سررسید ${escHtml(checkDue)}` : ""}</span><span>${formatAmount(t.checkAmount)} ${currencyLabel()}</span></div>` : ""}
      ${t.remaining > 0 ? `<div class="row due"><span>مانده${inv.paymentMethod === "credit" ? " نسیه" : ""}</span><span>${formatAmount(t.remaining)} ${currencyLabel()}</span></div>` : ""}
    </div>
  </div>
</div>
<div class="foot">با سپاس از اعتماد شما — ${escHtml(shopName)}</div>
</div>
${fit.script}
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
  const fmt = formatAmount;
  const t = invoiceTotals(inv);
  const rows = inv.items
    .map(
      (it) => `
      <div class="row">
        <div class="name">${it.name}${it.discountPercent ? ` <span style="font-weight:400;color:#333;">(٪${it.discountPercent.toLocaleString("fa-IR")} تخفیف)</span>` : ""}</div>
        <div class="line"><span>${qtyWithUnit(it)} × ${it.originalPrice ? `<s>${fmt(it.originalPrice)}</s> ` : ""}${fmt(it.price)}</span><span>${fmt(lineTotal(it))}</span></div>
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
  .logo{display:block;margin:0 auto 4px;max-width:56mm;max-height:28mm;object-fit:contain}
  @media print { body { width: 80mm; } }
</style></head><body>
${inv.shopLogoUrl ? `<img class="logo" src="${inv.shopLogoUrl}" alt="لوگو" />` : ""}
<div class="center shop">${shopName}</div>
<div class="center muted">فاکتور فروش</div>
${
  inv.shopAddress || inv.shopPhone
    ? `<div class="center muted">${[inv.shopAddress, inv.shopPhone ? `تلفن: ${inv.shopPhone}` : ""].filter(Boolean).join(" — ")}</div>`
    : ""
}
<div class="sep"></div>
<div class="meta">
  <div><span>شماره:</span><span>${inv.id.toUpperCase()}</span></div>
  <div><span>تاریخ:</span><span>${date}</span></div>
  ${customerName ? `<div><span>مشتری:</span><span>${customerName}</span></div>` : ""}
  ${customer?.phone ? `<div><span>تلفن:</span><span>${customer.phone}</span></div>` : ""}
  ${inv.paymentMethod ? `<div><span>پرداخت:</span><span>${PAYMENT_LABEL[inv.paymentMethod]}</span></div>` : ""}
</div>
${inv.notes ? `<div class="sep"></div><div class="muted">توضیحات: ${inv.notes}</div>` : ""}
<div class="sep"></div>
${rows}
<div class="sep"></div>
${t.discount || t.tax ? `<div class="line"><span>جمع اقلام</span><span>${fmt(t.subtotal)}</span></div>` : ""}
${t.discount ? `<div class="line"><span>تخفیف${t.discountPercent ? ` (${formatNumber(t.discountPercent)}٪)` : ""}</span><span>${fmt(t.discount)}</span></div>` : ""}
${t.tax ? `<div class="line"><span>مالیات${t.taxPercent ? ` (${formatNumber(t.taxPercent)}٪)` : ""}</span><span>${fmt(t.tax)}</span></div>` : ""}
<div class="total"><span>جمع کل</span><span>${fmt(t.total)} ${currencyLabel()}</span></div>
${t.paid ? `<div class="line"><span>پرداخت نقدی</span><span>${fmt(t.paid)}</span></div>` : ""}
${t.checkAmount ? `<div class="line"><span>مبلغ چک${inv.checkNumber ? ` (${inv.checkNumber})` : ""}</span><span>${fmt(t.checkAmount)}</span></div>` : ""}
${t.remaining > 0 ? `<div class="line"><span>مانده${inv.paymentMethod === "credit" ? " نسیه" : ""}</span><span>${fmt(t.remaining)}</span></div>` : ""}
<div class="foot">با تشکر از خرید شما</div>
</body></html>`;
}

// ─── متن ساده برای اشتراک‌گذاری ───────────────────────────────────────────

export function buildShareText(inv: Invoice): string {
  const date = formatJalaliDate(inv.createdAt);
  const customer = inv.customer;
  const customerName =
    customer
      ? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
      : "";
  // متن اشتراکی هم باید دقیقاً همان اعداد فاکتور چاپی را نشان بدهد؛ قبلاً فقط
  // «جمع کل» را داشت و مشتری با جمع‌زدن ردیف‌ها به عدد دیگری می‌رسید.
  const t = invoiceTotals(inv);
  const lines = [
    `🧾 فاکتور ${inv.shopName || "فروشگاه"}`,
    `📅 تاریخ: ${date}`,
    customerName ? `👤 مشتری: ${customerName}` : "",
    inv.notes ? `📝 توضیحات: ${inv.notes}` : "",
    `─────────────────`,
    ...inv.items.map(
      (item) =>
        `• ${item.name}  ×${qtyWithUnit(item)}  =  ${formatAmount(lineTotal(item))} ${currencyLabel()}`
    ),
    `─────────────────`,
    t.discount || t.tax ? `جمع اقلام: ${formatAmount(t.subtotal)} ${currencyLabel()}` : "",
    t.discount
      ? `تخفیف${t.discountPercent ? ` (٪${formatNumber(t.discountPercent)})` : ""}: ${formatAmount(t.discount)} ${currencyLabel()}`
      : "",
    t.tax
      ? `مالیات${t.taxPercent ? ` (٪${formatNumber(t.taxPercent)})` : ""}: ${formatAmount(t.tax)} ${currencyLabel()}`
      : "",
    `💰 جمع کل: ${formatAmount(t.total)} ${currencyLabel()}`,
    t.paid ? `پرداخت نقدی: ${formatAmount(t.paid)} ${currencyLabel()}` : "",
    t.checkAmount ? `مبلغ چک: ${formatAmount(t.checkAmount)} ${currencyLabel()}` : "",
    t.remaining > 0 ? `مانده: ${formatAmount(t.remaining)} ${currencyLabel()}` : "",
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
  const [appSettings, setSettings] = settings.useAll();
  const fontSize = appSettings.invoiceFontSize ?? 13;
  const template = appSettings.invoiceTemplate as Partial<InvoiceTemplate> | undefined;
  const paper = normalizePaperSize(appSettings.invoicePaperSize);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [paperMenu, setPaperMenu] = useState(false);

  const handlePrint = async (chosen: PaperSize = paper) => {
    setPaperMenu(false);
    if (chosen !== paper) {
      setSettings({ ...appSettings, invoicePaperSize: chosen });
    }
    const html = buildInvoiceHTML(inv, fontSize, template, chosen);
    const ok = await printHtml(html, `فاکتور ${inv.id.toUpperCase()}`);
    if (!ok) alert(OLD_APP_MESSAGE);
  };

  // ── چاپ حرارتی ۸۰ میلی‌متر ────────────────────────────────────────────────
  const handleThermalPrint = async () => {
    const html = buildThermalInvoiceHTML(inv);
    const ok = await printHtml(html, `فیش ${inv.id.toUpperCase()}`);
    if (!ok) alert(OLD_APP_MESSAGE);
  };

  // ── ارسال فایل PDF فاکتور (دستی — از طریق واتساپ/شبکه‌های اجتماعی) ────────
  // اپ اندروید: فایل نوشته و پنجره اشتراک سیستمی (شامل واتساپ) باز می‌شود.
  // مرورگر وب: در صورت پشتیبانی از اشتراک فایل، مستقیم به‌اشتراک گذاشته می‌شود؛
  // در غیر این صورت فایل دانلود می‌شود تا کاربر خودش در واتساپ/تلگرام ضمیمه کند.
  const handleSharePdf = async () => {
    if (sharingPdf) return;
    setSharingPdf(true);
    try {
      const { buildInvoicePdf } = await import("@/lib/invoice-pdf");
      const pdf = await buildInvoicePdf(inv);
      const filename = `فاکتور-${inv.id.toUpperCase()}.pdf`;

      if (isNativeApp()) {
        const dataUri = pdf.output("datauristring");
        const ok = await saveBase64File(dataUri, filename, "application/pdf");
        if (!ok) alert(OLD_APP_MESSAGE);
        return;
      }

      // مرورگر وب
      const blob = pdf.output("blob") as Blob;
      const file = new File([blob], filename, { type: "application/pdf" });
      const nav = navigator as Navigator & {
        canShare?: (data?: { files?: File[] }) => boolean;
        share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        try {
          await nav.share({ files: [file], title: filename });
          return;
        } catch {
          // کاربر لغو کرد یا خطا — به دانلود ساده برمی‌گردیم
        }
      }
      downloadBlob(blob, filename);
    } catch (e) {
      console.error("[InvoiceActions] share pdf failed", e);
      alert("ساخت یا ارسال فایل PDF ناموفق بود.");
    } finally {
      setSharingPdf(false);
    }
  };

  // ── اشتراک‌گذاری (متنی) ──────────────────────────────────────────────────
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
      ? "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition"
      : "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition";

  const btnSize = size === "sm" ? "h-8 w-8" : "flex-1";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-4 w-4";

  return (
    <>
      <button
        type="button"
        onClick={() => setPaperMenu(true)}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""}`}
        title="پرینت فاکتور"
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
        onClick={handleSharePdf}
        disabled={sharingPdf}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""} disabled:opacity-60`}
        title="ارسال فایل PDF فاکتور (واتساپ و…)"
      >
        <FileDown className={iconSize} />
        {showLabels && <span>{sharingPdf ? "در حال آماده‌سازی…" : "ارسال PDF"}</span>}
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

      <button
        type="button"
        onClick={() => setMessaging(true)}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-primary/10 text-primary hover:bg-primary/20" : ""}`}
        title="ارسال متن فاکتور با واتساپ/پیامک (قابل ویرایش)"
      >
        <MessageSquare className={iconSize} />
        {showLabels && <span>پیام به مشتری</span>}
      </button>

      {paperMenu &&
        createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setPaperMenu(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xl"
          >
            <div className="text-sm font-bold">اندازه کاغذ چاپ</div>
            <p className="text-[11px] leading-5 text-muted-foreground">
              متن فاکتور روی کاغذ انتخابی در یک صفحه جا می‌گیرد و به صفحه دوم نمی‌رود.
            </p>
            <div className="grid gap-1.5">
              {PAPER_SIZES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void handlePrint(p.id)}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    paper === p.id
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background hover:bg-accent"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPaperMenu(false)}
              className="w-full rounded-xl border border-border py-2 text-sm"
            >
              انصراف
            </button>
          </div>
        </div>,
        document.body,
      )}

      {messaging && (
        <InvoiceMessageDialog
          defaultText={buildShareText(inv)}
          defaultPhone={inv.customer?.phone ?? ""}
          onClose={() => setMessaging(false)}
        />
      )}
    </>
  );
}
