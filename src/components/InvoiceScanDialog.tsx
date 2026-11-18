import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ImagePlus,
  Link2,
  Loader2,
  Package,
  ScanText,
  Sparkles,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { formatToman, getUnitDefs, type Product, type PurchaseItem } from "@/lib/store";
import {
  buildReviewRows,
  linkRowToProduct,
  reviewRowsToPurchaseItems,
  reviewRowsTotal,
  suggestSellPrice,
  type RawScanResult,
  type ReviewRow,
} from "@/lib/invoice-scan";
import { getInvoiceScanQuota, scanPurchaseInvoice } from "@/lib/api/invoice-scan.functions";
import { MoneyInput } from "@/components/MoneyInput";
import { QtyUnitInput } from "@/components/QtyUnitInput";
import {
  alternateEntryUnits,
  convertQuantity,
  convertUnitPrice,
  unitsConvertible,
} from "@/lib/units";

const MAX_PAGES = 4;
/** حجم هدف هر عکس پس از فشرده‌سازی (Vercel بدنهٔ درخواست را تا ~۴٫۵MB می‌پذیرد) */
const TARGET_BYTES = 850 * 1024;
const MARGIN_KEY = "kamix.invoiceScan.margin";

type Page = { id: string; file: File; url: string };
type Prepared = { data: string; mime: "image/jpeg" };

export type InvoiceScanConfirm = {
  items: PurchaseItem[];
  supplierName?: string;
  supplierPhone?: string;
  note?: string;
};

function readMargin(): number {
  try {
    const v = Number(localStorage.getItem(MARGIN_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 1000 && localStorage.getItem(MARGIN_KEY) !== null
      ? v
      : 30;
  } catch {
    return 30;
  }
}
function saveMargin(v: number) {
  try {
    localStorage.setItem(MARGIN_KEY, String(v));
  } catch {
    /* ignore */
  }
}

/** عکس → JPEG کوچک‌شده (base64 بدون پیشوند). جهت عکس (EXIF) رعایت می‌شود. */
async function prepareImage(file: File): Promise<Prepared> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      "این فرمت عکس پشتیبانی نمی‌شود. لطفاً با دوربین عکس بگیرید یا عکس JPG/PNG انتخاب کنید.",
    );
  }
  try {
    const attempts: Array<[number, number]> = [
      [2000, 0.82],
      [1600, 0.75],
      [1300, 0.68],
      [1100, 0.6],
    ];
    let last: Blob | null = null;
    for (const [maxDim, quality] of attempts) {
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("پردازش عکس ممکن نشد.");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      last = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
      if (last && last.size <= TARGET_BYTES) break;
    }
    if (!last) throw new Error("پردازش عکس ممکن نشد.");
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error("خواندن عکس ممکن نشد."));
      r.readAsDataURL(last as Blob);
    });
    return { data: dataUrl.replace(/^data:[^;]+;base64,/, ""), mime: "image/jpeg" };
  } finally {
    bitmap.close?.();
  }
}

function guessCurrency(scan: RawScanResult): "rial" | "toman" {
  if (scan.currency === "rial" || scan.currency === "toman") return scan.currency;
  // مثل ورود گروهی اکسل: میانگین خیلی بزرگ → احتمالاً ریال (فقط پیش‌فرضِ قابل‌تغییر)
  const prices = scan.items.map((i) => i.unitPrice || 0).filter((p) => p > 0);
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  return avg >= 300_000 ? "rial" : "toman";
}

export function InvoiceScanDialog({
  open,
  onClose,
  onConfirm,
  allProducts,
  defaultCategory,
  hasSupplier,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (r: InvoiceScanConfirm) => void;
  allProducts: Product[];
  defaultCategory: string;
  hasSupplier: boolean;
}) {
  const unitDefs = useMemo(() => getUnitDefs(), []);
  const [step, setStep] = useState<"pick" | "scanning" | "review">("pick");
  const [pages, setPages] = useState<Page[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<{
    configured: boolean;
    remaining: number;
    limit: number;
  } | null>(null);
  const [scan, setScan] = useState<RawScanResult | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [currency, setCurrency] = useState<"rial" | "toman">("toman");
  const [margin, setMargin] = useState<number>(30);
  const [useSupplier, setUseSupplier] = useState(true);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const pagesRef = useRef<Page[]>([]);
  pagesRef.current = pages;

  // بازنشانی هر بار که باز می‌شود
  useEffect(() => {
    if (!open) return;
    setStep("pick");
    pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
    setError(null);
    setScan(null);
    setRows([]);
    setMargin(readMargin());
    setQuota(null);
    let alive = true;
    getInvoiceScanQuota()
      .then((q) => alive && setQuota(q))
      .catch(() => alive && setQuota(null));
    return () => {
      alive = false;
    };
  }, [open]);

  // آزاد کردن پیش‌نمایش‌ها هنگام بسته شدن/خروج
  useEffect(() => {
    if (open) return;
    pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
  }, [open]);
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  if (!open) return null;

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/") || !f.type);
    setPages((prev) => {
      const room = MAX_PAGES - prev.length;
      if (imgs.length > room) setError(`حداکثر ${MAX_PAGES} صفحه برای یک فاکتور.`);
      return [
        ...prev,
        ...imgs.slice(0, Math.max(0, room)).map((file) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          url: URL.createObjectURL(file),
        })),
      ];
    });
  };

  const removePage = (id: string) =>
    setPages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });

  const runScan = async () => {
    if (busyRef.current || pages.length === 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("برای اسکن فاکتور به اینترنت نیاز است.");
      return;
    }
    busyRef.current = true;
    setError(null);
    setStep("scanning");
    try {
      const images: Prepared[] = [];
      for (const p of pages) images.push(await prepareImage(p.file));
      const res = await scanPurchaseInvoice({ data: { images } });
      if (!res.ok) {
        setError(res.error);
        setStep("pick");
        if (res.code === "quota_user") setQuota((q) => (q ? { ...q, remaining: 0 } : q));
        return;
      }
      const cur = guessCurrency(res.result);
      setCurrency(cur);
      setScan(res.result);
      setQuota({ configured: true, limit: res.limit, remaining: res.remaining });
      setRows(
        buildReviewRows(res.result, {
          products: allProducts,
          unitDefs,
          currency: cur,
          marginPercent: margin,
        }),
      );
      setUseSupplier(!hasSupplier && !!res.result.supplierName);
      setStep("review");
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setError(
        /fetch|network|Failed/i.test(msg)
          ? "ارتباط با سرور برقرار نشد. اینترنت را بررسی کنید و دوباره امتحان کنید."
          : msg.length < 200
            ? msg
            : "خواندن فاکتور ناموفق بود. دوباره امتحان کنید.",
      );
      setStep("pick");
    } finally {
      busyRef.current = false;
    }
  };

  /** در مرحلهٔ بازبینی، بستن تصادفی نتیجهٔ اسکن (و سهمیهٔ مصرف‌شده) را هدر ندهد */
  const requestClose = () => {
    if (step === "scanning") return;
    if (
      step === "review" &&
      rows.length > 0 &&
      !window.confirm("اقلام خوانده‌شده اضافه نشده‌اند. بدون افزودن بسته شود؟")
    ) {
      return;
    }
    onClose();
  };

  const patchRow = (key: string, patch: Partial<ReviewRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const changeCurrency = (next: "rial" | "toman") => {
    if (next === currency) return;
    const factor = next === "rial" ? 0.1 : 10; // ریال → تومان یعنی تقسیم بر ۱۰
    setRows((prev) =>
      prev.map((r) => {
        const buyPrice = Math.round(r.buyPrice * factor * 100) / 100;
        return {
          ...r,
          buyPrice,
          sellPrice: r.sellEdited ? r.sellPrice : suggestSellPrice(buyPrice, margin),
        };
      }),
    );
    setCurrency(next);
  };

  const applyMargin = (m: number) => {
    const v = Math.max(0, Math.min(1000, Math.round(m)));
    setMargin(v);
    saveMargin(v);
    setRows((prev) =>
      prev.map((r) => (r.sellEdited ? r : { ...r, sellPrice: suggestSellPrice(r.buyPrice, v) })),
    );
  };

  const changeUnit = (r: ReviewRow, unit: string) => {
    if (unitsConvertible(r.unit, unit)) {
      patchRow(r.key, {
        unit,
        quantity: convertQuantity(r.quantity, r.unit, unit),
        buyPrice: convertUnitPrice(r.buyPrice, r.unit, unit),
        sellPrice: convertUnitPrice(r.sellPrice, r.unit, unit),
      });
    } else patchRow(r.key, { unit });
  };

  const included = rows.filter((r) => r.include);
  const invalid = included.filter((r) => !(r.quantity > 0) || !r.name.trim());
  const total = reviewRowsTotal(rows);
  const invoiceTotal =
    scan?.total != null ? (currency === "rial" ? scan.total / 10 : scan.total) : undefined;
  const discount =
    scan?.discount != null ? (currency === "rial" ? scan.discount / 10 : scan.discount) : 0;
  const totalMismatch =
    invoiceTotal != null &&
    included.length === rows.length &&
    Math.abs(total - discount - invoiceTotal) > Math.max(10, invoiceTotal * 0.01) &&
    Math.abs(total - invoiceTotal) > Math.max(10, invoiceTotal * 0.01);
  const newCount = included.filter((r) => !r.productId).length;
  const zeroBuy = included.filter((r) => !(r.buyPrice > 0)).length;

  const confirm = () => {
    if (included.length === 0 || invalid.length > 0) return;
    const items = reviewRowsToPurchaseItems(rows, allProducts, defaultCategory);
    if (items.length === 0) return;
    const noteParts = [
      scan?.invoiceNumber ? `شماره فاکتور: ${scan.invoiceNumber}` : "",
      scan?.invoiceDate ? `تاریخ فاکتور: ${scan.invoiceDate}` : "",
    ].filter(Boolean);
    onConfirm({
      items,
      supplierName: useSupplier ? scan?.supplierName : undefined,
      supplierPhone: useSupplier ? scan?.supplierPhone : undefined,
      note: noteParts.length ? noteParts.join(" · ") : undefined,
    });
  };

  const productById = (id?: string) => (id ? allProducts.find((p) => p.id === id) : undefined);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="اسکن فاکتور خرید"
    >
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-elegant sm:rounded-3xl">
        {/* سربرگ */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ScanText className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold">
              {step === "review" ? "بازبینی اقلام فاکتور" : "اسکن فاکتور خرید"}
            </h3>
          </div>
          <button
            onClick={requestClose}
            disabled={step === "scanning"}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary disabled:opacity-40"
            aria-label="بستن"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-6 text-destructive">
              <AlertTriangle className="mt-1 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === "pick" && (
            <div className="space-y-3">
              <p className="text-xs leading-6 text-muted-foreground">
                از فاکتور خرید عکس بگیرید؛ نام کالا، کد، تعداد و قیمت خرید خودکار خوانده می‌شود و
                قبل از ثبت، همه‌چیز را می‌بینید و می‌توانید ویرایش کنید. فاکتور چندصفحه‌ای؟ تا{" "}
                {MAX_PAGES} صفحه اضافه کنید (یک اسکن حساب می‌شود).
              </p>

              {quota && !quota.configured && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-800 dark:text-amber-300">
                  این قابلیت هنوز روی سرور فعال نشده است. فعلاً اقلام را دستی وارد کنید.
                </div>
              )}
              {quota && quota.configured && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  سهمیهٔ امروز: {quota.remaining.toLocaleString("fa-IR")} از{" "}
                  {quota.limit.toLocaleString("fa-IR")} اسکن باقی مانده
                </div>
              )}

              {pages.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {pages.map((p, i) => (
                    <div
                      key={p.id}
                      className="relative overflow-hidden rounded-xl border border-border bg-background"
                    >
                      <img src={p.url} alt={`صفحه ${i + 1}`} className="h-32 w-full object-cover" />
                      <span className="absolute bottom-1 right-1 rounded-md bg-foreground/70 px-1.5 text-[10px] text-background">
                        صفحه {(i + 1).toLocaleString("fa-IR")}
                      </span>
                      <button
                        onClick={() => removePage(p.id)}
                        className="absolute left-1 top-1 grid h-7 w-7 place-items-center rounded-lg bg-background/90 text-destructive"
                        aria-label="حذف صفحه"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {pages.length < MAX_PAGES && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => cameraRef.current?.click()}
                    className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-primary/50 bg-primary/5 py-5 text-sm font-medium text-primary hover:bg-primary/10"
                  >
                    <Camera className="h-7 w-7" />
                    {pages.length ? "عکس صفحهٔ بعد" : "عکس گرفتن"}
                  </button>
                  <button
                    onClick={() => galleryRef.current?.click()}
                    className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border py-5 text-sm font-medium text-muted-foreground hover:bg-accent"
                  >
                    <ImagePlus className="h-7 w-7" />
                    از گالری
                  </button>
                </div>
              )}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              <ul className="space-y-1 rounded-xl bg-secondary/50 px-3 py-2 text-[11px] leading-6 text-muted-foreground">
                <li>• فاکتور را صاف روی میز بگذارید و از بالا، با نور کافی عکس بگیرید.</li>
                <li>• همهٔ ستون‌ها (نام، تعداد، قیمت) داخل کادر باشند و عکس تار نباشد.</li>
              </ul>
            </div>
          )}

          {step === "scanning" && (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div className="text-sm font-medium">در حال خواندن فاکتور…</div>
              <div className="text-xs text-muted-foreground">
                معمولاً ۵ تا ۲۰ ثانیه طول می‌کشد؛ لطفاً صفحه را نبندید.
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-3">
              {/* تنظیمات کلی */}
              <div className="grid gap-2 rounded-2xl border border-border bg-background p-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                    مبالغ روی فاکتور به:
                  </div>
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
                    {(["rial", "toman"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => changeCurrency(c)}
                        className={`rounded-lg py-1.5 text-xs font-medium ${
                          currency === c
                            ? "bg-card shadow-sm text-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {c === "rial" ? "ریال" : "تومان"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                    سود پیشنهادی برای قیمت فروش (٪)
                  </div>
                  <input
                    inputMode="numeric"
                    value={margin.toLocaleString("fa-IR")}
                    onChange={(e) => {
                      const n = Number(
                        e.target.value
                          .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
                          .replace(/\D/g, ""),
                      );
                      applyMargin(Number.isFinite(n) ? n : 0);
                    }}
                    className="h-[34px] w-full rounded-lg border border-input bg-card px-2 text-sm outline-none focus:border-primary"
                    aria-label="درصد سود"
                  />
                </div>
                {scan?.supplierName && (
                  <label className="flex items-center gap-2 text-xs sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={useSupplier}
                      onChange={(e) => setUseSupplier(e.target.checked)}
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                    تامین‌کننده: <b>{scan.supplierName}</b>
                    {scan.supplierPhone ? ` (${scan.supplierPhone})` : ""}
                    {hasSupplier && (
                      <span className="text-muted-foreground">— جایگزین نام فعلی</span>
                    )}
                  </label>
                )}
              </div>

              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full bg-secondary px-2 py-0.5">
                  {rows.length.toLocaleString("fa-IR")} ردیف خوانده شد
                </span>
                {newCount > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                    {newCount.toLocaleString("fa-IR")} کالای جدید به انبار اضافه می‌شود
                  </span>
                )}
                {rows.some((r) => r.warnings.length) && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-800 dark:text-amber-300">
                    ردیف‌های زرد را با فاکتور مقایسه کنید
                  </span>
                )}
              </div>

              <ul className="space-y-2">
                {rows.map((r, idx) => {
                  const product = productById(r.productId);
                  const suggestion = productById(r.suggestionId);
                  const productUnit = product?.unit;
                  const unitOptions = product
                    ? [productUnit || "عدد", ...alternateEntryUnits(productUnit)]
                    : unitDefs.map((u) => u.name);
                  const warn = r.warnings.length > 0;
                  return (
                    <li
                      key={r.key}
                      className={`space-y-2 rounded-xl border px-3 py-2.5 ${
                        !r.include
                          ? "border-border bg-secondary/40 opacity-60"
                          : warn
                            ? "border-amber-500/50 bg-amber-500/5"
                            : "border-border bg-background"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(e) => patchRow(r.key, { include: e.target.checked })}
                          className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                          aria-label="ثبت این ردیف"
                        />
                        <span className="text-[11px] text-muted-foreground">
                          {(idx + 1).toLocaleString("fa-IR")}
                        </span>
                        <div className="min-w-0 flex-1">
                          {product ? (
                            <div className="truncate text-sm font-semibold">{product.name}</div>
                          ) : (
                            <input
                              value={r.name}
                              onChange={(e) => patchRow(r.key, { name: e.target.value })}
                              placeholder="نام کالا"
                              className="w-full rounded-lg border border-input bg-card px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                            />
                          )}
                        </div>
                        {product ? (
                          <button
                            onClick={() =>
                              patchRow(r.key, {
                                productId: "",
                                matchedBy: undefined,
                                sellEdited: false,
                                sellPrice: suggestSellPrice(r.buyPrice, margin),
                              })
                            }
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
                            title="ثبت به‌عنوان کالای جدید"
                            aria-label="جدا کردن از کالای انبار"
                          >
                            <Unlink className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        {product ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-600/10 px-2 py-0.5 text-green-700 dark:text-green-400">
                            <CheckCircle2 className="h-3 w-3" />
                            موجود در انبار{r.matchedBy === "code" ? " (با کد)" : ""} — موجودی اضافه
                            می‌شود
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                            <Package className="h-3 w-3" />
                            کالای جدید
                          </span>
                        )}
                      </div>

                      {!product && suggestion && (
                        <button
                          onClick={() =>
                            setRows((prev) =>
                              prev.map((x) =>
                                x.key === r.key ? linkRowToProduct(x, suggestion) : x,
                              ),
                            )
                          }
                          className="flex w-full items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-right text-[11px] text-amber-800 dark:text-amber-300"
                        >
                          <Link2 className="h-3.5 w-3.5 shrink-0" />
                          شاید همان «{suggestion.name}» انبار باشد؟ برای ثبت روی همان بزنید
                        </button>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <Field label={`تعداد/مقدار (${r.unit})`}>
                          <QtyUnitInput
                            value={r.quantity}
                            unit={r.unit}
                            onChange={(quantity) => patchRow(r.key, { quantity })}
                          />
                        </Field>
                        <Field label="واحد">
                          <select
                            value={r.unit}
                            onChange={(e) => changeUnit(r, e.target.value)}
                            className="h-[38px] w-full rounded-lg border border-input bg-card px-2 text-sm outline-none focus:border-primary"
                          >
                            {[...new Set([r.unit, ...unitOptions])].map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={`قیمت خرید هر ${r.unit}`}>
                          <MoneyInput
                            value={r.buyPrice}
                            onChange={(buyPrice) =>
                              patchRow(r.key, {
                                buyPrice,
                                ...(r.sellEdited
                                  ? {}
                                  : { sellPrice: suggestSellPrice(buyPrice, margin) }),
                              })
                            }
                            ariaLabel="قیمت خرید"
                          />
                        </Field>
                        <Field label={product ? "قیمت فروش (فعلی/جدید)" : "قیمت فروش"}>
                          <MoneyInput
                            value={r.sellPrice}
                            onChange={(sellPrice) =>
                              patchRow(r.key, { sellPrice, sellEdited: true })
                            }
                            ariaLabel="قیمت فروش"
                          />
                        </Field>
                        {!product?.code && (
                          <Field label="کد / بارکد (اختیاری)">
                            <input
                              value={r.code}
                              onChange={(e) => patchRow(r.key, { code: e.target.value })}
                              dir="ltr"
                              className="h-[38px] w-full rounded-lg border border-input bg-card px-2 text-sm outline-none focus:border-primary"
                            />
                          </Field>
                        )}
                      </div>

                      {r.include &&
                        r.buyPrice > 0 &&
                        r.sellPrice > 0 &&
                        r.sellPrice < r.buyPrice && (
                          <div className="text-[11px] text-destructive">
                            قیمت فروش از قیمت خرید کمتر است.
                          </div>
                        )}
                      {r.warnings.map((w) => (
                        <div
                          key={w}
                          className="flex items-center gap-1 text-[11px] text-amber-800 dark:text-amber-300"
                        >
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          {w}
                        </div>
                      ))}
                      <div className="text-left text-[11px] font-semibold">
                        جمع: {formatToman(Math.round(r.quantity * r.buyPrice))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* پایین */}
        {step === "pick" && (
          <div className="border-t border-border px-4 py-3">
            <button
              onClick={runScan}
              disabled={
                pages.length === 0 || (quota != null && (!quota.configured || quota.remaining <= 0))
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              خواندن فاکتور
              {pages.length > 1 ? ` (${pages.length.toLocaleString("fa-IR")} صفحه)` : ""}
            </button>
          </div>
        )}
        {step === "review" && (
          <div className="space-y-2 border-t border-border px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                جمع {included.length.toLocaleString("fa-IR")} قلم:
              </span>
              <b>{formatToman(total)}</b>
            </div>
            {invoiceTotal != null && (
              <div
                className={`text-[11px] ${totalMismatch ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}
              >
                جمع روی فاکتور: {formatToman(Math.round(invoiceTotal))}
                {discount > 0 ? ` (تخفیف: ${formatToman(Math.round(discount))})` : ""}
                {totalMismatch ? " — با جمع اقلام نمی‌خواند؛ ردیف‌ها را بررسی کنید" : " ✓"}
              </div>
            )}
            {zeroBuy > 0 && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300">
                {zeroBuy.toLocaleString("fa-IR")} ردیف بدون قیمت خرید است.
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={requestClose}
                className="rounded-xl border border-border py-3 text-sm font-medium hover:bg-accent"
              >
                انصراف
              </button>
              <button
                onClick={confirm}
                disabled={included.length === 0 || invalid.length > 0}
                className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                تایید و افزودن به فاکتور
              </button>
            </div>
            <p className="text-center text-[10px] text-muted-foreground">
              اقلام به فاکتور خرید اضافه می‌شوند؛ با «ثبت فاکتور خرید» وارد انبار می‌شوند.
            </p>
          </div>
        )}
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
