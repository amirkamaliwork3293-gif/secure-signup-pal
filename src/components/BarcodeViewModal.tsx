import { useEffect, useRef } from "react";
import { X, Download, Printer } from "lucide-react";
import {
  renderLabelToCanvas, downloadLabelPNG, buildBarcodesPDF, printBarcodeLabels,
} from "@/lib/barcode";
import { isNativeApp } from "@/lib/print";
import { formatToman, type Product } from "@/lib/store";

const VIEW_LABEL = { widthMm: 60, heightMm: 35, showName: true, showPrice: true } as const;

export function BarcodeViewModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const native = isNativeApp();

  useEffect(() => {
    if (!ref.current || !product.code) return;
    renderLabelToCanvas(
      { code: product.code, name: product.name, price: product.price },
      VIEW_LABEL,
      ref.current,
    ).catch(console.warn);
  }, [product.code, product.name, product.price]);

  const item = { code: product.code, name: product.name, price: product.price };

  const downloadPdf = async () => {
    const pdf = await buildBarcodesPDF([item], {
      cols: 1, rows: 1, copies: 1,
      labelWidthMm: VIEW_LABEL.widthMm, labelHeightMm: VIEW_LABEL.heightMm,
      showName: true, showPrice: true,
    });
    pdf.save(`${product.code}.pdf`);
  };

  const print = async () => {
    const ok = await printBarcodeLabels([item], {
      cols: 1, rows: 1, copies: 1,
      labelWidthMm: VIEW_LABEL.widthMm, labelHeightMm: VIEW_LABEL.heightMm,
      showName: true, showPrice: true,
    });
    if (!ok) alert("چاپ در این نسخه از اپلیکیشن در دسترس نیست — لطفاً نسخه جدید اپ را نصب کنید.");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold">{product.name}</h3>
            <div className="text-xs text-primary font-medium">{formatToman(product.price)}</div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-white p-3 text-center">
          {/* max-w-full + h-auto تا بارکد هرگز از کادر بیرون نزند */}
          <canvas ref={ref} className="mx-auto h-auto w-full max-w-full" />
        </div>
        <div className={`mt-3 grid gap-2 ${native ? "grid-cols-1" : "grid-cols-3"}`}>
          {!native && (
            <>
              <button onClick={() => downloadLabelPNG(item, VIEW_LABEL)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs">
                <Download className="h-3.5 w-3.5" /> PNG
              </button>
              <button onClick={downloadPdf} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs">
                <Download className="h-3.5 w-3.5" /> PDF
              </button>
            </>
          )}
          <button onClick={print} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
            <Printer className="h-3.5 w-3.5" /> چاپ
          </button>
        </div>
      </div>
    </div>
  );
}
