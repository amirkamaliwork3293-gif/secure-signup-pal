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
 *
 * ⚠️ این فایل فقط «ظاهر» سند را می‌سازد. هیچ عددی اینجا محاسبه نمی‌شود؛
 * همه‌ی مبالغ از invoiceTotals/lineTotal در ‎@/lib/invoice-math‎ می‌آیند.
 */
import {
  formatAmount,
  formatNumber,
  currencyLabel,
  amountInDisplayUnit,
  formatJalaliDate,
  formatJalaliDateTime,
  PAYMENT_LABEL,
  COUNT_UNIT,
  formatChequeDue,
  invoiceDocumentTitle,
  settings,
  type Invoice,
} from "@/lib/store";
import { invoiceTotals, lineTotal, invoiceCheques, chequeLineLabel } from "@/lib/invoice-math";
import { type PaperSize } from "@/lib/print";
import { escapeHtml } from "@/lib/html-escape";
import {
  normalizeReceiptSettings,
  printFontFaceCss,
  receiptDocument,
  receiptItemsHtml,
  receiptParts,
  type ReceiptSettings,
} from "@/lib/receipt";

export type InvoiceHtmlMode = "screen" | "print";

/**
 * رنگ تأکیدی پیش‌فرض — سرمه‌ای تیره. روی چاپگر سیاه‌وسفید تقریباً سیاه چاپ می‌شود
 * و روی رنگی، رسمی و آرام است. کاربر در «طراح فاکتور» می‌تواند عوضش کند؛ رنگ‌های
 * روشن خودکار تیره می‌شوند تا روی کاغذ کمرنگ نشوند.
 */
export const DEFAULT_INVOICE_ACCENT = "#1f3a5f";

const esc = escapeHtml;

// ─── رنگ — همه با کنتراست کافی برای چاپ سیاه‌وسفید ─────────────────────────

type Rgb = [number, number, number];

const FALLBACK_RGB: Rgb = [31, 58, 95];

function hexToRgb(hex: string): Rgb {
  let h = String(hex || "")
    .trim()
    .replace("#", "");
  if (h.length === 3 || h.length === 4) {
    h = h
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length < 6) return FALLBACK_RGB;
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return FALLBACK_RGB;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: Rgb): string {
  const p = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

function mixColor(hex: string, target: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
}

/** درخشندگی نسبی (WCAG) */
export function relativeLuminance(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * رنگ تأکیدی خوانا روی کاغذ سفید: کنتراست حداقل ۷:۱ با سفید (معادل متن تیره)
 * تا در چاپ سیاه‌وسفید به خاکستری کمرنگ تبدیل نشود. رنگ تیره دست نمی‌خورد.
 */
export function printableAccent(hex: string): string {
  let c = rgbToHex(hexToRgb(hex || DEFAULT_INVOICE_ACCENT));
  for (let i = 0; i < 20 && 1.05 / (relativeLuminance(c) + 0.05) < 7; i++) {
    c = mixColor(c, "#000000", 0.12);
  }
  return c;
}

export type InvoicePalette = {
  accent: string;
  deep: string;
  /** خطوط اصلی (قاب، جدول) */
  gold: string;
  /** برچسب‌ها */
  bronze: string;
  paper: string;
  ink: string;
  muted: string;
  line: string;
  hair: string;
  wash: string;
  tint: string;
  soft: string;
  glow: string;
  danger: string;
  dangerBg: string;
  success: string;
};

/**
 * پالت چاپی. نام کلیدها برای سازگاری با PDF و قالب‌های قبلی حفظ شده‌اند، ولی همه
 * تیره و با کنتراست بالا هستند: متن سیاه، برچسب خاکستری تیره (#333)، خطوط ۴۰٪ و
 * کاغذ سفید (بدون پس‌زمینهٔ عاجی که جوهر مصرف می‌کرد و کنتراست را کم می‌کرد).
 */
export function invoicePalette(accent: string): InvoicePalette {
  const base = printableAccent(accent || DEFAULT_INVOICE_ACCENT);
  return {
    accent: base,
    deep: mixColor(base, "#000000", 0.25),
    gold: "#3d3d3d",
    bronze: "#2b2b2b",
    paper: "#ffffff",
    ink: "#000000",
    muted: "#333333",
    line: "#3d3d3d",
    hair: "#8c8c8c",
    wash: "#ececec",
    tint: mixColor(base, "#ffffff", 0.9),
    soft: mixColor(base, "#ffffff", 0.6),
    glow: "#d9d9d9",
    danger: "#8b0000",
    dangerBg: "#f3e3e3",
    success: "#14532d",
  };
}

// ─── آیکون‌ها ───────────────────────────────────────────────────────────────

const ICON_PATHS: Record<string, string> = {
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  calendar:
    '<rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3 1.8"/>',
  wallet:
    '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v2.5"/><rect x="3" y="7.5" width="18" height="12.5" rx="3"/><path d="M16.5 14h1.6"/>',
  seal: '<circle cx="12" cy="12" r="8.6"/><path d="m8.4 12.4 2.5 2.5 4.7-5.3"/>',
  store:
    '<path d="M4 4.8h16l1.2 4.4A3.1 3.1 0 0 1 18.2 13a3.1 3.1 0 0 1-3.1-2.6A3.1 3.1 0 0 1 12 13a3.1 3.1 0 0 1-3.1-2.6A3.1 3.1 0 0 1 5.8 13a3.1 3.1 0 0 1-3-3.8Z"/><path d="M5 13v6.6h14V13"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
  note: '<path d="M6 3.4h12v17.2H6z"/><path d="M9.2 8.4h5.6M9.2 12h5.6M9.2 15.6h3.4"/>',
  phone:
    '<path d="M6.2 3.6h3l1.5 3.9-2 1.4a12.3 12.3 0 0 0 6.4 6.4l1.4-2 3.9 1.5v3a2 2 0 0 1-2.2 2C10.9 19.2 4.8 13.1 4.2 5.8A2 2 0 0 1 6.2 3.6Z"/>',
  pin: '<path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  box: '<path d="m21 8-9-5-9 5v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  layers: '<path d="m12 3 9 4.8-9 4.8-9-4.8Z"/><path d="m3 12.6 9 4.8 9-4.8"/>',
  tag: '<path d="M12.6 3.4H20v7.4l-8.6 8.6a2 2 0 0 1-2.8 0l-4.6-4.6a2 2 0 0 1 0-2.8Z"/><circle cx="16.3" cy="7.7" r="1.3"/>',
  coins:
    '<circle cx="9" cy="9" r="5.2"/><path d="M14.2 5.4a5.2 5.2 0 0 1 0 10.2"/><path d="M4.4 13.6A5.2 5.2 0 0 0 9.8 19h4.6"/>',
  sum: '<path d="M6 4.5h12l-6.4 7.4L18 19.5H6"/>',
  pen: '<path d="M14.6 4.6 19 9l-9.3 9.3-4.9.9.9-4.9Z"/><path d="M13 6.2 17.4 10.6"/>',
  doc: '<path d="M6 3.2h7.6L18 7.6v13.2H6z"/><path d="M13.4 3.2v4.6H18"/><path d="M9 12.4h6M9 16h4"/>',
};

/** آیکون خطی کوچک — رنگ از currentColor */
export function invoiceIcon(name: keyof typeof ICON_PATHS | string, cls = ""): string {
  const d = ICON_PATHS[name];
  if (!d) return "";
  return `<svg class="ico${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

export type AmountLine = {
  label: string;
  /** متن کامل مبلغ همراه واحد پول — سازگار با مصرف‌کننده‌های قدیمی */
  value: string;
  /** فقط عدد مبلغ (بدون واحد) — برای نمایش درشت مبلغ نهایی */
  amount: string;
  /** واحد پول همان لحظه (تومان/ریال) */
  currency: string;
  kind: "normal" | "grand" | "due";
};

/** سطرهای جمع‌بندی — منبع واحد برای HTML پیش‌فرض، قالب سفارشی، فیش و PDF */
export function invoiceAmountLines(inv: Invoice): AmountLine[] {
  const t = invoiceTotals(inv);
  const cur = currencyLabel();
  const lines: AmountLine[] = [];
  const push = (label: string, amount: number, kind: AmountLine["kind"] = "normal") => {
    const a = formatAmount(amount);
    lines.push({ label, value: `${a} ${cur}`, amount: a, currency: cur, kind });
  };
  if (t.discount || t.tax) {
    push("جمع اقلام", t.subtotal);
  }
  if (t.discount) {
    push(`تخفیف${t.discountPercent ? ` (${formatNumber(t.discountPercent)}٪)` : ""}`, t.discount);
  }
  if (t.tax) {
    push(`مالیات${t.taxPercent ? ` (${formatNumber(t.taxPercent)}٪)` : ""}`, t.tax);
  }
  push("جمع کل", t.total, "grand");
  if (t.paid) {
    push("پرداخت نقدی", t.paid);
  }
  const cheques = invoiceCheques(inv);
  if (cheques.length) {
    for (let i = 0; i < cheques.length; i++) {
      const c = cheques[i];
      push(chequeLineLabel(c, i, formatChequeDue), c.amount);
    }
  } else if (t.checkAmount) {
    push(`مبلغ چک${inv.checkNumber ? ` (${inv.checkNumber})` : ""}`, t.checkAmount);
  }
  if (t.remaining > 0) {
    push(`مانده${inv.paymentMethod === "credit" ? " نسیه" : ""}`, t.remaining, "due");
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
  tr, .party, .sign, .note, .block, .seal, .totals { break-inside: avoid; page-break-inside: avoid; }
  @media print {
    html, body { background: #fff !important; padding: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #print-root, .sheet { box-shadow: none !important; border-radius: 0 !important; }
    .screen-only { display: none !important; }
  }
  ${
    mode === "screen"
      ? `html, body { background: #e9ebef; }
         body { padding: 18px 10px 30px; }
         #print-root { max-width: 920px; margin: 0 auto; }
         .sheet { border-radius: 4px; box-shadow: 0 18px 48px rgba(15,23,42,.16), 0 1px 3px rgba(15,23,42,.08); }`
      : `html, body { background: #fff; }
         body { padding: 0; }`
  }
  `;
  return { css, script: "" };
}

/**
 * ظاهر سند — طراحی رسمی و چاپ‌محور:
 *  - کاغذ سفید، متن سیاه، برچسب‌ها #2b2b2b، هیچ متنی کمرنگ‌تر از #333 نیست
 *  - ساختار با «خط» ساخته می‌شود نه با رنگ زمینه؛ زمینه‌های خاکستری روشن تزئینی‌اند
 *    و اگر چاپگر/مرورگر پس‌زمینه را نیندازد، چیزی گم نمی‌شود
 *  - خطوط جدول ۱px تیره و قاب جمع کل ۲px — روی چاپگر لیزری و جوهرافشان سیاه‌وسفید دیده می‌شوند
 *  - رنگ تأکیدی فقط برای عنوان و قاب جمع کل؛ همیشه تیره (printableAccent)
 */
export function invoiceChromeCss(opts: {
  fontSize: number;
  accent: string;
  compact?: boolean;
}): string {
  const fs = opts.fontSize;
  const p = invoicePalette(opts.accent);
  const c = !!opts.compact;
  const px = (mult: number) => `${Math.max(10, Math.round(fs * mult))}px`;
  const gap = c ? 8 : 14;
  const cell = c ? "4px 6px" : "7px 9px";
  const rule = `1px solid ${p.line}`;

  return `
  ${printFontFaceCss(printOrigin())}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:"Vazirmatn",Tahoma,"Noto Naskh Arabic","Segoe UI",sans-serif;font-size:${fs}px;color:${p.ink};direction:rtl;
    line-height:1.6;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
  .ico{width:.95em;height:.95em;flex:0 0 auto;vertical-align:-.14em}
  .sheet{position:relative;background:#fff}
  .doc{padding:${c ? "4px" : "6px"} ${c ? "2px" : "4px"} 0}

  /* ─── سربرگ ───────────────────────────────────────────────────────────── */
  .hero{display:flex;align-items:stretch;justify-content:space-between;gap:${gap}px;padding-bottom:${c ? 8 : 12}px;
    border-bottom:3px solid ${p.accent}}
  .hero-brand{display:flex;align-items:center;gap:${c ? 10 : 14}px;min-width:0;flex:1 1 55%}
  .mono{width:${c ? 48 : 64}px;height:${c ? 48 : 64}px;flex:0 0 auto;display:grid;place-items:center;overflow:hidden;
    border:1.5px solid ${p.ink};border-radius:8px;background:#fff}
  .mono span{font-size:${px(c ? 1.5 : 1.8)};font-weight:900;line-height:1;color:${p.accent}}
  .mono .logo,.logo{width:100%;height:100%;object-fit:contain;display:block;background:#fff}
  .brand-name{font-size:${px(c ? 1.3 : 1.5)};font-weight:900;line-height:1.3;color:${p.ink};word-break:break-word}
  .brand-sub{margin-top:2px;font-size:${px(0.8)};color:${p.muted};display:flex;flex-wrap:wrap;gap:1px 12px;line-height:1.6}
  .brand-sub span{display:inline-flex;align-items:center;gap:4px;min-width:0}
  .hero-doc{flex:0 0 auto;min-width:${c ? 120 : 170}px;max-width:48%;border:1.5px solid ${p.ink};border-radius:6px;overflow:hidden;align-self:center}
  .doc-title{padding:${c ? "4px 10px" : "6px 14px"};font-size:${px(c ? 1.15 : 1.35)};font-weight:900;line-height:1.3;color:#fff;
    background:${p.accent};text-align:center;word-break:break-word}
  .doc-kicker{display:none}
  .doc-rows{padding:${c ? "4px 8px" : "6px 12px"}}
  .doc-row{display:flex;justify-content:space-between;gap:10px;font-size:${px(0.82)};line-height:1.7}
  .doc-row .k{color:${p.bronze}}
  .doc-row .v{font-weight:700;color:${p.ink};direction:ltr;unicode-bidi:plaintext;text-align:left}
  .doc-id{display:none}
  .ornament{display:none}

  /* ─── مشخصات فاکتور ─────────────────────────────────────────────────── */
  .facts{margin-top:${gap}px;display:grid;grid-template-columns:repeat(auto-fit,minmax(${c ? 90 : 120}px,1fr));border:${rule};border-radius:6px;overflow:hidden}
  .fact{display:flex;flex-direction:column;gap:1px;padding:${c ? "3px 8px" : "5px 10px"};min-width:0;border-inline-start:${rule}}
  .fact:first-child{border-inline-start:0}
  .fact .k{font-size:${px(0.72)};color:${p.bronze}}
  .fact .v{font-size:${px(0.88)};font-weight:700;color:${p.ink};word-break:break-word}
  .fact.due .v{color:${p.danger}}
  .fact.ok .v{color:${p.success}}

  /* ─── فروشنده و خریدار ──────────────────────────────────────────────── */
  .parties{margin-top:${gap}px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${c ? 8 : 12}px}
  .party{min-width:0;border:${rule};border-radius:6px;overflow:hidden}
  .party-k{display:block;padding:${c ? "3px 8px" : "4px 12px"};font-size:${px(0.8)};font-weight:900;color:${p.ink};
    background:${p.wash};border-bottom:${rule}}
  .party-body{padding:${c ? "4px 8px" : "6px 12px"}}
  .party-name{font-size:${px(1.02)};font-weight:900;color:${p.ink};line-height:1.45;word-break:break-word}
  .kv{display:flex;gap:7px;align-items:baseline;min-width:0;margin-top:${c ? 1 : 2}px;font-size:${px(0.84)};line-height:1.6}
  .kv .lbl{color:${p.bronze};flex:0 0 auto}
  .kv .lbl::after{content:":"}
  .kv .val{color:${p.ink};font-weight:700;min-width:0;word-break:break-word;overflow-wrap:anywhere}

  /* ─── جدول اقلام ────────────────────────────────────────────────────── */
  .ledger{margin-top:${gap}px;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
  table.items, table.tpl{width:100%;border-collapse:collapse;table-layout:fixed;border:1.5px solid ${p.ink}}
  table.items thead th, table.tpl thead th{padding:${cell};font-size:${px(0.82)};font-weight:900;color:${p.ink};text-align:center;
    background:${p.wash};border:${rule};border-bottom:1.5px solid ${p.ink};white-space:normal;line-height:1.35}
  table.items tbody td, table.tpl tbody td{padding:${cell};font-size:${px(0.92)};text-align:center;vertical-align:middle;line-height:1.55;
    border:${rule};word-break:break-word;overflow-wrap:anywhere;color:${p.ink}}
  table.items td.idx, table.tpl td.c-index{width:${c ? 7 : 6}%;font-weight:700}
  table.items td.name, table.tpl td.c-name{text-align:right;font-weight:700}
  table.items td.qty, table.tpl td.c-qty, table.tpl td.c-unit{white-space:nowrap}
  table.items td.sum, table.tpl td.c-total{font-weight:900}
  table.items .num, table.items td.price, table.items td.sum, table.tpl td.c-price, table.tpl td.c-total{direction:ltr;unicode-bidi:plaintext}
  .row-tag{display:inline-block;margin-right:6px;font-size:${px(0.74)};font-weight:700;color:${p.ink};border:1px solid ${p.ink};border-radius:4px;padding:0 4px;line-height:1.4}
  .was{display:block;color:${p.muted};font-size:${px(0.76)};line-height:1.3;text-decoration:line-through}
  .empty-row td{color:${p.muted};font-size:${px(0.85)};padding:${c ? 12 : 18}px 0}

  /* ─── جمع‌بندی ──────────────────────────────────────────────────────── */
  .folio{margin-top:${gap}px;display:flex;gap:${gap}px;align-items:flex-start;flex-wrap:wrap}
  .folio-side{flex:1 1 ${c ? 160 : 240}px;min-width:0;display:flex;flex-direction:column;gap:${c ? 6 : 10}px}
  .pay-words{border:${rule};border-radius:6px;padding:${c ? "4px 8px" : "6px 12px"};font-size:${px(0.84)};color:${p.ink};line-height:1.7}
  .pay-words b{font-weight:900}
  .seal{align-self:flex-start;border:2px solid ${p.success};color:${p.success};border-radius:6px;padding:${c ? "2px 10px" : "4px 14px"};
    font-size:${px(0.9)};font-weight:900}
  .totals{flex:0 1 ${c ? 220 : 300}px;min-width:${c ? 180 : 240}px;border:1.5px solid ${p.ink};border-radius:6px;overflow:hidden}
  .pay-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:${px(0.88)};padding:${c ? "3px 8px" : "5px 12px"};
    border-bottom:${rule}}
  .pay-row:last-child{border-bottom:0}
  .pay-row .k{color:${p.bronze};min-width:0}
  .pay-row .v{flex:0 0 auto;font-weight:700;color:${p.ink};white-space:nowrap}
  .pay-row.due .k,.pay-row.due .v{color:${p.danger};font-weight:900}
  .grand{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:${c ? "6px 8px" : "8px 12px"};
    border-top:2px solid ${p.ink};border-bottom:2px solid ${p.ink};background:${p.tint}}
  .grand:first-child{border-top:0}
  .grand-k{font-size:${px(0.92)};font-weight:900;color:${p.ink}}
  .grand-v{font-size:${px(c ? 1.3 : 1.55)};font-weight:900;color:${p.ink};white-space:nowrap}
  .grand-v .cur{font-size:${px(0.78)};font-weight:700;margin-inline-start:5px}

  /* ─── توضیحات، امضا، پانویس ─────────────────────────────────────────── */
  .closing{margin-top:${gap}px;display:flex;gap:${gap}px;align-items:stretch;flex-wrap:wrap}
  .note{flex:1 1 ${c ? 180 : 250}px;min-width:0;border:${rule};border-radius:6px;padding:${c ? "4px 8px" : "6px 12px"}}
  .note h3{display:flex;align-items:center;gap:5px;font-size:${px(0.8)};font-weight:900;color:${p.ink};margin-bottom:2px}
  .note p{font-size:${px(0.88)};color:${p.ink};line-height:1.75;white-space:pre-line;word-break:break-word}
  .signs{flex:1 1 ${c ? 200 : 260}px;min-width:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${c ? 8 : 12}px}
  .sign{border:${rule};border-radius:6px;min-height:${c ? 54 : 78}px;display:flex;flex-direction:column;justify-content:flex-end;
    padding:${c ? "4px 8px" : "6px 10px"};text-align:center}
  .sign .ln{display:none}
  .sign .lbl{display:inline-flex;justify-content:center;align-items:center;gap:4px;font-size:${px(0.8)};color:${p.bronze}}
  .foot{margin-top:${gap}px;padding-top:${c ? 5 : 8}px;border-top:${rule};display:flex;align-items:center;
    justify-content:space-between;gap:4px 14px;flex-wrap:wrap;font-size:${px(0.76)};color:${p.muted}}
  .foot .mark{font-weight:900;color:${p.ink}}
  .foot .ways{display:flex;flex-wrap:wrap;gap:2px 14px;min-width:0}
  .foot .ways span{display:inline-flex;align-items:center;gap:5px;min-width:0}

  /* ─── قالب سفارشی «طراح فاکتور» ─────────────────────────────────────── */
  .block{margin-top:${gap}px;border:${rule};border-radius:6px;overflow:hidden}
  .block > h2{font-size:${px(0.8)};font-weight:900;color:${p.ink};padding:${c ? "3px 8px" : "4px 12px"};background:${p.wash};border-bottom:${rule}}
  .block.plain{background:transparent}
  .grid{display:grid;padding:${c ? "2px 8px" : "4px 12px"}}
  .grid.cols-1{grid-template-columns:minmax(0,1fr)}
  .grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .cell{display:flex;gap:6px;align-items:baseline;min-width:0;padding:${c ? "2px 8px 2px 0" : "3px 12px 3px 0"};font-size:${px(0.84)};line-height:1.6}
  .cell .lbl{color:${p.bronze};flex:0 0 auto}
  .cell .lbl::after{content:":"}
  .cell .val{color:${p.ink};font-weight:700;min-width:0;word-break:break-word;overflow-wrap:anywhere}
  .cell .val.blank{flex:1 1 auto;min-width:${Math.round(fs * 3)}px;height:1em;border-bottom:1px dotted ${p.ink}}

  @media (max-width: 640px) {
    .hero{flex-direction:column}
    .hero-doc{max-width:100%;width:100%}
    .parties{grid-template-columns:1fr}
    table.items, table.tpl{min-width:520px}
    .totals{flex-basis:100%}
  }
  `;
}

function printOrigin(): string {
  try {
    return typeof window !== "undefined" && window.location?.origin?.startsWith("http")
      ? window.location.origin
      : "";
  } catch {
    return "";
  }
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

// ─── بخش‌های مشترک سند (پیش‌فرض + قالب سفارشی) ──────────────────────────────

/** لوگو اگر باشد، وگرنه حرف اول نام فروشگاه */
function shopMonogramHtml(inv: Invoice, showLogo: boolean): string {
  if (showLogo && inv.shopLogoUrl) {
    return `<div class="mono"><img class="logo" src="${esc(inv.shopLogoUrl)}" alt="لوگو"/></div>`;
  }
  const ch = (inv.shopName || "ف").trim().charAt(0) || "ف";
  return `<div class="mono" aria-hidden="true"><span>${esc(ch)}</span></div>`;
}

/**
 * سربرگ: نام و تماس فروشگاه سمت راست، کادر عنوان سند با شماره و تاریخ سمت چپ.
 * opts.note (قالب‌های سفارشی قدیمی «شماره · تاریخ» می‌فرستند) به ردیف‌ها تبدیل می‌شود.
 */
export function invoiceHeroHtml(
  inv: Invoice,
  opts: { docTitle: string; subtitle?: string; showLogo?: boolean; kicker?: string; note?: string },
): string {
  const shopName = inv.shopName || "فروشگاه";
  const showLogo = opts.showLogo !== false && !!inv.shopLogoUrl;
  const contacts = [
    inv.shopPhone ? `<span>${invoiceIcon("phone")}${esc(inv.shopPhone)}</span>` : "",
    inv.shopAddress ? `<span>${invoiceIcon("pin")}${esc(inv.shopAddress)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  const sub = opts.subtitle?.trim();
  return `<header class="hero">
    <div class="hero-brand">
      ${shopMonogramHtml(inv, showLogo)}
      <div>
        <div class="brand-name">${esc(shopName)}</div>
        ${sub ? `<div class="brand-sub"><span>${esc(sub)}</span></div>` : ""}
        ${contacts ? `<div class="brand-sub">${contacts}</div>` : ""}
      </div>
    </div>
    <div class="hero-doc">
      <div class="doc-title">${esc(opts.docTitle)}</div>
      <div class="doc-rows">
        <div class="doc-row"><span class="k">شماره</span><span class="v">${esc(inv.id.toUpperCase())}</span></div>
        <div class="doc-row"><span class="k">تاریخ</span><span class="v">${esc(formatJalaliDate(inv.createdAt))}</span></div>
      </div>
    </div>
  </header>`;
}

/** پانویس — نام فروشگاه و راه‌های تماس */
export function invoiceFooterHtml(inv: Invoice): string {
  const shopName = inv.shopName || "فروشگاه";
  const ways = [
    inv.shopPhone ? `<span>${invoiceIcon("phone")}${esc(inv.shopPhone)}</span>` : "",
    inv.shopAddress ? `<span>${invoiceIcon("pin")}${esc(inv.shopAddress)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  return `<footer class="foot">
    <span class="mark">${esc(shopName)}</span>
    ${ways ? `<span class="ways">${ways}</span>` : ""}
  </footer>`;
}

/**
 * جمع‌بندی: جدول مبالغ (جمع اقلام، تخفیف، مالیات، جمع کل در قاب پررنگ، پرداخت، چک،
 * مانده) و مبلغ به حروف. همه‌ی اعداد از invoiceAmountLines؛ اینجا فقط چیده می‌شوند.
 */
export function invoicePayCardHtml(inv: Invoice): string {
  const lines = invoiceAmountLines(inv);
  const words = amountInDisplayUnit(invoiceTotals(inv).total).wordsText;
  const row = (l: AmountLine) =>
    l.kind === "grand"
      ? `<div class="grand"><span class="grand-k">${esc(l.label)}</span><span class="grand-v">${esc(l.amount)}<span class="cur">${esc(l.currency)}</span></span></div>`
      : `<div class="pay-row${l.kind === "due" ? " due" : ""}"><span class="k">${esc(l.label)}</span><span class="v">${esc(l.value)}</span></div>`;
  return `<section class="folio">
    <div class="folio-side">
      ${words ? `<div class="pay-words"><b>مبلغ به حروف:</b> ${esc(words)}</div>` : ""}
    </div>
    <div class="totals">${lines.map(row).join("")}</div>
  </section>`;
}

/** مشخصات فاکتور — نوار جدول‌مانند */
function metaStripHtml(inv: Invoice): string {
  const t = invoiceTotals(inv);
  const cheques = invoiceCheques(inv);
  const dueDate = cheques
    .map((c) => c.dueDate)
    .filter((d): d is string => !!d)
    .sort()[0];
  const items: { k: string; v: string; tone?: string }[] = [
    { k: "تاریخ و ساعت", v: esc(formatJalaliDateTime(inv.createdAt)) },
  ];
  if (dueDate) items.push({ k: "سررسید چک", v: esc(formatChequeDue(dueDate)) });
  if (inv.paymentMethod) items.push({ k: "نوع پرداخت", v: esc(PAYMENT_LABEL[inv.paymentMethod]) });
  items.push({ k: "تعداد اقلام", v: inv.items.length.toLocaleString("fa-IR") });
  if (t.remaining > 0) items.push({ k: "وضعیت", v: "دارای مانده", tone: "due" });
  return `<section class="facts">${items
    .map(
      (it) =>
        `<div class="fact${it.tone ? ` ${it.tone}` : ""}"><span class="k">${esc(it.k)}</span><span class="v">${it.v}</span></div>`,
    )
    .join("")}</section>`;
}

export function partyHtml(
  kicker: string,
  name: string,
  rows: [string, string | undefined][],
  extra?: string,
): string {
  const body = rows
    .filter(([, v]) => v && v.trim())
    .map(
      ([k, v]) =>
        `<div class="kv"><span class="lbl">${esc(k)}</span><span class="val">${esc((v as string).trim())}</span></div>`,
    )
    .join("");
  return `<article class="party">
    <span class="party-k">${esc(kicker)}</span>
    <div class="party-body">
      <div class="party-name">${esc(name && name.trim() ? name : "—")}</div>
      ${body}
      ${extra || ""}
    </div>
  </article>`;
}

export function buildDefaultInvoiceHTML(
  inv: Invoice,
  fontSize: number = 13,
  paper: PaperSize = "A4",
  mode: InvoiceHtmlMode = "print",
): string {
  const fs = invoiceBaseFontSize(fontSize, mode);
  const compact = paper === "A5" && mode === "print";
  const accent = DEFAULT_INVOICE_ACCENT;
  const shopName = inv.shopName || "فروشگاه";
  const docTitle = invoiceDocumentTitle(inv);
  const name = customerDisplayName(inv);
  const cur = currencyLabel();
  const hasUnit = inv.items.some((i) => itemUnitOf(i.unit) !== COUNT_UNIT);

  const rows = inv.items
    .map(
      (item, i) => `<tr>
        <td class="idx">${(i + 1).toLocaleString("fa-IR")}</td>
        <td class="name">${esc(item.name)}${
          item.discountPercent
            ? `<span class="row-tag">٪${item.discountPercent.toLocaleString("fa-IR")} تخفیف</span>`
            : ""
        }</td>
        <td class="qty">${esc(qtyWithUnit(item))}</td>
        <td class="price">${formatAmount(item.price)}${
          item.originalPrice ? `<s class="was">${formatAmount(item.originalPrice)}</s>` : ""
        }</td>
        <td class="sum">${formatAmount(lineTotal(item))}</td>
      </tr>`,
    )
    .join("");

  const inner = `<div class="sheet"><div class="doc">
  ${invoiceHeroHtml(inv, { docTitle })}
  ${metaStripHtml(inv)}
  <div class="parties">
    ${partyHtml("مشخصات فروشنده", shopName, [
      ["تلفن", inv.shopPhone],
      ["نشانی", inv.shopAddress],
    ])}
    ${partyHtml("مشخصات خریدار", name, [
      ["تلفن", inv.customer?.phone],
      ...(inv.customerFields ?? []).map((f): [string, string] => [f.label, f.value]),
    ])}
  </div>
  <div class="ledger">
  <table class="items">
    <colgroup><col style="width:${compact ? 7 : 6}%"/><col/><col style="width:${hasUnit ? 15 : 11}%"/><col style="width:${compact ? 18 : 17}%"/><col style="width:${compact ? 19 : 18}%"/></colgroup>
    <thead><tr>
      <th>ردیف</th>
      <th class="t-name">شرح کالا / خدمات</th>
      <th>${hasUnit ? "مقدار" : "تعداد"}</th>
      <th>مبلغ واحد (${esc(cur)})</th>
      <th>مبلغ کل (${esc(cur)})</th>
    </tr></thead>
    <tbody>${rows || `<tr class="empty-row"><td colspan="5">قلمی ثبت نشده است</td></tr>`}</tbody>
  </table>
  </div>
  ${invoicePayCardHtml(inv)}
  <div class="closing">
    ${inv.notes ? `<div class="note"><h3>${invoiceIcon("note")}توضیحات</h3><p>${esc(inv.notes)}</p></div>` : ""}
    <div class="signs">
      <div class="sign"><span class="lbl">مهر و امضای فروشنده</span></div>
      <div class="sign"><span class="lbl">امضای خریدار</span></div>
    </div>
  </div>
  ${invoiceFooterHtml(inv)}
  </div></div>`;

  return wrapInvoiceHtml({
    title: `${docTitle} ${inv.id.toUpperCase()}`,
    inner,
    paper,
    mode,
    fontSize: fs,
    accent,
    compact,
  });
}

/**
 * فیش فروش برای چاپگر حرارتی — با تنظیمات کاربر (عرض کاغذ/ناحیه چاپ/قلم/بخش‌ها).
 * همهٔ مبالغ از invoiceAmountLines می‌آیند؛ همان اعداد A4 و PDF.
 */
export function buildThermalInvoiceHTML(
  inv: Invoice,
  receipt: ReceiptSettings = normalizeReceiptSettings(settings.get().receipt),
): string {
  const s = receipt;
  const sh = s.show;
  const customerName = customerDisplayName(inv);
  const shopName = inv.shopName || "فروشگاه";
  const fmt = formatAmount;
  const amountLines = invoiceAmountLines(inv);
  const grand = amountLines.find((l) => l.kind === "grand");
  const t = invoiceTotals(inv);
  const words = amountInDisplayUnit(t.total).wordsText;
  // شماره تلفن جدا (LTR) تا در متن راست‌به‌چپ وارونه نشود
  const contact = [
    inv.shopAddress ? esc(inv.shopAddress) : "",
    inv.shopPhone ? `تلفن: <span class="ltr">${esc(inv.shopPhone)}</span>` : "",
  ]
    .filter(Boolean)
    .join(" — ");
  const meta = [
    sh.invoiceId ? receiptParts.kv("شماره", inv.id.toUpperCase()) : "",
    receiptParts.kv("تاریخ", formatJalaliDateTime(inv.createdAt)),
    sh.customer && customerName ? receiptParts.kv("مشتری", customerName) : "",
    sh.customer && inv.customer?.phone ? receiptParts.kv("تلفن", inv.customer.phone) : "",
    ...(sh.customerFields
      ? (inv.customerFields ?? []).map((f) => receiptParts.kv(f.label, f.value))
      : []),
    inv.paymentMethod ? receiptParts.kv("پرداخت", PAYMENT_LABEL[inv.paymentMethod]) : "",
  ].join("");
  const items = receiptItemsHtml(
    inv.items.map((it) => ({
      name: it.name,
      tag:
        sh.itemDiscount && it.discountPercent
          ? `٪${formatNumber(it.discountPercent)} تخفیف`
          : undefined,
      qty: qtyWithUnit(it),
      was: sh.itemDiscount && it.originalPrice ? fmt(it.originalPrice) : undefined,
      unitPrice: fmt(it.price),
      total: fmt(lineTotal(it)),
    })),
    s,
  );
  const lines = amountLines
    .map((l) =>
      l.kind === "grand"
        ? receiptParts.total(l.label, l.value)
        : `<div class="kv${l.kind === "due" ? " due" : ""}"><span>${esc(l.label)}</span><span>${esc(l.value)}</span></div>`,
    )
    .join("");
  const body = `
  ${sh.logo && inv.shopLogoUrl ? `<img class="logo" src="${esc(inv.shopLogoUrl)}" alt=""/>` : ""}
  <div class="c shop">${esc(shopName)}</div>
  ${sh.shopContact && contact ? `<div class="c sub">${contact}</div>` : ""}
  <div class="c"><span class="title">${esc(invoiceDocumentTitle(inv))}</span></div>
  <hr class="b"/>
  ${meta}
  ${sh.notes && inv.notes ? `<hr/><div class="sub">توضیحات: ${esc(inv.notes)}</div>` : ""}
  <hr/>
  ${items || `<div class="c sub">قلمی ثبت نشده است</div>`}
  <hr class="b"/>
  ${lines}
  ${sh.amountWords && grand && words ? `<div class="words">به حروف: ${esc(words)}</div>` : ""}
  ${sh.thanks && s.footerText.trim() ? `<div class="foot">${esc(s.footerText.trim())}</div>` : ""}
  <div class="cut">- - - - - - - -</div>`;
  return receiptDocument({ title: `فیش ${inv.id.toUpperCase()}`, body, s });
}

export function buildShareText(inv: Invoice): string {
  const date = formatJalaliDate(inv.createdAt);
  const customerName = customerDisplayName(inv);
  const t = invoiceTotals(inv);
  const lines = [
    `🧾 ${invoiceDocumentTitle(inv)} ${inv.shopName || "فروشگاه"}`,
    `📅 تاریخ: ${date}`,
    customerName ? `👤 مشتری: ${customerName}` : "",
    ...(inv.customerFields ?? []).map((f) => `   ${f.label}: ${f.value}`),
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
