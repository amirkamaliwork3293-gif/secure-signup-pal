import { useEffect, useMemo, useRef, useState } from "react";
import { X, Printer, Download, FileText, Tag, Barcode, AlertTriangle } from "lucide-react";
import {
  buildBarcodesPDF,
  printBarcodeLabels,
  renderLabelToCanvas,
  DEFAULT_LAYOUT,
  DEFAULT_LABEL_LAYOUT,
  LABEL_PRESETS,
  LAYOUT_LIMITS,
  SHEET_PAPERS,
  loadPrintLayout,
  savePrintLayout,
  sanitizeLayout,
  gridMetrics,
  layoutFitMessage,
  commitBoundedNumber,
  hasProductBarcode,
  type PrintLayout,
  type LabelItem,
  type SheetPaper,
} from "@/lib/barcode";
import { generateUniqueCode } from "@/lib/barcode-code";
import { savePdf, OLD_APP_MESSAGE } from "@/lib/print";
import { formatNumber, products, type Product } from "@/lib/store";
import { requireOnlineWrite } from "@/lib/online-status";

export function BarcodePrintModal({ items, onClose }: { items: Product[]; onClose: () => void }) {
  const [layout, setLayout] = useState<PrintLayout>(() => sanitizeLayout(loadPrintLayout()));
  const [busy, setBusy] = useState(false);
  const [localItems, setLocalItems] = useState<Product[]>(items);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const isLabel = layout.mode === "label";
  const metrics = useMemo(() => gridMetrics(layout), [layout]);
  const fitMsg = layoutFitMessage(metrics);

  const missing = localItems.filter((p) => !hasProductBarcode(p.code));
  const ready = localItems.filter((p) => hasProductBarcode(p.code));
  const validItems: LabelItem[] = ready.map((p) => ({
    code: p.code.trim(),
    name: p.name,
    price: p.price,
  }));

  const preview = validItems[0];
  const previewCode = preview?.code;
  const previewName = preview?.name;
  const previewPrice = preview?.price;
  useEffect(() => {
    if (!previewRef.current || !previewCode) return;
    renderLabelToCanvas(
      { code: previewCode, name: previewName, price: previewPrice },
      {
        widthMm: layout.labelWidthMm,
        heightMm: layout.labelHeightMm,
        showName: layout.showName,
        showPrice: layout.showPrice,
        showCode: layout.showCode !== false,
        boldness: layout.boldness ?? 1,
      },
      previewRef.current,
    ).catch(console.warn);
  }, [
    previewCode,
    previewName,
    previewPrice,
    layout.labelWidthMm,
    layout.labelHeightMm,
    layout.showName,
    layout.showPrice,
    layout.showCode,
    layout.boldness,
  ]);

  useEffect(() => {
    savePrintLayout(layout);
  }, [layout]);

  const generateMissing = () => {
    if (missing.length === 0) return;
    if (!requireOnlineWrite()) return;
    const taken = new Set(
      products
        .getAll()
        .map((p) => p.code)
        .filter(Boolean),
    );
    const generated = new Map<string, string>();
    const next = localItems.map((p) => {
      if (hasProductBarcode(p.code)) return p;
      const code = generateUniqueCode(taken);
      generated.set(p.id, code);
      return { ...p, code };
    });
    const all = products.getAll();
    products.save(all.map((p) => (generated.has(p.id) ? { ...p, code: generated.get(p.id)! } : p)));
    setLocalItems(next);
  };

  const guard = (): boolean => {
    if (validItems.length === 0) {
      alert("هیچ یک از محصولات بارکد ندارد. ابتدا «ساخت بارکد» را بزنید.");
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
    } catch (e) {
      console.warn("[barcode] pdf failed", e);
      alert("ساخت PDF بارکد انجام نشد. اندازه لیبل و کد بارکد را بررسی کنید.");
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
    } catch (e) {
      console.warn("[barcode] print failed", e);
      alert(
        "چاپ بارکد انجام نشد. اندازه کاغذ را در پنجره چاپ روی همان مقدار تنظیم‌شده بگذارید و مقیاس را ۱۰۰٪ کنید.",
      );
    } finally {
      setBusy(false);
    }
  };

  const patch = (partial: Partial<PrintLayout>) =>
    setLayout((p) => sanitizeLayout({ ...p, ...partial }));

  const setMode = (mode: "a4" | "label") =>
    setLayout((p) =>
      sanitizeLayout({
        ...(mode === "label" ? DEFAULT_LABEL_LAYOUT : DEFAULT_LAYOUT),
        copies: p.copies,
        showName: p.showName,
        showPrice: p.showPrice,
        showCode: p.showCode,
        boldness: p.boldness,
        mode,
      }),
    );

  const totalLabels = validItems.length * Math.max(1, layout.copies);
  const pages = Math.max(1, Math.ceil(totalLabels / Math.max(1, metrics.perPage)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-bold">چاپ بارکد محصولات</h3>
            <p className="text-[11px] text-muted-foreground">
              {formatNumber(ready.length)} از {formatNumber(localItems.length)} محصول آماده چاپ
              {layout.copies > 1 ? ` · ${formatNumber(totalLabels)} لیبل` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-secondary"
            aria-label="بستن"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {missing.length > 0 && (
            <div className="rounded-xl border border-amber-300/80 bg-amber-50 p-3 text-amber-950">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold leading-5">
                    {missing.length === localItems.length
                      ? "هیچ‌کدام از محصولات انتخاب‌شده بارکد ندارند."
                      : `${formatNumber(missing.length)} محصول بارکد ندارد و در چاپ نمی‌آید.`}
                  </p>
                  <ul className="mt-1 max-h-20 overflow-y-auto text-[11px] leading-5">
                    {missing.slice(0, 8).map((p) => (
                      <li key={p.id} className="truncate">
                        {p.name || "بدون نام"}
                      </li>
                    ))}
                    {missing.length > 8 && <li>و {formatNumber(missing.length - 8)} مورد دیگر</li>}
                  </ul>
                  <button
                    type="button"
                    onClick={generateMissing}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-[11px] font-medium text-white"
                  >
                    <Barcode className="h-3.5 w-3.5" />
                    ساخت بارکد برای این محصولات
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("a4")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${!isLabel ? "bg-primary text-primary-foreground shadow-sm" : "border border-border bg-background text-muted-foreground"}`}
            >
              <FileText className="h-3.5 w-3.5" /> چاپ روی برگه
            </button>
            <button
              type="button"
              onClick={() => setMode("label")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${isLabel ? "bg-primary text-primary-foreground shadow-sm" : "border border-border bg-background text-muted-foreground"}`}
            >
              <Tag className="h-3.5 w-3.5" /> پرینتر لیبل‌زن
            </button>
          </div>

          {isLabel ? (
            <p className="rounded-xl bg-primary/5 p-2 text-[11px] leading-5 text-muted-foreground">
              اندازه صفحه چاپ دقیقاً برابر {formatNumber(metrics.pageW)}×
              {formatNumber(metrics.pageH)} میلی‌متر می‌شود ({formatNumber(layout.cols)} ستون ×{" "}
              {formatNumber(layout.rows)} ردیف). در پنجره چاپ مقیاس را ۱۰۰٪، حاشیه را هیچ، و اندازه
              کاغذ را همین مقدار بگذارید. برای رول حرارتی معمولاً ردیف را ۱ بگذارید.
            </p>
          ) : (
            <p className="rounded-xl bg-primary/5 p-2 text-[11px] leading-5 text-muted-foreground">
              هر صفحه دقیقاً {formatNumber(layout.cols)} ستون و {formatNumber(layout.rows)} ردیف چاپ
              می‌شود ({formatNumber(metrics.perPage)} لیبل در صفحه). اندازه لیبل را خودتان به
              میلی‌متر تعیین کنید.
            </p>
          )}

          {validItems.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-dashed border-border bg-white p-2 text-center">
              <canvas ref={previewRef} className="mx-auto h-auto max-h-36 w-auto max-w-full" />
              <div className="mt-1 text-[10px] text-muted-foreground">پیش‌نمایش یک لیبل</div>
            </div>
          )}

          <GridSchematic
            cols={layout.cols}
            rows={layout.rows}
            pages={pages}
            perPage={metrics.perPage}
          />

          {!isLabel && (
            <Field label="اندازه کاغذ">
              <select
                value={layout.paper ?? "A4"}
                onChange={(e) => patch({ paper: e.target.value as SheetPaper })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                {SHEET_PAPERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {isLabel && (
            <Field label="اندازه برچسب (پیش‌تنظیم)">
              <select
                value={
                  LABEL_PRESETS.find(
                    (p) =>
                      p.widthMm === layout.labelWidthMm &&
                      p.heightMm === layout.labelHeightMm &&
                      p.cols === layout.cols &&
                      (p.rows ?? 1) === layout.rows,
                  )?.id ?? ""
                }
                onChange={(e) => {
                  const p = LABEL_PRESETS.find((x) => x.id === e.target.value);
                  if (!p) return;
                  patch({
                    labelWidthMm: p.widthMm,
                    labelHeightMm: p.heightMm,
                    cols: p.cols,
                    rows: p.rows ?? 1,
                    gapMm: p.gapMm,
                  });
                }}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="">سفارشی</option>
                {LABEL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label={isLabel ? "تعداد ستون در هر ردیف رول" : "تعداد ستون"}>
              <LayoutNumber
                value={layout.cols}
                min={LAYOUT_LIMITS.cols.min}
                max={LAYOUT_LIMITS.cols.max}
                integer
                onCommit={(n) => patch({ cols: n })}
              />
            </Field>
            <Field label={isLabel ? "تعداد ردیف در هر برش" : "تعداد ردیف"}>
              <LayoutNumber
                value={layout.rows}
                min={LAYOUT_LIMITS.rows.min}
                max={LAYOUT_LIMITS.rows.max}
                integer
                onCommit={(n) => patch({ rows: n })}
              />
            </Field>
            <Field label="تعداد تکرار هر بارکد">
              <LayoutNumber
                value={layout.copies}
                min={LAYOUT_LIMITS.copies.min}
                max={LAYOUT_LIMITS.copies.max}
                integer
                onCommit={(n) => patch({ copies: n })}
              />
            </Field>
            <Field label="فاصله بین برچسب‌ها (mm)">
              <LayoutNumber
                value={layout.gapMm ?? 2}
                min={LAYOUT_LIMITS.gapMm.min}
                max={LAYOUT_LIMITS.gapMm.max}
                onCommit={(n) => patch({ gapMm: n })}
              />
            </Field>
            <Field label="عرض لیبل (mm)">
              <LayoutNumber
                value={layout.labelWidthMm}
                min={LAYOUT_LIMITS.labelWidthMm.min}
                max={LAYOUT_LIMITS.labelWidthMm.max}
                onCommit={(n) => patch({ labelWidthMm: n })}
              />
            </Field>
            <Field label="ارتفاع لیبل (mm)">
              <LayoutNumber
                value={layout.labelHeightMm}
                min={LAYOUT_LIMITS.labelHeightMm.min}
                max={LAYOUT_LIMITS.labelHeightMm.max}
                onCommit={(n) => patch({ labelHeightMm: n })}
              />
            </Field>
            {isLabel && (
              <>
                <Field label="کالیبراسیون افقی (mm)">
                  <LayoutNumber
                    value={layout.offsetXMm ?? 0}
                    min={LAYOUT_LIMITS.offsetMm.min}
                    max={LAYOUT_LIMITS.offsetMm.max}
                    onCommit={(n) => patch({ offsetXMm: n })}
                  />
                </Field>
                <Field label="کالیبراسیون عمودی (mm)">
                  <LayoutNumber
                    value={layout.offsetYMm ?? 0}
                    min={LAYOUT_LIMITS.offsetMm.min}
                    max={LAYOUT_LIMITS.offsetMm.max}
                    onCommit={(n) => patch({ offsetYMm: n })}
                  />
                </Field>
                <Field label="پررنگی میله‌ها">
                  <select
                    value={String(layout.boldness ?? 1)}
                    onChange={(e) => patch({ boldness: Number(e.target.value) })}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  >
                    <option value="0.75">کم</option>
                    <option value="1">عادی</option>
                    <option value="1.5">زیاد</option>
                  </select>
                </Field>
              </>
            )}
          </div>

          {fitMsg && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-2 text-[11px] leading-5 text-destructive">
              {fitMsg}
            </p>
          )}

          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!layout.showName}
                onChange={(e) => patch({ showName: e.target.checked })}
              />
              نمایش نام
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!layout.showPrice}
                onChange={(e) => patch({ showPrice: e.target.checked })}
              />
              نمایش قیمت
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={layout.showCode !== false}
                onChange={(e) => patch({ showCode: e.target.checked })}
              />
              نمایش کد زیر بارکد
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={download}
              disabled={busy || validItems.length === 0}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> PDF
            </button>
            <button
              onClick={print}
              disabled={busy || validItems.length === 0}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Printer className="h-4 w-4" /> چاپ
            </button>
          </div>
          {busy && (
            <p className="text-center text-xs text-muted-foreground">در حال تولید بارکدها...</p>
          )}
        </div>
      </div>
    </div>
  );
}

function GridSchematic({
  cols,
  rows,
  pages,
  perPage,
}: {
  cols: number;
  rows: number;
  pages: number;
  perPage: number;
}) {
  const c = Math.max(1, Math.min(cols, 8));
  const r = Math.max(1, Math.min(rows, 10));
  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-2">
      <div
        className="mx-auto grid w-fit gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${c}, 11px)` }}
        aria-hidden
      >
        {Array.from({ length: c * r }, (_, i) => (
          <div key={i} className="h-3.5 w-[11px] rounded-[2px] bg-primary/80" />
        ))}
      </div>
      <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
        شبکه چاپ: {formatNumber(cols)} ستون × {formatNumber(rows)} ردیف — {formatNumber(perPage)}{" "}
        لیبل در هر صفحه
        {pages > 1 ? ` · ${formatNumber(pages)} صفحه` : ""}
      </p>
    </div>
  );
}

/**
 * ورودی عدد آزاد: کاربر می‌تواند کل مقدار را پاک کند و عدد دلخواه را بنویسد.
 * ثبت فقط روی blur انجام می‌شود تا رقم اول به ۱ قفل نشود.
 */
function LayoutNumber({
  value,
  onCommit,
  min,
  max,
  integer = false,
}: {
  value: number;
  onCommit: (n: number) => void;
  min: number;
  max: number;
  integer?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(value);

  return (
    <input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      dir="ltr"
      autoComplete="off"
      value={shown}
      onFocus={(e) => {
        setText(String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        onCommit(commitBoundedNumber(text ?? "", min, max, value, integer));
        setText(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
    />
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
