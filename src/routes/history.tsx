import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { InvoiceActions } from "@/components/InvoiceActions";
import { PurchaseCard } from "@/routes/purchases";
import {
  invoice, products, purchases, formatToman, formatNumber, formatJalaliDateTime, settings,
  PAYMENT_LABEL, parseNumberInput, applyProductDiscount, recalc,
  toJalaliInputDate, toJalaliInputTime, parseJalaliInput, parseTimeInput, jalaliToTimestamp, toJalali,
  type Invoice, type InvoiceItem, type Product, type PaymentMethod, type Purchase,
} from "@/lib/store";
import { invoiceTotals, lineTotal } from "@/lib/invoice-math";
import { filterAndRankSearch } from "@/lib/search";
import {
  History as HistoryIcon,
  ChevronDown, ChevronUp,
  User, Pencil, Trash2, Check, X, Calendar,
  Minus, Plus, Search, PlusCircle, Wallet,
  Receipt, ShoppingBag,
} from "lucide-react";
import { z } from "zod";

const searchSchema = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/history")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "تاریخچه فاکتورها | KAMIX" },
      { name: "description", content: "تاریخچه فاکتورهای ثبت‌شده." },
    ],
  }),
  component: HistoryPage,
});

/** یک سطر از خلاصه‌ی مبالغ فاکتور */
function Row({
  label, value, bold, tone,
}: { label: string; value: string; bold?: boolean; tone?: "primary" | "destructive" }) {
  const color =
    tone === "primary" ? "text-primary" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${color} ${bold ? "font-bold" : "font-medium"}`}>{value}</span>
    </div>
  );
}

// ─── ویرایش یک آیتم ─────────────────────────────────────────────────────────

function EditableItem({
  item,
  onChange,
  onRemove,
}: {
  item: InvoiceItem;
  onChange: (updated: InvoiceItem) => void;
  onRemove: () => void;
}) {
  return (
    <li className="space-y-2 rounded-xl border border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.name}</div>
          <div className="text-[11px] text-muted-foreground">جمع: {formatToman(lineTotal(item))}</div>
        </div>
        {/* تعداد */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={() => onChange({ ...item, quantity: Math.max(1, item.quantity - 1) })}
          className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-6 text-center text-sm font-semibold">
          {item.quantity.toLocaleString("fa-IR")}
        </span>
        <button
          type="button"
          onClick={() => onChange({ ...item, quantity: item.quantity + 1 })}
          className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
          title="حذف"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-muted-foreground">قیمت واحد:</label>
        <input
          inputMode="numeric"
          value={item.price.toLocaleString("fa-IR")}
          onChange={(e) => onChange({ ...item, price: Math.max(0, parseNumberInput(e.target.value)) })}
          className="flex-1 rounded-lg border border-input bg-card px-2 py-1 text-xs outline-none focus:border-primary"
        />
        <span className="text-[11px] text-muted-foreground">تومان</span>
      </div>
    </li>
  );
}

// ─── یک فاکتور ──────────────────────────────────────────────────────────────

function InvoiceCard({ inv: initialInv }: { inv: Invoice }) {
  const [appSettings] = settings.useAll();
  const [allProducts] = products.useAll();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Invoice>(initialInv);
  // نگه داری آخرین نسخه ذخیره‌شده (برای نمایش بعد از save)
  const [saved, setSaved] = useState<Invoice>(initialInv);
  const [addQuery, setAddQuery] = useState("");
  const [dateStr, setDateStr] = useState<string>(toJalaliInputDate(initialInv.createdAt));
  const [timeStr, setTimeStr] = useState<string>(toJalaliInputTime(initialInv.createdAt));
  const [dateErr, setDateErr] = useState<string | null>(null);

  const customer = saved.customer;
  const hasCustomer = customer && (customer.firstName || customer.lastName || customer.phone);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft({
      ...saved,
      shopName: saved.shopName || appSettings.shopName,
      shopAddress: saved.shopAddress || appSettings.storeAddress,
      shopPhone: saved.shopPhone || appSettings.storePhones?.[0],
      shopLogoUrl: saved.shopLogoUrl || appSettings.logoUrl,
    });
    setEditing(true);
    setIsOpen(true);
    setAddQuery("");
    setDateStr(toJalaliInputDate(saved.createdAt));
    setTimeStr(toJalaliInputTime(saved.createdAt));
    setDateErr(null);
  };

  const cancelEdit = () => {
    setDraft(saved);
    setEditing(false);
    setAddQuery("");
    setDateErr(null);
  };

  const saveEdit = () => {
    // پارس تاریخ/ساعت شمسی
    const jd = parseJalaliInput(dateStr);
    if (!jd) { setDateErr("تاریخ نامعتبر است. فرمت: ۱۴۰۳/۰۵/۱۲"); return; }
    // اگر ساعت وارد‌شده قابل تشخیص نبود، به‌جای صفر کردن ساعت، همان ساعت قبلی فاکتور حفظ می‌شود
    const prevTime = toJalali(saved.createdAt);
    const tm = parseTimeInput(timeStr) ?? (prevTime ? { h: prevTime.h, min: prevTime.min } : { h: 0, min: 0 });
    const newCreatedAt = jalaliToTimestamp(jd.jy, jd.jm, jd.jd, tm.h, tm.min);
    // بازمحاسبه با recalc — تخفیف فاکتور (درصدی یا مبلغی) حفظ و دوباره اعمال
    // می‌شود. قبلاً اینجا فقط جمع خام اقلام حساب می‌شد و تخفیفِ فاکتور بعد از هر
    // ویرایش از جمع کل حذف می‌شد، در حالی‌که سطر «تخفیف» روی فاکتور چاپی می‌ماند.
    const updated = recalc({ ...draft, createdAt: newCreatedAt });
    invoice.updateHistory(updated);
    setSaved(updated);
    setDraft(updated);
    setEditing(false);
    setAddQuery("");
    setDateErr(null);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("آیا این فاکتور حذف شود؟")) {
      invoice.deleteFromHistory(saved.id);
    }
  };

  const updateItem = (idx: number, updated: InvoiceItem) => {
    setDraft((d) => {
      const items = d.items.map((it, i) => (i === idx ? updated : it));
      return { ...d, items };
    });
  };

  const removeItem = (idx: number) => {
    setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
  };

  const addProduct = (p: Product) => {
    setDraft((d) => {
      const exists = d.items.find((i) => i.productId === p.id);
      const effective = applyProductDiscount(p);
      if (exists) {
        return { ...d, items: d.items.map((i) => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i) };
      }
      return {
        ...d,
        items: [...d.items, { productId: p.id, name: p.name, price: effective, quantity: 1, buyPrice: p.buyPrice, unit: p.unit }],
      };
    });
    setAddQuery("");
  };

  const matchingProducts = useMemo(() => {
    const q = addQuery.trim();
    if (!q) return [] as Product[];
    return filterAndRankSearch(allProducts, q, (p) => [p.name, p.code]).slice(0, 8);
  }, [addQuery, allProducts]);

  // فاکتور آماده برای InvoiceActions (با shopName/آدرس/تلفن)
  const printInv = {
    ...saved,
    shopName: saved.shopName || appSettings.shopName,
    shopAddress: saved.shopAddress || appSettings.storeAddress,
    shopPhone: saved.shopPhone || appSettings.storePhones?.[0],
    shopLogoUrl: saved.shopLogoUrl || appSettings.logoUrl,
  };

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {/* هدر */}
      <button
        onClick={() => !editing && setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-right"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-primary">{formatToman(saved.total)}</span>
            {hasCustomer && <User className="h-3.5 w-3.5 text-muted-foreground" />}
            {saved.paymentMethod && (
              <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {PAYMENT_LABEL[saved.paymentMethod]}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatJalaliDateTime(saved.createdAt)} · {saved.items.length} قلم
          </div>
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {/* اکشن‌های فاکتور */}
          <InvoiceActions inv={printInv} size="sm" />

          {/* ویرایش */}
          <button
            type="button"
            onClick={startEdit}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            title="ویرایش فاکتور"
          >
            <Pencil className="h-4 w-4" />
          </button>

          {/* حذف */}
          <button
            type="button"
            onClick={handleDelete}
            className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
            title="حذف فاکتور"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          {isOpen
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {/* محتوا */}
      {isOpen && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">

          {/* اطلاعات مشتری */}
          {hasCustomer && !editing && (
            <div className="rounded-lg bg-accent px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">مشتری: </span>
              {[customer?.firstName, customer?.lastName].filter(Boolean).join(" ")}
              {customer?.phone && (
                <span className="mr-2" dir="ltr">{customer.phone}</span>
              )}
            </div>
          )}

          {/* حالت نمایش */}
          {!editing && (
            <>
              {saved.notes && (
                <div className="rounded-lg bg-accent px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">توضیحات: </span>
                  {saved.notes}
                </div>
              )}
              <ul className="space-y-1">
                {saved.items.map((item) => (
                  <li key={item.productId} className="flex justify-between text-xs text-muted-foreground">
                    <span>{item.name} × {item.quantity.toLocaleString("fa-IR")}</span>
                    <span>{formatToman(lineTotal(item))}</span>
                  </li>
                ))}
              </ul>
              {/* خلاصه‌ی مبالغ — عیناً همان چیزی که روی فاکتور چاپی می‌آید */}
              {(() => {
                const t = invoiceTotals(saved);
                const showBreakdown = t.discount > 0 || t.paid > 0 || t.checkAmount > 0;
                if (!showBreakdown) return null;
                return (
                  <div className="space-y-1 rounded-lg border border-border bg-background px-3 py-2 text-xs">
                    <Row label="جمع اقلام" value={formatToman(t.subtotal)} />
                    {t.discount > 0 && (
                      <Row
                        label={`تخفیف${t.discountPercent ? ` (٪${formatNumber(t.discountPercent)})` : ""}`}
                        value={formatToman(t.discount)}
                        tone="primary"
                      />
                    )}
                    <Row label="جمع کل" value={formatToman(t.total)} bold />
                    {t.paid > 0 && <Row label="پرداخت نقدی" value={formatToman(t.paid)} />}
                    {t.checkAmount > 0 && <Row label="مبلغ چک" value={formatToman(t.checkAmount)} />}
                    {t.remaining > 0 && (
                      <Row label="مانده" value={formatToman(t.remaining)} tone="destructive" />
                    )}
                  </div>
                );
              })()}
            </>
          )}

          {/* حالت ویرایش */}
          {editing && (
            <div className="space-y-3">
              {/* تاریخ و ساعت فاکتور */}
              <div className="rounded-xl border border-border bg-background p-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" /> تاریخ و ساعت فاکتور (شمسی)
                </div>
                <div className="flex gap-2" dir="ltr">
                  <input
                    value={dateStr}
                    onChange={(e) => { setDateStr(e.target.value); setDateErr(null); }}
                    placeholder="1403/05/12"
                    inputMode="numeric"
                    className="flex-1 rounded-lg border border-input bg-card px-2 py-1.5 text-xs outline-none focus:border-primary"
                  />
                  <input
                    value={timeStr}
                    onChange={(e) => setTimeStr(e.target.value)}
                    placeholder="14:30"
                    inputMode="numeric"
                    className="w-24 rounded-lg border border-input bg-card px-2 py-1.5 text-xs outline-none focus:border-primary"
                  />
                </div>
                {dateErr && <div className="mt-1 text-[10px] text-destructive">{dateErr}</div>}
              </div>

              {/* نام مشتری */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={draft.customer?.firstName ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, customer: { ...d.customer, firstName: e.target.value } }))
                  }
                  placeholder="نام"
                  className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <input
                  value={draft.customer?.lastName ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, customer: { ...d.customer, lastName: e.target.value } }))
                  }
                  placeholder="نام خانوادگی"
                  className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <input
                value={draft.customer?.phone ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, customer: { ...d.customer, phone: e.target.value } }))
                }
                placeholder="تلفن"
                inputMode="tel"
                dir="ltr"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />

              {/* روش پرداخت */}
              <div className="rounded-xl border border-border bg-background p-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Wallet className="h-3.5 w-3.5" /> روش پرداخت
                </div>
                <div className="flex gap-1.5">
                  {(["cash","card","credit"] as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, paymentMethod: m }))}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                        draft.paymentMethod === m
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {PAYMENT_LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>

              {/* توضیحات */}
              <textarea
                value={draft.notes ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="توضیحات فاکتور (اختیاری)"
                rows={2}
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />

              {/* اقلام */}
              <ul className="space-y-2">
                {draft.items.map((item, idx) => (
                  <EditableItem
                    key={item.productId}
                    item={item}
                    onChange={(u) => updateItem(idx, u)}
                    onRemove={() => removeItem(idx)}
                  />
                ))}
              </ul>

              {/* افزودن محصول */}
              <div className="rounded-xl border border-dashed border-border bg-background p-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <PlusCircle className="h-3.5 w-3.5" /> افزودن محصول
                </div>
                <input
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="نام یا بارکد محصول..."
                  className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs outline-none focus:border-primary"
                />
                {matchingProducts.length > 0 && (
                  <ul className="mt-1.5 max-h-44 space-y-1 overflow-y-auto">
                    {matchingProducts.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => addProduct(p)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
                        >
                          <span className="truncate">{p.name}</span>
                          <span className="shrink-0 text-muted-foreground">{formatToman(applyProductDiscount(p))}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* جمع موقت — دقیقاً با همان منطقی که ذخیره و چاپ می‌شود */}
              {(() => {
                const t = invoiceTotals(draft);
                return (
                  <div className="space-y-0.5 text-left text-sm">
                    {t.discount > 0 && (
                      <>
                        <div className="text-xs text-muted-foreground">
                          جمع اقلام: {formatToman(t.subtotal)}
                        </div>
                        <div className="text-xs text-primary">
                          تخفیف{t.discountPercent ? ` (٪${formatNumber(t.discountPercent)})` : ""}:{" "}
                          {formatToman(t.discount)}
                        </div>
                      </>
                    )}
                    <div className="font-semibold text-primary">جمع کل: {formatToman(t.total)}</div>
                  </div>
                );
              })()}

              {/* دکمه‌های ذخیره/لغو */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={draft.items.length === 0}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  ذخیره تغییرات
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm"
                >
                  <X className="h-4 w-4" />
                  لغو
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ─── صفحه اصلی ────────────────────────────────────────────────────────────────

type InvoiceCategory = "sale" | "purchase";

export function HistoryPageInner() {
  const { q: incomingQuery } = Route.useSearch();
  const [list] = invoice.useHistory();
  const [purchaseList] = purchases.useHistory();
  const [category, setCategory] = useState<InvoiceCategory>("sale");
  const [searchQ, setSearchQ] = useState(incomingQuery ?? "");

  useEffect(() => {
    if (incomingQuery != null) setSearchQ(incomingQuery);
  }, [incomingQuery]);

  const filtered = useMemo(() => {
    const q = searchQ.trim();
    if (!q) return list;
    return filterAndRankSearch(list, q, (inv) => [
      inv.id,
      [inv.customer?.firstName, inv.customer?.lastName].filter(Boolean).join(" "),
      inv.customer?.phone,
      ...inv.items.map((i) => i.name),
    ]);
  }, [list, searchQ]);

  const filteredPurchases = useMemo(() => {
    const q = searchQ.trim();
    if (!q) return purchaseList;
    return filterAndRankSearch(purchaseList, q, (p) => [
      p.id,
      p.supplierName,
      ...p.items.map((i) => i.name),
    ]);
  }, [purchaseList, searchQ]);

  const activeList = category === "sale" ? list : purchaseList;
  const activeFiltered = category === "sale" ? filtered : filteredPurchases;
  const searchPlaceholder =
    category === "sale"
      ? "جستجو: نام مشتری، محصول، شماره فاکتور..."
      : "جستجو: تامین‌کننده، محصول، شماره فاکتور...";

  return (
    <Layout>
      <h1 className="mb-3 text-lg font-bold">تاریخچه فاکتورها</h1>

      {/* دسته‌بندی: فاکتور فروش / فاکتور خرید */}
      <div className="mb-3 flex gap-1 rounded-xl bg-muted p-1">
        <button
          onClick={() => setCategory("sale")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
            category === "sale" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Receipt className="h-3.5 w-3.5" />
          فاکتور فروش ({formatNumber(list.length)})
        </button>
        <button
          onClick={() => setCategory("purchase")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
            category === "purchase" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          فاکتور خرید ({formatNumber(purchaseList.length)})
        </button>
      </div>

      {activeList.length > 0 && (
        <div className="relative mb-3">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
          />
          {searchQ && (
            <button onClick={() => setSearchQ("")} className="absolute left-2 top-2.5 text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {activeList.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <HistoryIcon className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {category === "sale" ? "هنوز فاکتور فروشی ثبت نشده است." : "هنوز فاکتور خریدی ثبت نشده است."}
          </p>
        </div>
      ) : activeFiltered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <Search className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">فاکتوری با این مشخصات یافت نشد.</p>
        </div>
      ) : (
        <>
          {searchQ.trim() && (
            <p className="mb-2 text-xs text-muted-foreground">{formatNumber(activeFiltered.length)} فاکتور یافت شد</p>
          )}
          {category === "sale" ? (
            <ul className="space-y-2">
              {(activeFiltered as Invoice[]).map((inv) => (
                <InvoiceCard key={inv.id} inv={inv} />
              ))}
            </ul>
          ) : (
            <ul className="space-y-2">
              {(activeFiltered as Purchase[]).map((p) => (
                <PurchaseCard key={p.id} p={p} />
              ))}
            </ul>
          )}
        </>
      )}
    </Layout>
  );
}

function HistoryPage() {
  return <AuthGuard><HistoryPageInner /></AuthGuard>;
}
