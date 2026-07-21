import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  products,
  categories,
  purchases,
  emptyPurchase,
  recalcPurchase,
  formatToman,
  formatNumber,
  parseNumberInput,
  formatJalaliDateTime,
  PAYMENT_LABEL,
  type Product,
  type PurchaseItem,
  type Purchase,
  type PaymentMethod,
} from "@/lib/store";
import { filterAndRankSearch } from "@/lib/search";
import {
  ShoppingBag, Plus, Trash2, Search, X, Package, Check,
  ChevronDown, ChevronUp, Truck, History as HistoryIcon,
} from "lucide-react";

export const Route = createFileRoute("/purchases")({
  head: () => ({
    meta: [
      { title: "فاکتور خرید | KAMIX" },
      { name: "description", content: "ثبت خرید کالا از تامین‌کننده و به‌روزرسانی خودکار انبار و قیمت خرید." },
    ],
  }),
  component: PurchasesPage,
});

function PurchasesPageInner() {
  const [allProducts] = products.useAll();
  const [catList] = categories.useAll();
  const [history] = purchases.useHistory();

  const [draft, setDraft] = useState<Purchase>(emptyPurchase());
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

  const [query, setQuery] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const matches = useMemo(() => {
    if (!query.trim()) return [] as Product[];
    return filterAndRankSearch(allProducts, query, (p) => [p.name, p.code]).slice(0, 6);
  }, [query, allProducts]);

  const total = draft.items.reduce((s, it) => s + it.buyPrice * it.quantity, 0);

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
          { productId: "", name: "", quantity: 1, buyPrice: 0, sellPrice: 0, unit: "عدد", category: catList[0]?.name || "" } as PurchaseItem,
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
    purchases.archive({
      ...draft,
      supplierName: supplierName.trim() || undefined,
      supplierPhone: supplierPhone.trim() || undefined,
      note: note.trim() || undefined,
      paymentMethod,
      total,
    });
    setDraft(emptyPurchase());
    setSupplierName("");
    setSupplierPhone("");
    setNote("");
    setPaymentMethod("cash");
    alert("فاکتور خرید ثبت شد و موجودی/قیمت خرید انبار به‌روزرسانی شد.");
  };

  const removeFromHistory = (id: string) => {
    if (!confirm("این فاکتور خرید از تاریخچه حذف شود؟ (تاثیری در موجودی فعلی انبار ندارد)")) return;
    purchases.deleteFromHistory(id);
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
              <div className={`mt-2 grid gap-2 ${it.productId ? "grid-cols-2" : "grid-cols-3"}`}>
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
                  <MiniField label="قیمت فروش پیشنهادی">
                    <input
                      inputMode="decimal"
                      value={formatNumber(it.sellPrice || 0)}
                      onChange={(e) => updateItem(idx, { sellPrice: parseNumberInput(e.target.value) })}
                      className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                    />
                  </MiniField>
                )}
              </div>
              <div className="mt-1.5 text-left text-xs text-muted-foreground">
                جمع: {formatToman(it.buyPrice * it.quantity)}
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

      <div className="mb-4 flex items-center justify-between rounded-2xl border border-border bg-card p-4">
        <span className="text-sm font-medium text-muted-foreground">جمع کل فاکتور خرید</span>
        <span className="text-lg font-bold">{formatToman(total)}</span>
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
          <div className="mt-3 space-y-2">
            {history.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">هنوز فاکتور خریدی ثبت نشده.</p>
            )}
            {history.map((p) => (
              <div key={p.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                    {p.supplierName || "بدون نام تامین‌کننده"}
                  </span>
                  <button onClick={() => removeFromHistory(p.id)} className="text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatJalaliDateTime(p.createdAt)} · {p.items.length.toLocaleString("fa-IR")} قلم · {PAYMENT_LABEL[p.paymentMethod || "cash"]}
                </div>
                <div className="mt-1 text-sm font-bold">{formatToman(p.total)}</div>
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                  {p.items.map((it, i) => (
                    <li key={i}>
                      {it.name} × {formatNumber(it.quantity)} — {formatToman(it.buyPrice)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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
