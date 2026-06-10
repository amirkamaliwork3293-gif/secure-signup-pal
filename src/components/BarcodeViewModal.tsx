import { useEffect, useRef } from "react";
import { X, Download } from "lucide-react";
import { renderBarcodeToCanvas, downloadBarcodePNG, buildBarcodesPDF } from "@/lib/barcode";
import type { Product } from "@/lib/store";

export function BarcodeViewModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || !product.code) return;
    renderBarcodeToCanvas(ref.current, product.code, { scale: 4, height: 18 }).catch(console.warn);
  }, [product.code]);

  const downloadPdf = async () => {
    const pdf = await buildBarcodesPDF([{ code: product.code, name: product.name, price: product.price }], {
      cols: 1, rows: 1, copies: 1, labelWidthMm: 80, labelHeightMm: 50, showName: true, showPrice: true,
    });
    pdf.save(`${product.code}.pdf`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">{product.name}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded-xl border border-border bg-white p-4 text-center">
          <canvas ref={ref} className="mx-auto" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => downloadBarcodePNG(product.code, `${product.code}.png`)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs">
            <Download className="h-3.5 w-3.5" /> PNG
          </button>
          <button onClick={downloadPdf} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
            <Download className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
      </div>
    </div>
  );
}
