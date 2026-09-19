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

/** زرشکی سلطنتی — رنگ تأکیدی سند؛ کاربر می‌تواند در «طراح فاکتور» عوضش کند */
export const DEFAULT_INVOICE_ACCENT = "#6e2432";

const esc = escapeHtml;

// ─── ابزار رنگ ──────────────────────────────────────────────────────────────
// رنگ تم فاکتور دلخواهِ کاربر است؛ سایه‌ها و طیف‌ها باید از همان رنگ ساخته شوند
// تا هر رنگی که کاربر انتخاب می‌کند هماهنگ بماند.

type Rgb = [number, number, number];

const FALLBACK_RGB: Rgb = [110, 36, 50];

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
const darken = (hex: string, t: number) => mixColor(hex, "#14080c", t);

/** طلای شامپاین — فلز ثابت سند؛ با رنگ تم مخلوط نمی‌شود تا فاکتور «رنگی» نشود */
const METAL = "#c4a574";
const IVORY = "#f7f1e6";
const INK = "#1a1410";

/** همان رنگ با شفافیت — برای سایه و خطوط بسیار ظریف */
function alphaColor(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export type InvoicePalette = {
  accent: string;
  deep: string;
  gold: string;
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

export function invoicePalette(accent: string): InvoicePalette {
  const base = accent || DEFAULT_INVOICE_ACCENT;
  return {
    accent: base,
    deep: darken(base, 0.22),
    gold: METAL,
    bronze: mixColor(METAL, "#2a1c10", 0.48),
    paper: IVORY,
    ink: INK,
    muted: "#8a7d70",
    line: METAL,
    hair: "rgba(26,20,16,.08)",
    wash: "#f1eadc",
    tint: lighten(base, 0.92),
    soft: lighten(base, 0.42),
    glow: lighten(METAL, 0.45),
    danger: darken(base, 0.05),
    dangerBg: "#f8eee8",
    success: "#2d5a45",
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
  tr, .party, .sign, .note, .block, .seal { break-inside: avoid; page-break-inside: avoid; }
  @media print {
    html, body { background: #fff !important; padding: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #print-root, .sheet { box-shadow: none !important; border-radius: 0 !important; }
    .screen-only { display: none !important; }
  }
  ${
    mode === "screen"
      ? `html, body { background: #e8dfd0; }
         body { padding: 18px 10px 30px; }
         #print-root { max-width: 940px; margin: 0 auto; }
         .sheet { border-radius: 6px; box-shadow: 0 28px 64px rgba(40,24,16,.18), 0 2px 6px rgba(40,24,16,.06); }`
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
  const pad = c ? 12 : 22;
  const gap = c ? 9 : 18;
  const rowPad = c ? "6px 5px" : "12px 8px";
  const px = (mult: number) => `${Math.round(fs * mult)}px`;
  const gold = p.gold;
  const g = (t: number) => alphaColor(gold, t);
  const wine = (t: number) => alphaColor(p.accent, t);
  const corner = c ? 16 : 22;
  const inset = c ? 8 : 11;

  return `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Vazirmatn,Tahoma,'Noto Naskh Arabic','Segoe UI',sans-serif;font-size:${fs}px;color:${p.ink};direction:rtl;
    line-height:1.65;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
  .ico{width:.95em;height:.95em;flex:0 0 auto;vertical-align:-.14em}

  /* ─── ورق گواهی ─────────────────────────────────────────────────────────
     کاغذ عاجی ثابت است. طلا و زرشکی فقط برای قاب، عنوان و مبلغ نهایی‌اند
     تا سند شبیه کارت نعنایی یا بلوک تیره نشود. */
  .sheet{position:relative;background-color:${p.paper};overflow:hidden;isolation:isolate;
    border:1px solid ${gold};
    background-image:
      linear-gradient(${gold},${gold}),linear-gradient(${gold},${gold}),
      linear-gradient(${gold},${gold}),linear-gradient(${gold},${gold}),
      linear-gradient(${gold},${gold}),linear-gradient(${gold},${gold}),
      linear-gradient(${gold},${gold}),linear-gradient(${gold},${gold});
    background-size:${corner}px 1.5px,1.5px ${corner}px,${corner}px 1.5px,1.5px ${corner}px,${corner}px 1.5px,1.5px ${corner}px,${corner}px 1.5px,1.5px ${corner}px;
    background-repeat:no-repeat;
    background-position:
      top ${inset}px right ${inset}px, top ${inset}px right ${inset}px,
      top ${inset}px left ${inset}px, top ${inset}px left ${inset}px,
      bottom ${inset}px right ${inset}px, bottom ${inset}px right ${inset}px,
      bottom ${inset}px left ${inset}px, bottom ${inset}px left ${inset}px}
  .doc{position:relative;z-index:1;margin:${c ? 7 : 10}px;padding:${pad}px ${pad}px ${c ? 10 : 14}px;
    border:1px solid ${wine(0.42)}}

  /* ─── سربرگ ───────────────────────────────────────────────────────────── */
  .hero{display:flex;align-items:center;justify-content:space-between;gap:${gap}px;flex-wrap:wrap}
  .hero-brand{display:flex;align-items:center;gap:${c ? 10 : 14}px;min-width:0;flex:1 1 46%}
  .mono{width:${c ? 46 : 58}px;height:${c ? 46 : 58}px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;
    background:${p.accent};color:${gold};border:1.5px solid ${gold};box-shadow:0 0 0 3px ${p.paper},0 0 0 4px ${g(0.55)};overflow:hidden}
  .mono span{font-size:${px(c ? 1.35 : 1.55)};font-weight:800;line-height:1}
  .mono .logo,.logo{width:100%;height:100%;object-fit:contain;display:block;background:#fff}
  .brand-name{font-size:${px(1.22)};font-weight:800;line-height:1.35;color:${p.ink};word-break:break-word}
  .brand-sub{margin-top:2px;font-size:${px(0.72)};color:${p.muted};display:flex;flex-wrap:wrap;gap:1px 12px;line-height:1.7}
  .brand-sub span{display:inline-flex;align-items:center;gap:4px;min-width:0}
  .brand-sub .ico{color:${p.bronze}}

  .hero-doc{flex:0 1 auto;min-width:0;max-width:52%;text-align:left}
  .doc-kicker{display:block;font-size:${px(0.66)};font-weight:700;color:${p.bronze};margin-bottom:2px}
  .doc-title{font-size:${px(c ? 1.85 : 2.35)};font-weight:800;line-height:1.15;color:${p.accent};word-break:break-word}
  .doc-id{display:block;margin-top:4px;font-size:${px(0.82)};font-weight:700;color:${p.bronze}}

  /* شمسه — ستارهٔ هشت‌پر ایرانی روی خط طلایی */
  .ornament{display:flex;align-items:center;gap:${c ? 8 : 12}px;margin-top:${gap}px}
  .ornament .orn-line{flex:1 1 auto;height:0;border-top:1px solid ${gold};box-shadow:0 2px 0 ${wine(0.35)}}
  .shamse{width:${c ? 22 : 26}px;height:${c ? 22 : 26}px;flex:0 0 auto;color:${gold}}

  /* ─── مشخصات فاکتور ─────────────────────────────────────────────────── */
  .facts{margin-top:${c ? 10 : 14}px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;
    gap:6px 18px;padding-bottom:${c ? 8 : 11}px;border-bottom:1px solid ${g(0.45)}}
  .fact{display:flex;align-items:baseline;gap:7px;min-width:0}
  .fact .k{font-size:${px(0.7)};font-weight:700;color:${p.bronze};white-space:nowrap}
  .fact .v{font-size:${px(0.9)};font-weight:700;color:${p.ink};word-break:break-word}
  .fact.due .v{color:${p.danger}}
  .fact.ok .v{color:${p.success}}

  /* ─── فروشنده و خریدار ──────────────────────────────────────────────── */
  .parties{margin-top:${c ? 12 : 18}px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0}
  .party{min-width:0;padding:${c ? "2px 14px 2px 0" : "2px 22px 2px 0"}}
  .party + .party{border-inline-start:1px solid ${g(0.55)};padding-inline-start:${c ? 14 : 22}px;padding-inline-end:0}
  .party-k{display:block;font-size:${px(0.68)};font-weight:700;color:${p.bronze}}
  .party-name{margin-top:1px;font-size:${px(1.08)};font-weight:800;color:${p.ink};line-height:1.45;word-break:break-word}
  .kv{display:flex;gap:7px;align-items:baseline;min-width:0;margin-top:${c ? 2 : 3}px;font-size:${px(0.8)};line-height:1.6}
  .kv .lbl{color:${p.muted};flex:0 0 auto}
  .kv .val{color:${p.ink};font-weight:600;min-width:0;word-break:break-word;overflow-wrap:anywhere}

  /* ─── دفتر اقلام ────────────────────────────────────────────────────── */
  .ledger{margin-top:${c ? 10 : 22}px;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
  table.items, table.tpl{width:100%;border-collapse:collapse;table-layout:fixed}
  table.items thead th, table.tpl thead th{padding:${c ? "0 6px 7px" : "0 8px 9px"};font-size:${px(0.68)};font-weight:700;
    color:${p.bronze};text-align:center;white-space:nowrap;background:transparent;
    border-bottom:1px solid ${p.accent};box-shadow:0 2px 0 ${gold}}
  table.items thead th.t-name, table.tpl thead th.c-name{text-align:right}
  table.items tbody td, table.tpl tbody td{padding:${rowPad};font-size:${px(0.9)};text-align:center;vertical-align:middle;line-height:1.65;
    border-bottom:1px solid ${p.hair};word-break:break-word;overflow-wrap:anywhere}
  table.items tbody tr:last-child td, table.tpl tbody tr:last-child td{border-bottom:1px solid ${p.accent};box-shadow:0 2px 0 ${gold}}
  table.items td.idx{width:${c ? 6 : 7}%;color:${p.bronze};font-weight:700;font-size:${px(0.78)}}
  table.items td.name{width:${c ? 47 : 41}%;text-align:right;font-weight:700;color:${p.ink}}
  table.items td.qty{width:${c ? 12 : 13}%;white-space:nowrap;color:${p.muted};font-weight:600}
  table.items td.price{width:${c ? 17 : 19}%;color:${p.ink}}
  table.items td.sum{width:18%;font-weight:800;color:${p.ink}}
  .row-tag{display:inline-block;margin-right:6px;font-size:${px(0.66)};font-weight:700;color:${p.accent}}
  .was{display:block;color:${p.muted};font-size:${px(0.74)};line-height:1.4}
  .empty-row td{color:${p.muted};font-size:${px(0.85)};padding:${c ? 14 : 20}px 0}

  /* ─── مبلغ — بزرگ‌ترین عدد سند ──────────────────────────────────────── */
  .folio{margin-top:${c ? 10 : 24}px;padding-top:${c ? 8 : 16}px;border-top:1px solid ${gold};box-shadow:0 -2px 0 ${wine(0.35)};
    display:flex;gap:${c ? 12 : 20}px;align-items:flex-end;flex-wrap:wrap}
  .pay-list{flex:1 1 ${c ? 180 : 220}px;min-width:0}
  .pay-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:${px(0.82)};padding:${c ? "1px 0" : "3px 0"}}
  .pay-row .k{color:${p.muted};min-width:0}
  .pay-row .v{flex:0 0 auto;font-weight:700;color:${p.ink};white-space:nowrap}
  .pay-row.due .k,.pay-row.due .v{color:${p.danger};font-weight:800}
  .grand{flex:0 1 auto;min-width:0;text-align:left;padding-bottom:2px}
  .grand-k{display:block;font-size:${px(0.7)};font-weight:700;color:${p.bronze}}
  .grand-v{display:block;font-size:${px(c ? 1.9 : 2.55)};font-weight:800;line-height:1.12;color:${p.accent};white-space:nowrap}
  .grand-v .cur{font-size:${px(0.72)};font-weight:700;color:${p.bronze};margin-inline-start:7px}
  .seal{flex:0 0 auto;width:${c ? 52 : 64}px;height:${c ? 52 : 64}px;border-radius:50%;display:grid;place-items:center;align-self:center;
    border:1.5px solid ${gold};box-shadow:inset 0 0 0 3px ${p.paper},inset 0 0 0 4px ${g(0.7)};color:${p.accent};
    font-size:${px(c ? 0.62 : 0.7)};font-weight:800;text-align:center;line-height:1.3;transform:rotate(-8deg)}
  .pay-words{flex:1 1 100%;margin-top:${c ? 6 : 8}px;padding-top:${c ? 6 : 8}px;border-top:1px solid ${g(0.4)};
    font-size:${px(0.74)};color:${p.muted};line-height:1.75}
  .pay-words b{color:${p.accent};font-weight:700}

  /* ─── توضیحات، امضا، پانویس ─────────────────────────────────────────── */
  .closing{margin-top:${c ? 10 : 20}px;display:flex;gap:${c ? 10 : 22}px;align-items:flex-start;flex-wrap:wrap}
  .note{flex:1 1 ${c ? 200 : 250}px;min-width:0}
  .note h3{font-size:${px(0.68)};font-weight:700;color:${p.bronze};margin-bottom:3px}
  .note p{font-size:${px(0.84)};color:${p.ink};line-height:1.8;white-space:pre-line;word-break:break-word}
  .signs{flex:1 1 ${c ? 200 : 250}px;min-width:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${c ? 12 : 20}px}
  .sign{text-align:center;padding-top:${c ? 22 : 34}px}
  .sign .ln{display:block;border-bottom:1px solid ${gold}}
  .sign .lbl{display:block;margin-top:6px;font-size:${px(0.7)};color:${p.muted}}
  .foot{margin-top:${c ? 12 : 18}px;padding-top:${c ? 8 : 10}px;border-top:1px solid ${g(0.45)};display:flex;align-items:center;
    justify-content:space-between;gap:6px 14px;flex-wrap:wrap;font-size:${px(0.7)};color:${p.muted}}
  .foot .mark{display:inline-flex;align-items:center;gap:7px;font-weight:700;color:${p.accent}}
  .foot .mark .shamse{width:12px;height:12px;color:${gold}}
  .foot .ways{display:flex;flex-wrap:wrap;gap:2px 14px;min-width:0}
  .foot .ways span{display:inline-flex;align-items:center;gap:5px;min-width:0}

  /* ─── قالب سفارشی «طراح فاکتور» ─────────────────────────────────────── */
  .block{margin-top:${c ? 12 : 16}px}
  .block > h2{font-size:${px(0.68)};font-weight:700;color:${p.bronze};padding:0 0 4px}
  .block.plain{background:transparent;overflow:visible}
  .grid{display:grid;padding:0}
  .grid.cols-1{grid-template-columns:minmax(0,1fr)}
  .grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .cell{display:flex;gap:7px;align-items:baseline;min-width:0;padding:${c ? "3px 12px 3px 0" : "4px 16px 4px 0"};font-size:${px(0.8)};line-height:1.6}
  .cell .lbl{color:${p.bronze};font-weight:700;flex:0 0 auto;font-size:${px(0.72)}}
  .cell .val{color:${p.ink};font-weight:600;min-width:0;word-break:break-word;overflow-wrap:anywhere}
  .cell .val.blank{flex:1 1 auto;min-width:${Math.round(fs * 3)}px;height:1em;border-bottom:1px solid ${g(0.55)}}
  table.tpl tbody td.c-name{text-align:right;font-weight:700;color:${p.ink}}
  table.tpl tbody td.c-index{color:${p.bronze};font-weight:700;font-size:${px(0.78)}}
  table.tpl tbody td.c-qty, table.tpl tbody td.c-unit{white-space:nowrap;color:${p.muted};font-weight:600}
  table.tpl tbody td.c-total{font-weight:800;color:${p.ink}}

  @media screen {
    table.items tbody tr:hover td, table.tpl tbody tr:hover td{background:${g(0.08)}}
  }
  @media (max-width: 640px) {
    .parties{grid-template-columns:1fr}
    .party + .party{border-inline-start:0;border-top:1px solid ${g(0.45)};padding:12px 0 0;margin-top:12px}
    .hero-doc{max-width:100%;text-align:right}
    .grand{text-align:right}
    table.items, table.tpl{min-width:520px}
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

/** ستارهٔ هشت‌پر — امضای هندسی سند، ساخته از دو مربع چرخیده */
function shamseSvg(cls = "shamse"): string {
  return `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true">
    <g fill="currentColor" stroke="none">
      <polygon points="16.0,3.0 18.1,10.8 25.2,6.8 21.2,13.9 29.0,16.0 21.2,18.1 25.2,25.2 18.1,21.2 16.0,29.0 13.9,21.2 6.8,25.2 10.8,18.1 3.0,16.0 10.8,13.9 6.8,6.8 13.9,10.8"/>
    </g>
  </svg>`;
}

function ornamentHtml(): string {
  return `<div class="ornament" aria-hidden="true"><span class="orn-line"></span>${shamseSvg()}<span class="orn-line"></span></div>`;
}

/** مونوگرام حلقه‌طلا: لوگو اگر باشد، وگرنه حرف اول نام فروشگاه */
function shopMonogramHtml(inv: Invoice, showLogo: boolean): string {
  if (showLogo && inv.shopLogoUrl) {
    return `<div class="mono"><img class="logo" src="${esc(inv.shopLogoUrl)}" alt="لوگو"/></div>`;
  }
  const ch = (inv.shopName || "ف").trim().charAt(0) || "ف";
  return `<div class="mono" aria-hidden="true"><span>${esc(ch)}</span></div>`;
}

/** سربرگ: مونوگرام و برند سمت راست، عنوان زرشکی سند سمت چپ */
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
  const idLine = opts.note?.trim() || inv.id.toUpperCase();
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
      ${kicker ? `<span class="doc-kicker">${esc(kicker)}</span>` : `<span class="doc-kicker">سند فروش</span>`}
      <div class="doc-title">${esc(opts.docTitle)}</div>
      <span class="doc-id">${esc(idLine)}</span>
    </div>
  </header>
  ${ornamentHtml()}`;
}

/** پانویس گواهی — شمسه کوچک و اطلاعات تماسی که در سیستم ثبت شده */
export function invoiceFooterHtml(inv: Invoice): string {
  const shopName = inv.shopName || "فروشگاه";
  const ways = [
    inv.shopPhone ? `<span>${invoiceIcon("phone")}${esc(inv.shopPhone)}</span>` : "",
    inv.shopAddress ? `<span>${invoiceIcon("pin")}${esc(inv.shopAddress)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  return `<footer class="foot">
    <span class="mark">${shamseSvg()} ${esc(shopName)}</span>
    ${ways ? `<span class="ways">${ways}</span>` : ""}
  </footer>`;
}

/**
 * جمع‌بندی سلطنتی — مبلغ قابل پرداخت درشت‌ترین عدد سند است.
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
    `<div class="pay-row${l.kind === "due" ? " due" : ""}"><span class="k">${esc(l.label)}</span><span class="v">${esc(l.value)}</span></div>`;
  return `<section class="folio">
    <div class="pay-list">${
      rest.map(row).join("") ||
      (grand
        ? `<div class="pay-row"><span class="k">جمع اقلام</span><span class="v">${esc(grand.value)}</span></div>`
        : "")
    }</div>
    ${settled ? `<div class="seal">تسویه<br/>شد</div>` : ""}
    ${
      grand
        ? `<div class="grand">
        <span class="grand-k">مبلغ قابل پرداخت</span>
        <span class="grand-v">${esc(grand.amount)}<span class="cur">${esc(grand.currency)}</span></span>
      </div>`
        : ""
    }
    ${words ? `<div class="pay-words"><b>به حروف</b> — ${esc(words)} ${esc(currencyLabel())}</div>` : ""}
  </section>`;
}

/** مشخصات فاکتور — یک ردیف ظریف، بدون کارت و بدون آیکون شلوغ */
function metaStripHtml(inv: Invoice): string {
  const t = invoiceTotals(inv);
  const cheques = invoiceCheques(inv);
  const dueDate = cheques
    .map((c) => c.dueDate)
    .filter((d): d is string => !!d)
    .sort()[0];
  const items: { k: string; v: string; tone?: string }[] = [
    { k: "تاریخ", v: esc(formatJalaliDateTime(inv.createdAt)) },
  ];
  if (dueDate) items.push({ k: "سررسید چک", v: esc(formatChequeDue(dueDate)) });
  if (inv.paymentMethod) items.push({ k: "نوع", v: esc(PAYMENT_LABEL[inv.paymentMethod]) });
  items.push({ k: "اقلام", v: inv.items.length.toLocaleString("fa-IR") });
  items.push(
    t.remaining > 0
      ? { k: "وضعیت", v: "دارای مانده", tone: "due" }
      : { k: "وضعیت", v: "تسویه شده", tone: "ok" },
  );
  return `<section class="facts">${items
    .map(
      (it) =>
        `<div class="fact${it.tone ? ` ${it.tone}` : ""}"><span class="k">${esc(it.k)}</span><span class="v">${it.v}</span></div>`,
    )
    .join("")}</section>`;
}

function partyHtml(
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
    subtitle: inv.shopPhone || inv.shopAddress ? undefined : `${docTitle} کالا و خدمات`,
  })}
  ${metaStripHtml(inv)}
  <div class="parties">
    ${partyHtml("فروشنده", shopName, [
      ["تلفن", inv.shopPhone],
      ["نشانی", inv.shopAddress],
    ])}
    ${partyHtml(
      "خریدار",
      name,
      [["تلفن", inv.customer?.phone]],
      payment
        ? `<div class="kv"><span class="lbl">پرداخت</span><span class="val">${esc(payment)}</span></div>`
        : "",
    )}
  </div>
  <div class="ledger">
  <table class="items">
    <thead><tr>
      <th>ردیف</th>
      <th class="t-name">شرح کالا / خدمات</th>
      <th>تعداد</th>
      <th>مبلغ واحد (${esc(cur)})</th>
      <th>مبلغ کل (${esc(cur)})</th>
    </tr></thead>
    <tbody>${rows || `<tr class="empty-row"><td colspan="5">قلمی ثبت نشده است</td></tr>`}</tbody>
  </table>
  </div>
  ${invoicePayCardHtml(inv)}
  <div class="closing">
    ${inv.notes ? `<div class="note"><h3>توضیحات</h3><p>${esc(inv.notes)}</p></div>` : ""}
    <div class="signs">
      <div class="sign"><span class="ln"></span><span class="lbl">مهر و امضای فروشنده</span></div>
      <div class="sign"><span class="ln"></span><span class="lbl">امضای خریدار</span></div>
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
