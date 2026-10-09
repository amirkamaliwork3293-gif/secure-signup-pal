/**
 * receipt-image.ts — فیش به‌صورت عکس PNG (برای مینی‌پرینترهای بلوتوثی مثل فوممو)
 *
 * این پرینترها در پنجرهٔ چاپ اندروید/مرورگر دیده نمی‌شوند و فقط با برنامهٔ خودشان
 * (مثل Print Master) چاپ می‌کنند. پس همان فیش حرارتی (receipt.ts) با موتور خود
 * مرورگر به عکس سیاه‌وسفید تبدیل می‌شود تا کاربر آن را در برنامهٔ پرینتر باز کند.
 *
 * روش: HTML فیش داخل SVG/foreignObject روی canvas کشیده می‌شود — چیدمان و
 * فونت وزیرمتن دقیقاً مثل پیش‌نمایش و چاپ فیش است. فقط خواندنی است؛ هیچ داده یا
 * تنظیمی ذخیره یا تغییر نمی‌کند.
 */

import { inlinePrintFonts } from "@/lib/print";

/** تراکم نقطهٔ چاپگرهای حرارتی رایج (۲۰۳dpi ≈ ۸ نقطه در میلی‌متر) */
const DOTS_PER_MM = 8;
const CSS_PX_PER_MM = 96 / 25.4;
/** سقف امن مساحت canvas در مرورگرهای موبایل */
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_SIDE = 30_000;

async function waitForFonts(doc: Document | null | undefined, timeoutMs: number): Promise<void> {
  try {
    const ready = (doc as Document & { fonts?: { ready?: Promise<unknown> } })?.fonts?.ready;
    if (!ready) return;
    await Promise.race([ready, new Promise((r) => setTimeout(r, timeoutMs))]);
  } catch {
    /* ignore */
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * عکس‌ها (لوگو) داخل SVG بارگذاری نمی‌شوند مگر data: باشند. اگر دریافت ممکن
 * نبود، عکس حذف می‌شود تا ساخت فیش هرگز به‌خاطر لوگو شکست نخورد.
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
        console.warn("[receipt-image] logo skipped", e);
        img.remove();
      }
    }),
  );
}

/** ارتفاع واقعی محتوای فیش (پیکسل CSS) در قابی پنهان با عرض کاغذ */
function measureReceiptHeight(html: string, paperMm: number): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const frame = document.createElement("iframe");
    const finish = (h: number) => {
      if (done) return;
      done = true;
      try {
        document.body.removeChild(frame);
      } catch {
        /* ignore */
      }
      resolve(h);
    };
    frame.setAttribute("title", "receipt-image-measure");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: `${paperMm}mm`,
      height: "100px",
      border: "0",
      visibility: "hidden",
    });
    frame.onload = () => {
      // Chrome پیش از srcdoc یک load برای about:blank هم می‌فرستد — آن را نادیده بگیر
      if (!frame.contentDocument?.querySelector(".r")) return;
      void waitForFonts(frame.contentDocument, 2500).then(() => {
        try {
          const box = frame.contentDocument?.querySelector(".r");
          finish(box ? Math.ceil(box.getBoundingClientRect().bottom) : 0);
        } catch {
          finish(0);
        }
      });
    };
    document.body.appendChild(frame);
    frame.srcdoc = html;
    setTimeout(() => finish(0), 6000);
  });
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

/**
 * HTML فیش حرارتی (خروجی buildThermalInvoiceHTML) → data-URL عکس PNG سیاه‌وسفید.
 * عرض عکس = عرض کاغذ (حاشیه‌ها همان تنظیمات فیش)، ارتفاع = طول واقعی فیش.
 * در صورت شکست خطا پرتاب می‌کند تا caller پیام مناسب نشان دهد.
 */
export async function buildReceiptImageDataUrl(receiptHtml: string): Promise<string> {
  if (typeof document === "undefined") throw new Error("no document");
  const paperMm = Number(receiptHtml.match(/data-kamix-receipt="([\d.]+)"/)?.[1]) || 80;

  const withFonts = await inlinePrintFonts(receiptHtml);
  const doc = new DOMParser().parseFromString(withFonts, "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  await inlineImages(doc);

  const html = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  const heightPx = await measureReceiptHeight(html, paperMm);
  if (!heightPx) throw new Error("receipt measure failed");

  const widthPx = Math.ceil(paperMm * CSS_PX_PER_MM);
  let scale = DOTS_PER_MM / CSS_PX_PER_MM;
  // فیش‌های خیلی بلند: کیفیت کمی پایین می‌آید ولی canvas از سقف مرورگر رد نمی‌شود
  const maxScaleByArea = Math.sqrt(MAX_CANVAS_PIXELS / (widthPx * heightPx));
  const maxScaleBySide = MAX_CANVAS_SIDE / heightPx;
  scale = Math.min(scale, maxScaleByArea, maxScaleBySide);
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
  return canvas.toDataURL("image/png");
}
