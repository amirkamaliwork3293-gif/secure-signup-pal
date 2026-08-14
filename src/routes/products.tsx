import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { Layout } from "@/components/Layout";
import {
  products, categories, settings, cryptoId, formatToman, formatNumber, stockStatus,
  parseNumberInput, COUNT_UNIT, getUnitDefs, addUnitDef, removeUnitDef,
  expiryStatus, daysToExpiry, formatJalaliDate, toJalali, jalaliToTimestamp,
  jalaliMonthLength, JMONTHS_LONG,
  type Product, type Category, type UnitDef,
} from "@/lib/store";
import { generateUniqueCode } from "@/lib/barcode-code";
import { filterAndRankSearch } from "@/lib/search";
import { isWebView } from "@/lib/isWebView";
// مودال‌های سنگین فقط هنگام باز شدن بارگذاری می‌شوند (bwip-js/jsPDF/xlsx) تا
// خودِ صفحه‌ی محصولات سریع باز شود.
const BulkImportModal = lazy(() =>
  import("@/components/BulkImportModal").then((m) => ({ default: m.BulkImportModal })),
);
const BarcodePrintModal = lazy(() =>
  import("@/components/BarcodePrintModal").then((m) => ({ default: m.BarcodePrintModal })),
);
const BarcodeViewModal = lazy(() =>
  import("@/components/BarcodeViewModal").then((m) => ({ default: m.BarcodeViewModal })),
);
import {
  Plus, Trash2, Package, X, Pencil, AlertTriangle,
  Search, Filter, Upload, Zap, Printer, Barcode, CheckSquare, Square, FileSpreadsheet, ShoppingBag,
  CalendarClock, Mic,
} from "lucide-react";
import { z } from "zod";

const searchSchema = z.object({ code: z.string().optional(), q: z.string().optional() });

export const Route = createFileRoute("/products")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "محصولات | KAMIX" },
      { name: "description", content: "مدیریت محصولات و کدهای بارکد/QR." },
    ],
  }),
  component: ProductsPage,
});

function ProductsPageInner() {
  const { code: incomingCode, q: incomingQuery } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [list, setList] = products.useAll();
  const [catList, setCatList] = categories.useAll();
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [searchQ, setSearchQ] = useState(incomingQuery ?? "");
  // فیلتر/جستجو با کمی تاخیر (debounce) اجرا می‌شود تا با انبارهای بزرگ (چند هزار
  // محصول)، تایپ کردن در جستجو کند یا لگ‌دار نشود.
  const [debouncedSearchQ, setDebouncedSearchQ] = useState(searchQ);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQ(searchQ), 150);
    return () => clearTimeout(t);
  }, [searchQ]);
  const [filterCat, setFilterCat] = useState<string>("all");
  // نمای انتخابی: همه / رو به اتمام / نزدیک انقضا
  const [view, setView] = useState<"all" | "low" | "expiry">("all");
  const [showCatManager, setShowCatManager] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [viewBarcode, setViewBarcode] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [printTargets, setPrintTargets] = useState<Product[] | null>(null);

  useEffect(() => {
    if (incomingCode) setOpen(true);
  }, [incomingCode]);

  useEffect(() => {
    if (incomingQuery != null) setSearchQ(incomingQuery);
  }, [incomingQuery]);

  const remove = (id: string) => {
    if (!confirm("حذف این محصول؟")) return;
    setList(list.filter((p) => p.id !== id));
  };

  const removeAll = () => {
    if (list.length === 0) return;
    if (
      !confirm(
        `همه‌ی ${list.length.toLocaleString("fa-IR")} محصول حذف شود؟ این عمل غیرقابل بازگشت است.`,
      )
    )
      return;
    setList([]);
    setSelected(new Set());
  };

  const onCreate = (p: Omit<Product, "id">) => {
    if (p.code && products.getAll().some((x) => x.code === p.code)) {
      alert("محصولی با همین کد قبلاً ثبت شده است.");
      return;
    }
    setList([{ ...p, id: cryptoId() }, ...list]);
    setOpen(false);
    if (incomingCode) navigate({ search: {} });
  };

  const onEdit = (p: Product) => {
    setList(list.map((x) => (x.id === p.id ? p : x)));
    setEditTarget(null);
  };

  const filtered = useMemo(
    () =>
      filterAndRankSearch(
        list
          .filter((p) =>
            filterCat === "all"
              ? true
              : filterCat === "__none"
                ? !p.category
                : p.category === filterCat,
          )
          .filter((p) => {
            if (view === "low") {
              const s = stockStatus(p);
              return s === "low" || s === "out";
            }
            if (view === "expiry") {
              const s = expiryStatus(p);
              return s === "soon" || s === "expired";
            }
            return true;
          })
          .sort((a, b) =>
            view === "expiry" ? (a.expiryAt ?? 0) - (b.expiryAt ?? 0)
            : view === "low"  ? a.stock - b.stock
            : 0,
          ),
        debouncedSearchQ,
        (p) => [p.name, p.code],
      ),
    [list, filterCat, view, debouncedSearchQ],
  );

  const lowCount = useMemo(
    () => list.filter((p) => { const s = stockStatus(p); return s === "low" || s === "out"; }).length,
    [list],
  );
  const expiryCount = useMemo(
    () => list.filter((p) => { const s = expiryStatus(p); return s === "soon" || s === "expired"; }).length,
    [list],
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(filtered.map((p) => p.id)));
  const clearSelection = () => setSelected(new Set());

  const generateBarcodesForSelected = () => {
    if (selected.size === 0) return;
    const taken = new Set(list.map((p) => p.code).filter(Boolean));
    const next = list.map((p) => {
      if (selected.has(p.id) && !p.code) {
        const code = generateUniqueCode(taken);
        return { ...p, code };
      }
      return p;
    });
    setList(next);
    alert("بارکد برای محصولات انتخاب شده تولید شد.");
  };

  const printSelected = () => {
    if (selected.size === 0) return;
    setPrintTargets(list.filter((p) => selected.has(p.id)));
  };

  const totalInventoryValue = useMemo(() => list.reduce((sum, p) => sum + p.price * p.stock, 0), [list]);
  const totalBuyValue = useMemo(() => list.reduce((sum, p) => sum + (p.buyPrice ?? 0) * p.stock, 0), [list]);

  // نمایش پنجره‌ای (windowed) لیست محصولات — با انبارهای بزرگ (چند هزار محصول)،
  // رندر کردن همه‌ی ردیف‌ها هم‌زمان کند و لگ‌دار می‌شود؛ به‌جای آن فقط بخشی از
  // نتایج فیلترشده رندر می‌شود و با اسکرول/دکمه «بارگذاری بیشتر» ادامه می‌آید.
  const PRODUCT_PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState(PRODUCT_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PRODUCT_PAGE_SIZE);
  }, [filtered]);
  const visibleItems = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  const exportToExcel = async () => {
    if (list.length === 0) { alert("محصولی برای خروجی وجود ندارد."); return; }

    // داخل اپلیکیشن اندروید: دانلود فایل اکسل به‌طور قابل‌اعتماد در WebView کار
    // نمی‌کند (چه با دانلود مستقیم مرورگر، چه با پلاگین‌های نیتیو که در تست
    // واقعی باعث کرش می‌شدند). به‌جای ریسک کردن، کاربر را به نسخه‌ی وب/سایت
    // ارجاع می‌دهیم؛ آنجا این قابلیت با مرورگر واقعی بدون مشکل کار می‌کند.
    if (isWebView()) {
      alert(
        "خروجی گرفتن اکسل در نسخه‌ی اپلیکیشن در دسترس نیست. لطفاً از طریق مرورگر (سایت) وارد حساب‌تان شوید و از همان‌جا خروجی اکسل را دریافت کنید.",
      );
      return;
    }

    const XLSX = await import("xlsx");
    const rows = list.map((p) => ({
      "نام محصول": p.name,
      "قیمت فروش (تومان)": p.price,
      "موجودی": p.stock,
      "واحد": p.unit || "عدد",
      "ارزش موجودی (تومان)": p.price * p.stock,
      "دسته‌بندی": p.category,
      "کد بارکد": p.code,
      "قیمت خرید (تومان)": p.buyPrice ?? "",
      "قیمت مصرف‌کننده (تومان)": p.consumerPrice ?? "",
      "قیمت همکار (تومان)": p.sellerPrice ?? "",
      "قیمت عمده/کارتنی (تومان)": p.wholesalePrice ?? "",
      "حداقل تعداد عمده": p.wholesaleMinQty ?? "",
      "درصد تخفیف": p.discountPercent ?? "",
      "هشدار موجودی کم": p.lowStockThreshold ?? 5,
      "توضیحات": p.description ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    // Set column widths
    ws["!cols"] = [
      { wch: 25 }, { wch: 18 }, { wch: 10 }, { wch: 8 }, { wch: 20 },
      { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 18 },
      { wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 25 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "محصولات");
    XLSX.writeFile(wb, `products-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const stockBadge = (p: Product) => {
    const s = stockStatus(p);
    const unitLabel = p.unit || "عدد";
    if (s === "out") return <span className="text-[10px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded-md">اتمام موجودی</span>;
    if (s === "low") return <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5" />{formatNumber(p.stock)}</span>;
    return <span className="text-[10px] text-muted-foreground">{formatNumber(p.stock)} {unitLabel}</span>;
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">محصولات</h1>
          <p className="text-xs text-muted-foreground">{list.length.toLocaleString("fa-IR")} محصول ثبت شده</p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          <button
            onClick={exportToExcel}
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
            title="خروجی Excel"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" />
            Excel
          </button>
          {list.length > 0 && (
            <button
              onClick={removeAll}
              className="inline-flex items-center gap-1 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
              title="حذف همه محصولات"
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف همه
            </button>
          )}
          <button
            onClick={() => { setEditTarget(null); setOpen(true); }}
            className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-elegant"
          >
            <Plus className="h-3.5 w-3.5" />
            افزودن
          </button>
        </div>
      </div>

      {/* Inventory value summary */}
      {list.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground mb-1">ارزش کل موجودی (قیمت فروش)</div>
            <div className="text-sm font-bold text-primary">{formatToman(totalInventoryValue)}</div>
          </div>
          {totalBuyValue > 0 && (
            <div className="rounded-2xl border border-border bg-card p-3">
              <div className="text-[10px] text-muted-foreground mb-1">ارزش کل موجودی (قیمت خرید)</div>
              <div className="text-sm font-bold text-green-600">{formatToman(totalBuyValue)}</div>
            </div>
          )}
        </div>
      )}

      {/* Action toolbar */}
      <div className="mb-3 grid grid-cols-5 gap-1.5">
        <Link to="/voice-products" className="inline-flex items-center justify-center gap-1 rounded-xl border border-primary/40 bg-primary/5 px-2 py-2 text-[11px] font-medium text-primary">
          <Mic className="h-3.5 w-3.5" /> ثبت صوتی
        </Link>
        <button onClick={() => setShowImport(true)} className="inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-card px-2 py-2 text-[11px]">
          <Upload className="h-3.5 w-3.5" /> ورود گروهی
        </button>
        <Link to="/quick-add" className="inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-card px-2 py-2 text-[11px]">
          <Zap className="h-3.5 w-3.5" /> ثبت سریع
        </Link>
        <Link to="/purchases" className="inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-card px-2 py-2 text-[11px]">
          <ShoppingBag className="h-3.5 w-3.5" /> فاکتور خرید
        </Link>
        <button onClick={() => { setSelectMode((v) => !v); clearSelection(); }} className={`inline-flex items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] ${selectMode ? "border-primary bg-primary/5 text-primary" : "border-border bg-card"}`}>
          {selectMode ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />} انتخاب گروهی
        </button>
      </div>

      {/* Search */}
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="جستجوی نام یا بارکد..."
            className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* دسته‌بندی محصولات — واضح و قابل لمس، نه یک آیکن ریز */}
      <section className="mb-3 rounded-2xl border border-border bg-card p-3 shadow-card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-bold">
            <Filter className="h-4 w-4 text-primary" />
            دسته‌بندی محصولات
          </h2>
          <button
            onClick={() => setShowCatManager(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-primary/40 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
          >
            <Plus className="h-3.5 w-3.5" />
            مدیریت دسته‌ها
          </button>
        </div>
        {catList.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            هنوز دسته‌بندی نساخته‌اید. با «مدیریت دسته‌ها» دسته بسازید (مثلاً لبنیات، نوشیدنی) تا محصولات‌تان مرتب شوند.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFilterCat("all")}
              className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                filterCat === "all"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border border-border bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              همه ({formatNumber(list.length)})
            </button>
            {catList.map((c) => {
              const count = list.filter((p) => p.category === c.name).length;
              const active = filterCat === c.name;
              return (
                <button
                  key={c.id}
                  onClick={() => setFilterCat(active ? "all" : c.name)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {c.name} ({formatNumber(count)})
                </button>
              );
            })}
            {list.some((p) => !p.category) && (
              <button
                onClick={() => setFilterCat(filterCat === "__none" ? "all" : "__none")}
                className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                  filterCat === "__none"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "border border-dashed border-border bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                بدون دسته ({formatNumber(list.filter((p) => !p.category).length)})
              </button>
            )}
          </div>
        )}
      </section>

      {/* نماها: همه / رو به اتمام / نزدیک انقضا */}
      <div className="mb-3 flex gap-1.5 overflow-x-auto">
        {([
          { key: "all",    label: "همه محصولات", count: list.length,  icon: Package },
          { key: "low",    label: "رو به اتمام",  count: lowCount,     icon: AlertTriangle },
          ...(expiryCount > 0 || list.some((p) => p.expiryAt)
            ? [{ key: "expiry" as const, label: "نزدیک انقضا", count: expiryCount, icon: CalendarClock }]
            : []),
        ] as const).map(({ key, label, count, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setView(key as typeof view)}
            className={`inline-flex shrink-0 items-center gap-1 rounded-xl border px-3 py-1.5 text-[11px] font-medium transition ${
              view === key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className="rounded-md bg-secondary px-1 text-[10px] text-secondary-foreground">
              {formatNumber(count)}
            </span>
          </button>
        ))}
      </div>

      {/* Selection bar */}
      {selectMode && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-2 text-xs">
          <span className="font-medium">{selected.size.toLocaleString("fa-IR")} انتخاب شده</span>
          <button onClick={selectAll} className="rounded-md border border-border bg-background px-2 py-1">انتخاب همه</button>
          <button onClick={clearSelection} className="rounded-md border border-border bg-background px-2 py-1">پاک کردن</button>
          <div className="flex-1" />
          <button onClick={generateBarcodesForSelected} disabled={selected.size === 0} className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 disabled:opacity-50">
            <Barcode className="h-3.5 w-3.5" /> تولید بارکد
          </button>
          <button onClick={printSelected} disabled={selected.size === 0} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50">
            <Printer className="h-3.5 w-3.5" /> چاپ
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <Package className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {list.length === 0 ? "هنوز محصولی اضافه نکرده‌اید." : "محصولی با این مشخصات یافت نشد."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visibleItems.map((p) => {
            const isSel = selected.has(p.id);
            return (
              <li key={p.id} className={`flex items-center gap-3 rounded-xl border bg-card p-3 shadow-card ${isSel ? "border-primary" : "border-border"}`}>
                {selectMode && (
                  <button onClick={() => toggleSelect(p.id)} className="grid h-8 w-8 place-items-center rounded-lg text-primary">
                    {isSel ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                  </button>
                )}
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <Package className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.category && (
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">{p.category}</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs flex-wrap">
                    <span className="font-medium text-primary">
                      {formatToman(p.price)}{p.unit && p.unit !== "عدد" ? ` / ${p.unit}` : ""}
                    </span>
                    {!!p.discountPercent && (
                      <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">٪{formatNumber(p.discountPercent)} تخفیف</span>
                    )}
                    {stockBadge(p)}
                    {(() => {
                      const st = expiryStatus(p);
                      if (st === "none" || st === "ok") return null;
                      const d = daysToExpiry(p) ?? 0;
                      return (
                        <span
                          className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                            st === "expired"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-amber-500/10 text-amber-600"
                          }`}
                          title={p.expiryAt ? formatJalaliDate(p.expiryAt) : ""}
                        >
                          <CalendarClock className="h-2.5 w-2.5" />
                          {st === "expired" ? "منقضی شده" : `${formatNumber(d)} روز تا انقضا`}
                        </span>
                      );
                    })()}
                    {p.stock > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        ارزش: {formatToman(p.price * p.stock)}
                      </span>
                    )}
                    {p.code && <span className="text-muted-foreground" dir="ltr">{p.code.slice(0, 16)}</span>}
                  </div>
                </div>
                <div className="flex gap-0.5">
                  {p.code ? (
                    <button onClick={() => setViewBarcode(p)} className="grid h-8 w-8 place-items-center rounded-lg text-foreground hover:bg-secondary" title="مشاهده بارکد">
                      <Barcode className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const taken = new Set(list.map((x) => x.code).filter(Boolean));
                        const code = generateUniqueCode(taken);
                        setList(list.map((x) => x.id === p.id ? { ...x, code } : x));
                      }}
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
                      title="تولید بارکد"
                    >
                      <Barcode className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setEditTarget(p)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-primary hover:bg-primary/10"
                    aria-label="ویرایش"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                    aria-label="حذف"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {filtered.length > visibleItems.length && (
        <div className="mt-3 flex flex-col items-center gap-1.5">
          <button
            onClick={() => setVisibleCount((c) => c + PRODUCT_PAGE_SIZE)}
            className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-secondary"
          >
            نمایش {formatNumber(Math.min(PRODUCT_PAGE_SIZE, filtered.length - visibleItems.length))} محصول بعدی
            ({formatNumber(visibleItems.length)} از {formatNumber(filtered.length)})
          </button>
        </div>
      )}

      {open && (
        <ProductModal
          initialCode={incomingCode ?? ""}
          catList={catList}
          onClose={() => { setOpen(false); if (incomingCode) navigate({ search: {} }); }}
          onSave={onCreate}
        />
      )}

      {editTarget && (
        <ProductModal
          initial={editTarget}
          catList={catList}
          onClose={() => setEditTarget(null)}
          onSave={(p) => onEdit(p as Product)}
          isEdit
        />
      )}

      {showCatManager && (
        <CategoryManager
          catList={catList}
          onClose={() => setShowCatManager(false)}
          onChange={setCatList}
        />
      )}

      <Suspense fallback={null}>
        {showImport && <BulkImportModal onClose={() => setShowImport(false)} />}
        {viewBarcode && <BarcodeViewModal product={viewBarcode} onClose={() => setViewBarcode(null)} />}
        {printTargets && <BarcodePrintModal items={printTargets} onClose={() => setPrintTargets(null)} />}
      </Suspense>
    </Layout>
  );
}

// ─── Product Modal ────────────────────────────────────────────────────────────

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

/** ورودی قیمت با جداکننده هزارگان زنده */
function PriceInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const display = value ? formatNumber(parseNumberInput(value)) : "";
  return (
    <input
      value={display}
      onChange={(e) => {
        const n = parseNumberInput(e.target.value);
        onChange(n ? String(n) : "");
      }}
      inputMode="numeric"
      placeholder={placeholder}
      className={inputCls}
    />
  );
}

function ProductModal({
  initialCode = "",
  initial,
  catList,
  onClose,
  onSave,
  isEdit = false,
}: {
  initialCode?: string;
  initial?: Product;
  catList: Category[];
  onClose: () => void;
  onSave: (p: Omit<Product, "id"> | Product) => void;
  isEdit?: boolean;
}) {
  const [appSettings] = settings.useAll();
  const [unitDefs, setUnitDefs] = useState<UnitDef[]>(() => getUnitDefs());
  useEffect(() => { setUnitDefs(getUnitDefs()); }, [appSettings.units]);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [newUnitName, setNewUnitName] = useState("");
  const [newUnitDecimal, setNewUnitDecimal] = useState(true);

  const [name, setName]       = useState(initial?.name ?? "");
  const [price, setPrice]     = useState(initial ? String(initial.price) : "");
  const [category, setCat]    = useState(initial?.category ?? "");
  const [code, setCode]       = useState(initial?.code ?? initialCode);
  const [stock, setStock]     = useState(initial ? String(initial.stock) : "0");
  const [desc, setDesc]       = useState(initial?.description ?? "");
  const [lowThreshold, setLow]= useState(initial?.lowStockThreshold ? String(initial.lowStockThreshold) : "5");
  const [unit, setUnit]       = useState(initial?.unit ?? COUNT_UNIT);
  // فیلدهای اختیاری — صرفاً پیشنهادی، هیچ‌کدام الزامی نیستند
  const [showOptional, setShowOptional] = useState(
    !!(initial?.buyPrice || initial?.consumerPrice || initial?.sellerPrice || initial?.discountPercent || initial?.wholesalePrice),
  );
  const [buyPrice, setBuyPrice]           = useState(initial?.buyPrice ? String(initial.buyPrice) : "");
  const [consumerPrice, setConsumerPrice] = useState(initial?.consumerPrice ? String(initial.consumerPrice) : "");
  const [sellerPrice, setSellerPrice]     = useState(initial?.sellerPrice ? String(initial.sellerPrice) : "");
  const [discount, setDiscount]           = useState(initial?.discountPercent ? String(initial.discountPercent) : "");
  const [wholesalePrice, setWholesalePrice] = useState(initial?.wholesalePrice ? String(initial.wholesalePrice) : "");
  const [wholesaleMinQty, setWholesaleMinQty] = useState(initial?.wholesaleMinQty ? String(initial.wholesaleMinQty) : "");
  // تاریخ انقضا — فقط در صورت فعال کردن کاربر نمایش داده و ذخیره می‌شود
  const nowJ = toJalali(Date.now()) ?? { jy: 1404, jm: 1, jd: 1, h: 0, min: 0 };
  const initExpJ = initial?.expiryAt ? toJalali(initial.expiryAt) ?? nowJ : nowJ;
  const [hasExpiry, setHasExpiry] = useState(!!initial?.expiryAt);
  const [ejy, setEjy] = useState(initExpJ.jy);
  const [ejm, setEjm] = useState(initExpJ.jm);
  const [ejd, setEjd] = useState(initExpJ.jd);
  const expDaysInMonth = jalaliMonthLength(ejy, ejm);
  useEffect(() => { if (ejd > expDaysInMonth) setEjd(expDaysInMonth); }, [expDaysInMonth, ejd]);
  const EXP_YEARS = Array.from({ length: 8 }, (_, i) => nowJ.jy + i);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseNumberInput(price);
    if (!name.trim() || !priceNum) { alert("نام و قیمت الزامی است."); return; }
    const discountNum = Math.max(0, Math.min(100, parseNumberInput(discount)));
    const data: Omit<Product, "id"> = {
      name: name.trim(),
      price: priceNum,
      category: category.trim(),
      code: code.trim(),
      stock: parseNumberInput(stock) || 0,
      description: desc.trim() || undefined,
      lowStockThreshold: parseNumberInput(lowThreshold) || 5,
      unit,
      buyPrice: parseNumberInput(buyPrice) || undefined,
      consumerPrice: parseNumberInput(consumerPrice) || undefined,
      sellerPrice: parseNumberInput(sellerPrice) || undefined,
      discountPercent: discountNum || undefined,
      wholesalePrice: parseNumberInput(wholesalePrice) || undefined,
      wholesaleMinQty: parseNumberInput(wholesaleMinQty) || undefined,
      expiryAt: hasExpiry ? jalaliToTimestamp(ejy, ejm, ejd, 23, 59) : undefined,
    };
    if (isEdit && initial) onSave({ ...data, id: initial.id });
    else onSave(data);
  };

  const genCode = () => {
    setCode("P" + Math.random().toString(36).slice(2, 10).toUpperCase());
  };

  const confirmAddUnit = () => {
    const trimmed = newUnitName.trim();
    if (!trimmed) return;
    const next = addUnitDef({ name: trimmed, allowDecimal: newUnitDecimal });
    setUnitDefs(next);
    setUnit(trimmed);
    setNewUnitName("");
    setShowAddUnit(false);
  };

  const handleRemoveUnit = (e: React.MouseEvent, u: UnitDef) => {
    e.stopPropagation();
    if (u.name === COUNT_UNIT) return;
    if (!confirm(`واحد «${u.name}» حذف شود؟ محصولاتی که قبلاً با این واحد ثبت شده‌اند تغییری نمی‌کنند.`)) return;
    const next = removeUnitDef(u.name);
    setUnitDefs(next);
    if (unit === u.name) setUnit(COUNT_UNIT);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">{isEdit ? "ویرایش محصول" : "افزودن محصول جدید"}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="نام محصول *">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: شیر پرچرب کاله"
              className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={unit !== COUNT_UNIT ? `قیمت هر ${unit} (تومان) *` : "قیمت (تومان) *"}>
              <PriceInput value={price} onChange={setPrice} placeholder="۲۵٬۰۰۰" />
            </Field>
            <Field label={unit !== COUNT_UNIT ? `موجودی (${unit})` : "موجودی انبار"}>
              <input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="decimal" placeholder="۰"
                className={inputCls} />
            </Field>
          </div>
          <Field label="واحد فروش">
            <div className="flex flex-wrap gap-2">
              {unitDefs.map((u) => (
                <span
                  key={u.name}
                  className={`inline-flex items-center overflow-hidden rounded-xl border text-xs font-medium transition ${
                    unit === u.name ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  <button type="button" onClick={() => setUnit(u.name)} className="px-3 py-2">
                    {u.name}
                  </button>
                  {u.name !== COUNT_UNIT && (
                    <button
                      type="button"
                      onClick={(e) => handleRemoveUnit(e, u)}
                      className="grid h-full place-items-center border-r border-current/10 px-1.5 py-2 text-current/70 hover:bg-destructive/10 hover:text-destructive"
                      title={`حذف واحد ${u.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              <button
                type="button"
                onClick={() => setShowAddUnit((v) => !v)}
                className="rounded-xl border border-dashed border-primary/50 px-3 py-2 text-xs font-medium text-primary"
              >
                + واحد جدید
              </button>
            </div>
            {showAddUnit && (
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-secondary/40 p-2">
                <input
                  value={newUnitName}
                  onChange={(e) => setNewUnitName(e.target.value)}
                  placeholder="مثلاً: متر مربع، بسته، لیتر"
                  className="flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                />
                <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                  <input type="checkbox" checked={newUnitDecimal} onChange={(e) => setNewUnitDecimal(e.target.checked)} />
                  اعشاری
                </label>
                <button type="button" onClick={confirmAddUnit}
                  className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground">
                  افزودن
                </button>
              </div>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="دسته‌بندی">
              <select value={category} onChange={(e) => setCat(e.target.value)}
                className={inputCls}>
                <option value="">— بدون دسته —</option>
                {catList.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="هشدار موجودی کم">
              <input value={lowThreshold} onChange={(e) => setLow(e.target.value)} inputMode="numeric" placeholder="۵"
                className={inputCls} />
            </Field>
          </div>
          <Field label="کد بارکد / QR">
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" placeholder="اختیاری"
                className={inputCls} />
              <button type="button" onClick={genCode} className="shrink-0 rounded-xl border border-border px-3 text-xs">
                تولید
              </button>
            </div>
          </Field>

          {/* تاریخ انقضا — اختیاری؛ تا زمانی که فعال نشود هیچ فیلدی اضافه نمی‌شود */}
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent">
            <input
              type="checkbox"
              checked={hasExpiry}
              onChange={(e) => setHasExpiry(e.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            این محصول تاریخ انقضا دارد (اختیاری)
          </label>
          {hasExpiry && (
            <Field label="تاریخ انقضا (شمسی)">
              <div className="grid grid-cols-3 gap-1.5">
                <select value={ejd} onChange={(e) => setEjd(+e.target.value)} className={inputCls}>
                  {Array.from({ length: expDaysInMonth }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{formatNumber(d)}</option>
                  ))}
                </select>
                <select value={ejm} onChange={(e) => setEjm(+e.target.value)} className={inputCls}>
                  {JMONTHS_LONG.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
                <select value={ejy} onChange={(e) => setEjy(+e.target.value)} className={inputCls}>
                  {EXP_YEARS.map((y) => (
                    <option key={y} value={y}>{formatNumber(y)}</option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                محصولاتی که کمتر از ۳۰ روز تا انقضایشان مانده، در تب «نزدیک انقضا» نمایش داده می‌شوند.
              </p>
            </Field>
          )}

          {/* بخش اختیاری: قیمت خرید، قیمت مصرف‌کننده، قیمت همکار، تخفیف */}
          <button
            type="button"
            onClick={() => setShowOptional((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent"
          >
            <span>قیمت‌های تکمیلی و تخفیف (اختیاری)</span>
            <span>{showOptional ? "▲" : "▼"}</span>
          </button>
          {showOptional && (
            <div className="space-y-3 rounded-xl border border-border bg-background/50 p-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="قیمت خرید (برای سود)">
                  <PriceInput value={buyPrice} onChange={setBuyPrice} placeholder="—" />
                </Field>
                <Field label="درصد تخفیف">
                  <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" placeholder="۰"
                    className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="قیمت مصرف‌کننده">
                  <PriceInput value={consumerPrice} onChange={setConsumerPrice} placeholder="—" />
                </Field>
                <Field label="قیمت همکار / فروشنده">
                  <PriceInput value={sellerPrice} onChange={setSellerPrice} placeholder="—" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="قیمت عمده / کارتنی">
                  <PriceInput value={wholesalePrice} onChange={setWholesalePrice} placeholder="—" />
                </Field>
                <Field label="حداقل تعداد برای قیمت عمده">
                  <input
                    value={wholesaleMinQty}
                    onChange={(e) => setWholesaleMinQty(e.target.value)}
                    inputMode="numeric"
                    placeholder="مثلاً ۱۲"
                    className={inputCls}
                  />
                </Field>
              </div>
              <p className="text-[11px] text-muted-foreground leading-5">
                در صورت وارد کردن «قیمت عمده»، هنگام ثبت فاکتور می‌توانید با یک کلیک قیمت هر ردیف را به قیمت عمده تغییر دهید.
                اگر «حداقل تعداد» را هم وارد کنید، وقتی تعداد فاکتور به آن حد رسید قیمت به‌طور خودکار عمده حساب می‌شود.
              </p>
              {parseNumberInput(buyPrice) > 0 && parseNumberInput(price) > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  سود هر واحد:{" "}
                  <span className={parseNumberInput(price) >= parseNumberInput(buyPrice) ? "font-semibold text-green-600" : "font-semibold text-destructive"}>
                    {formatToman(parseNumberInput(price) - parseNumberInput(buyPrice))}
                  </span>
                </p>
              )}
            </div>
          )}

          <Field label="توضیحات">
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="توضیحات اضافی (اختیاری)"
              className={`${inputCls} resize-none`} />
          </Field>
          <button type="submit"
            className="mt-2 w-full rounded-xl bg-gradient-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-elegant">
            {isEdit ? "ذخیره تغییرات" : "ذخیره محصول"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Category Manager ─────────────────────────────────────────────────────────

function CategoryManager({
  catList,
  onClose,
  onChange,
}: {
  catList: Category[];
  onClose: () => void;
  onChange: (list: Category[]) => void;
}) {
  const [list, setList] = useState<Category[]>(catList);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const save = (updated: Category[]) => {
    setList(updated);
    onChange(updated);
    categories.save(updated);
  };

  const add = () => {
    if (!newName.trim()) return;
    save([...list, { id: cryptoId(), name: newName.trim() }]);
    setNewName("");
  };

  const remove = (id: string) => {
    save(list.filter((c) => c.id !== id));
  };

  const startEdit = (c: Category) => { setEditId(c.id); setEditName(c.name); };
  const commitEdit = () => {
    if (!editName.trim() || !editId) return;
    save(list.map((c) => (c.id === editId ? { ...c, name: editName.trim() } : c)));
    setEditId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">مدیریت دسته‌بندی‌ها</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="mb-3 space-y-2 max-h-52 overflow-y-auto">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
              {editId === c.id ? (
                <>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 bg-transparent text-sm outline-none" autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); }} />
                  <button onClick={commitEdit} className="text-xs font-semibold text-primary">ذخیره</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{c.name}</span>
                  <button onClick={() => startEdit(c)} className="text-muted-foreground hover:text-primary">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => remove(c.id)} className="text-destructive hover:text-destructive/80">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="نام دسته جدید..."
            className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <button onClick={add} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ProductsPage() {
  return <AuthGuard><ProductsPageInner /></AuthGuard>;
}
