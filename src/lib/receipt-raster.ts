/**
 * receipt-raster.ts — فیش (HTML حرارتی receipt.ts) → تصویر سیاه‌وسفید با عرض دقیق هد چاپگر
 *
 * برای چاپ مستقیم روی چاپگر حرارتی (phomemo.ts). HTML فیش داخل SVG/foreignObject
 * روی canvas کشیده می‌شود تا چیدمان و فونت وزیرمتن دقیقاً مثل پیش‌نمایش فیش باشد.
 * فقط خواندنی است؛ هیچ داده یا تنظیمی را تغییر نمی‌دهد.
 */

import { inlinePrintFonts, measureReceiptHeightPx } from "@/lib/print";

const CSS_PX_PER_MM = 96 / 25.4;

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

/**
 * لوگوی غیر data: داخل SVG نمایش داده نمی‌شود؛ تبدیل یا (در صورت شکست) حذف می‌شود
 * تا فیش هرگز به‌خاطر لوگو چاپ نشود.
 */
async function inlineImages(doc: Document): Promise<void> {
  await Promise.all(
    Array.from(doc.querySelectorAll("img")).map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (src.startsWith("data:")) return;
      try {
        const res = await fetch(src, { mode: "cors" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob.type.startsWith("image/")) throw new Error("not an image");
        const url = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ""));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
        img.setAttribute("src", url);
      } catch {
        img.remove();
      }
    }),
  );
}

/**
 * HTML فیش → canvas با عرض دقیق widthDots نقطه (مثلاً ۵۷۶ = ۷۲ میلی‌متر در ۲۰۳dpi).
 * عرض کاغذِ داخل HTML باید همان عرض چاپ باشد تا مقیاس ۱:۱ بماند.
 */
export async function renderReceiptCanvas(
  receiptHtml: string,
  widthDots: number,
): Promise<HTMLCanvasElement> {
  if (typeof document === "undefined") throw new Error("no document");
  const paperMm = Number(receiptHtml.match(/data-kamix-receipt="([\d.]+)"/)?.[1]) || 72;
  const doc = new DOMParser().parseFromString(await inlinePrintFonts(receiptHtml), "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  await inlineImages(doc);

  const heightPx = await measureReceiptHeightPx(
    `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
  );
  if (!heightPx) throw new Error("receipt measure failed");
  const widthPx = paperMm * CSS_PX_PER_MM;
  const scale = widthDots / widthPx;
  const cw = widthDots;
  const ch = Math.max(1, Math.round(heightPx * scale));
  if (ch > 0xffff) throw new Error("receipt too long");

  const xhtml = new XMLSerializer().serializeToString(doc.documentElement);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" ` +
    `viewBox="0 0 ${widthPx} ${heightPx}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  try {
    await img.decode?.();
  } catch {
    /* onload already fired */
  }

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas context");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  return canvas;
}
