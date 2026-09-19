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

export const DEFAULT_INVOICE_ACCENT = "#232c63";

const esc = escapeHtml;

// ─── ابزار رنگ ──────────────────────────────────────────────────────────────
// رنگ تم فاکتور دلخواهِ کاربر است؛ سایه‌ها و طیف‌ها باید از همان رنگ ساخته شوند
// تا هر رنگی که کاربر انتخاب می‌کند هماهنگ بماند.

type Rgb = [number, number, number];

const FALLBACK_RGB: Rgb = [35, 44, 99];

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

/** ترکیب دو رنگ — t=0 یعنی رنگ اول، t=1 یعنی رنگ دوم */
function mixColor(hex: string, target: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
}

const lighten = (hex: string, t: number) => mixColor(hex, "#ffffff", t);
const darken = (hex: string, t: number) => mixColor(hex, "#070b1c", t);

/** همان رنگ با شفافیت — برای سایه و خطوط بسیار ظریف */
function alphaColor(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export type InvoicePalette = {
  accent: string;
  deep: string;
  soft: string;
  glow: string;
  wash: string;
  tint: string;
  line: string;
  hair: string;
  ink: string;
  muted: string;
  danger: string;
  dangerBg: string;
  success: string;
};

export function invoicePalette(accent: string): InvoicePalette {
  const base = accent || DEFAULT_INVOICE_ACCENT;
  return {
    accent: base,
    deep: darken(base, 0.42),
    soft: lighten(base, 0.3),
    glow: lighten(base, 0.72),
    wash: lighten(base, 0.955),
    tint: lighten(base, 0.9),
    line: lighten(base, 0.8),
    hair: alphaColor(base, 0.1),
    ink: darken(base, 0.55),
    muted: mixColor(base, "#8b95ad", 0.72),
    danger: "#b4232a",
    dangerBg: "#fdf2f2",
    success: "#0f7b4a",
  };
}

// ─── آیکون‌ها ───────────────────────────────────────────────────────────────
// SVG درون‌خطی و بدون وابستگی — سبک، قابل چاپ و بدون درخواست شبکه.

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

/** آیکون خطی کوچک — رنگ از currentColor می‌آید تا با هر تم هماهنگ باشد */
export function invoiceIcon(name: keyof typeof ICON_PATHS | string, cls = ""): string {
  const d = ICON_PATHS[name];
  if (!d) return "";
  return `<svg class="ico${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
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

/** سطرهای جمع‌بندی — منبع واحد برای HTML پیش‌فرض، قالب سفارشی و PDF */
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
  tr, .party, .sign-box, .pay-card, .note-card, .meta-card { break-inside: avoid; page-break-inside: avoid; }
  @media print {
    html, body { background: #fff !important; padding: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #print-root, .sheet { box-shadow: none !important; border-radius: 0 !important; }
    .screen-only { display: none !important; }
    .sheet { border: 0 !important; }
  }
  ${
    mode === "screen"
      ? `html, body { background: #e8ecf6; }
         body { padding: 18px 10px 30px; }
         #print-root { max-width: 940px; margin: 0 auto; }
         .sheet { border-radius: 22px; box-shadow: 0 26px 60px rgba(17,25,56,.18), 0 2px 6px rgba(17,25,56,.06); }`
      : `html, body { background: #fff; }
         body { padding: 0; }`
  }
  `;
  return { css, script: "" };
}

export function invoiceChromeCss(opts: {
  fontSize: number;
  accent: string;
  compact?: boolean;
}): string {
  const fs = opts.fontSize;
  const p = invoicePalette(opts.accent);
  const pad = opts.compact ? 14 : 22;
  const rowPad = opts.compact ? "8px 8px" : "11px 10px";
  const px = (mult: number) => `${Math.round(fs * mult)}px`;

  return `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Vazirmatn,Tahoma,'Noto Naskh Arabic','Segoe UI',sans-serif;font-size:${fs}px;color:${p.ink};direction:rtl;line-height:1.6;-webkit-font-smoothing:antialiased}
  .ico{width:1.05em;height:1.05em;flex:0 0 auto;vertical-align:-.16em}

  /* ورق فاکتور — پس‌زمینه بخشی از طراحی است، نه فقط یک کادر سفید */
  .sheet{position:relative;background:#fff;overflow:hidden;isolation:isolate}
  .sheet::before{content:"";position:absolute;inset:0;background:
      radial-gradient(130% 62% at 100% -8%, ${alphaColor(p.accent, 0.13)} 0%, ${alphaColor(p.accent, 0.04)} 42%, rgba(255,255,255,0) 72%),
      radial-gradient(90% 46% at -10% 106%, ${alphaColor(p.glow, 0.5)} 0%, rgba(255,255,255,0) 68%),
      linear-gradient(180deg, ${p.wash} 0%, #ffffff 34%, #ffffff 82%, ${p.wash} 100%);
    z-index:0;pointer-events:none}
  .sheet::after{content:"";position:absolute;top:-${fs * 9}px;left:-${fs * 10}px;width:${fs * 22}px;height:${fs * 22}px;border-radius:50%;
    border:1px solid ${alphaColor(p.accent, 0.08)};box-shadow:0 0 0 ${fs}px ${alphaColor(p.accent, 0.03)};z-index:0;pointer-events:none}
  .doc{position:relative;z-index:1;padding:${pad}px ${pad + 2}px ${opts.compact ? 10 : 14}px}

  /* سربرگ */
  .hero{display:flex;align-items:flex-start;justify-content:space-between;gap:${pad}px;flex-wrap:wrap}
  .hero-brand{display:flex;align-items:center;gap:${opts.compact ? 10 : 14}px;min-width:0;flex:1 1 52%}
  .logo-wrap{width:${opts.compact ? 48 : 62}px;height:${opts.compact ? 48 : 62}px;border-radius:16px;background:#fff;padding:5px;flex:0 0 auto;
    border:1px solid ${p.line};box-shadow:0 6px 16px ${alphaColor(p.accent, 0.12)}}
  .logo{width:100%;height:100%;object-fit:contain;display:block}
  .brand-name{font-size:${px(1.42)};font-weight:800;letter-spacing:-.015em;line-height:1.3;color:${p.deep};word-break:break-word}
  .brand-sub{margin-top:3px;font-size:${px(0.76)};color:${p.muted};display:flex;flex-wrap:wrap;gap:4px 12px;line-height:1.6}
  .brand-sub span{display:inline-flex;align-items:center;gap:4px;min-width:0}
  .hero-doc{text-align:left;flex:0 0 auto;min-width:0}
  .doc-kicker{display:inline-flex;align-items:center;gap:6px;font-size:${px(0.7)};font-weight:700;letter-spacing:.14em;color:${p.soft};text-transform:uppercase}
  .doc-title{font-size:${px(opts.compact ? 2.1 : 2.5)};font-weight:800;line-height:1.1;letter-spacing:-.03em;margin-top:2px;
    color:${p.deep};background:linear-gradient(105deg, ${p.deep} 12%, ${p.accent} 56%, ${p.soft} 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .doc-note{font-size:${px(0.76)};color:${p.muted};margin-top:4px}
  .hair-rule{height:2px;margin:${opts.compact ? 10 : 14}px 0 0;border-radius:2px;
    background:linear-gradient(90deg, ${p.accent} 0%, ${alphaColor(p.accent, 0.35)} 38%, ${alphaColor(p.glow, 0.5)} 70%, rgba(255,255,255,0) 100%)}

  /* کارت اطلاعات فاکتور */
  .meta-card{margin-top:${opts.compact ? 10 : 14}px;display:flex;flex-wrap:wrap;gap:0;
    border:1px solid ${p.line};border-radius:16px;background:linear-gradient(180deg,#fff 0%, ${p.wash} 100%);
    box-shadow:0 6px 18px ${alphaColor(p.accent, 0.06)};overflow:hidden}
  .meta-item{flex:1 1 ${opts.compact ? 104 : 124}px;min-width:0;display:flex;align-items:center;gap:9px;padding:${opts.compact ? "8px 10px" : "11px 12px"};
    border-inline-start:1px solid ${p.hair}}
  .meta-item:first-child{border-inline-start:0}
  .meta-badge{width:${Math.round(fs * 1.9)}px;height:${Math.round(fs * 1.9)}px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto;
    color:#fff;background:linear-gradient(140deg, ${p.deep}, ${p.accent} 62%, ${p.soft});box-shadow:0 4px 10px ${alphaColor(p.accent, 0.25)}}
  .meta-badge .ico{width:1em;height:1em}
  .meta-txt{min-width:0}
  .meta-k{display:block;font-size:${px(0.7)};color:${p.muted};line-height:1.5}
  .meta-v{display:block;font-size:${px(0.95)};font-weight:700;color:${p.deep};word-break:break-word;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
  .chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 10px;font-size:${px(0.76)};font-weight:700;
    background:${p.tint};color:${p.accent};border:1px solid ${p.hair}}
  .chip.ok{background:#eef8f2;color:${p.success};border-color:#cdeadb}
  .chip.due{background:${p.dangerBg};color:${p.danger};border-color:#f3d3d3}

  /* فروشنده و خریدار */
  .parties{margin-top:${opts.compact ? 10 : 14}px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${opts.compact ? 10 : 14}px}
  .party{position:relative;border:1px solid ${p.line};border-radius:16px;padding:${opts.compact ? "10px 12px 11px" : "13px 15px 14px"};
    background:linear-gradient(170deg, #fff 0%, ${p.wash} 100%);box-shadow:0 5px 16px ${alphaColor(p.accent, 0.05)};min-width:0}
  .party-head{display:flex;align-items:center;gap:8px;margin-bottom:${opts.compact ? 6 : 9}px}
  .party-ico{width:${Math.round(fs * 1.75)}px;height:${Math.round(fs * 1.75)}px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;
    color:#fff;background:linear-gradient(140deg, ${p.accent}, ${p.soft})}
  .party-ico .ico{width:.95em;height:.95em}
  .party-head h2{font-size:${px(0.82)};font-weight:700;color:${p.accent};letter-spacing:.01em}
  .kv{display:flex;gap:10px;align-items:baseline;min-width:0;padding:${opts.compact ? "2px 0" : "3px 0"}}
  .kv + .kv{border-top:1px dashed ${p.hair}}
  .kv .lbl{color:${p.muted};font-size:${px(0.74)};flex:0 0 ${Math.round(fs * 3.4)}px}
  .kv .val{font-weight:700;font-size:${px(0.9)};word-break:break-word;min-width:0;color:${p.ink};line-height:1.55}

  /* جدول کالاها */
  .items-wrap{margin-top:${opts.compact ? 12 : 16}px;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
  table.items, table.tpl{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
  table.items thead th, table.tpl thead th{background:linear-gradient(120deg, ${p.deep} 0%, ${mixColor(p.deep, p.accent, 0.55)} 55%, ${p.accent} 100%);
    color:#fff;font-weight:700;padding:${opts.compact ? "9px 7px" : "12px 9px"};font-size:${px(0.78)};text-align:center;letter-spacing:.01em;
    border:0;white-space:nowrap}
  table.items thead th .ico, table.tpl thead th .ico{opacity:.75;margin-left:5px;width:.95em;height:.95em}
  table.items thead th:first-child, table.tpl thead th:first-child{border-start-start-radius:14px}
  table.items thead th:last-child, table.tpl thead th:last-child{border-start-end-radius:14px}
  table.items tbody td, table.tpl tbody td{padding:${rowPad};border:0;border-bottom:1px solid ${p.hair};
    font-size:${px(0.9)};text-align:center;word-break:break-word;overflow-wrap:anywhere;vertical-align:middle;line-height:1.6}
  table.items tbody tr:nth-child(even) td, table.tpl tbody tr:nth-child(even) td{background:${alphaColor(p.accent, 0.035)}}
  table.items tbody tr:last-child td, table.tpl tbody tr:last-child td{border-bottom:0}
  table.items tbody tr:last-child td:first-child, table.tpl tbody tr:last-child td:first-child{border-end-start-radius:14px}
  table.items tbody tr:last-child td:last-child, table.tpl tbody tr:last-child td:last-child{border-end-end-radius:14px}
  table.items td.idx{width:8%;color:${p.muted};font-variant-numeric:tabular-nums;font-size:${px(0.82)}}
  table.items td.name{text-align:right;width:40%;font-weight:700;color:${p.deep}}
  table.items td.qty{width:14%;white-space:nowrap;font-variant-numeric:tabular-nums}
  table.items td.price{width:18%;font-variant-numeric:tabular-nums}
  table.items td.sum{width:20%;font-variant-numeric:tabular-nums;font-weight:800;color:${p.accent}}
  .row-tag{display:inline-block;margin-right:6px;border-radius:999px;padding:1px 7px;font-size:${px(0.68)};font-weight:700;
    background:#eef8f2;color:${p.success};border:1px solid #cdeadb}
  .was{display:block;color:${p.muted};font-size:${px(0.78)};line-height:1.45;font-variant-numeric:tabular-nums}
  .empty-row td{color:${p.muted};font-size:${px(0.85)}}

  /* جمع‌بندی، توضیحات و امضا */
  .finale{margin-top:${opts.compact ? 12 : 16}px;display:flex;gap:${opts.compact ? 10 : 14}px;align-items:stretch;flex-wrap:wrap}
  .pay-card{flex:1 1 ${opts.compact ? 230 : 280}px;max-width:${opts.compact ? 330 : 390}px;border-radius:18px;padding:${opts.compact ? "12px 14px" : "15px 17px"};
    color:#fff;background:linear-gradient(140deg, ${p.deep} 0%, ${p.accent} 58%, ${mixColor(p.accent, p.glow, 0.45)} 100%);
    box-shadow:0 12px 28px ${alphaColor(p.accent, 0.28)};position:relative;overflow:hidden}
  .pay-card::after{content:"";position:absolute;inset-inline-end:-${fs * 2.4}px;top:-${fs * 2.4}px;width:${fs * 7}px;height:${fs * 7}px;border-radius:50%;
    background:rgba(255,255,255,.08)}
  .pay-row{display:flex;justify-content:space-between;gap:12px;font-size:${px(0.8)};padding:${opts.compact ? "3px 0" : "4px 0"};position:relative;z-index:1;line-height:1.5}
  .pay-row .k{color:rgba(255,255,255,.78);min-width:0;flex:1 1 auto}
  .pay-row .v{font-variant-numeric:tabular-nums;font-weight:600;flex:0 0 auto;white-space:nowrap}
  .pay-grand{position:relative;z-index:1;margin:${opts.compact ? "8px 0" : "10px 0"};padding:${opts.compact ? "9px 12px" : "11px 14px"};
    border-radius:14px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22)}
  .pay-grand .k{display:block;font-size:${px(0.74)};color:rgba(255,255,255,.85);font-weight:600}
  .pay-grand .v{display:block;font-size:${px(opts.compact ? 1.65 : 1.95)};font-weight:800;line-height:1.25;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .pay-grand .cur{font-size:${px(0.74)};font-weight:600;color:rgba(255,255,255,.85);margin-right:5px}
  .pay-due{position:relative;z-index:1;margin-top:${opts.compact ? 6 : 8}px;display:flex;justify-content:space-between;gap:12px;
    border-radius:12px;padding:${opts.compact ? "6px 11px" : "8px 12px"};background:#fff;color:${p.danger};font-weight:800;font-size:${px(0.86)}}
  .pay-due .v{font-variant-numeric:tabular-nums;white-space:nowrap}

  .side{flex:1 1 ${opts.compact ? 230 : 280}px;min-width:0;display:flex;flex-direction:column;gap:${opts.compact ? 8 : 11}px}
  .note-card{border:1px solid ${p.line};border-radius:16px;padding:${opts.compact ? "10px 12px" : "12px 14px"};background:#fff;
    box-shadow:0 5px 16px ${alphaColor(p.accent, 0.05)}}
  .note-card h3{display:flex;align-items:center;gap:7px;font-size:${px(0.8)};font-weight:700;color:${p.accent};margin-bottom:4px}
  .note-card p{font-size:${px(0.85)};color:${p.ink};word-break:break-word;line-height:1.75;white-space:pre-line}
  .signs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${opts.compact ? 8 : 11}px;margin-top:auto}
  .sign-box{border:1px solid ${p.line};border-radius:14px;padding:${opts.compact ? "8px 10px 26px" : "10px 12px 34px"};
    background:linear-gradient(180deg,#fff, ${p.wash});font-size:${px(0.76)};color:${p.muted}}
  .sign-box strong{display:flex;align-items:center;gap:6px;color:${p.accent};font-size:${px(0.78)};font-weight:700}

  /* پانویس */
  .foot{position:relative;margin-top:${opts.compact ? 10 : 14}px}
  .foot svg.wave{display:block;width:100%;height:${opts.compact ? 22 : 28}px}
  .foot-in{background:${p.deep};color:rgba(255,255,255,.88);padding:${opts.compact ? "7px 16px" : "9px 20px"};
    display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:${px(0.74)}}
  .foot-in .thanks{font-weight:700;color:#fff;display:inline-flex;align-items:center;gap:6px}
  .foot-in .ways{display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:flex-start}
  .foot-in .ways span{display:inline-flex;align-items:center;gap:5px}

  /* قالب سفارشی «طراح فاکتور» — همان زبان بصری، ساختار جدولی کاربر */
  .block{margin-top:${opts.compact ? 10 : 14}px;border:1px solid ${p.line};border-radius:16px;overflow:hidden;background:#fff;
    box-shadow:0 5px 16px ${alphaColor(p.accent, 0.05)}}
  .block > h2{display:flex;align-items:center;gap:7px;font-size:${px(0.8)};font-weight:700;color:#fff;
    background:linear-gradient(120deg, ${p.deep}, ${p.accent});padding:${opts.compact ? "6px 12px" : "8px 14px"};letter-spacing:.02em}
  .block.plain{border:0;box-shadow:none;background:transparent;overflow:visible}
  .grid{display:grid}
  .grid.cols-1{grid-template-columns:minmax(0,1fr)}
  .grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .cell{display:flex;align-items:stretch;border-inline-start:1px solid ${p.hair};border-top:1px solid ${p.hair};min-height:${Math.round(fs * 2.2)}px;min-width:0}
  .cell .lbl{background:${p.wash};color:${p.muted};font-size:${px(0.74)};padding:6px 10px;flex:0 1 auto;max-width:46%;min-width:0;
    display:flex;align-items:center;font-weight:600;word-break:break-word;line-height:1.45}
  .cell .val{padding:6px 10px;font-weight:700;font-size:${px(0.9)};display:flex;align-items:center;flex:1;min-width:0;
    word-break:break-word;overflow-wrap:anywhere;line-height:1.5}
  table.tpl tbody td.c-name{text-align:right;font-weight:700;color:${p.deep}}
  table.tpl tbody td.c-index, table.tpl tbody td.c-qty, table.tpl tbody td.c-unit{white-space:nowrap;font-variant-numeric:tabular-nums}
  table.tpl tbody td.c-price, table.tpl tbody td.c-total{font-variant-numeric:tabular-nums}
  table.tpl tbody td.c-total{font-weight:800;color:${p.accent}}

  @media (max-width: 640px) {
    .parties{grid-template-columns:1fr}
    .hero{gap:10px}
    .hero-doc{text-align:right}
    .pay-card{max-width:none}
    table.items, table.tpl{min-width:520px}
  }
  @media print {
    .party, .note-card, .meta-card, .sign-box, .block{box-shadow:none}
    .pay-card{box-shadow:none}
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

// ─── بخش‌های مشترک سند (پیش‌فرض + قالب سفارشی) ──────────────────────────────

/** سربرگ: برند سمت راست، عنوان بزرگ سند سمت چپ */
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
      ${showLogo ? `<div class="logo-wrap"><img class="logo" src="${esc(inv.shopLogoUrl!)}" alt="لوگو"/></div>` : ""}
      <div>
        <div class="brand-name">${esc(shopName)}</div>
        ${sub ? `<div class="brand-sub"><span>${esc(sub)}</span></div>` : ""}
        ${contacts ? `<div class="brand-sub">${contacts}</div>` : ""}
      </div>
    </div>
    <div class="hero-doc">
      <span class="doc-kicker">${invoiceIcon("doc")}${esc(opts.kicker || "سند مالی")}</span>
      <div class="doc-title">${esc(opts.docTitle)}</div>
      <div class="doc-note">${esc(opts.note || "با سپاس از اعتماد شما")}</div>
    </div>
  </header>
  <div class="hair-rule"></div>`;
}

/** پانویس موج‌دار با اطلاعات تماس موجود در سیستم */
export function invoiceFooterHtml(inv: Invoice, accent: string): string {
  const p = invoicePalette(accent);
  const shopName = inv.shopName || "فروشگاه";
  const ways = [
    inv.shopPhone ? `<span>${invoiceIcon("phone")}${esc(inv.shopPhone)}</span>` : "",
    inv.shopAddress ? `<span>${invoiceIcon("pin")}${esc(inv.shopAddress)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  return `<footer class="foot">
    <svg class="wave" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 34C160 4 330 0 520 18c190 18 330 34 520 20 60-4 118-12 160-22V60H0Z" fill="${p.deep}"/>
      <path d="M0 44C170 20 340 16 540 32c200 16 350 26 520 12 50-4 100-12 140-20v12H0Z" fill="${alphaColor(p.accent, 0.35)}"/>
    </svg>
    <div class="foot-in">
      <span class="thanks">${invoiceIcon("seal")}${esc(shopName)}</span>
      ${ways ? `<span class="ways">${ways}</span>` : ""}
    </div>
  </footer>`;
}

/** کارت جمع‌بندی مبالغ — مبلغ قابل پرداخت درشت‌ترین عدد سند است */
export function invoicePayCardHtml(inv: Invoice): string {
  const lines = invoiceAmountLines(inv);
  const grandAt = lines.findIndex((l) => l.kind === "grand");
  const grand = grandAt >= 0 ? lines[grandAt] : undefined;
  const before = grandAt >= 0 ? lines.slice(0, grandAt) : lines;
  const after = grandAt >= 0 ? lines.slice(grandAt + 1) : [];
  const row = (l: AmountLine) =>
    `<div class="pay-row"><span class="k">${esc(l.label)}</span><span class="v">${esc(l.value)}</span></div>`;
  return `<section class="pay-card">
    ${before.map(row).join("")}
    ${
      grand
        ? `<div class="pay-grand">
        <span class="k">مبلغ قابل پرداخت</span>
        <span class="v">${esc(grand.amount)}<span class="cur">${esc(grand.currency)}</span></span>
      </div>`
        : ""
    }
    ${after
      .filter((l) => l.kind !== "due")
      .map(row)
      .join("")}
    ${after
      .filter((l) => l.kind === "due")
      .map(
        (l) =>
          `<div class="pay-due"><span>${esc(l.label)}</span><span class="v">${esc(l.value)}</span></div>`,
      )
      .join("")}
  </section>`;
}

/** خانه‌های کارت اطلاعات فاکتور — فقط داده‌ای که واقعاً روی فاکتور هست */
function metaCardHtml(inv: Invoice): string {
  const t = invoiceTotals(inv);
  const cheques = invoiceCheques(inv);
  const dueDate = cheques
    .map((c) => c.dueDate)
    .filter((d): d is string => !!d)
    .sort()[0];
  const items: { icon: string; k: string; v: string }[] = [
    { icon: "hash", k: "شماره فاکتور", v: esc(inv.id.toUpperCase()) },
    { icon: "calendar", k: "تاریخ صدور", v: esc(formatJalaliDateTime(inv.createdAt)) },
  ];
  if (dueDate) {
    items.push({ icon: "clock", k: "سررسید چک", v: esc(formatChequeDue(dueDate)) });
  }
  if (inv.paymentMethod) {
    items.push({ icon: "wallet", k: "نوع فاکتور", v: esc(PAYMENT_LABEL[inv.paymentMethod]) });
  }
  items.push({
    icon: "seal",
    k: "وضعیت",
    v:
      t.remaining > 0
        ? `<span class="chip due">${invoiceIcon("coins")}دارای مانده</span>`
        : `<span class="chip ok">${invoiceIcon("seal")}تسویه شده</span>`,
  });
  return `<section class="meta-card">${items
    .map(
      (it) => `<div class="meta-item">
      <span class="meta-badge">${invoiceIcon(it.icon)}</span>
      <span class="meta-txt"><span class="meta-k">${esc(it.k)}</span><span class="meta-v">${it.v}</span></span>
    </div>`,
    )
    .join("")}</section>`;
}

function partyHtml(
  title: string,
  icon: string,
  rows: [string, string | undefined][],
  accentRow?: string,
): string {
  const body = rows
    .filter(([, v], i) => i === 0 || (v && v.trim()))
    .map(
      ([k, v]) =>
        `<div class="kv"><span class="lbl">${esc(k)}</span><span class="val">${esc(v && v.trim() ? v : "—")}</span></div>`,
    )
    .join("");
  return `<article class="party">
    <div class="party-head"><span class="party-ico">${invoiceIcon(icon)}</span><h2>${esc(title)}</h2></div>
    ${body}
    ${accentRow || ""}
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
  const payment = inv.paymentMethod ? PAYMENT_LABEL[inv.paymentMethod] : "";

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
  ${invoiceHeroHtml(inv, {
    docTitle,
    // وقتی تماس و نشانی فروشگاه ثبت نشده، زیرِ نام برند خالی نماند
    subtitle: inv.shopPhone || inv.shopAddress ? undefined : `${docTitle} کالا و خدمات`,
  })}
  ${metaCardHtml(inv)}
  <div class="parties">
    ${partyHtml("اطلاعات فروشنده", "store", [
      ["نام", shopName],
      ["تلفن", inv.shopPhone],
      ["نشانی", inv.shopAddress],
    ])}
    ${partyHtml(
      "اطلاعات خریدار",
      "user",
      [
        ["نام", name],
        ["تلفن", inv.customer?.phone],
      ],
      payment
        ? `<div class="kv"><span class="lbl">پرداخت</span><span class="val"><span class="chip">${invoiceIcon("wallet")}${esc(payment)}</span></span></div>`
        : "",
    )}
  </div>
  <div class="items-wrap">
  <table class="items">
    <thead><tr>
      <th>ردیف</th>
      <th>${invoiceIcon("box")}نام کالا / خدمات</th>
      <th>تعداد</th>
      <th>مبلغ واحد</th>
      <th>مبلغ کل</th>
    </tr></thead>
    <tbody>${rows || `<tr class="empty-row"><td colspan="5">قلمی ثبت نشده است</td></tr>`}</tbody>
  </table>
  </div>
  <div class="finale">
    ${invoicePayCardHtml(inv)}
    <div class="side">
      ${
        inv.notes
          ? `<div class="note-card"><h3>${invoiceIcon("note")}توضیحات</h3><p>${esc(inv.notes)}</p></div>`
          : ""
      }
      <div class="signs">
        <div class="sign-box"><strong>${invoiceIcon("seal")}مهر و امضای فروشنده</strong></div>
        <div class="sign-box"><strong>${invoiceIcon("pen")}امضای خریدار</strong></div>
      </div>
    </div>
  </div>
  </div>
  ${invoiceFooterHtml(inv, accent)}
</div>`;

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
