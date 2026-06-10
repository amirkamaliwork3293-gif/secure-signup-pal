/**
 * InvoiceActions.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * سه‌گانه عملیات فاکتور: پرینت، دانلود PDF، اشتراک‌گذاری
 */

import { useRef } from "react";
import { Printer, Download, Share2 } from "lucide-react";
import type { Invoice } from "@/lib/store";
import { settings } from "@/lib/store";

// ─── HTML فاکتور ────────────────────────────────────────────────────────────

export function buildInvoiceHTML(inv: Invoice, fontSize: number = 13): string {
  const date = new Date(inv.createdAt).toLocaleDateString("fa-IR");
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
</div>
<table>
  <thead><tr><th>#</th><th>نام کالا</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr class="total-row">
      <td colspan="4">جمع کل</td>
      <td>${new Intl.NumberFormat("fa-IR").format(inv.total)} تومان</td>
    </tr>
  </tfoot>
</table>
<div class="footer">با تشکر از خرید شما — ${shopName}</div>
</body>
</html>`;
}

// ─── متن ساده برای اشتراک‌گذاری ───────────────────────────────────────────

function buildShareText(inv: Invoice): string {
  const date = new Date(inv.createdAt).toLocaleDateString("fa-IR");
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [appSettings] = settings.useAll();
  const fontSize = appSettings.invoiceFontSize ?? 13;

  // ── پرینت با iframe (نه window.open) ──────────────────────────────────────
  const handlePrint = () => {
    const html = buildInvoiceHTML(inv, fontSize);
    const iframe = iframeRef.current;
    if (!iframe) return;

    iframe.srcdoc = html;
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    };
  };

  // ── دانلود HTML ───────────────────────────────────────────────────────────
  const handleDownload = () => {
    const html = buildInvoiceHTML(inv, fontSize);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `فاکتور-${inv.id.toUpperCase()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
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
      {/* iframe مخفی برای پرینت */}
      <iframe
        ref={iframeRef}
        title="invoice-print"
        style={{
          position: "fixed",
          top: "-9999px",
          left: "-9999px",
          width: "1px",
          height: "1px",
          border: "none",
          opacity: 0,
          pointerEvents: "none",
        }}
      />

      <button
        type="button"
        onClick={handlePrint}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""}`}
        title="پرینت فاکتور"
      >
        <Printer className={iconSize} />
        {showLabels && <span>پرینت</span>}
      </button>

      <button
        type="button"
        onClick={handleDownload}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""}`}
        title="دانلود فاکتور"
      >
        <Download className={iconSize} />
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
