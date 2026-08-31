import { useMemo, useState } from "react";
import { X, Upload, FileSpreadsheet, Download, AlertCircle, CheckCircle2 } from "lucide-react";
import { parseFile, downloadSample, mergeImported, type ImportRow } from "@/lib/bulk-import";
import { products, cryptoId } from "@/lib/store";

export function BulkImportModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);
  // واحد پول مبالغ داخل فایل اکسل/CSV — برنامه همیشه داخلی به «تومان» ذخیره می‌کند،
  // پس اگر فایل به ریال باشد باید قبل از ثبت بر ۱۰ تقسیم شود، وگرنه قیمت‌ها ۱۰ برابر
  // وارد انبار می‌شوند (فارغ از اینکه واحد نمایشیِ تنظیمات چه باشد).
  const [fileCurrency, setFileCurrency] = useState<"toman" | "rial">("toman");

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const parsed = await parseFile(file);
      setRows(parsed);
      setResult(null);
      // حدس اولیه: اگر میانگین قیمت‌ها خیلی بزرگ باشد (بالای ۳۰۰٬۰۰۰)، احتمال دارد
      // فایل به ریال باشد — فقط به‌عنوان پیش‌فرضِ قابل‌تغییر، نه تصمیم قطعی.
      const prices = parsed.map((r) => r.price).filter((p) => p > 0);
      const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
      setFileCurrency(avg >= 300000 ? "rial" : "toman");
    } catch (e: any) {
      alert("خطا در خواندن فایل: " + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  // ردیف‌ها با اعمال تبدیل ریال→تومان (در صورت انتخاب ریال)، برای نمایش و ثبت
  const convertedRows = useMemo<ImportRow[]>(() => {
    if (fileCurrency !== "rial") return rows;
    return rows.map((r) => ({
      ...r,
      price: r.price ? Math.round(r.price / 10) : r.price,
      buyPrice: r.buyPrice ? Math.round(r.buyPrice / 10) : r.buyPrice,
    }));
  }, [rows, fileCurrency]);

  const validRows = convertedRows.filter((r) => r.errors.length === 0);
  const errorRows = convertedRows.filter((r) => r.errors.length > 0);

  const submit = () => {
    if (validRows.length === 0) return;
    const { list, result: r } = mergeImported(products.getAll(), validRows, cryptoId);
    products.save(list);
    setResult(r);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">ورود گروهی محصولات</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          <div className="rounded-xl border border-border bg-background p-6 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
            <div className="text-sm font-medium">ثبت با موفقیت انجام شد</div>
            <div className="text-xs text-muted-foreground">
              {result.added.toLocaleString("fa-IR")} محصول جدید، {result.updated.toLocaleString("fa-IR")} محصول به‌روزرسانی شد
            </div>
            <button onClick={onClose} className="mt-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">بستن</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center">
              <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-2 text-sm">فایل Excel یا CSV را انتخاب کنید</p>
              <p className="mt-1 text-xs text-muted-foreground">ستون‌ها: نام، بارکد، قیمت خرید، قیمت فروش، موجودی، دسته، واحد، توضیحات</p>
              <label className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                <Upload className="h-4 w-4" />
                انتخاب فایل
                <input
                  type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </label>
            </div>
            <button onClick={downloadSample} className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2 text-xs">
              <Download className="h-3.5 w-3.5" />
              دانلود فایل نمونه
            </button>
            {loading && <p className="text-center text-xs text-muted-foreground">در حال خواندن فایل...</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2 text-xs flex-wrap">
              <span className="rounded-md bg-green-50 px-2 py-1 text-green-700">معتبر: {validRows.length.toLocaleString("fa-IR")}</span>
              {errorRows.length > 0 && <span className="rounded-md bg-destructive/10 px-2 py-1 text-destructive">خطادار: {errorRows.length.toLocaleString("fa-IR")}</span>}
              <span className="rounded-md bg-secondary px-2 py-1 text-muted-foreground">کل: {rows.length.toLocaleString("fa-IR")}</span>
            </div>

            <div className="rounded-xl border border-border bg-background p-3">
              <p className="mb-2 text-xs font-medium">قیمت‌های داخل فایل به چه واحدی است؟</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFileCurrency("toman")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                    fileCurrency === "toman" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  تومان
                </button>
                <button
                  type="button"
                  onClick={() => setFileCurrency("rial")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                    fileCurrency === "rial" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  ریال
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                برنامه همیشه قیمت‌ها را داخلی به تومان نگه می‌دارد. اگر فایل شما به ریال است،
                «ریال» را انتخاب کنید تا قیمت‌ها هنگام ثبت خودکار به تومان تبدیل شوند (تقسیم بر
                ۱۰) — جدول زیر پیش‌نمایشِ قیمتِ نهایی به تومان را نشان می‌دهد.
              </p>
            </div>

            <div className="max-h-80 overflow-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-secondary/60">
                  <tr>
                    <th className="px-2 py-1.5 text-right">#</th>
                    <th className="px-2 py-1.5 text-right">نام</th>
                    <th className="px-2 py-1.5 text-right">بارکد</th>
                    <th className="px-2 py-1.5 text-right">قیمت (تومان)</th>
                    <th className="px-2 py-1.5 text-right">موجودی</th>
                    <th className="px-2 py-1.5 text-right">دسته</th>
                    <th className="px-2 py-1.5 text-right">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {convertedRows.slice(0, 200).map((r) => (
                    <tr key={r.rowIndex} className={`border-t border-border ${r.errors.length ? "bg-destructive/5" : ""}`}>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.rowIndex}</td>
                      <td className="px-2 py-1.5">{r.name || "—"}</td>
                      <td className="px-2 py-1.5" dir="ltr">{r.code || "—"}</td>
                      <td className="px-2 py-1.5">{r.price.toLocaleString("fa-IR")}</td>
                      <td className="px-2 py-1.5">{r.stock.toLocaleString("fa-IR")}</td>
                      <td className="px-2 py-1.5">{r.category || "—"}</td>
                      <td className="px-2 py-1.5">
                        {r.errors.length ? (
                          <span className="flex items-center gap-1 text-destructive">
                            <AlertCircle className="h-3 w-3" />{r.errors[0]}
                          </span>
                        ) : <span className="text-green-600">معتبر</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 200 && <p className="p-2 text-center text-[10px] text-muted-foreground">نمایش ۲۰۰ ردیف اول از {rows.length.toLocaleString("fa-IR")}</p>}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setRows([])} className="flex-1 rounded-xl border border-border px-4 py-2 text-sm">انتخاب فایل دیگر</button>
              <button
                onClick={submit}
                disabled={validRows.length === 0}
                className="flex-1 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                ثبت {validRows.length.toLocaleString("fa-IR")} محصول
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
