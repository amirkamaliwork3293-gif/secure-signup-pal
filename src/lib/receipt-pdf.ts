/**
 * receipt-pdf.ts — فیش به‌صورت PDF هم‌اندازهٔ خود فیش (برای مینی‌پرینترهای بلوتوثی)
 *
 * چرا؟ مینی‌پرینترهایی مثل فوممو M220 در پنجرهٔ چاپ اندروید دیده نمی‌شوند و فقط با
 * برنامهٔ خودشان (Print Master) چاپ می‌کنند. «ذخیره PDF» در پنجرهٔ چاپ اندروید هم
 * فقط کاغذهای استاندارد (A4 و…) دارد؛ فیش ۸ سانتی وسط برگهٔ A4 می‌نشست و در برنامهٔ
 * پرینتر بسیار ریز چاپ می‌شد.
 *
 * اینجا PDF مستقیماً با عرض «ناحیهٔ قابل چاپ» و ارتفاع واقعی فیش ساخته می‌شود:
 * یک صفحهٔ بلند، بدون حاشیهٔ اضافه، تا برنامهٔ پرینتر آن را تمام‌عرض روی رول چاپ کند.
 * محتوا همان فیش حرارتی (receipt.ts) است که با موتور خود مرورگر (فونت وزیرمتن، متن
 * راست‌به‌چپ درست) به تصویر سیاه‌وسفید با تراکم چاپگر حرارتی تبدیل می‌شود.
 *
 * فقط خواندنی است؛ هیچ داده یا تنظیمی را ذخیره یا تغییر نمی‌دهد.
 */

import { jsPDF } from "jspdf";
import { inlinePrintFonts, measureReceiptHeightPx } from "@/lib/print";

/** تراکم نقطهٔ چاپگرهای حرارتی رایج (۲۰۳dpi ≈ ۸ نقطه در میلی‌متر) */
const DOTS_PER_MM = 8;
const CSS_PX_PER_MM = 96 / 25.4;
/** سقف امن canvas در مرورگرهای موبایل */
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_SIDE = 30_000;
/** سقف ارتفاع یک صفحهٔ PDF (میلی‌متر) — فیش‌های بسیار بلند روی چند صفحه می‌روند */
const MAX_PAGE_MM = 5000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * عکس‌ها (لوگو) داخل SVG فقط به‌صورت data: نمایش داده می‌شوند. اگر دریافت لوگو
 * ممکن نبود حذف می‌شود تا ساخت فیش هرگز به‌خاطر لوگو شکست نخورد.
 */
async function inlineImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (src.startsWith("data:")) return;
      try {
        if (!src) throw new Error("empty src");
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = setTimeout(() => ctrl?.abort(), 6000);
        const res = await fetch(src, { signal: ctrl?.signal, mode: "cors" }).finally(() =>
          clearTimeout(timer),
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob.type.startsWith("image/")) throw new Error("not an image");
        img.setAttribute("src", await blobToDataUrl(blob));
      } catch (e) {
        console.warn("[receipt-pdf] logo skipped", e);
        img.remove();
      }
    }),
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error("image load timeout")), 10_000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("image load failed"));
    };
    img.src = src;
  });
}

/** خاکستری‌ها → سیاه یا سفید خالص (چاپ حرارتی تیز، بدون نقطه‌نقطه شدن متن) */
function toMonochrome(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    // پس‌زمینهٔ شفاف = سفید
    const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * a + 255 * (1 - a);
    const v = lum < 170 ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
}

/** HTML فیش → canvas سیاه‌وسفید با عرض کاغذ و ارتفاع واقعی فیش */
async function renderReceiptCanvas(
  receiptHtml: string,
): Promise<{ canvas: HTMLCanvasElement; widthMm: number; heightMm: number }> {
  if (typeof document === "undefined") throw new Error("no document");
  const paperMm = Number(receiptHtml.match(/data-kamix-receipt="([\d.]+)"/)?.[1]) || 80;

  const withFonts = await inlinePrintFonts(receiptHtml);
  const doc = new DOMParser().parseFromString(withFonts, "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  await inlineImages(doc);

  const heightPx = await measureReceiptHeightPx(
    `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
  );
  if (!heightPx) throw new Error("receipt measure failed");

  const widthPx = Math.ceil(paperMm * CSS_PX_PER_MM);
  // فیش‌های خیلی بلند: کیفیت کمی پایین می‌آید ولی canvas از سقف مرورگر رد نمی‌شود
  const scale = Math.min(
    DOTS_PER_MM / CSS_PX_PER_MM,
    Math.sqrt(MAX_CANVAS_PIXELS / (widthPx * heightPx)),
    MAX_CANVAS_SIDE / heightPx,
  );
  const cw = Math.max(1, Math.round(widthPx * scale));
  const ch = Math.max(1, Math.round(heightPx * scale));

  const xhtml = new XMLSerializer().serializeToString(doc.documentElement);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" ` +
    `viewBox="0 0 ${widthPx} ${heightPx}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  try {
    await img.decode?.();
  } catch {
    /* onload already fired — decode is best-effort */
  }

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas context");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  toMonochrome(ctx, cw, ch);
  return { canvas, widthMm: paperMm, heightMm: heightPx / CSS_PX_PER_MM };
}

/**
 * HTML فیش حرارتی (خروجی buildThermalInvoiceHTML) → PDF هم‌اندازهٔ فیش.
 * عرض صفحه = عرض کاغذِ داخل HTML، ارتفاع = طول واقعی فیش (معمولاً یک صفحه).
 * در صورت شکست خطا پرتاب می‌کند تا caller پیام مناسب نشان دهد.
 */
export async function buildReceiptPdf(receiptHtml: string): Promise<jsPDF> {
  const { canvas, widthMm, heightMm } = await renderReceiptCanvas(receiptHtml);
  const pxPerMm = canvas.height / heightMm;
  const pageCount = Math.max(1, Math.ceil(heightMm / MAX_PAGE_MM));
  const pageMm = heightMm / pageCount;

  let pdf: jsPDF | null = null;
  for (let i = 0; i < pageCount; i++) {
    const sy = Math.round(i * pageMm * pxPerMm);
    const sh = Math.min(canvas.height, Math.round((i + 1) * pageMm * pxPerMm)) - sy;
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = Math.max(1, sh);
    slice.getContext("2d")!.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
    const hMm = sh / pxPerMm;
    const format: [number, number] = [widthMm, hMm];
    const orientation = hMm >= widthMm ? "portrait" : "landscape";
    if (!pdf) pdf = new jsPDF({ unit: "mm", format, orientation, compress: true });
    else pdf.addPage(format, orientation);
    pdf.addImage(slice.toDataURL("image/png"), "PNG", 0, 0, widthMm, hMm, undefined, "FAST");
  }
  return pdf!;
}
