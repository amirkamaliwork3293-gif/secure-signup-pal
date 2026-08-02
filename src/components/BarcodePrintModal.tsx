import { useEffect, useRef, useState } from "react";
import { X, Printer, Download, FileText, Tag } from "lucide-react";
import {
  buildBarcodesPDF, printBarcodeLabels, renderLabelToCanvas,
  DEFAULT_LAYOUT, DEFAULT_LABEL_LAYOUT, LABEL_PRESETS,
  loadPrintLayout, savePrintLayout,
  type PrintLayout, type LabelItem,
} from "@/lib/barcode";
import { savePdf, OLD_APP_MESSAGE } from "@/lib/print";
import { formatNumber, type Product } from "@/lib/store";

export function BarcodePrintModal({ items, onClose }: { items: Product[]; onClose: () => void }) {
  const [layout, setLayout] = useState<PrintLayout>(() => loadPrintLayout());
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const isLabel = layout.mode === "label";

  const validItems: LabelItem[] = items
    .filter((p) => p.code)
    .map((p) => ({ code: p.code, name: p.name, price: p.price }));

  // پیش‌نمایش زنده اولین لیبل با تنظیمات فعلی
  useEffect(() => {
    if (!previewRef.current || validItems.length === 0) return;
    renderLabelToCanvas(validItems[0], {
      widthMm: layout.labelWidthMm,
      heightMm: layout.labelHeightMm,
      showName: layout.showName,
      showPrice: layout.showPrice,
      showCode: layout.showCode !== false,
      boldness: layout.boldness ?? 1,
    }, previewRef.current).catch(console.warn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, items]);

  useEffect(() => { savePrintLayout(layout); }, [layout]);

  const guard = (): boolean => {
    if (validItems.length === 0) {
      alert("هیچ یک از محصولات بارکد ندارد. ابتدا بارکد تولید کنید.");
      return false;
    }
    return true;
  };

  const download = async () => {
    if (!guard()) return;
    setBusy(true);
    try {
      const pdf = await buildBarcodesPDF(validItems, layout);
      const ok = await savePdf(pdf, "barcodes.pdf");
      if (!ok) alert(OLD_APP_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  const print = async () => {
    if (!guard()) return;
    setBusy(true);
    try {
      const ok = await printBarcodeLabels(validItems, layout);
      if (!ok) alert(OLD_APP_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof PrintLayout>(k: K, v: PrintLayout[K]) => setLayout((p) => ({ ...p, [k]: v }));

  const setMode = (mode: "a4" | "label") =>
    setLayout((p) => ({
      ...(mode === "label" ? DEFAULT_LABEL_LAYOUT : DEFAULT_LAYOUT),
      copies: p.copies,
      showName: p.showName,
      showPrice: p.showPrice,
      showCode: p.showCode,
      mode,
    }));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">چاپ بارکد ({formatNumber(items.length)} محصول)</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {/* انتخاب نوع چاپگر */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("a4")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${!isLabel ? "bg-primary text-primary-foreground shadow-sm" : "border border-border bg-background text-muted-foreground"}`}
            >
              <FileText className="h-3.5 w-3.5" /> برگه A4
            </button>
            <button
              type="button"
              onClick={() => setMode("label")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${isLabel ? "bg-primary text-primary-foreground shadow-sm" : "border border-border bg-background text-muted-foreground"}`}
            >
              <Tag className="h-3.5 w-3.5" /> پرینتر لیبل‌زن
            </button>
          </div>
          {isLabel && (
            <p className="rounded-xl bg-primary/5 p-2 text-[11px] leading-5 text-muted-foreground">
              مناسب لیبل‌زن‌های حرارتی (مثل Remo P600N). اندازه‌ی صفحه دقیقاً برابر اندازه‌ی برچسب تنظیم می‌شود؛
              در پنجره‌ی چاپ حتماً «مقیاس» را روی ۱۰۰٪ و حاشیه را روی «هیچ» بگذارید.
            </p>
          )}

          {/* پیش‌نمایش لیبل */}
          {validItems.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-dashed border-border bg-white p-2 text-center">
              <canvas ref={previewRef} className="mx-auto h-auto max-h-36 w-auto max-w-full" />
              <div className="mt-1 text-[10px] text-muted-foreground">پیش‌نمایش لیبل</div>
            </div>
          )}

          {isLabel && (
            <Field label="اندازه برچسب (پیش‌تنظیم)">
              <select
                value={LABEL_PRESETS.find((p) => p.widthMm === layout.labelWidthMm && p.heightMm === layout.labelHeightMm && p.cols === layout.cols)?.id ?? ""}
                onChange={(e) => {
                  const p = LABEL_PRESETS.find((x) => x.id === e.target.value);
                  if (!p) return;
                  setLayout((prev) => ({ ...prev, labelWidthMm: p.widthMm, labelHeightMm: p.heightMm, cols: p.cols, gapMm: p.gapMm, rows: 1 }));
                }}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="">سفارشی</option>
                {LABEL_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label={isLabel ? "تعداد برچسب در هر ردیف رول" : "تعداد ستون"}>
              <input type="number" min={1} max={6} value={layout.cols} onChange={(e) => set("cols", Math.max(1, Number(e.target.value)))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
            {!isLabel && (
              <Field label="تعداد ردیف">
                <input type="number" min={1} max={20} value={layout.rows} onChange={(e) => set("rows", Math.max(1, Number(e.target.value)))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
              </Field>
            )}
            <Field label="تعداد تکرار هر بارکد">
              <input type="number" min={1} max={50} value={layout.copies} onChange={(e) => set("copies", Math.max(1, Number(e.target.value)))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
            <Field label="عرض لیبل (mm)">
              <input type="number" min={15} max={210} value={layout.labelWidthMm} onChange={(e) => set("labelWidthMm", Number(e.target.value))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
            <Field label="ارتفاع لیبل (mm)">
              <input type="number" min={10} max={120} value={layout.labelHeightMm} onChange={(e) => set("labelHeightMm", Number(e.target.value))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
            <Field label="فاصله بین برچسب‌ها (mm)">
              <input type="number" min={0} max={20} step={0.5} value={layout.gapMm ?? 2} onChange={(e) => set("gapMm", Number(e.target.value))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
            {isLabel && (
              <>
                <Field label="کالیبراسیون افقی (mm)">
                  <input type="number" step={0.5} min={-10} max={10} value={layout.offsetXMm ?? 0} onChange={(e) => set("offsetXMm", Number(e.target.value))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                </Field>
                <Field label="کالیبراسیون عمودی (mm)">
                  <input type="number" step={0.5} min={-10} max={10} value={layout.offsetYMm ?? 0} onChange={(e) => set("offsetYMm", Number(e.target.value))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                </Field>
                <Field label="پررنگی میله‌ها">
                  <select value={String(layout.boldness ?? 1)} onChange={(e) => set("boldness", Number(e.target.value))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                    <option value="0.75">کم</option>
                    <option value="1">عادی</option>
                    <option value="1.5">زیاد</option>
                  </select>
                </Field>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!layout.showName} onChange={(e) => set("showName", e.target.checked)} />
              نمایش نام
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!layout.showPrice} onChange={(e) => set("showPrice", e.target.checked)} />
              نمایش قیمت
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={layout.showCode !== false} onChange={(e) => set("showCode", e.target.checked)} />
              نمایش کد زیر بارکد
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
