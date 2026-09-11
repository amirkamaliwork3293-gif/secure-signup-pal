/**
 * invoice-document.ts — سند فاکتور فروش (نمایش روی صفحه + چاپ)
 *
 * دو حالت جدا:
 *   screen  پیش‌نمایش داخل برنامه — خوانا و بزرگ، بدون مقیاس چاپ
 *   print   برگه A4/A5/Letter — اندازه واقعی کاغذ، صفحه‌بندی طبیعی
 *
 * قبلاً یک اسکریپت «جا دادن در یک صفحه» فاکتور را تا ۴۲٪ کوچک می‌کرد و همان
 * HTML در iframe پیش‌نمایش هم اجرا می‌شد؛ به همین دلیل فاکتور روی صفحه ریز
 * دیده می‌شد. آن مقیاس حذف شده. داده و محاسبات فاکتور دست‌نخورده می‌مانند.
 */
import {
  formatAmount,
  formatNumber,
  currencyLabel,
  formatJalaliDate,
  formatJalaliDateTime,
  PAYMENT_LABEL,
  COUNT_UNIT,
  formatChequeDue,
  invoiceDocumentTitle,
  type Invoice,
} from "@/lib/store";
import { invoiceTotals, lineTotal, invoiceCheques, chequeLineLabel } from "@/lib/invoice-math";
import { type PaperSize } from "@/lib/print";
import { escapeHtml } from "@/lib/html-escape";

export type InvoiceHtmlMode = "screen" | "print";

export const DEFAULT_INVOICE_ACCENT = "#0e2a47";
export const DEFAULT_INVOICE_GOLD = "#c9a227";

const esc = escapeHtml;

export type AmountLine = {
  label: string;
  value: string;
  kind: "normal" | "grand" | "due";
};

/** سطرهای جمع‌بندی — منبع واحد برای HTML پیش‌فرض، قالب سفارشی و PDF */
export function invoiceAmountLines(inv: Invoice): AmountLine[] {
  const t = invoiceTotals(inv);
  const cur = currencyLabel();
  const lines: AmountLine[] = [];
  if (t.discount || t.tax) {
    lines.push({
      label: "جمع اقلام",
      value: `${formatAmount(t.subtotal)} ${cur}`,
      kind: "normal",
    });
  }
  if (t.discount) {
    lines.push({
      label: `تخفیف${t.discountPercent ? ` (${formatNumber(t.discountPercent)}٪)` : ""}`,
      value: `${formatAmount(t.discount)} ${cur}`,
      kind: "normal",
    });
  }
  if (t.tax) {
    lines.push({
      label: `مالیات${t.taxPercent ? ` (${formatNumber(t.taxPercent)}٪)` : ""}`,
      value: `${formatAmount(t.tax)} ${cur}`,
      kind: "normal",
    });
  }
  lines.push({
    label: "جمع کل",
    value: `${formatAmount(t.total)} ${cur}`,
    kind: "grand",
  });
  if (t.paid) {
    lines.push({
      label: "پرداخت نقدی",
      value: `${formatAmount(t.paid)} ${cur}`,
      kind: "normal",
    });
  }
  const cheques = invoiceCheques(inv);
  if (cheques.length) {
    for (let i = 0; i < cheques.length; i++) {
      const c = cheques[i];
      lines.push({
        label: chequeLineLabel(c, i, formatChequeDue),
        value: `${formatAmount(c.amount)} ${cur}`,
        kind: "normal",
      });
    }
  } else if (t.checkAmount) {
    lines.push({
      label: `مبلغ چک${inv.checkNumber ? ` (${inv.checkNumber})` : ""}`,
      value: `${formatAmount(t.checkAmount)} ${cur}`,
      kind: "normal",
    });
  }
  if (t.remaining > 0) {
    lines.push({
      label: `مانده${inv.paymentMethod === "credit" ? " نسیه" : ""}`,
      value: `${formatAmount(t.remaining)} ${cur}`,
      kind: "due",
    });
  }
  return lines;
}

/** واحد نمایشی هر ردیف — همان واحدی که کاربر برای محصول ساخته است */
function itemUnitOf(unit?: string): string {
  return (unit && unit.trim()) || COUNT_UNIT;
}

/** واحد کنار تعداد — فقط وقتی واحد غیر از «عدد» باشد */
export function qtyWithUnit(item: Invoice["items"][number]): string {
  const unit = itemUnitOf(item.unit);
  const q = item.quantity.toLocaleString("fa-IR");
  return unit && unit !== COUNT_UNIT ? `${q} ${unit}` : q;
}

export function customerDisplayName(inv: Invoice): string {
  const c = inv.customer;
  if (!c) return "";
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
}

/** فونت نمایش روی صفحه همیشه خوانا است؛ چاپ از تنظیم کاربر پیروی می‌کند */
export function invoiceBaseFontSize(fontSize: number, mode: InvoiceHtmlMode): number {
  const n = Number(fontSize) || 13;
  if (mode === "screen") return Math.min(20, Math.max(16, n + 3));
  return Math.max(12, Math.min(18, n));
}

/** CSS اندازه کاغذ + صفحه‌بندی چاپ — بدون کوچک‌کردن کل سند */
export function invoicePageAssets(
  paper: PaperSize,
  mode: InvoiceHtmlMode,
  marginMm = 10,
): { css: string; script: string } {
  const cssSize = paper === "Letter" ? "letter" : paper;
  const css = `
  @page { size: ${cssSize} portrait; margin: ${marginMm}mm; }
  html, body { margin: 0 !important; }
  #print-root { width: 100%; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr, .party, .sign-box, .totals-card, .note-box { break-inside: avoid; page-break-inside: avoid; }
  @media print {
    html, body { background: #fff !important; padding: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #print-root, .sheet { box-shadow: none !important; }
    .screen-only { display: none !important; }
  }
  ${
    mode === "screen"
      ? `html, body { background: #d7e0ea; }
         body { padding: 16px 10px 28px; }
         #print-root { max-width: 920px; margin: 0 auto; }
         .sheet { box-shadow: 0 18px 48px rgba(14,42,71,.16), 0 1px 0 ${DEFAULT_INVOICE_GOLD}; }`
      : `html, body { background: #fff; }
         body { padding: 0; }`
  }
  `;
  return { css, script: "" };
}

export function invoiceChromeCss(opts: {
  fontSize: number;
  accent: string;
  gold?: string;
  compact?: boolean;
}): string {
  const fs = opts.fontSize;
  const ink = opts.accent;
  const gold = opts.gold || DEFAULT_INVOICE_GOLD;
  const pad = opts.compact ? 8 : 14;
  return `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Vazirmatn,Tahoma,'Noto Naskh Arabic','Segoe UI',sans-serif;font-size:${fs}px;color:#1a2332;direction:rtl;line-height:1.55}
  .sheet{border:1.5px solid ${ink};background:#fff;overflow:hidden}
  .frame{margin:${opts.compact ? 5 : 7}px;border:1px solid ${gold}99;background:#fff}
  .gold-rule{height:3px;background:linear-gradient(90deg, ${gold}55, ${gold}, ${gold}55)}
  .masthead{display:flex;align-items:stretch;gap:12px;padding:${pad}px ${pad + 4}px;background:linear-gradient(118deg, ${ink} 0%, #163552 52%, ${ink} 100%);color:#fff}
  .masthead .brand{display:flex;align-items:center;gap:12px;flex:1;min-width:0}
  .masthead .logo{width:${opts.compact ? 52 : 68}px;height:${opts.compact ? 52 : 68}px;object-fit:contain;border-radius:12px;background:#fff;padding:4px;flex-shrink:0;box-shadow:0 0 0 1px ${gold}88}
  .masthead .who{min-width:0;flex:1}
  .masthead h1{font-size:${Math.round(fs * 1.55)}px;font-weight:800;letter-spacing:-.02em;line-height:1.25;word-break:break-word}
  .masthead .sub{font-size:${Math.round(fs * 0.84)}px;opacity:.9;margin-top:4px;word-break:break-word;line-height:1.45}
  .doc-mark{flex-shrink:0;text-align:center;background:rgba(255,255,255,.1);border:1px solid ${gold}cc;border-radius:12px;padding:10px 14px;min-width:${opts.compact ? 108 : 128}px;backdrop-filter:blur(4px)}
  .doc-mark .k{font-size:${Math.round(fs * 0.78)}px;color:${gold};font-weight:700;letter-spacing:.04em}
  .doc-mark .v{font-size:${Math.round(fs * 1.12)}px;font-weight:800;margin-top:3px;letter-spacing:.02em}
  .doc-mark .d{font-size:${Math.round(fs * 0.78)}px;opacity:.88;margin-top:4px}
  .parties{display:grid;grid-template-columns:1fr 1fr}
  .party{border-bottom:1px solid #d5dee8;border-left:1px solid #d5dee8;min-width:0}
  .party:last-child{border-left:0}
  .party h2{font-size:${Math.round(fs * 0.78)}px;font-weight:700;color:#fff;background:${ink};padding:5px 12px;letter-spacing:.06em}
  .party .body{padding:8px 12px 10px;display:grid;gap:4px}
  .kv{display:flex;gap:8px;align-items:baseline;min-width:0}
  .kv .lbl{color:#667788;font-size:${Math.round(fs * 0.78)}px;flex:0 0 auto}
  .kv .val{font-weight:700;font-size:${Math.round(fs * 0.95)}px;word-break:break-word;min-width:0}
  table.items{width:100%;border-collapse:collapse;table-layout:fixed}
  table.items thead th{background:${ink};color:#fff;font-weight:700;padding:${opts.compact ? "7px 6px" : "9px 8px"};font-size:${Math.round(fs * 0.82)}px;text-align:center;border-bottom:2px solid ${gold}}
  table.items tbody td{padding:${opts.compact ? "6px 6px" : "8px 8px"};border-bottom:1px solid #e4ebf2;font-size:${Math.round(fs * 0.92)}px;text-align:center;word-break:break-word;overflow-wrap:anywhere;vertical-align:middle}
  table.items tbody tr:nth-child(even) td{background:#f4f7fb}
  table.items td.idx{width:8%;color:#6b7c8f;font-variant-numeric:tabular-nums}
  table.items td.name{text-align:right;width:38%;font-weight:700}
  table.items td.qty{width:14%;white-space:nowrap}
  table.items td.price, table.items td.sum{width:20%;font-variant-numeric:tabular-nums}
  table.items td.sum{font-weight:800;color:${ink}}
  .off{color:#0f7b4a;font-size:.82em;font-weight:700}
  s{color:#9aa8b5;margin-left:4px}
  .closing{display:flex;gap:14px;align-items:stretch;padding:${pad}px;flex-wrap:wrap;background:linear-gradient(180deg,#fbfcfe, #fff)}
  .closing-main{flex:1;min-width:180px;display:flex;flex-direction:column;gap:10px}
  .note-box{padding:8px 10px;background:#fff8e6;border:1px solid #ead9a0;border-radius:8px;font-size:${Math.round(fs * 0.88)}px;color:#5c4a12;word-break:break-word}
  .signs{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .sign-box{border:1px dashed #b7c4d2;border-radius:10px;padding:8px 10px 36px;font-size:${Math.round(fs * 0.8)}px;color:#5d6b7a;background:#fff}
  .sign-box strong{display:block;color:${ink};font-size:${Math.round(fs * 0.82)}px;margin-bottom:4px}
  .totals-card{margin-right:auto;min-width:min(100%,260px);border:1.5px solid ${ink};border-radius:12px;overflow:hidden;background:#fff}
  .totals-card .row{display:flex;justify-content:space-between;gap:14px;padding:7px 12px;font-size:${Math.round(fs * 0.92)}px;border-bottom:1px solid #e8eef4}
  .totals-card .row:last-child{border-bottom:0}
  .totals-card .row.grand{background:${ink};color:#fff;font-weight:800;font-size:${Math.round(fs * 1.02)}px}
  .totals-card .row.due{color:#9b1c1c;font-weight:800;background:#fff1f0}
  .colophon{text-align:center;font-size:${Math.round(fs * 0.78)}px;color:#7a8794;padding:8px 12px 10px;letter-spacing:.02em}
  .pay-chip{display:inline-block;background:${ink}12;color:${ink};border:1px solid ${ink}33;border-radius:999px;padding:2px 10px;font-size:${Math.round(fs * 0.78)}px;font-weight:700}
  /* قالب سفارشی — همان زبان بصری */
  .block{border-top:1px solid ${ink}33}
  .block h2{font-size:${Math.round(fs * 0.8)}px;font-weight:700;color:#fff;background:${ink};padding:5px 12px;letter-spacing:.04em}
  .grid{display:grid}
  .grid.cols-1{grid-template-columns:minmax(0,1fr)}
  .grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .cell{display:flex;align-items:stretch;border-left:1px solid #d7dee7;border-bottom:1px solid #d7dee7;min-height:${Math.round(fs * 2.1)}px;min-width:0}
  .cell .lbl{background:#f3f6fa;color:#556677;font-size:${Math.round(fs * 0.78)}px;padding:6px 8px;flex:0 1 auto;max-width:46%;min-width:0;display:flex;align-items:center;border-left:1px solid #e6e6e6;font-weight:600;word-break:break-word;line-height:1.35}
  .cell .val{padding:6px 8px;font-weight:700;font-size:${Math.round(fs * 0.92)}px;display:flex;align-items:center;flex:1;min-width:0;word-break:break-word;overflow-wrap:anywhere;line-height:1.4}
  table.tpl{width:100%;border-collapse:collapse;table-layout:fixed}
  table.tpl thead th{background:${ink};color:#fff;font-weight:700;padding:8px 6px;font-size:${Math.round(fs * 0.82)}px;border:1px solid ${ink};word-break:break-word;border-bottom:2px solid ${gold}}
  table.tpl tbody td{padding:7px 6px;border:1px solid #d5dce5;font-size:${Math.round(fs * 0.9)}px;text-align:center;word-break:break-word;overflow-wrap:anywhere}
  table.tpl tbody td.c-name{text-align:right;font-weight:700}
  table.tpl tbody td.c-index, table.tpl tbody td.c-qty, table.tpl tbody td.c-unit{white-space:nowrap}
  table.tpl tbody tr:nth-child(even) td{background:#f6f9fc}
  .tpl-totals{display:flex;justify-content:flex-start;padding:12px;gap:10px;flex-wrap:wrap;background:linear-gradient(180deg,#fbfcfe,#fff)}
  .tpl-totals table{width:auto;min-width:min(100%,260px);max-width:100%;margin-right:auto;table-layout:auto;border-collapse:collapse;border:1.5px solid ${ink};border-radius:10px;overflow:hidden}
  .tpl-totals td{border:1px solid #dce4ec;padding:7px 12px;font-size:${Math.round(fs * 0.9)}px;word-break:break-word}
  .tpl-totals td:first-child{background:#f3f6fa;color:#445566;font-weight:600}
  .tpl-totals tr.grand td{font-weight:800;background:${ink};color:#fff;border-color:${ink}}
  .tpl-totals tr.due td{color:#9b1c1c;font-weight:800;background:#fff1f0}
  .tpl-note{padding:8px 12px;border-top:1px dashed #ccc;font-size:${Math.round(fs * 0.86)}px;color:#444;word-break:break-word}
  .tpl-signs{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid ${ink}33}
  .tpl-signs div{padding:10px 12px 40px;font-size:${Math.round(fs * 0.84)}px;color:#556;word-break:break-word}
  .tpl-signs div:first-child{border-left:1px solid #dcdcdc}
  @media (max-width: 640px) {
    .parties{grid-template-columns:1fr}
    .party:last-child{border-left:1px solid #d5dee8}
    .masthead{flex-wrap:wrap}
    .doc-mark{width:100%}
  }
  `;
}

export function wrapInvoiceHtml(opts: {
  title: string;
  inner: string;
  paper: PaperSize;
  mode: InvoiceHtmlMode;
  fontSize: number;
  accent: string;
  compact?: boolean;
}): string {
  const page = invoicePageAssets(opts.paper, opts.mode);
  const chrome = invoiceChromeCss({
    fontSize: opts.fontSize,
    accent: opts.accent,
    compact: opts.compact,
  });
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(opts.title)}</title>
<style>
${page.css}
${chrome}
</style>
</head>
<body>
<div id="print-root">${opts.inner}</div>
</body>
</html>`;
}

function shopMetaLine(inv: Invoice): string {
  return [inv.shopAddress, inv.shopPhone ? `تلفن: ${inv.shopPhone}` : ""]
    .filter(Boolean)
    .join("  ·  ");
}

export function buildDefaultInvoiceHTML(
  inv: Invoice,
  fontSize: number = 13,
  paper: PaperSize = "A4",
  mode: InvoiceHtmlMode = "print",
): string {
  const fs = invoiceBaseFontSize(fontSize, mode);
  const compact = paper === "A5" && mode === "print";
  const shopName = inv.shopName || "فروشگاه";
  const docTitle = invoiceDocumentTitle(inv);
  const date = formatJalaliDateTime(inv.createdAt);
  const name = customerDisplayName(inv) || "—";
  const phone = inv.customer?.phone || "—";
  const payment = inv.paymentMethod ? PAYMENT_LABEL[inv.paymentMethod] : "—";
  const meta = shopMetaLine(inv);
  const amountLines = invoiceAmountLines(inv);

  const rows = inv.items
    .map(
      (item, i) => `<tr>
        <td class="idx">${(i + 1).toLocaleString("fa-IR")}</td>
        <td class="name">${esc(item.name)}${
          item.discountPercent
            ? ` <span class="off">٪${item.discountPercent.toLocaleString("fa-IR")} تخفیف</span>`
            : ""
        }</td>
        <td class="qty">${esc(qtyWithUnit(item))}</td>
        <td class="price">${
          item.originalPrice ? `<s>${formatAmount(item.originalPrice)}</s> ` : ""
        }${formatAmount(item.price)}</td>
        <td class="sum">${formatAmount(lineTotal(item))}</td>
      </tr>`,
    )
    .join("");

  const totals = amountLines
    .map(
      (l) =>
        `<div class="row ${l.kind}"><span>${esc(l.label)}</span><span>${esc(l.value)}</span></div>`,
    )
    .join("");

  const inner = `<div class="sheet"><div class="frame">
  <div class="gold-rule"></div>
  <header class="masthead">
    <div class="brand">
      ${inv.shopLogoUrl ? `<img class="logo" src="${esc(inv.shopLogoUrl)}" alt="لوگو"/>` : ""}
      <div class="who">
        <h1>${esc(shopName)}</h1>
        <div class="sub">${esc(meta || `${docTitle} کالا و خدمات`)}</div>
      </div>
    </div>
    <div class="doc-mark">
      <div class="k">${esc(docTitle)}</div>
      <div class="v">${esc(inv.id.toUpperCase())}</div>
      <div class="d">${esc(date)}</div>
    </div>
  </header>
  <div class="gold-rule"></div>
  <div class="parties">
    <section class="party">
      <h2>مشخصات فروشنده</h2>
      <div class="body">
        <div class="kv"><span class="lbl">نام</span><span class="val">${esc(shopName)}</span></div>
        <div class="kv"><span class="lbl">تلفن</span><span class="val">${esc(inv.shopPhone || "—")}</span></div>
        <div class="kv"><span class="lbl">نشانی</span><span class="val">${esc(inv.shopAddress || "—")}</span></div>
      </div>
    </section>
    <section class="party">
      <h2>مشخصات خریدار</h2>
      <div class="body">
        <div class="kv"><span class="lbl">نام</span><span class="val">${esc(name)}</span></div>
        <div class="kv"><span class="lbl">تلفن</span><span class="val">${esc(phone)}</span></div>
        <div class="kv"><span class="lbl">پرداخت</span><span class="val"><span class="pay-chip">${esc(payment)}</span></span></div>
      </div>
    </section>
  </div>
  <table class="items">
    <thead><tr><th>#</th><th>شرح کالا / خدمات</th><th>تعداد</th><th>مبلغ واحد</th><th>مبلغ کل</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5">—</td></tr>`}</tbody>
  </table>
  <div class="closing">
    <div class="closing-main">
      ${inv.notes ? `<div class="note-box"><strong>توضیحات: </strong>${esc(inv.notes)}</div>` : ""}
      <div class="signs">
        <div class="sign-box"><strong>مهر و امضای فروشنده</strong></div>
        <div class="sign-box"><strong>امضای خریدار</strong></div>
      </div>
    </div>
    <div class="totals-card">${totals}</div>
  </div>
  <div class="colophon">با سپاس از اعتماد شما — ${esc(shopName)}</div>
</div></div>`;

  return wrapInvoiceHtml({
    title: `${docTitle} ${inv.id.toUpperCase()}`,
    inner,
    paper,
    mode,
    fontSize: fs,
    accent: DEFAULT_INVOICE_ACCENT,
    compact,
  });
}

export function buildThermalInvoiceHTML(inv: Invoice): string {
  const date = formatJalaliDateTime(inv.createdAt);
  const customerName = customerDisplayName(inv);
  const shopName = inv.shopName || "فروشگاه";
  const fmt = formatAmount;
  const rows = inv.items
    .map(
      (it) => `
      <div class="row">
        <div class="name">${esc(it.name)}${it.discountPercent ? ` <span style="font-weight:400;color:#333;">(٪${it.discountPercent.toLocaleString("fa-IR")} تخفیف)</span>` : ""}</div>
        <div class="line"><span>${esc(qtyWithUnit(it))} × ${it.originalPrice ? `<s>${fmt(it.originalPrice)}</s> ` : ""}${fmt(it.price)}</span><span>${fmt(lineTotal(it))}</span></div>
      </div>`,
    )
    .join("");
  const amountLines = invoiceAmountLines(inv);
  const grandAt = amountLines.findIndex((l) => l.kind === "grand");
  const beforeGrand = amountLines.slice(0, Math.max(0, grandAt));
  const grand = grandAt >= 0 ? amountLines[grandAt] : undefined;
  const afterGrand = grandAt >= 0 ? amountLines.slice(grandAt + 1) : [];
  const asLines = (list: AmountLine[]) =>
    list
      .map(
        (l) => `<div class="line"><span>${esc(l.label)}</span><span>${esc(l.value)}</span></div>`,
      )
      .join("");
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="utf-8"/>
<title>فیش ${esc(inv.id.toUpperCase())}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Vazirmatn,Tahoma,'Noto Naskh Arabic','Segoe UI',sans-serif;color:#000;direction:rtl;width:80mm;padding:8px 9px;font-size:13px;line-height:1.55}
  .center{text-align:center}
  .shop{font-weight:800;font-size:16px}
  .muted{color:#333;font-size:11px}
  .sep{border-top:1px dashed #000;margin:7px 0}
  .sep-d{border-top:2px solid #000;margin:7px 0}
  .meta{font-size:12px}
  .meta div{display:flex;justify-content:space-between;gap:6px}
  .row{padding:3px 0}
  .name{font-weight:800}
  .line{display:flex;justify-content:space-between;font-size:12px;color:#111}
  .total{display:flex;justify-content:space-between;font-weight:800;font-size:14px;margin-top:4px}
  .foot{font-size:11px;text-align:center;margin-top:8px}
  .logo{display:block;margin:0 auto 5px;max-width:56mm;max-height:28mm;object-fit:contain}
  @media print { body { width: 80mm; } }
</style></head><body>
${inv.shopLogoUrl ? `<img class="logo" src="${esc(inv.shopLogoUrl)}" alt="لوگو" />` : ""}
<div class="center shop">${esc(shopName)}</div>
<div class="center muted">${esc(invoiceDocumentTitle(inv))}</div>
${
  inv.shopAddress || inv.shopPhone
    ? `<div class="center muted">${esc([inv.shopAddress, inv.shopPhone ? `تلفن: ${inv.shopPhone}` : ""].filter(Boolean).join(" — "))}</div>`
    : ""
}
<div class="sep-d"></div>
<div class="meta">
  <div><span>شماره:</span><span>${esc(inv.id.toUpperCase())}</span></div>
  <div><span>تاریخ:</span><span>${esc(date)}</span></div>
  ${customerName ? `<div><span>مشتری:</span><span>${esc(customerName)}</span></div>` : ""}
  ${inv.customer?.phone ? `<div><span>تلفن:</span><span>${esc(inv.customer.phone)}</span></div>` : ""}
  ${inv.paymentMethod ? `<div><span>پرداخت:</span><span>${PAYMENT_LABEL[inv.paymentMethod]}</span></div>` : ""}
</div>
${inv.notes ? `<div class="sep"></div><div class="muted">توضیحات: ${esc(inv.notes)}</div>` : ""}
<div class="sep"></div>
${rows}
<div class="sep-d"></div>
${asLines(beforeGrand)}
${grand ? `<div class="total"><span>${esc(grand.label)}</span><span>${esc(grand.value)}</span></div>` : ""}
${asLines(afterGrand)}
<div class="foot">با تشکر از خرید شما</div>
</body></html>`;
}

export function buildShareText(inv: Invoice): string {
  const date = formatJalaliDate(inv.createdAt);
  const customerName = customerDisplayName(inv);
  const t = invoiceTotals(inv);
  const lines = [
    `🧾 ${invoiceDocumentTitle(inv)} ${inv.shopName || "فروشگاه"}`,
    `📅 تاریخ: ${date}`,
    customerName ? `👤 مشتری: ${customerName}` : "",
    inv.notes ? `📝 توضیحات: ${inv.notes}` : "",
    `─────────────────`,
    ...inv.items.map(
      (item) =>
        `• ${item.name}  ×${qtyWithUnit(item)}  =  ${formatAmount(lineTotal(item))} ${currencyLabel()}`,
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
    ...invoiceCheques(inv).map(
      (c, i) =>
        `${chequeLineLabel(c, i, formatChequeDue)}: ${formatAmount(c.amount)} ${currencyLabel()}`,
    ),
    t.checkAmount && invoiceCheques(inv).length === 0
      ? `مبلغ چک: ${formatAmount(t.checkAmount)} ${currencyLabel()}`
      : "",
    t.remaining > 0 ? `مانده: ${formatAmount(t.remaining)} ${currencyLabel()}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
