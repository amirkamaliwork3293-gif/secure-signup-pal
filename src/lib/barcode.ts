/**
 * barcode.ts — تولید کد یکتا + رندر لیبل حرفه‌ای بارکد
 *
 * لیبل‌ها به‌صورت تصویر (canvas) رندر می‌شوند تا نام فارسی محصول و قیمت
 * با کیفیت بالا و فونت درست، زیر بارکد چاپ شوند (jsPDF به‌تنهایی قادر به
 * رندر متن فارسی نیست). همان تصویر هم در PDF و هم در چاپ مستقیم استفاده
 * می‌شود تا خروجی همه مسیرها یکسان و تمیز باشد.
 */
import bwipjs from "bwip-js/browser";
import { jsPDF } from "jspdf";
import { formatToman } from "@/lib/store";
import { printHtml } from "@/lib/print";

// تولید کد یکتا در ماژول سبکِ جدا نگه‌داری می‌شود؛ اینجا فقط re-export می‌کنیم
// تا importهای قدیمی از "@/lib/barcode" همچنان کار کنند.
export { generateUniqueCode } from "@/lib/barcode-code";

export type BarcodeFormat = "code128" | "ean13";

export async function renderBarcodeToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  opts: { format?: BarcodeFormat; scale?: number; height?: number; includetext?: boolean } = {},
) {
  const { format = "code128", scale = 3, height = 12, includetext = true } = opts;
  const bcid = format === "ean13" && /^\d{12,13}$/.test(text) ? "ean13" : "code128";
  await bwipjs.toCanvas(canvas, {
    bcid, text, scale, height, includetext,
    textxalign: "center", textsize: 8,
  });
}

export async function barcodeDataUrl(text: string, opts?: Parameters<typeof renderBarcodeToCanvas>[2]) {
  const c = document.createElement("canvas");
  await renderBarcodeToCanvas(c, text, opts);
  return c.toDataURL("image/png");
}

// ─── رندر لیبل کامل (بارکد + نام + قیمت) ────────────────────────────────────

export type LabelItem = { code: string; name?: string; price?: number };

export type LabelOptions = {
  widthMm: number;
  heightMm: number;
  showName?: boolean;
  showPrice?: boolean;
  /** نمایش رشته‌ی کد زیر میله‌های بارکد */
  showCode?: boolean;
  /** ضریب پررنگی/ضخامت میله‌ها برای پرینترهای حرارتی (۱ = عادی) */
  boldness?: number;
};

// رزولوشن لیبل: ‎12px/mm ≈ 300dpi — کیفیت چاپ حرفه‌ای
const PX_PER_MM = 12;
const LABEL_FONT = "Vazirmatn, Tahoma, 'Segoe UI', sans-serif";

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

/**
 * رندر یک لیبل کامل روی canvas (یا canvas جدید).
 * چیدمان: بارکد بالا (با کد زیر میله‌ها)، نام فارسی وسط، قیمت پایین.
 */
export async function renderLabelToCanvas(
  item: LabelItem,
  opts: LabelOptions,
  target?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const { widthMm, heightMm, showName = true, showPrice = true, showCode = true, boldness = 1 } = opts;
  const W = Math.round(widthMm * PX_PER_MM);
  const H = Math.round(heightMm * PX_PER_MM);

  const canvas = target ?? document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // پس‌زمینه سفید تمیز
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const pad = Math.round(Math.min(H, W) * 0.05);
  const hasName = showName && !!item.name;
  const hasPrice = showPrice && typeof item.price === "number";

  const nameFontPx = Math.max(16, Math.round(H * 0.115));
  const priceFontPx = Math.max(18, Math.round(H * 0.125));
  const lineGap = Math.round(H * 0.025);

  const nameH = hasName ? nameFontPx + lineGap : 0;
  const priceH = hasPrice ? priceFontPx + lineGap : 0;
  const barcodeAreaH = H - pad * 2 - nameH - priceH;

  // رندر بارکد در canvas موقت و جای‌گذاری با حفظ نسبت ابعاد
  const bc = document.createElement("canvas");
  await bwipjs.toCanvas(bc, {
    bcid: /^\d{12,13}$/.test(item.code) ? "ean13" : "code128",
    text: item.code,
    scale: Math.max(2, Math.round(4 * boldness)),
    height: 11,
    includetext: showCode,
    textxalign: "center",
    textsize: 9,
    paddingwidth: 2,
  });
  const maxBcW = W - pad * 2;
  const ratio = Math.min(maxBcW / bc.width, barcodeAreaH / bc.height);
  const bw = Math.max(1, Math.floor(bc.width * ratio));
  const bh = Math.max(1, Math.floor(bc.height * ratio));
  ctx.imageSmoothingEnabled = bw < bc.width; // فقط هنگام کوچک‌کردن
  ctx.drawImage(bc, Math.round((W - bw) / 2), pad + Math.round((barcodeAreaH - bh) / 2), bw, bh);

  // متن‌ها — راست‌به‌چپ، وسط‌چین
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.direction = "rtl";

  let y = pad + barcodeAreaH;
  if (hasName) {
    y += nameFontPx;
    ctx.font = `600 ${nameFontPx}px ${LABEL_FONT}`;
    ctx.fillText(fitText(ctx, item.name!, W - pad * 2), W / 2, y);
    y += lineGap;
  }
  if (hasPrice) {
    y += priceFontPx;
    ctx.font = `700 ${priceFontPx}px ${LABEL_FONT}`;
    ctx.fillText(formatToman(item.price!), W / 2, y);
  }

  return canvas;
}

export async function labelDataUrl(item: LabelItem, opts: LabelOptions): Promise<string> {
  const c = await renderLabelToCanvas(item, opts);
  return c.toDataURL("image/png");
}

// ─── چیدمان چاپ ─────────────────────────────────────────────────────────────

export type PrintLayout = {
  /** a4 = چاپ روی برگه A4 — label = چاپ روی رول/برچسب مخصوص لیبل‌زن */
  mode?: "a4" | "label";
  cols: number;
  rows: number;
  copies: number;
  labelWidthMm: number;
  labelHeightMm: number;
  showName?: boolean;
  showPrice?: boolean;
  showCode?: boolean;
  /** فاصله بین لیبل‌ها (mm) */
  gapMm?: number;
  /** جابه‌جایی ریز برای کالیبراسیون پرینتر لیبل‌زن (mm) */
  offsetXMm?: number;
  offsetYMm?: number;
  /** پررنگی میله‌ها برای پرینتر حرارتی */
  boldness?: number;
};

export const DEFAULT_LAYOUT: PrintLayout = {
  mode: "a4",
  cols: 3, rows: 8, copies: 1,
  labelWidthMm: 60, labelHeightMm: 35,
  showName: true, showPrice: true, showCode: true,
  gapMm: 2, offsetXMm: 0, offsetYMm: 0, boldness: 1,
};

/** پیش‌تنظیم‌های رایج رول لیبل (سازگار با Remo P600N و سایر لیبل‌زن‌های حرارتی) */
export type LabelPreset = {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  cols: number;
  gapMm: number;
};

export const LABEL_PRESETS: LabelPreset[] = [
  { id: "50x30", label: "۵۰×۳۰ تک‌ردیفه", widthMm: 50, heightMm: 30, cols: 1, gapMm: 2 },
  { id: "50x30x2", label: "۵۰×۳۰ دوردیفه", widthMm: 50, heightMm: 30, cols: 2, gapMm: 2 },
  { id: "40x30", label: "۴۰×۳۰ تک‌ردیفه", widthMm: 40, heightMm: 30, cols: 1, gapMm: 2 },
  { id: "40x30x2", label: "۴۰×۳۰ دوردیفه", widthMm: 40, heightMm: 30, cols: 2, gapMm: 2 },
  { id: "38x25x2", label: "۳۸×۲۵ دوردیفه", widthMm: 38, heightMm: 25, cols: 2, gapMm: 2 },
  { id: "60x40", label: "۶۰×۴۰ تک‌ردیفه", widthMm: 60, heightMm: 40, cols: 1, gapMm: 2 },
  { id: "100x50", label: "۱۰۰×۵۰ تک‌ردیفه", widthMm: 100, heightMm: 50, cols: 1, gapMm: 2 },
  { id: "30x20x3", label: "۳۰×۲۰ سه‌ردیفه", widthMm: 30, heightMm: 20, cols: 3, gapMm: 2 },
];

export const DEFAULT_LABEL_LAYOUT: PrintLayout = {
  mode: "label",
  cols: 1, rows: 1, copies: 1,
  labelWidthMm: 50, labelHeightMm: 30,
  showName: true, showPrice: true, showCode: true,
  gapMm: 2, offsetXMm: 0, offsetYMm: 0, boldness: 1,
};

const LAYOUT_KEY = "kamix_barcode_layout_v1";

/** ذخیره/بازیابی تنظیمات چاپ تا در چاپ تکی و گروهی یکسان باشد */
export function loadPrintLayout(): PrintLayout {
  if (typeof localStorage === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    return { ...DEFAULT_LAYOUT, ...(JSON.parse(raw) as PrintLayout) };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function savePrintLayout(l: PrintLayout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

const gapOf = (l: PrintLayout) => Math.max(0, Number(l.gapMm ?? 2));

function expandCopies(items: LabelItem[], copies: number): LabelItem[] {
  const out: LabelItem[] = [];
  for (const it of items) for (let i = 0; i < copies; i++) out.push(it);
  return out;
}

async function renderAllLabels(items: LabelItem[], layout: PrintLayout): Promise<string[]> {
  const opts: LabelOptions = {
    widthMm: layout.labelWidthMm,
    heightMm: layout.labelHeightMm,
    showName: layout.showName,
    showPrice: layout.showPrice,
    showCode: layout.showCode !== false,
    boldness: layout.boldness ?? 1,
  };
  // کش بر اساس کد: هر بارکد فقط یک‌بار رندر می‌شود حتی با چند کپی
  const cache = new Map<string, string>();
  const urls: string[] = [];
  for (const it of items) {
    let url = cache.get(it.code);
    if (!url) {
      url = await labelDataUrl(it, opts);
      cache.set(it.code, url);
    }
    urls.push(url);
  }
  return urls;
}

/** ساخت PDF لیبل‌ها (A4) با لیبل‌های تصویریِ باکیفیت */
export async function buildBarcodesPDF(
  items: LabelItem[],
  layout: PrintLayout = DEFAULT_LAYOUT,
): Promise<jsPDF> {
  const GAP_MM = gapOf(layout);
  if (layout.mode === "label") return buildLabelRollPDF(items, layout);
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const { cols, rows, labelWidthMm, labelHeightMm } = layout;

  const totalW = cols * labelWidthMm + (cols - 1) * GAP_MM;
  const totalH = rows * labelHeightMm + (rows - 1) * GAP_MM;
  const marginX = Math.max(4, (pageW - totalW) / 2);
  const marginY = Math.max(6, (pageH - totalH) / 2);

  const expanded = expandCopies(items, Math.max(1, layout.copies));
  const urls = await renderAllLabels(expanded, layout);

  const perPage = cols * rows;
  for (let i = 0; i < expanded.length; i++) {
    const idx = i % perPage;
    if (i > 0 && idx === 0) pdf.addPage();
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = marginX + col * (labelWidthMm + GAP_MM);
    const y = marginY + row * (labelHeightMm + GAP_MM);
    pdf.addImage(urls[i], "PNG", x, y, labelWidthMm, labelHeightMm);
  }
  return pdf;
}

/** ساخت صفحه HTML چاپ لیبل‌ها — برای چاپ مستقیم در وب و اپ اندروید */
export function buildLabelsPrintHTML(dataUrls: string[], layout: PrintLayout): string {
  const { labelWidthMm, labelHeightMm } = layout;
  const GAP_MM = gapOf(layout);
  if (layout.mode === "label") return buildLabelRollHTML(dataUrls, layout);
  const imgs = dataUrls
    .map((u) => `<img src="${u}" style="width:${labelWidthMm}mm;height:${labelHeightMm}mm;" />`)
    .join("");
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>چاپ بارکد</title>
<style>
  @page { size: A4; margin: 6mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; }
  .sheet { display: flex; flex-wrap: wrap; gap: ${GAP_MM}mm; align-content: flex-start; }
  img { display: block; break-inside: avoid; page-break-inside: avoid; border: 0.2mm dashed #ddd; }
  @media print { img { border: none; } }
</style>
</head>
<body><div class="sheet">${imgs}</div></body>
</html>`;
}

/** چاپ مستقیم لیبل‌ها (وب: iframe — اپ اندروید: پلاگین چاپ) */
export async function printBarcodeLabels(
  items: LabelItem[],
  layout: PrintLayout = DEFAULT_LAYOUT,
): Promise<boolean> {
  const expanded = expandCopies(items, Math.max(1, layout.copies));
  const urls = await renderAllLabels(expanded, layout);
  const html = buildLabelsPrintHTML(urls, layout);
  return printHtml(html, "بارکد محصولات");
}
