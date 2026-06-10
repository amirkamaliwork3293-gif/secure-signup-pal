import { useState } from "react";
import { X, Printer, Download } from "lucide-react";
import { buildBarcodesPDF, DEFAULT_LAYOUT, type PrintLayout } from "@/lib/barcode";
import type { Product } from "@/lib/store";

export function BarcodePrintModal({ items, onClose }: { items: Product[]; onClose: () => void }) {
  const [layout, setLayout] = useState<PrintLayout>(DEFAULT_LAYOUT);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    const valid = items.filter((p) => p.code);
    if (valid.length === 0) { alert("هیچ یک از محصولات بارکد ندارد. ابتدا بارکد تولید کنید."); return null; }
    setBusy(true);
    try {
      return await buildBarcodesPDF(
        valid.map((p) => ({ code: p.code, name: p.name, price: p.price })),
        layout,
      );
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    const pdf = await generate();
    if (pdf) pdf.save("بارکدها.pdf");
  };

  const print = async () => {
    const pdf = await generate();
    if (pdf) {
      pdf.autoPrint();
      const url = pdf.output("bloburl");
      window.open(url, "_blank");
    }
  };

  const set = <K extends keyof PrintLayout>(k: K, v: PrintLayout[K]) => setLayout((p) => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">چاپ بارکد ({items.length.toLocaleString("fa-IR")} محصول)</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="تعداد ستون">
              <input type="number" min={1} max={6} value={layout.cols} onChange={(e) => set("cols", Math.max(1, Number(e.target.value)))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
            <Field label="تعداد ردیف">
              <input type="number" min={1} max={20} value={layout.rows} onChange={(e) => set("rows", Math.max(1, Number(e.target.value)))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
            <Field label="تعداد تکرار هر بارکد">
              <input type="number" min={1} max={50} value={layout.copies} onChange={(e) => set("copies", Math.max(1, Number(e.target.value)))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
            <Field label="عرض لیبل (mm)">
              <input type="number" min={20} max={210} value={layout.labelWidthMm} onChange={(e) => set("labelWidthMm", Number(e.target.value))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
            <Field label="ارتفاع لیبل (mm)">
              <input type="number" min={15} max={120} value={layout.labelHeightMm} onChange={(e) => set("labelHeightMm", Number(e.target.value))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
          </div>

          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!layout.showName} onChange={(e) => set("showName", e.target.checked)} />
              نمایش نام
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!layout.showPrice} onChange={(e) => set("showPrice", e.target.checked)} />
              نمایش قیمت
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={download} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm disabled:opacity-50">
              <Download className="h-4 w-4" /> PDF
            </button>
            <button onClick={print} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              <Printer className="h-4 w-4" /> چاپ
            </button>
          </div>
          {busy && <p className="text-center text-xs text-muted-foreground">در حال تولید بارکدها...</p>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
