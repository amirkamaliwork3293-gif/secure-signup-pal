/**
 * PurchaseActions.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * همتای InvoiceActions برای فاکتورهای خرید — پرینت (A4/حرارتی)، PDF، اشتراک متنی.
 * همه‌ی اطلاعات واردشده (تامین‌کننده، تلفن، یادداشت، روش پرداخت، لوگو) روی
 * خروجی چاپی/PDF نمایش داده می‌شود.
 */

import { useState } from "react";
import { Printer, Share2, Receipt, FileDown } from "lucide-react";
import type { Purchase } from "@/lib/store";
import { formatJalaliDate, formatJalaliDateTime, PAYMENT_LABEL, formatAmount, currencyLabel } from "@/lib/store";
import { printHtml, OLD_APP_MESSAGE, isNativeApp, saveBase64File, downloadBlob } from "@/lib/print";
import { purchaseLineTotal } from "@/lib/invoice-math";

// ─── HTML فاکتور خرید (A4) ──────────────────────────────────────────────────

export function buildPurchaseHTML(p: Purchase, fontSize: number = 13): string {
  const date = formatJalaliDateTime(p.createdAt);
  const shopName = p.shopName || "فروشگاه";

  const rows = p.items
    .map(
      (item, i) => `<tr>
        <td>${(i + 1).toLocaleString("fa-IR")}</td>
        <td>${item.name}</td>
        <td>${item.quantity.toLocaleString("fa-IR")}${item.unit && item.unit !== "عدد" ? ` ${item.unit}` : ""}</td>
        <td>${formatAmount(item.buyPrice)}</td>
        <td>${formatAmount(purchaseLineTotal(item))}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>فاکتور خرید ${p.id.toUpperCase()}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Vazirmatn',Tahoma,sans-serif;font-size:${fontSize}px;color:#111;padding:24px 32px;direction:rtl}
  .header{text-align:center;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:16px}
  .header h1{font-size:${Math.round(fontSize * 1.54)}px;font-weight:700}
  .header p{font-size:${Math.round(fontSize * 0.85)}px;color:#555;margin-top:4px}
  .logo{display:block;margin:0 auto 8px;max-width:120px;max-height:120px;object-fit:contain}
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
  ${p.shopLogoUrl ? `<img class="logo" src="${p.shopLogoUrl}" alt="لوگو" />` : ""}
  <h1>${shopName}</h1>
  <p>سیستم حسابداری کمالی | فاکتور خرید</p>
</div>
<div class="meta">
  <div><span>شماره: </span><strong>${p.id.toUpperCase()}</strong></div>
  <div><span>تاریخ: </span><strong>${date}</strong></div>
  <div><span>تامین‌کننده: </span><strong>${p.supplierName || "—"}</strong></div>
  <div><span>تلفن: </span><strong>${p.supplierPhone || "—"}</strong></div>
  ${p.paymentMethod ? `<div><span>روش پرداخت: </span><strong>${PAYMENT_LABEL[p.paymentMethod]}</strong></div>` : ""}
</div>
${p.note ? `<div style="margin-bottom:16px;padding:8px 12px;border-radius:8px;background:#f7f7f7;border:1px solid #e2e2e2;font-size:${Math.round(fontSize * 0.9)}px;"><strong>یادداشت: </strong>${p.note}</div>` : ""}
<table>
  <thead><tr><th>#</th><th>نام کالا</th><th>تعداد</th><th>قیمت خرید</th><th>جمع</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr class="total-row">
      <td colspan="4">جمع کل</td>
      <td>${formatAmount(p.total)} ${currencyLabel()}</td>
    </tr>
    ${p.paidAmount != null ? `<tr><td colspan="4">پرداخت‌شده</td><td>${formatAmount(p.paidAmount)} ${currencyLabel()}</td></tr>` : ""}
    ${p.paymentMethod === "credit" && p.paidAmount != null ? `<tr><td colspan="4">مانده بدهی به تامین‌کننده</td><td>${formatAmount(Math.max(0, p.total - (p.paidAmount || 0)))} ${currencyLabel()}</td></tr>` : ""}
  </tfoot>
</table>
<div class="footer">فاکتور خرید — ${shopName}</div>
</body>
</html>`;
}

// ─── HTML فیش حرارتی خرید ────────────────────────────────────────────────

export function buildThermalPurchaseHTML(p: Purchase): string {
  const date = formatJalaliDateTime(p.createdAt);
  const shopName = p.shopName || "فروشگاه";
  const fmt = formatAmount;
  const rows = p.items
    .map(
      (it) => `
      <div class="row">
        <div class="name">${it.name}</div>
        <div class="line"><span>${it.quantity.toLocaleString("fa-IR")} × ${fmt(it.buyPrice)}</span><span>${fmt(it.buyPrice * it.quantity)}</span></div>
      </div>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="utf-8"/>
<title>فاکتور خرید ${p.id.toUpperCase()}</title>
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
${p.shopLogoUrl ? `<img class="logo" src="${p.shopLogoUrl}" alt="لوگو" />` : ""}
<div class="center shop">${shopName}</div>
<div class="center muted">فاکتور خرید</div>
<div class="sep"></div>
<div class="meta">
  <div><span>شماره:</span><span>${p.id.toUpperCase()}</span></div>
  <div><span>تاریخ:</span><span>${date}</span></div>
  ${p.supplierName ? `<div><span>تامین‌کننده:</span><span>${p.supplierName}</span></div>` : ""}
  ${p.supplierPhone ? `<div><span>تلفن:</span><span>${p.supplierPhone}</span></div>` : ""}
  ${p.paymentMethod ? `<div><span>پرداخت:</span><span>${PAYMENT_LABEL[p.paymentMethod]}</span></div>` : ""}
</div>
${p.note ? `<div class="sep"></div><div class="muted">یادداشت: ${p.note}</div>` : ""}
<div class="sep"></div>
${rows}
<div class="sep"></div>
<div class="total"><span>جمع کل</span><span>${fmt(p.total)} ${currencyLabel()}</span></div>
${p.paidAmount != null ? `<div class="line"><span>پرداخت‌شده</span><span>${fmt(p.paidAmount)}</span></div>` : ""}
${p.paymentMethod === "credit" && p.paidAmount != null ? `<div class="line"><span>مانده بدهی</span><span>${fmt(Math.max(0, p.total - (p.paidAmount || 0)))}</span></div>` : ""}
<div class="foot">فاکتور خرید</div>
</body></html>`;
}

// ─── متن اشتراک‌گذاری ────────────────────────────────────────────────────

function buildPurchaseShareText(p: Purchase): string {
  const date = formatJalaliDate(p.createdAt);
  const lines = [
    `🧾 فاکتور خرید ${p.shopName || "فروشگاه"}`,
    `📅 تاریخ: ${date}`,
    p.supplierName ? `🚚 تامین‌کننده: ${p.supplierName}` : "",
    p.note ? `📝 یادداشت: ${p.note}` : "",
    `─────────────────`,
    ...p.items.map(
      (item) => `• ${item.name}  ×${item.quantity}  =  ${formatAmount(purchaseLineTotal(item))} ${currencyLabel()}`,
    ),
    `─────────────────`,
    `💰 جمع کل: ${formatAmount(p.total)} ${currencyLabel()}`,
  ].filter(Boolean);
  return lines.join("\n");
}

// ─── کامپوننت ────────────────────────────────────────────────────────────────

type Props = {
  p: Purchase;
  size?: "sm" | "md";
  showLabels?: boolean;
  /** اندازه‌ی فونت پرینت — پیش‌فرض ۱۳ */
  fontSize?: number;
};

export function PurchaseActions({ p, size = "md", showLabels = false, fontSize = 13 }: Props) {
  const [sharingPdf, setSharingPdf] = useState(false);

  const handlePrint = async () => {
    const html = buildPurchaseHTML(p, fontSize);
    const ok = await printHtml(html, `فاکتور خرید ${p.id.toUpperCase()}`);
    if (!ok) alert(OLD_APP_MESSAGE);
  };

  const handleThermalPrint = async () => {
    const html = buildThermalPurchaseHTML(p);
    const ok = await printHtml(html, `فاکتور خرید ${p.id.toUpperCase()}`);
    if (!ok) alert(OLD_APP_MESSAGE);
  };

  const handleSharePdf = async () => {
    if (sharingPdf) return;
    setSharingPdf(true);
    try {
      const { buildPurchasePdf } = await import("@/lib/purchase-pdf");
      const pdf = await buildPurchasePdf(p);
      const filename = `فاکتور-خرید-${p.id.toUpperCase()}.pdf`;

      if (isNativeApp()) {
        const dataUri = pdf.output("datauristring");
        const ok = await saveBase64File(dataUri, filename, "application/pdf");
        if (!ok) alert(OLD_APP_MESSAGE);
        return;
      }

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
          // کاربر لغو کرد — به دانلود ساده برمی‌گردیم
        }
      }
      downloadBlob(blob, filename);
    } catch (e) {
      console.error("[PurchaseActions] share pdf failed", e);
      alert("ساخت یا ارسال فایل PDF ناموفق بود.");
    } finally {
      setSharingPdf(false);
    }
  };

  const handleShare = async () => {
    const text = buildPurchaseShareText(p);
    if (navigator.share) {
      try {
        await navigator.share({ title: `فاکتور خرید ${p.shopName || "فروشگاه"}`, text });
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
  const iconSize = "h-4 w-4";

  return (
    <>
      <button
        type="button"
        onClick={handlePrint}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""}`}
        title="پرینت فاکتور خرید (A4)"
      >
        <Printer className={iconSize} />
        {showLabels && <span>پرینت</span>}
      </button>
      <button
        type="button"
        onClick={handleThermalPrint}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""}`}
        title="چاپ حرارتی ۸۰ میلی‌متر"
      >
        <Receipt className={iconSize} />
        {showLabels && <span>چاپ حرارتی</span>}
      </button>
      <button
        type="button"
        onClick={handleSharePdf}
        disabled={sharingPdf}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""} disabled:opacity-60`}
        title="ارسال فایل PDF فاکتور خرید"
      >
        <FileDown className={iconSize} />
        {showLabels && <span>{sharingPdf ? "در حال آماده‌سازی…" : "ارسال PDF"}</span>}
      </button>
      <button
        type="button"
        onClick={handleShare}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-primary/10 text-primary hover:bg-primary/20" : ""}`}
        title="ارسال فاکتور خرید"
      >
        <Share2 className={iconSize} />
        {showLabels && <span>ارسال</span>}
      </button>
    </>
  );
}
