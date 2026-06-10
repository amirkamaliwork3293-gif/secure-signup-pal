// Barcode utilities: unique generation + PNG/PDF rendering for print.
import bwipjs from "bwip-js/browser";
import { jsPDF } from "jspdf";
import { products } from "@/lib/store";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateUniqueCode(existing?: Set<string>): string {
  const taken = existing ?? new Set(products.getAll().map((p) => p.code).filter(Boolean));
  for (let i = 0; i < 50; i++) {
    let code = "P";
    for (let j = 0; j < 9; j++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  return "P" + Date.now().toString(36).toUpperCase();
}

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

export async function downloadBarcodePNG(text: string, filename = `${text}.png`) {
  const url = await barcodeDataUrl(text);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
}

export type PrintLayout = {
  cols: number;
  rows: number;
  copies: number;
  labelWidthMm: number;
  labelHeightMm: number;
  showName?: boolean;
  showPrice?: boolean;
};

export const DEFAULT_LAYOUT: PrintLayout = {
  cols: 3, rows: 8, copies: 1,
  labelWidthMm: 60, labelHeightMm: 30,
  showName: true, showPrice: true,
};

export async function buildBarcodesPDF(
  items: { code: string; name?: string; price?: number }[],
  layout: PrintLayout = DEFAULT_LAYOUT,
): Promise<jsPDF> {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const { cols, rows, copies, labelWidthMm, labelHeightMm } = layout;
  const totalW = cols * labelWidthMm;
  const totalH = rows * labelHeightMm;
  const marginX = Math.max(2, (pageW - totalW) / 2);
  const marginY = Math.max(2, (pageH - totalH) / 2);

  const expanded: typeof items = [];
  for (const it of items) for (let i = 0; i < copies; i++) expanded.push(it);

  const perPage = cols * rows;
  for (let i = 0; i < expanded.length; i++) {
    const idx = i % perPage;
    if (i > 0 && idx === 0) pdf.addPage();
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = marginX + col * labelWidthMm;
    const y = marginY + row * labelHeightMm;
    const it = expanded[i];

    try {
      const dataUrl = await barcodeDataUrl(it.code, { scale: 3, height: 10, includetext: true });
      const imgH = labelHeightMm - (layout.showName ? 6 : 0) - (layout.showPrice ? 5 : 0) - 2;
      pdf.addImage(dataUrl, "PNG", x + 2, y + 2, labelWidthMm - 4, Math.max(8, imgH));
      let textY = y + 2 + Math.max(8, imgH) + 3;
      if (layout.showName && it.name) {
        pdf.setFontSize(8);
        pdf.text(String(it.name).slice(0, 28), x + labelWidthMm / 2, textY, { align: "center" });
        textY += 4;
      }
      if (layout.showPrice && typeof it.price === "number") {
        pdf.setFontSize(9);
        pdf.text(new Intl.NumberFormat("en").format(it.price), x + labelWidthMm / 2, textY, { align: "center" });
      }
    } catch (e) {
      console.warn("barcode render failed for", it.code, e);
    }
  }
  return pdf;
}
