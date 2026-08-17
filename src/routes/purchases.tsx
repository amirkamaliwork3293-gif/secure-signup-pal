import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { PurchaseActions } from "@/components/PurchaseActions";
import {
  products,
  categories,
  purchases,
  customers,
  customerFullName,
  settings,
  emptyPurchase,
  recalcPurchase,
  formatToman,
  formatNumber,
  formatJalaliDateTime,
  parseNumberInput,
  PAYMENT_LABEL,
  toJalaliInputDate,
  toJalaliInputTime,
  parseJalaliInput,
  parseTimeInput,
  jalaliToTimestamp,
  toJalali,
  getUnitDefs,
  COUNT_UNIT,
  type Product,
  type PurchaseItem,
  type Purchase,
  type PaymentMethod,
  type UnitDef,
} from "@/lib/store";
import { purchaseLineTotal, purchaseTotals } from "@/lib/invoice-math";
import { filterAndRankSearch, personNameSearchFields } from "@/lib/search";
import {
  ShoppingBag, Plus, Trash2, Search, X, Package, Check,
  ChevronDown, ChevronUp, Truck, History as HistoryIcon,
  Pencil, Calendar, PlusCircle, Minus, Users,
} from "lucide-react";
import { z } from "zod";

const searchSchema = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/purchases")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "فاکتور خرید | KAMIX" },
      { name: "description", content: "ثبت خرید کالا از تامین‌کننده و به‌روزرسانی خودکار انبار و قیمت خرید." },
    ],
  }),
  component: PurchasesPage,
});

// ─── ویرایش یک قلم فاکتور خرید ───────────────────────────────────────────────

function EditablePurchaseItem({
  item,
  onChange,
  onRemove,
  unitDefs,
}: {
  item: PurchaseItem;
  onChange: (updated: PurchaseItem) => void;
  onRemove: () => void;
  unitDefs: UnitDef[];
}) {
  return (
    <li className="space-y-2 rounded-xl border border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {item.productId ? (
            <div className="truncate text-sm font-medium">{item.name}</div>
          ) : (
            <input
              value={item.name}
              onChange={(e) => onChange({ ...item, name: e.target.value })}
              placeholder="نام کالا"
              className="w-full rounded-lg border border-input bg-card px-2 py-1 text-sm outline-none focus:border-primary"
            />
          )}
          <div className="text-[11px] text-muted-foreground">جمع: {formatToman(purchaseLineTotal(item))}</div>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card">
          <button
            type="button"
            onClick={() => onChange({ ...item, quantity: Math.max(1, item.quantity - 1) })}
            className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-6 text-center text-sm font-semibold">{formatNumber(item.quantity)}</span>
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
        <label className="text-[11px] text-muted-foreground">قیمت خرید واحد:</label>
        <input
          inputMode="numeric"
          value={item.buyPrice.toLocaleString("fa-IR")}
          onChange={(e) => onChange({ ...item, buyPrice: Math.max(0, parseNumberInput(e.target.value)) })}
          className="flex-1 rounded-lg border border-input bg-card px-2 py-1 text-xs outline-none focus:border-primary"
        />
        <span className="text-[11px] text-muted-foreground">تومان</span>
      </div>
      {!item.productId && (
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-muted-foreground shrink-0">واحد:</label>
          <select
            value={item.unit || COUNT_UNIT}
            onChange={(e) => onChange({ ...item, unit: e.target.value })}
            className="flex-1 rounded-lg border border-input bg-card px-2 py-1 text-xs outline-none focus:border-primary"
          >
            {unitDefs.map((u) => (
              <option key={u.name} value={u.name}>{u.name}</option>
            ))}
          </select>
        </div>
      )}
    </li>
  );
}

// ─── کارت یک فاکتور خرید در تاریخچه (نمایش/ویرایش/پرینت/حذف) ─────────────────

export function PurchaseCard({ p: initialP }: { p: Purchase }) {
  const [appSettings] = settings.useAll();
  const [allProducts] = products.useAll();
  const [catList] = categories.useAll();
  const unitDefs = useMemo<UnitDef[]>(() => getUnitDefs(), [appSettings.units]);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Purchase>(initialP);
  const [saved, setSaved] = useState<Purchase>(initialP);
  const [addQuery, setAddQuery] = useState("");
  const [dateStr, setDateStr] = useState<string>(toJalaliInputDate(initialP.createdAt));
  const [timeStr, setTimeStr] = useState<string>(toJalaliInputTime(initialP.createdAt));
  const [dateErr, setDateErr] = useState<string | null>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft({
      ...saved,
      shopName: saved.shopName || appSettings.shopName,
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
    const total = purchaseTotals(draft).total;
    const jd = parseJalaliInput(dateStr);
    if (!jd) { setDateErr("تاریخ نامعتبر است. فرمت: ۱۴۰۳/۰۵/۱۲"); return; }
    // اگر ساعت وارد‌شده قابل تشخیص نبود، به‌جای صفر کردن ساعت، همان ساعت قبلی فاکتور حفظ می‌شود
    const prevTime = toJalali(saved.createdAt);
    const tm = parseTimeInput(timeStr) ?? (prevTime ? { h: prevTime.h, min: prevTime.min } : { h: 0, min: 0 });
    const newCreatedAt = jalaliToTimestamp(jd.jy, jd.jm, jd.jd, tm.h, tm.min);
    const updated = { ...draft, total, createdAt: newCreatedAt };
    purchases.updateHistory(updated);
    setSaved(updated);
    setDraft(updated);
    setEditing(false);
    setAddQuery("");
    setDateErr(null);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("این فاکتور خرید از تاریخچه حذف شود؟ (تاثیری در موجودی فعلی انبار ندارد)")) {
      purchases.deleteFromHistory(saved.id);
    }
  };

  const updateItem = (idx: number, updated: PurchaseItem) => {
    setDraft((d) => ({ ...d, items: d.items.map((it, i) => (i === idx ? updated : it)) }));
  };

  const removeItem = (idx: number) => {
    setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
  };

  const addExisting = (prod: Product) => {
    setDraft((d) => {
      const already = d.items.find((it) => it.productId === prod.id);
      const items = already
        ? d.items.map((it) => (it.productId === prod.id ? { ...it, quantity: it.quantity + 1 } : it))
        : [...d.items, { productId: prod.id, name: prod.name, quantity: 1, buyPrice: prod.buyPrice ?? 0, unit: prod.unit, category: prod.category }];
      return { ...d, items };
    });
    setAddQuery("");
  };

  const addManualItem = () => {
    setDraft((d) => ({
      ...d,
      items: [...d.items, { productId: "", name: "", quantity: 1, buyPrice: 0, sellPrice: 0, unit: COUNT_UNIT, category: catList[0]?.name || "" }],
    }));
  };

  const matchingProducts = useMemo(() => {
    const q = addQuery.trim();
    if (!q) return [] as Product[];
    return filterAndRankSearch(allProducts, q, (pr) => [pr.name, pr.code]).slice(0, 8);
  }, [addQuery, allProducts]);

  const printP: Purchase = {
    ...saved,
    shopName: saved.shopName || appSettings.shopName,
    shopLogoUrl: saved.shopLogoUrl || appSettings.logoUrl,
  };

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="px-3 py-3 sm:px-4">
        <button
          onClick={() => !editing && setIsOpen((v) => !v)}
          className="flex w-full min-w-0 items-start justify-between gap-2 text-right"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-words text-sm font-semibold text-primary">{formatToman(saved.total)}</span>
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <Truck className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{saved.supplierName || "بدون نام تامین‌کننده"}</span>
              </span>
              {saved.paymentMethod && (
                <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {PAYMENT_LABEL[saved.paymentMethod]}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {formatJalaliDateTime(saved.createdAt)} · {saved.items.length.toLocaleString("fa-IR")} قلم
            </div>
          </div>
          {isOpen ? <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
        </button>

        <div className="mt-2 flex flex-wrap items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <PurchaseActions p={printP} size="sm" />
          <button
            type="button"
            onClick={startEdit}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            title="ویرایش فاکتور خرید"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
            title="حذف فاکتور"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
          {!editing && (
            <>
              {saved.supplierPhone && (
                <div className="rounded-lg bg-accent px-3 py-2 text-xs text-muted-foreground" dir="ltr">
                  <span className="font-medium text-foreground" dir="rtl">تلفن تامین‌کننده: </span>
                  {saved.supplierPhone}
                </div>
              )}
              {saved.note && (
                <div className="rounded-lg bg-accent px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">یادداشت: </span>
                  {saved.note}
                </div>
              )}
              <ul className="space-y-1">
                {saved.items.map((it, i) => (
                  <li key={i} className="flex justify-between text-xs text-muted-foreground">
                    <span>{it.name} × {formatNumber(it.quantity)}</span>
                    <span>{formatToman(purchaseLineTotal(it))}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

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

              {/* تامین‌کننده */}
              <input
                value={draft.supplierName ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, supplierName: e.target.value }))}
                placeholder="نام تامین‌کننده"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                value={draft.supplierPhone ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, supplierPhone: e.target.value }))}
                placeholder="تلفن تامین‌کننده"
                inputMode="tel"
                dir="ltr"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />

              {/* روش پرداخت */}
              <div className="rounded-xl border border-border bg-background p-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  روش پرداخت
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, paymentMethod: m }))}
                      className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${
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

              {/* یادداشت */}
              <textarea
                value={draft.note ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                placeholder="یادداشت فاکتور (اختیاری)"
                rows={2}
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />

              {/* اقلام */}
              <ul className="space-y-2">
                {draft.items.map((item, idx) => (
                  <EditablePurchaseItem
                    key={idx}
                    item={item}
                    onChange={(u) => updateItem(idx, u)}
                    onRemove={() => removeItem(idx)}
                    unitDefs={unitDefs}
                  />
                ))}
              </ul>

              {/* افزودن کالا */}
              <div className="rounded-xl border border-dashed border-border bg-background p-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <PlusCircle className="h-3.5 w-3.5" /> افزودن کالا
                </div>
                <input
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="نام یا کد کالا..."
                  className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs outline-none focus:border-primary"
                />
                {matchingProducts.length > 0 && (
                  <ul className="mt-1.5 max-h-44 space-y-1 overflow-y-auto">
                    {matchingProducts.map((pr) => (
                      <li key={pr.id}>
                        <button
                          type="button"
                          onClick={() => addExisting(pr)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
                        >
                          <span className="truncate">{pr.name}</span>
                          <span className="shrink-0 text-muted-foreground">موجودی: {formatNumber(pr.stock)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={addManualItem}
                  className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1.5 text-[11px] font-medium text-primary hover:bg-accent"
                >
                  <Plus className="h-3 w-3" />
                  کالای جدید (که در انبار نیست)
                </button>
              </div>

              <PurchaseDiscountBox
                discountPercent={draft.discountPercent}
                discountAmount={draft.discountAmount}
                onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
              />

              {(() => {
                const t = purchaseTotals(draft);
                return (
                  <div className="space-y-0.5 text-left text-sm">
                    {t.discount > 0 && (
                      <>
                        <div className="text-xs text-muted-foreground">جمع اقلام: {formatToman(t.subtotal)}</div>
                        <div className="text-xs text-primary">
                          تخفیف{t.discountPercent ? ` (٪${formatNumber(t.discountPercent)})` : ""}: {formatToman(t.discount)}
                        </div>
                      </>
                    )}
                    <div className="font-semibold text-primary">جمع کل: {formatToman(t.total)}</div>
                  </div>
                );
              })()}

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

// ─── صفحه اصلی: ثبت فاکتور خرید جدید + تاریخچه ────────────────────────────────

/** جعبه‌ی تخفیف کل فاکتور خرید — درصد یا مبلغ ثابت */
function PurchaseDiscountBox({
  discountPercent,
  discountAmount,
  onChange,
}: {
  discountPercent?: number;
  discountAmount?: number;
  onChange: (p: { discountPercent?: number; discountAmount?: number }) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-2">
      <div className="mb-1.5 text-[11px] text-muted-foreground">تخفیف کل فاکتور خرید (اختیاری)</div>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1">
          <input
            inputMode="numeric"
            value={discountPercent ? formatNumber(discountPercent) : ""}
            onChange={(e) => {
              const v = Math.min(100, Math.max(0, parseNumberInput(e.target.value)));
              onChange({ discountPercent: v || undefined, discountAmount: undefined });
            }}
            placeholder="درصد"
            className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
          <span className="text-[11px] text-muted-foreground">٪</span>
        </div>
        <div className="flex flex-1 items-center gap-1">
          <input
            inputMode="numeric"
            value={discountAmount ? formatNumber(discountAmount) : ""}
            onChange={(e) => {
              const v = Math.max(0, parseNumberInput(e.target.value));
              onChange({ discountAmount: v || undefined, discountPercent: undefined });
            }}
            placeholder="مبلغ"
            className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
          <span className="text-[11px] text-muted-foreground">تومان</span>
        </div>
      </div>
    </div>
  );
}

export function PurchasesPageInner() {
  const { q: incomingQuery } = Route.useSearch();
  const [allProducts] = products.useAll();
  const [catList] = categories.useAll();
  const [history] = purchases.useHistory();
  const [appSettings] = settings.useAll();
  const [customerList] = customers.useAll();
  // واحدهای فروش تعریف‌شده توسط کاربر (پیش‌فرض‌ها + واحدهای سفارشی مثل «متر مربع»)
  // تا در فاکتور خرید هم برای کالاهای جدید قابل انتخاب باشند، نه فقط در فرم محصول.
  const unitDefs = useMemo<UnitDef[]>(() => getUnitDefs(), [appSettings.units]);

  const [draft, setDraft] = useState<Purchase>(emptyPurchase());
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [dateStr, setDateStr] = useState<string>(toJalaliInputDate(Date.now()));
  const [timeStr, setTimeStr] = useState<string>(toJalaliInputTime(Date.now()));
  const [dateErr, setDateErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [showHistory, setShowHistory] = useState(true);
  const [searchQ, setSearchQ] = useState(incomingQuery ?? "");

  useEffect(() => {
    if (incomingQuery != null) setSearchQ(incomingQuery);
  }, [incomingQuery]);

  const matches = useMemo(() => {
    if (!query.trim()) return [] as Product[];
    return filterAndRankSearch(allProducts, query, (p) => [p.name, p.code]).slice(0, 6);
  }, [query, allProducts]);

  const filteredHistory = useMemo(() => {
    const q = searchQ.trim();
    if (!q) return history;
    return filterAndRankSearch(history, q, (p) => [
      p.id,
      p.supplierName,
      p.supplierPhone,
      ...p.items.map((i) => i.name),
    ]);
  }, [history, searchQ]);

  const matchingCustomers = useMemo(() => {
    const q = customerQuery.trim();
    if (!q) return customerList.slice(0, 8);
    return filterAndRankSearch(customerList, q, (c) => [...personNameSearchFields(c), c.phone ?? ""]).slice(0, 8);
  }, [customerList, customerQuery]);

  const totals = purchaseTotals(draft);
  const total = totals.total;

  const addExisting = (p: Product) => {
    setDraft((prev) => {
      const already = prev.items.find((it) => it.productId === p.id);
      const items = already
        ? prev.items.map((it) => (it.productId === p.id ? { ...it, quantity: it.quantity + 1 } : it))
        : [
            ...prev.items,
            { productId: p.id, name: p.name, quantity: 1, buyPrice: p.buyPrice ?? 0, unit: p.unit, category: p.category } as PurchaseItem,
          ];
      return recalcPurchase({ ...prev, items });
    });
    setQuery("");
  };

  const addManualItem = () => {
    setDraft((prev) =>
      recalcPurchase({
        ...prev,
        items: [
          ...prev.items,
          { productId: "", name: "", quantity: 1, buyPrice: 0, sellPrice: 0, unit: COUNT_UNIT, category: catList[0]?.name || "" } as PurchaseItem,
        ],
      }),
    );
  };

  const updateItem = (idx: number, patch: Partial<PurchaseItem>) => {
    setDraft((prev) =>
      recalcPurchase({ ...prev, items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }),
    );
  };

  const removeItem = (idx: number) => {
    setDraft((prev) => recalcPurchase({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const canSubmit = draft.items.length > 0 && draft.items.every((it) => it.quantity > 0 && it.name.trim());

  const submit = () => {
    if (!canSubmit) {
      alert("حداقل یک کالا با نام، تعداد و قیمت خرید معتبر وارد کنید.");
      return;
    }
    const jd = parseJalaliInput(dateStr);
    const tm = parseTimeInput(timeStr) ?? { h: 0, min: 0 };
    if (!jd) {
      setDateErr("تاریخ نامعتبر است. فرمت: ۱۴۰۳/۰۵/۱۲");
      return;
    }
    const createdAt = jalaliToTimestamp(jd.jy, jd.jm, jd.jd, tm.h, tm.min);
    purchases.archive(
      {
        ...draft,
        createdAt,
        supplierName: supplierName.trim() || undefined,
        supplierPhone: supplierPhone.trim() || undefined,
        note: note.trim() || undefined,
        paymentMethod,
        total,
        shopName: appSettings.shopName,
        shopLogoUrl: appSettings.logoUrl || undefined,
      },
      { keepCreatedAt: true },
    );
    setDraft(emptyPurchase());
    setSupplierName("");
    setSupplierPhone("");
    setNote("");
    setPaymentMethod("cash");
    setDateStr(toJalaliInputDate(Date.now()));
    setTimeStr(toJalaliInputTime(Date.now()));
    setDateErr(null);
    alert("فاکتور خرید ثبت شد و موجودی/قیمت خرید انبار به‌روزرسانی شد.");
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">فاکتور خرید</h1>
        </div>
        <Link
          to="/products"
          className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
        >
          انبار محصولات
        </Link>
      </div>

      <p className="mb-4 text-xs leading-6 text-muted-foreground">
        کالاهایی که از تامین‌کننده می‌خرید اینجا ثبت کنید — موجودی و قیمت خرید کالاهای موجود
        به‌طور خودکار به‌روزرسانی می‌شود، و کالای جدید هم مستقیماً به انبار اضافه می‌شود تا سود هر
        فروش بعدی درست محاسبه شود.
      </p>

      <div className="mb-3 rounded-2xl border border-border bg-card p-3">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          افزودن کالای موجود در انبار
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="نام یا کد کالا را تایپ کنید..."
            className="w-full rounded-xl border border-input bg-background py-2.5 pr-9 pl-3 text-sm outline-none focus:border-primary"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {matches.length > 0 && (
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => addExisting(p)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    {p.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    موجودی: {formatNumber(p.stock)} {p.unit || "عدد"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={addManualItem}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-xs font-medium text-primary hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" />
          کالای جدید (که در انبار نیست)
        </button>
      </div>

      {draft.items.length > 0 && (
        <div className="mb-3 space-y-2">
          {draft.items.map((it, idx) => (
            <div key={idx} className="rounded-2xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                {it.productId ? (
                  <span className="text-sm font-semibold">{it.name}</span>
                ) : (
                  <input
                    value={it.name}
                    onChange={(e) => updateItem(idx, { name: e.target.value })}
                    placeholder="نام کالای جدید"
                    className="flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                  />
                )}
                <button onClick={() => removeItem(idx)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className={`mt-2 grid gap-2 ${it.productId ? "grid-cols-2" : "grid-cols-2"}`}>
                <MiniField label="تعداد">
                  <input
                    inputMode="decimal"
                    value={formatNumber(it.quantity)}
                    onChange={(e) => updateItem(idx, { quantity: parseNumberInput(e.target.value) })}
                    className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                  />
                </MiniField>
                <MiniField label="قیمت خرید (واحد)">
                  <input
                    inputMode="decimal"
                    value={formatNumber(it.buyPrice)}
                    onChange={(e) => updateItem(idx, { buyPrice: parseNumberInput(e.target.value) })}
                    className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                  />
                </MiniField>
                {!it.productId && (
                  <>
                    <MiniField label="قیمت فروش پیشنهادی">
                      <input
                        inputMode="decimal"
                        value={formatNumber(it.sellPrice || 0)}
                        onChange={(e) => updateItem(idx, { sellPrice: parseNumberInput(e.target.value) })}
                        className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                      />
                    </MiniField>
                    <MiniField label="واحد">
                      <select
                        value={it.unit || COUNT_UNIT}
                        onChange={(e) => updateItem(idx, { unit: e.target.value })}
                        className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                      >
                        {unitDefs.map((u) => (
                          <option key={u.name} value={u.name}>{u.name}</option>
                        ))}
                      </select>
                    </MiniField>
                  </>
                )}
              </div>
              <div className="mt-1.5 text-left text-xs text-muted-foreground">
                جمع: {formatToman(purchaseLineTotal(it))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2">
        <MiniField label="نام تامین‌کننده (اختیاری)">
          <input
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </MiniField>
        <MiniField label="تلفن تامین‌کننده (اختیاری)">
          <input
            value={supplierPhone}
            onChange={(e) => setSupplierPhone(e.target.value)}
            dir="ltr"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </MiniField>
      </div>

      {/* انتخاب از لیست مشتریان — برای وقتی طرف حساب خرید، یکی از مشتریان ثبت‌شده است */}
      <div className="mb-3 rounded-2xl border border-border bg-card p-3">
        <button
          type="button"
          onClick={() => setShowCustomerPicker((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-xs font-medium"
        >
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-primary" />
            انتخاب از مشتریان ثبت‌شده
          </span>
          {showCustomerPicker ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {showCustomerPicker && (
          <div className="mt-2">
            <input
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              placeholder="نام یا شماره مشتری..."
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
            />
            {matchingCustomers.length === 0 ? (
              <div className="mt-2 text-center text-[11px] text-muted-foreground">مشتری‌ای پیدا نشد.</div>
            ) : (
              <ul className="mt-1.5 max-h-44 space-y-1 overflow-y-auto">
                {matchingCustomers.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSupplierName(customerFullName(c));
                        setSupplierPhone(c.phone ?? "");
                        setShowCustomerPicker(false);
                        setCustomerQuery("");
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
                    >
                      <span className="truncate">{customerFullName(c)}</span>
                      {c.phone && <span dir="ltr" className="shrink-0 text-muted-foreground">{c.phone}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to="/customers"
              className="mt-2 block text-center text-[11px] font-medium text-primary hover:underline"
            >
              مدیریت مشتریان
            </Link>
          </div>
        )}
      </div>

      <div className="mb-3">
        <MiniField label="یادداشت (اختیاری)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثلاً شماره سفارش یا توضیح کوتاه"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </MiniField>
      </div>

      {/* تاریخ و ساعت فاکتور — قابل ثبت با تاریخ دلخواه */}
      <div className="mb-3 rounded-2xl border border-border bg-card p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" /> تاریخ و ساعت فاکتور (شمسی)
        </div>
        <div className="flex gap-2" dir="ltr">
          <input
            value={dateStr}
            onChange={(e) => { setDateStr(e.target.value); setDateErr(null); }}
            placeholder="1403/05/12"
            inputMode="numeric"
            className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            value={timeStr}
            onChange={(e) => setTimeStr(e.target.value)}
            placeholder="14:30"
            inputMode="numeric"
            className="w-28 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        {dateErr && <div className="mt-1 text-[11px] text-destructive">{dateErr}</div>}
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">روش پرداخت</label>
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => setPaymentMethod(m)}
              className={`rounded-xl border py-2 text-xs font-medium ${
                paymentMethod === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {PAYMENT_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <PurchaseDiscountBox
          discountPercent={draft.discountPercent}
          discountAmount={draft.discountAmount}
          onChange={(p) => setDraft((d) => recalcPurchase({ ...d, ...p }))}
        />
      </div>

      <div className="mb-4 space-y-1 rounded-2xl border border-border bg-card p-4">
        {totals.discount > 0 && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>جمع اقلام</span>
              <span>{formatToman(totals.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-primary">
              <span>تخفیف{totals.discountPercent ? ` (٪${formatNumber(totals.discountPercent)})` : ""}</span>
              <span>{formatToman(totals.discount)}</span>
            </div>
          </>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">جمع کل فاکتور خرید</span>
          <span className="text-lg font-bold">{formatToman(total)}</span>
        </div>
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        <Check className="h-4 w-4" />
        ثبت فاکتور خرید و افزودن به انبار
      </button>

      <div className="rounded-2xl border border-border bg-card p-4">
        <button onClick={() => setShowHistory((v) => !v)} className="flex w-full items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-bold">
            <HistoryIcon className="h-4 w-4 text-primary" />
            تاریخچه فاکتورهای خرید ({formatNumber(history.length)})
          </span>
          {showHistory ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {showHistory && (
          <div className="mt-3 space-y-3">
            {history.length > 0 && (
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="جستجو: نام تامین‌کننده، تلفن، کالا..."
                  className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
                />
                {searchQ && (
                  <button onClick={() => setSearchQ("")} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {history.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">هنوز فاکتور خریدی ثبت نشده.</p>
            )}
            {history.length > 0 && filteredHistory.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">فاکتوری با این مشخصات یافت نشد.</p>
            )}
            {filteredHistory.length > 0 && (
              <>
                {searchQ.trim() && (
                  <p className="text-xs text-muted-foreground">{formatNumber(filteredHistory.length)} فاکتور یافت شد</p>
                )}
                <ul className="space-y-2">
                  {filteredHistory.map((p) => (
                    <PurchaseCard key={p.id} p={p} />
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function PurchasesPage() {
  return (
    <AuthGuard>
      <PurchasesPageInner />
    </AuthGuard>
  );
}
