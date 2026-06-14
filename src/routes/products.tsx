import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import {
  products, categories, settings, cryptoId, formatToman, formatNumber, stockStatus,
  parseNumberInput, COUNT_UNIT, WEIGHT_UNITS,
  type Product, type Category,
} from "@/lib/store";
import { generateUniqueCode } from "@/lib/barcode";
import { BulkImportModal } from "@/components/BulkImportModal";
import { BarcodePrintModal } from "@/components/BarcodePrintModal";
import { BarcodeViewModal } from "@/components/BarcodeViewModal";
import {
  Plus, Trash2, Package, X, Pencil, AlertTriangle,
  Search, Filter, Upload, Zap, Printer, Barcode, CheckSquare, Square, FileSpreadsheet,
} from "lucide-react";
import { z } from "zod";
import * as XLSX from "xlsx";
import { downloadFile } from "@/lib/download-file";

const searchSchema = z.object({ code: z.string().optional(), q: z.string().optional() });

export const Route = createFileRoute("/products")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "محصولات | کمالی حسابداری" },
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
  const [filterCat, setFilterCat] = useState<string>("all");
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

  const filtered = list.filter((p) => {
    const matchQ = !searchQ.trim() || p.name.includes(searchQ) || p.code.includes(searchQ);
    const matchCat = filterCat === "all" || p.category === filterCat;
    return matchQ && matchCat;
  });

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

  const totalInventoryValue = list.reduce((sum, p) => sum + p.price * p.stock, 0);
  const totalBuyValue = list.reduce((sum, p) => sum + (p.buyPrice ?? 0) * p.stock, 0);

  const exportToExcel = async () => {
    if (list.length === 0) { alert("محصولی برای خروجی وجود ندارد."); return; }
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
      "درصد تخفیف": p.discountPercent ?? "",
      "هشدار موجودی کم": p.lowStockThreshold ?? 5,
      "توضیحات": p.description ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    // Set column widths
    ws["!cols"] = [
      { wch: 25 }, { wch: 18 }, { wch: 10 }, { wch: 8 }, { wch: 20 },
      { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 18 },
      { wch: 12 }, { wch: 16 }, { wch: 25 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "محصولات");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    await downloadFile(
      out,
      `products-${new Date().toISOString().slice(0, 10)}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
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
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        <button onClick={() => setShowImport(true)} className="inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-card px-2 py-2 text-[11px]">
          <Upload className="h-3.5 w-3.5" /> ورود گروهی
        </button>
        <Link to="/quick-add" className="inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-card px-2 py-2 text-[11px]">
          <Zap className="h-3.5 w-3.5" /> ثبت سریع
        </Link>
        <button onClick={() => { setSelectMode((v) => !v); clearSelection(); }} className={`inline-flex items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] ${selectMode ? "border-primary bg-primary/5 text-primary" : "border-border bg-card"}`}>
          {selectMode ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />} انتخاب گروهی
        </button>
      </div>

      {/* Search + category filter */}
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
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="all">همه دسته‌ها</option>
          {catList.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={() => setShowCatManager(true)}
          className="rounded-xl border border-border px-2 text-xs"
          title="مدیریت دسته‌ها"
        >
          <Filter className="h-4 w-4" />
        </button>
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
          {filtered.map((p) => {
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

      {showImport && <BulkImportModal onClose={() => setShowImport(false)} />}
      {viewBarcode && <BarcodeViewModal product={viewBarcode} onClose={() => setViewBarcode(null)} />}
      {printTargets && <BarcodePrintModal items={printTargets} onClose={() => setPrintTargets(null)} />}
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
  const weightEnabled = !!appSettings.weightUnits;

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
    !!(initial?.buyPrice || initial?.consumerPrice || initial?.sellerPrice || initial?.discountPercent),
  );
  const [buyPrice, setBuyPrice]           = useState(initial?.buyPrice ? String(initial.buyPrice) : "");
  const [consumerPrice, setConsumerPrice] = useState(initial?.consumerPrice ? String(initial.consumerPrice) : "");
  const [sellerPrice, setSellerPrice]     = useState(initial?.sellerPrice ? String(initial.sellerPrice) : "");
  const [discount, setDiscount]           = useState(initial?.discountPercent ? String(initial.discountPercent) : "");

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
      unit: weightEnabled && unit !== COUNT_UNIT ? unit : undefined,
      buyPrice: parseNumberInput(buyPrice) || undefined,
      consumerPrice: parseNumberInput(consumerPrice) || undefined,
      sellerPrice: parseNumberInput(sellerPrice) || undefined,
      discountPercent: discountNum || undefined,
    };
    if (isEdit && initial) onSave({ ...data, id: initial.id });
    else onSave(data);
  };

  const genCode = () => {
    setCode("P" + Math.random().toString(36).slice(2, 10).toUpperCase());
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
            <Field label={weightEnabled && unit !== COUNT_UNIT ? `قیمت هر ${unit} (تومان) *` : "قیمت (تومان) *"}>
              <PriceInput value={price} onChange={setPrice} placeholder="۲۵٬۰۰۰" />
            </Field>
            <Field label={weightEnabled && unit !== COUNT_UNIT ? `موجودی (${unit})` : "موجودی انبار"}>
              <input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="decimal" placeholder="۰"
                className={inputCls} />
            </Field>
          </div>
          {weightEnabled && (
            <Field label="واحد فروش">
              <div className="grid grid-cols-3 gap-2">
                {[COUNT_UNIT, ...WEIGHT_UNITS].map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnit(u)}
                    className={`rounded-xl border px-2 py-2 text-xs font-medium transition ${
                      unit === u ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </Field>
          )}
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
