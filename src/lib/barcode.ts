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

const CODE_FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Roboto Mono', monospace";

/**
 * رندر یک لیبل کامل روی canvas (یا canvas جدید).
 * چیدمان: میله‌های بارکد بالا، کد خوانا، نام فارسی، قیمت.
 *
 * میله‌ها با «عرض صحیح هر ماژول» (بزرگ‌ترین مضرب صحیحی که جا شود) و بدون نرم‌کردن کشیده
 * می‌شوند تا لبه‌ها سیاه‌وسفید خالص بمانند — خاکستری لبه‌ها روی چاپگر حرارتی
 * میله‌ها را پهن/باریک و بارکد را ناخوانا می‌کرد. دو طرف حاشیهٔ سفید (منطقهٔ آرام)
 * لازم برای اسکنر می‌ماند و کد زیر میله‌ها با قلم درشت‌تر نوشته می‌شود.
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

  // منطقهٔ آرام: دست‌کم ۲ میلی‌متر دو طرف، بالا/پایین دست‌کم ۱ میلی‌متر
  const padX = Math.max(Math.round(2 * PX_PER_MM), Math.round(W * 0.04));
  const padY = Math.max(Math.round(1 * PX_PER_MM), Math.round(H * 0.04));
  const hasName = showName && !!item.name;
  const hasPrice = showPrice && typeof item.price === "number";

  let codeFontPx = showCode ? Math.max(12, Math.round(H * 0.1)) : 0;
  let nameFontPx = hasName ? Math.max(12, Math.round(H * 0.115)) : 0;
  let priceFontPx = hasPrice ? Math.max(13, Math.round(H * 0.13)) : 0;
  const lineGap = Math.round(H * 0.02);
  const textH = () =>
    (showCode ? codeFontPx + lineGap : 0) +
    (hasName ? nameFontPx + lineGap : 0) +
    (hasPrice ? priceFontPx + lineGap : 0);
  // میله‌ها دست‌کم ۴۰٪ ارتفاع لیبل — در لیبل‌های کوتاه نوشته‌ها کمی کوچک می‌شوند
  const minBarH = Math.round(H * 0.4);
  if (textH() > 0 && H - padY * 2 - textH() < minBarH) {
    const k = Math.max(0.5, (H - padY * 2 - minBarH) / textH());
    codeFontPx = showCode ? Math.max(10, Math.round(codeFontPx * k)) : 0;
    nameFontPx = hasName ? Math.max(10, Math.round(nameFontPx * k)) : 0;
    priceFontPx = hasPrice ? Math.max(10, Math.round(priceFontPx * k)) : 0;
  }
  const barH = Math.max(1, H - padY * 2 - textH());
  const maxBarW = W - padX * 2;

  // بارکد با ۱ پیکسل در هر ماژول، بعد بزرگ‌نمایی با ضریب صحیح
  const bc = document.createElement("canvas");
  await drawBarcodeCanvas(bc, item.code, {
    scale: 1,
    height: 2,
    includetext: false,
    paddingwidth: 0,
  });
  const fit = maxBarW / Math.max(1, bc.width);
  // پررنگی کمتر از ۱ = بارکد کمی باریک‌تر (برای چاپگرهای پرحرارت)
  const moduleK = Math.floor(fit * Math.min(1, boldness));
  const barY = padY;
  if (moduleK >= 1) {
    const bw = bc.width * moduleK;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bc, 0, 0, bc.width, 1, Math.round((W - bw) / 2), barY, bw, barH);
  } else {
    // کد خیلی بلند برای این عرض: کوچک‌نمایی (مثل قبل)
    const bw = Math.max(1, Math.floor(bc.width * fit));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bc, 0, 0, bc.width, 1, Math.round((W - bw) / 2), barY, bw, barH);
  }
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  let y = barY + barH;
  if (showCode) {
    y += lineGap + codeFontPx;
    ctx.direction = "ltr";
    ctx.font = `600 ${codeFontPx}px ${CODE_FONT}`;
    ctx.fillText(fitText(ctx, item.code, W - padX), W / 2, y - Math.round(codeFontPx * 0.12));
  }
  ctx.direction = "rtl";
  if (hasName) {
    y += lineGap + nameFontPx;
    ctx.font = `600 ${nameFontPx}px ${LABEL_FONT}`;
    ctx.fillText(fitText(ctx, item.name!, W - padX), W / 2, y - Math.round(nameFontPx * 0.12));
  }
  if (hasPrice) {
    y += lineGap + priceFontPx;
    ctx.font = `700 ${priceFontPx}px ${LABEL_FONT}`;
    ctx.fillText(formatToman(item.price!), W / 2, y - Math.round(priceFontPx * 0.12));
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
