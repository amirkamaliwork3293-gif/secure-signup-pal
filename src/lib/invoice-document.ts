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
import { amountToPersianWords } from "@/lib/amount-words";

export type InvoiceHtmlMode = "screen" | "print";

/** سبز زمردی آرام — رنگ پایه‌ی سند؛ کاربر می‌تواند در «طراح فاکتور» عوضش کند */
export const DEFAULT_INVOICE_ACCENT = "#0d7c6b";

const esc = escapeHtml;

// ─── ابزار رنگ ──────────────────────────────────────────────────────────────
// رنگ تم فاکتور دلخواهِ کاربر است؛ سایه‌ها و طیف‌ها باید از همان رنگ ساخته شوند
// تا هر رنگی که کاربر انتخاب می‌کند هماهنگ بماند.

type Rgb = [number, number, number];

const FALLBACK_RGB: Rgb = [13, 124, 107];

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
const darken = (hex: string, t: number) => mixColor(hex, "#08131a", t);

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
  paper: string;
  danger: string;
  dangerBg: string;
  success: string;
};

export function invoicePalette(accent: string): InvoicePalette {
  const base = accent || DEFAULT_INVOICE_ACCENT;
  return {
    accent: base,
    deep: darken(base, 0.4),
    soft: lighten(base, 0.34),
    glow: lighten(base, 0.74),
    wash: lighten(base, 0.96),
    tint: lighten(base, 0.92),
    line: lighten(base, 0.84),
    hair: alphaColor(base, 0.12),
    // متن سند تقریباً مشکیِ گرم است تا رنگ تم فقط برای «ساختار» بماند
    ink: "#18211f",
    muted: mixColor(base, "#7d8a92", 0.82),
    paper: "#fdfdfb",
    danger: "#b02a30",
    dangerBg: "#fdf1f1",
    success: "#10704f",
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
  tr, .party, .sign, .stub, .note, .strip-i, .block { break-inside: avoid; page-break-inside: avoid; }
  @media print {
    html, body { background: #fff !important; padding: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #print-root, .sheet { box-shadow: none !important; border-radius: 0 !important; }
    .screen-only { display: none !important; }
    .sheet { border: 0 !important; }
  }
  ${
    mode === "screen"
      ? `html, body { background: #edefec; }
         body { padding: 18px 10px 30px; }
         #print-root { max-width: 940px; margin: 0 auto; }
         .sheet { border-radius: 20px; box-shadow: 0 24px 54px rgba(24,33,31,.14), 0 1px 3px rgba(24,33,31,.06); }`
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
  const c = !!opts.compact;
  const pad = c ? 16 : 26;
  const gap = c ? 11 : 17;
  const rowPad = c ? "9px 7px" : "13px 9px";
  const px = (mult: number) => `${Math.round(fs * mult)}px`;
  const a = (t: number) => alphaColor(p.accent, t);

  return `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Vazirmatn,Tahoma,'Noto Naskh Arabic','Segoe UI',sans-serif;font-size:${fs}px;color:${p.ink};direction:rtl;
    line-height:1.65;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
  .ico{width:1em;height:1em;flex:0 0 auto;vertical-align:-.14em}

  /* ─── کاغذ ───────────────────────────────────────────────────────────────
     پس‌زمینه از چند لایه‌ی بسیار کم‌رنگ ساخته می‌شود: تابش نرم رنگ تم از بالا،
     یک کمان موییِ بزرگ و شبکه‌ی نقطه‌ایِ محوشونده در پایین کادر. */
  .sheet{position:relative;background:${p.paper};overflow:hidden;isolation:isolate}
  .sheet::before{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background:
      radial-gradient(118% 60% at 97% -16%, ${a(0.11)} 0%, ${a(0.03)} 42%, rgba(255,255,255,0) 72%),
      radial-gradient(64% 34% at -8% 102%, ${a(0.07)} 0%, rgba(255,255,255,0) 100%),
      linear-gradient(180deg,#ffffff 0%, ${p.paper} 62%, ${p.wash} 100%)}
  /* شیرازه‌ی رنگی لبه‌ی سند — نشانه‌ی بصری ثابت فاکتورهای این برنامه */
  .sheet::after{content:"";position:absolute;z-index:2;pointer-events:none;top:0;bottom:0;inset-inline-start:0;width:${c ? 4 : 6}px;
    background:linear-gradient(180deg, ${p.accent} 0%, ${a(0.6)} 36%, ${a(0.14)} 100%)}
  .doc{position:relative;z-index:1;padding:${pad}px ${pad}px ${c ? 12 : 16}px;padding-inline-start:${pad + (c ? 6 : 10)}px}

  /* ─── سربرگ ───────────────────────────────────────────────────────────── */
  .hero{display:flex;align-items:flex-end;justify-content:space-between;gap:${gap}px;flex-wrap:wrap}
  .hero-brand{display:flex;align-items:center;gap:${c ? 10 : 14}px;min-width:0;flex:1 1 48%}
  .logo-wrap{width:${c ? 46 : 58}px;height:${c ? 46 : 58}px;border-radius:${c ? 15 : 19}px;background:#fff;padding:5px;flex:0 0 auto;
    border:1px solid ${p.line};box-shadow:0 4px 14px ${a(0.08)}}
  .logo{width:100%;height:100%;object-fit:contain;display:block}
  .brand-name{font-size:${px(1.28)};font-weight:800;line-height:1.35;color:${p.ink};word-break:break-word}
  .brand-sub{margin-top:2px;font-size:${px(0.72)};color:${p.muted};display:flex;flex-wrap:wrap;gap:1px 12px;line-height:1.7}
  .brand-sub span{display:inline-flex;align-items:center;gap:4px;min-width:0}
  .brand-sub .ico{color:${p.accent};opacity:.7}

  .hero-doc{flex:0 1 auto;min-width:0;max-width:56%;text-align:left}
  .doc-kicker{display:block;font-size:${px(0.64)};font-weight:700;color:${a(0.72)};margin-bottom:1px}
  .doc-title{font-size:${px(c ? 1.95 : 2.4)};font-weight:300;line-height:1.16;color:${p.ink};word-break:break-word}
  .doc-title b{font-weight:800;color:${p.deep}}
  .swash{display:block;width:100%;height:${c ? 8 : 11}px;color:${p.accent};margin-top:1px}
  .doc-id{display:inline-block;margin-top:6px;padding:1px 10px;border-radius:999px;background:${a(0.08)};
    font-size:${px(0.8)};font-weight:700;color:${p.accent};letter-spacing:.05em}
  .rule{height:1px;margin-top:${gap}px;background:linear-gradient(90deg, ${a(0.55)} 0%, ${a(0.2)} 42%, rgba(255,255,255,0) 100%)}

  /* ─── نوار اطلاعات فاکتور ───────────────────────────────────────────── */
  .strip{display:flex;flex-wrap:wrap;margin-top:${c ? 8 : 12}px;padding-bottom:${c ? 6 : 9}px;border-bottom:1px solid ${a(0.12)}}
  .strip-i{flex:1 1 ${c ? 96 : 116}px;min-width:0;padding:${c ? "2px 11px" : "3px 15px"};border-inline-start:1px solid ${a(0.14)}}
  .strip-i:first-child{border-inline-start:0;padding-inline-start:0}
  .strip-k{display:flex;align-items:center;gap:5px;font-size:${px(0.68)};color:${p.muted};line-height:1.5}
  .strip-k .ico{color:${p.accent};opacity:.75}
  .strip-v{display:block;margin-top:1px;font-size:${px(0.92)};font-weight:700;color:${p.ink};line-height:1.5;word-break:break-word}
  .chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:1px 9px;font-size:${px(0.74)};font-weight:700;
    background:${a(0.09)};color:${p.accent}}
  .chip.ok{background:#e8f4ef;color:${p.success}}
  .chip.due{background:${p.dangerBg};color:${p.danger}}

  /* ─── فروشنده و خریدار ──────────────────────────────────────────────── */
  .parties{margin-top:${c ? 11 : 17}px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${c ? 10 : 15}px}
  .party{min-width:0;border-radius:${c ? 14 : 18}px;padding:${c ? "10px 13px 11px" : "14px 17px 15px"};background:${a(0.037)}}
  .party-k{display:flex;align-items:center;gap:6px;font-size:${px(0.68)};font-weight:700;color:${p.accent}}
  .party-name{margin-top:2px;font-size:${px(1.04)};font-weight:800;color:${p.ink};line-height:1.45;word-break:break-word}
  .kv{display:flex;gap:7px;align-items:baseline;min-width:0;margin-top:${c ? 2 : 4}px;font-size:${px(0.8)};line-height:1.6}
  .kv .lbl{color:${p.muted};flex:0 0 auto}
  .kv .val{color:${p.ink};font-weight:600;min-width:0;word-break:break-word;overflow-wrap:anywhere}

  /* ─── دفتر اقلام ────────────────────────────────────────────────────── */
  .ledger{margin-top:${c ? 13 : 20}px;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
  table.items, table.tpl{width:100%;border-collapse:collapse;table-layout:fixed}
  table.items thead th, table.tpl thead th{padding:${c ? "0 7px 6px" : "0 9px 9px"};font-size:${px(0.68)};font-weight:700;
    color:${p.accent};text-align:center;white-space:nowrap;background:transparent;border-bottom:1.5px solid ${a(0.55)}}
  table.items thead th .ico, table.tpl thead th .ico{opacity:.7;margin-left:4px;width:.9em;height:.9em}
  table.items thead th.t-name, table.tpl thead th.c-name{text-align:right}
  table.items tbody td, table.tpl tbody td{padding:${rowPad};font-size:${px(0.9)};text-align:center;vertical-align:middle;line-height:1.65;
    border-bottom:1px solid ${a(0.11)};word-break:break-word;overflow-wrap:anywhere}
  table.items tbody tr:last-child td, table.tpl tbody tr:last-child td{border-bottom:1.5px solid ${a(0.3)}}
  table.items td.idx{width:${c ? 6 : 7}%;color:${a(0.55)};font-weight:800;font-size:${px(0.8)}}
  table.items td.name{width:${c ? 47 : 41}%;text-align:right;font-weight:700;color:${p.ink}}
  table.items td.qty{width:${c ? 12 : 13}%;white-space:nowrap;color:${p.muted};font-weight:600}
  table.items td.price{width:${c ? 17 : 19}%;color:${p.ink}}
  table.items td.sum{width:18%;font-weight:800;color:${p.ink}}
  .row-tag{display:inline-block;margin-right:6px;border-radius:999px;padding:0 7px;font-size:${px(0.66)};font-weight:700;
    background:#e8f4ef;color:${p.success}}
  .was{display:block;color:${p.muted};font-size:${px(0.74)};line-height:1.4}
  .empty-row td{color:${p.muted};font-size:${px(0.85)};padding:${c ? "14px" : "20px"} 0}

  /* ─── ته‌برگ مالی ────────────────────────────────────────────────────
     بخش مبلغ مثل «ته‌برگ جداشونده»‌ی یک سند بهادار از بدنه جدا می‌شود:
     خط پرفراژ نقطه‌چین + دو بریدگی گرد در دو لبه. */
  .stub{position:relative;margin-top:${c ? 17 : 26}px;border-radius:${c ? 16 : 22}px;background:${a(0.05)};
    padding:${c ? "15px 14px 13px" : "21px 20px 17px"}}
  .stub::before{content:"";position:absolute;top:0;inset-inline:${c ? 13 : 19}px;border-top:2px dashed ${a(0.34)}}
  .notch{position:absolute;top:0;width:${c ? 16 : 20}px;height:${c ? 16 : 20}px;border-radius:50%;background:${p.paper};transform:translateY(-50%)}
  .notch.s{inset-inline-start:-${c ? 8 : 10}px}
  .notch.e{inset-inline-end:-${c ? 8 : 10}px}
  .pay{display:flex;gap:${c ? 12 : 20}px;align-items:flex-end;flex-wrap:wrap}
  .pay-list{flex:1 1 ${c ? 190 : 230}px;min-width:0}
  .pay-row{display:flex;align-items:baseline;gap:7px;font-size:${px(0.82)};padding:${c ? "1px 0" : "2px 0"}}
  .pay-row .k{color:${p.muted};flex:0 1 auto;min-width:0;word-break:break-word}
  .pay-row .dots{flex:1 1 auto;min-width:12px;border-bottom:1px dotted ${a(0.4)};transform:translateY(-.3em)}
  .pay-row .v{flex:0 0 auto;font-weight:700;color:${p.ink};white-space:nowrap}
  .pay-row.due .k, .pay-row.due .v{color:${p.danger};font-weight:800}
  .pay-stamp{flex:0 0 auto;align-self:center;transform:rotate(-9deg);border:2px solid ${alphaColor(p.success, 0.4)};color:${alphaColor(p.success, 0.72)};
    border-radius:${c ? 9 : 12}px;padding:${c ? "2px 10px" : "3px 14px"};font-size:${px(c ? 0.8 : 0.95)};font-weight:800;
    box-shadow:inset 0 0 0 1px ${alphaColor(p.success, 0.14)}}
  .grand{flex:0 1 auto;min-width:0;text-align:left}
  .grand-k{display:block;font-size:${px(0.72)};font-weight:700;color:${p.accent}}
  .grand-v{display:block;font-size:${px(c ? 1.85 : 2.45)};font-weight:800;line-height:1.18;letter-spacing:-.03em;color:${p.ink};white-space:nowrap}
  .grand-v .cur{font-size:${px(0.78)};font-weight:700;color:${p.accent};margin-inline-start:6px;letter-spacing:0}
  .pay-words{margin-top:${c ? 9 : 13}px;padding-top:${c ? 7 : 10}px;border-top:1px dashed ${a(0.28)};font-size:${px(0.74)};
    color:${p.muted};line-height:1.75}
  .pay-words b{color:${p.accent};font-weight:700}

  /* ─── توضیحات، امضا، پانویس ─────────────────────────────────────────── */
  .closing{margin-top:${c ? 12 : 18}px;display:flex;gap:${c ? 12 : 20}px;align-items:flex-start;flex-wrap:wrap}
  .note{flex:1 1 ${c ? 200 : 250}px;min-width:0;border-radius:${c ? 12 : 15}px;background:${a(0.04)};padding:${c ? "9px 12px" : "12px 15px"}}
  .note h3{display:flex;align-items:center;gap:6px;font-size:${px(0.7)};font-weight:700;color:${p.accent};margin-bottom:2px}
  .note p{font-size:${px(0.84)};color:${p.ink};line-height:1.8;white-space:pre-line;word-break:break-word}
  .signs{flex:1 1 ${c ? 200 : 250}px;min-width:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${c ? 10 : 16}px}
  .sign{text-align:center;padding-top:${c ? 24 : 36}px}
  .sign .ln{display:block;border-bottom:1px dashed ${a(0.45)}}
  .sign .lbl{display:inline-flex;align-items:center;gap:5px;margin-top:5px;font-size:${px(0.72)};color:${p.muted}}
  .sign .lbl .ico{color:${p.accent};opacity:.7}
  .foot{margin-top:${c ? 12 : 18}px;padding-top:${c ? 7 : 9}px;border-top:1px solid ${a(0.16)};display:flex;align-items:center;
    justify-content:space-between;gap:6px 14px;flex-wrap:wrap;font-size:${px(0.7)};color:${p.muted}}
  .foot .mark{display:inline-flex;align-items:center;gap:6px;font-weight:700;color:${p.accent}}
  .foot .ways{display:flex;flex-wrap:wrap;gap:2px 14px;min-width:0}
  .foot .ways span{display:inline-flex;align-items:center;gap:5px;min-width:0}

  /* ─── قالب سفارشی «طراح فاکتور» — همان زبان بصری، چیدمان دلخواه کاربر ─ */
  .block{margin-top:${c ? 11 : 16}px;border-radius:${c ? 14 : 18}px;overflow:hidden;background:${a(0.037)}}
  .block > h2{display:flex;align-items:center;gap:6px;font-size:${px(0.7)};font-weight:700;color:${p.accent};
    padding:${c ? "8px 13px 2px" : "12px 17px 3px"}}
  .block.plain{background:transparent;overflow:visible}
  .grid{display:grid;padding:${c ? "4px 13px 10px" : "5px 17px 13px"}}
  .grid.cols-1{grid-template-columns:minmax(0,1fr)}
  .grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .cell{display:flex;gap:7px;align-items:baseline;min-width:0;padding:${c ? "2px 0" : "3px 0"};padding-inline-end:12px;font-size:${px(0.8)};line-height:1.6}
  .cell .lbl{color:${p.muted};flex:0 0 auto}
  .cell .val{color:${p.ink};font-weight:600;min-width:0;word-break:break-word;overflow-wrap:anywhere}
  table.tpl tbody td.c-name{text-align:right;font-weight:700;color:${p.ink}}
  table.tpl tbody td.c-index{color:${a(0.55)};font-weight:800;font-size:${px(0.8)}}
  table.tpl tbody td.c-qty, table.tpl tbody td.c-unit{white-space:nowrap;color:${p.muted};font-weight:600}
  table.tpl tbody td.c-total{font-weight:800;color:${p.ink}}

  @media screen {
    table.items tbody tr:hover td, table.tpl tbody tr:hover td{background:${a(0.045)}}
  }
  @media (max-width: 640px) {
    .parties{grid-template-columns:1fr}
    .hero-doc{max-width:100%;text-align:right}
    .grand{text-align:right}
    table.items, table.tpl{min-width:520px}
  }
  @media print {
    .logo-wrap{box-shadow:none}
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

/** خط دست‌کشیده‌ی زیر عنوان — امضای بصری سند */
const SWASH_SVG = `<svg class="swash" viewBox="0 0 240 12" preserveAspectRatio="none" aria-hidden="true"><path d="M3 9.1C48 3.4 105 1.8 153 4.1c29 1.4 55 3.5 84 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

/** عنوان سند: واژه‌ی آخر پررنگ می‌شود تا ریتم تایپوگرافی بگیرد */
function docTitleMarkup(title: string): string {
  const words = String(title || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return `<b>${esc(words[0] || "فاکتور")}</b>`;
  const last = words.pop() as string;
  return `${esc(words.join(" "))} <b>${esc(last)}</b>`;
}

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
  const kicker = opts.kicker?.trim();
  const idLine = opts.note?.trim() || `${inv.id.toUpperCase()}`;
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
      ${kicker ? `<span class="doc-kicker">${esc(kicker)}</span>` : ""}
      <div class="doc-title">${docTitleMarkup(opts.docTitle)}</div>
      ${SWASH_SVG}
      <span class="doc-id">${esc(idLine)}</span>
    </div>
  </header>
  <div class="rule"></div>`;
}

/** پانویس سبک — فقط یک خط مویی و اطلاعات تماسی که در سیستم ثبت شده */
export function invoiceFooterHtml(inv: Invoice): string {
  const shopName = inv.shopName || "فروشگاه";
  const ways = [
    inv.shopPhone ? `<span>${invoiceIcon("phone")}${esc(inv.shopPhone)}</span>` : "",
    inv.shopAddress ? `<span>${invoiceIcon("pin")}${esc(inv.shopAddress)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  return `<footer class="foot">
    <span class="mark">${invoiceIcon("seal")}${esc(shopName)}</span>
    ${ways ? `<span class="ways">${ways}</span>` : ""}
  </footer>`;
}

/**
 * ته‌برگ مالی — سطرهای جمع‌بندی سمت راست، مبلغ قابل پرداخت درشت سمت چپ.
 * همه‌ی اعداد از invoiceAmountLines می‌آیند؛ اینجا فقط چیده می‌شوند.
 */
export function invoicePayCardHtml(inv: Invoice): string {
  const lines = invoiceAmountLines(inv);
  const grandAt = lines.findIndex((l) => l.kind === "grand");
  const grand = grandAt >= 0 ? lines[grandAt] : undefined;
  const rest = lines.filter((l) => l.kind !== "grand");
  const settled = !!grand && !lines.some((l) => l.kind === "due");
  const words = grand ? amountToPersianWords(invoiceTotals(inv).total) : "";
  const row = (l: AmountLine) =>
    `<div class="pay-row${l.kind === "due" ? " due" : ""}"><span class="k">${esc(l.label)}</span><span class="dots"></span><span class="v">${esc(l.value)}</span></div>`;
  return `<section class="stub">
    <span class="notch s"></span><span class="notch e"></span>
    <div class="pay">
      <div class="pay-list">${rest.map(row).join("") || `<div class="pay-row"><span class="k">جمع اقلام</span><span class="dots"></span><span class="v">${esc(grand?.value || "")}</span></div>`}</div>
      ${settled ? `<div class="pay-stamp">تسویه شد</div>` : ""}
      ${
        grand
          ? `<div class="grand">
        <span class="grand-k">مبلغ قابل پرداخت</span>
        <span class="grand-v">${esc(grand.amount)}<span class="cur">${esc(grand.currency)}</span></span>
      </div>`
          : ""
      }
    </div>
    ${words ? `<div class="pay-words"><b>به حروف:</b> ${esc(words)} ${esc(currencyLabel())}</div>` : ""}
  </section>`;
}

/** نوار اطلاعات فاکتور — فقط داده‌ای که واقعاً روی فاکتور هست */
function metaStripHtml(inv: Invoice): string {
  const t = invoiceTotals(inv);
  const cheques = invoiceCheques(inv);
  const dueDate = cheques
    .map((c) => c.dueDate)
    .filter((d): d is string => !!d)
    .sort()[0];
  const items: { icon: string; k: string; v: string }[] = [
    { icon: "calendar", k: "تاریخ صدور", v: esc(formatJalaliDateTime(inv.createdAt)) },
  ];
  if (dueDate) {
    items.push({ icon: "clock", k: "سررسید چک", v: esc(formatChequeDue(dueDate)) });
  }
  if (inv.paymentMethod) {
    items.push({ icon: "wallet", k: "نوع فاکتور", v: esc(PAYMENT_LABEL[inv.paymentMethod]) });
  }
  items.push({ icon: "layers", k: "تعداد اقلام", v: inv.items.length.toLocaleString("fa-IR") });
  items.push({
    icon: "seal",
    k: "وضعیت",
    v:
      t.remaining > 0
        ? `<span class="chip due">${invoiceIcon("coins")}دارای مانده</span>`
        : `<span class="chip ok">${invoiceIcon("seal")}تسویه شده</span>`,
  });
  return `<section class="strip">${items
    .map(
      (it) => `<div class="strip-i">
      <span class="strip-k">${invoiceIcon(it.icon)}${esc(it.k)}</span>
      <span class="strip-v">${it.v}</span>
    </div>`,
    )
    .join("")}</section>`;
}

/** کارت فروشنده/خریدار — بدون کادر سنگین، فقط یک لایه‌ی رنگیِ بسیار کم‌رنگ */
function partyHtml(
  kicker: string,
  icon: string,
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
    <span class="party-k">${invoiceIcon(icon)}${esc(kicker)}</span>
    <div class="party-name">${esc(name && name.trim() ? name : "—")}</div>
    ${body}
    ${extra || ""}
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
  const cur = currencyLabel();

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
  ${metaStripHtml(inv)}
  <div class="parties">
    ${partyHtml("فروشنده", "store", shopName, [
      ["تلفن", inv.shopPhone],
      ["نشانی", inv.shopAddress],
    ])}
    ${partyHtml(
      "خریدار",
      "user",
      name,
      [["تلفن", inv.customer?.phone]],
      payment
        ? `<div class="kv"><span class="lbl">پرداخت</span><span class="val"><span class="chip">${invoiceIcon("wallet")}${esc(payment)}</span></span></div>`
        : "",
    )}
  </div>
  <div class="ledger">
  <table class="items">
    <thead><tr>
      <th>ردیف</th>
      <th class="t-name">${invoiceIcon("box")}شرح کالا / خدمات</th>
      <th>تعداد</th>
      <th>مبلغ واحد (${esc(cur)})</th>
      <th>مبلغ کل (${esc(cur)})</th>
    </tr></thead>
    <tbody>${rows || `<tr class="empty-row"><td colspan="5">قلمی ثبت نشده است</td></tr>`}</tbody>
  </table>
  </div>
  ${invoicePayCardHtml(inv)}
  <div class="closing">
    ${
      inv.notes
        ? `<div class="note"><h3>${invoiceIcon("note")}توضیحات</h3><p>${esc(inv.notes)}</p></div>`
        : ""
    }
    <div class="signs">
      <div class="sign"><span class="ln"></span><span class="lbl">${invoiceIcon("seal")}مهر و امضای فروشنده</span></div>
      <div class="sign"><span class="ln"></span><span class="lbl">${invoiceIcon("pen")}امضای خریدار</span></div>
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
