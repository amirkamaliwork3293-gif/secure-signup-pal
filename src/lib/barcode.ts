/**
 * barcode.ts — تولید کد یکتا + رندر لیبل حرفه‌ای بارکد
 *
 * لیبل‌ها به‌صورت تصویر (canvas) رندر می‌شوند تا نام فارسی محصول و قیمت
 * با کیفیت بالا و فونت درست، زیر بارکد چاپ شوند (jsPDF به‌تنهایی قادر به
 * رندر متن فارسی نیست). همان تصویر هم در PDF و هم در چاپ مستقیم استفاده
 * می‌شود تا خروجی همه مسیرها یکسان و تمیز باشد.
 *
 * چیدمان صفحه (ستون، ردیف، اندازه کاغذ) در barcode-layout.ts است.
 */
import bwipjs from "bwip-js/browser";
import { jsPDF } from "jspdf";
import { formatToman } from "@/lib/store";
import { printHtml } from "@/lib/print";
import {
  buildLabelsPrintHTML,
  cellPosition,
  DEFAULT_LAYOUT,
  expandCopies,
  gridMetrics,
  jsPdfSheetFormat,
  sanitizeLayout,
  type PrintLayout,
} from "@/lib/barcode-layout";

export { generateUniqueCode } from "@/lib/barcode-code";
export {
  buildLabelsPrintHTML,
  DEFAULT_LABEL_LAYOUT,
  DEFAULT_LAYOUT,
  LABEL_PRESETS,
  LAYOUT_LIMITS,
  loadPrintLayout,
  savePrintLayout,
  SHEET_PAPERS,
  sanitizeLayout,
  gridMetrics,
  layoutFitMessage,
  commitBoundedNumber,
  hasProductBarcode,
  type LabelPreset,
  type PrintLayout,
  type SheetPaper,
} from "@/lib/barcode-layout";

export type BarcodeFormat = "code128" | "ean13";

function ean13Checksum(d12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = d12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? n : n * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isEan13Text(text: string): boolean {
  if (/^\d{12}$/.test(text)) return true;
  if (!/^\d{13}$/.test(text)) return false;
  return text[12] === ean13Checksum(text.slice(0, 12));
}

async function drawBarcodeCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  opts: {
    bcid?: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    textsize?: number;
    paddingwidth?: number;
  },
) {
  const preferEan = opts.bcid === "ean13" || (!opts.bcid && isEan13Text(text));
  const common = {
    text,
    scale: opts.scale ?? 3,
    height: opts.height ?? 12,
    includetext: opts.includetext !== false,
    textxalign: "center" as const,
    textsize: opts.textsize ?? 8,
    paddingwidth: opts.paddingwidth ?? 0,
  };
  try {
    await bwipjs.toCanvas(canvas, { ...common, bcid: preferEan ? "ean13" : "code128" });
  } catch {
    await bwipjs.toCanvas(canvas, { ...common, bcid: "code128" });
  }
}

export async function renderBarcodeToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  opts: { format?: BarcodeFormat; scale?: number; height?: number; includetext?: boolean } = {},
) {
  const { format = "code128", scale = 3, height = 12, includetext = true } = opts;
  await drawBarcodeCanvas(canvas, text, {
    bcid: format === "ean13" ? "ean13" : "code128",
    scale,
    height,
    includetext,
  });
}

export async function barcodeDataUrl(
  text: string,
  opts?: Parameters<typeof renderBarcodeToCanvas>[2],
) {
  const c = document.createElement("canvas");
  await renderBarcodeToCanvas(c, text, opts);
  return c.toDataURL("image/png");
}

export type LabelItem = { code: string; name?: string; price?: number };

export type LabelOptions = {
  widthMm: number;
  heightMm: number;
  showName?: boolean;
  showPrice?: boolean;
  showCode?: boolean;
  boldness?: number;
};

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
  const {
    widthMm,
    heightMm,
    showName = true,
    showPrice = true,
    showCode = true,
    boldness = 1,
  } = opts;
  const W = Math.round(widthMm * PX_PER_MM);
  const H = Math.round(heightMm * PX_PER_MM);

  const canvas = target ?? document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

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

  const bc = document.createElement("canvas");
  await drawBarcodeCanvas(bc, item.code, {
    scale: Math.max(2, Math.round(4 * boldness)),
    height: 11,
    includetext: showCode,
    textsize: 9,
    paddingwidth: 2,
  });
  const maxBcW = W - pad * 2;
  const ratio = Math.min(maxBcW / bc.width, barcodeAreaH / Math.max(1, bc.height));
  const bw = Math.max(1, Math.floor(bc.width * ratio));
  const bh = Math.max(1, Math.floor(bc.height * ratio));
  ctx.imageSmoothingEnabled = bw < bc.width;
  ctx.drawImage(bc, Math.round((W - bw) / 2), pad + Math.round((barcodeAreaH - bh) / 2), bw, bh);

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

function labelCacheKey(item: LabelItem, layout: PrintLayout): string {
  return `${item.code}\0${item.name ?? ""}\0${item.price ?? ""}\0${layout.labelWidthMm}x${layout.labelHeightMm}\0${layout.showName}\0${layout.showPrice}\0${layout.showCode}\0${layout.boldness}`;
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
  const cache = new Map<string, string>();
  const urls: string[] = [];
  for (const it of items) {
    const key = labelCacheKey(it, layout);
    let url = cache.get(key);
    if (!url) {
      url = await labelDataUrl(it, opts);
      cache.set(key, url);
    }
    urls.push(url);
  }
  return urls;
}

/** ساخت PDF لیبل‌ها با همان شبکهٔ ستون×ردیف که در چاپ HTML استفاده می‌شود */
export async function buildBarcodesPDF(
  items: LabelItem[],
  layout: PrintLayout = DEFAULT_LAYOUT,
): Promise<jsPDF> {
  const s = sanitizeLayout(layout);
  const m = gridMetrics(s);
  const expanded = expandCopies(items, s.copies);
  const urls = await renderAllLabels(expanded, s);

  if (s.mode === "label") {
    const pdf = new jsPDF({
      unit: "mm",
      format: [m.pageW, m.pageH],
      orientation: m.pageW >= m.pageH ? "landscape" : "portrait",
    });
    placeImagesOnPdf(pdf, urls, m, true);
    return pdf;
  }

  const pdf = new jsPDF({
    unit: "mm",
    format: jsPdfSheetFormat(s),
    orientation: "portrait",
  });
  placeImagesOnPdf(pdf, urls, m, false);
  return pdf;
}

function placeImagesOnPdf(
  pdf: jsPDF,
  urls: string[],
  m: ReturnType<typeof gridMetrics>,
  customPage: boolean,
) {
  const perPage = Math.max(1, m.perPage);
  for (let i = 0; i < urls.length; i++) {
    const idx = i % perPage;
    if (i > 0 && idx === 0) {
      if (customPage) {
        pdf.addPage([m.pageW, m.pageH], m.pageW >= m.pageH ? "landscape" : "portrait");
      } else {
        pdf.addPage();
      }
    }
    const { x, y } = cellPosition(idx, m);
    pdf.addImage(urls[i], "PNG", x, y, m.labelW, m.labelH);
  }
}

/** چاپ مستقیم لیبل‌ها (وب: iframe — اپ اندروید: پلاگین چاپ) */
export async function printBarcodeLabels(
  items: LabelItem[],
  layout: PrintLayout = DEFAULT_LAYOUT,
): Promise<boolean> {
  const s = sanitizeLayout(layout);
  const expanded = expandCopies(items, s.copies);
  const urls = await renderAllLabels(expanded, s);
  const html = buildLabelsPrintHTML(urls, s);
  return printHtml(html, "بارکد محصولات");
}
