import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { Layout } from "@/components/Layout";
import { invoice, recalc, formatToman, settings, products, addProductToInvoice, PAYMENT_LABEL, type CustomerInfo, type PaymentMethod } from "@/lib/store";
import {
  Minus, Plus, Trash2, ScanLine, CheckCircle2, Receipt,
  User, Search, X, FileText, Plus as PlusIcon,
} from "lucide-react";
import { InvoiceActions } from "@/components/InvoiceActions";

export const Route = createFileRoute("/")(
  {
    head: () => ({
      meta: [
        { title: "حساب‌بان | فاکتور جاری" },
        { name: "description", content: "فاکتور حسابداری با اسکن بارکد و QR کد توسط دوربین موبایل." },
      ],
    }),
    component: InvoicePage,
  }
);

function InvoicePageInner() {
  const [inv, setInv] = invoice.useCurrent();
  const [board, tabs] = invoice.useTabs();
  const [appSettings] = settings.useAll();
  const [showCustomer, setShowCustomer] = useState(false);
  const [customer, setCustomer] = useState<CustomerInfo>(inv.customer ?? {});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(inv.paymentMethod ?? "cash");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [allProducts] = products.useAll();
  const searchRef = useRef<HTMLInputElement>(null);

  // Sync local customer form whenever the active tab changes
  useEffect(() => {
    setCustomer(inv.customer ?? {});
    setPaymentMethod(inv.paymentMethod ?? "cash");
    setShowCustomer(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.id]);

  const update = (productId: string, delta: number) => {
    setInv((prev) => {
      const items = prev.items
        .map((i) => (i.productId === productId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0);
      return recalc({ ...prev, items });
    });
  };

  const remove = (productId: string) => {
    setInv((prev) => recalc({ ...prev, items: prev.items.filter((i) => i.productId !== productId) }));
  };

  const checkout = () => {
    if (inv.items.length === 0) return;
    const finalInv = { ...inv, customer, paymentMethod, shopName: appSettings.shopName };
    invoice.archive(finalInv);
    setCustomer({});
    setPaymentMethod("cash");
    setShowCustomer(false);
  };

  const saveCustomer = () => {
    setInv((prev) => ({ ...prev, customer }));
  };

  const addFromSearch = (productId: string) => {
    const p = allProducts.find((x) => x.id === productId);
    if (!p) return;
    setInv((prev) => addProductToInvoice(prev, p));
    setSearchQ("");
  };

  const filtered = searchQ.trim()
    ? allProducts.filter((p) => p.name.includes(searchQ) || p.code.includes(searchQ))
    : [];


  return (
    <Layout>
      {/* Invoice tabs */}
      <div className="mb-3 flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 shadow-card">
        {board.open.map((it, idx) => {
          const isActive = it.id === board.activeId;
          const cust = it.customer;
          const label = cust?.firstName || cust?.lastName
            ? `${cust?.firstName ?? ""} ${cust?.lastName ?? ""}`.trim()
            : `فاکتور ${(idx + 1).toLocaleString("fa-IR")}`;
          return (
            <div
              key={it.id}
              className={`flex shrink-0 items-center gap-1 rounded-xl border px-2 py-1.5 text-xs transition ${
                isActive
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              <button
                type="button"
                onClick={() => tabs.switchTo(it.id)}
                className="flex items-center gap-1"
                title="نمایش این فاکتور"
              >
                <FileText className="h-3.5 w-3.5" />
                <span className="max-w-[120px] truncate font-medium">{label}</span>
                {it.items.length > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? "bg-primary/20" : "bg-muted"}`}>
                    {it.items.length.toLocaleString("fa-IR")}
                  </span>
                )}
              </button>
              {board.open.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (it.items.length > 0 && !confirm("این فاکتور باز خالی نیست — بستنش مطمئنید؟")) return;
                    tabs.close(it.id);
                  }}
                  className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="بستن"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => tabs.openNew()}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-xl border border-dashed border-primary/50 px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
          title="فاکتور جدید"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          جدید
        </button>
      </div>

      {/* Invoice header card */}
      <section className="mb-4 rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-elegant">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs/5 opacity-80">جمع کل فاکتور</div>
            <div className="mt-1 text-2xl font-bold">{formatToman(inv.total)}</div>
            <div className="text-xs opacity-70 mt-0.5">{inv.items.length} قلم کالا</div>
          </div>
          <Receipt className="h-10 w-10 opacity-80" />
        </div>

        {/* Action buttons */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            to="/scan"
            className="flex items-center justify-center gap-2 rounded-xl bg-background/15 px-3 py-2.5 text-sm font-medium backdrop-blur transition hover:bg-background/25"
          >
            <ScanLine className="h-4 w-4" />
            اسکن بارکد
          </Link>
          <button
            onClick={() => { setShowSearch((v) => !v); setTimeout(() => searchRef.current?.focus(), 100); }}
            className="flex items-center justify-center gap-2 rounded-xl bg-background/15 px-3 py-2.5 text-sm font-medium backdrop-blur transition hover:bg-background/25"
          >
            <Search className="h-4 w-4" />
            جستجوی محصول
          </button>
        </div>

        {/* Quick product search */}
        {showSearch && (
          <div className="mt-2 relative">
            <input
              ref={searchRef}
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="نام یا بارکد محصول..."
              className="w-full rounded-xl bg-background/90 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {searchQ && (
              <button onClick={() => setSearchQ("")} className="absolute left-2 top-2.5 text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
            {filtered.length > 0 && (
              <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addFromSearch(p.id)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-sm hover:bg-accent border-b border-border last:border-0"
                  >
                    <span className="font-medium text-foreground">{p.name}</span>
                    <span className="text-xs text-primary font-semibold">{formatToman(p.price)}</span>
                  </button>
                ))}
              </div>
            )}
            {searchQ.trim() && filtered.length === 0 && (
              <div className="absolute inset-x-0 top-full z-50 mt-1 rounded-xl border border-border bg-card px-3 py-3 text-sm text-muted-foreground shadow-lg">
                محصولی یافت نشد
              </div>
            )}
          </div>
        )}

        {/* Bottom buttons */}
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setShowCustomer((v) => !v)}
            className="flex items-center justify-center gap-1 rounded-xl bg-background/10 px-3 py-2 text-xs font-medium backdrop-blur transition hover:bg-background/20"
          >
            <User className="h-3.5 w-3.5" />
            {showCustomer ? "بستن" : "مشتری"}
          </button>

          {/* پرینت / دانلود / ارسال — غیرفعال وقتی فاکتور خالیه */}
          {inv.items.length > 0 && (
            <div className="flex gap-1.5 flex-1 justify-end">
              <InvoiceActions
                inv={{ ...inv, customer, shopName: appSettings.shopName }}
                size="sm"
                showLabels={false}
              />
            </div>
          )}

          <button
            onClick={checkout}
            disabled={inv.items.length === 0}
            className="flex items-center justify-center gap-1 rounded-xl bg-background px-3 py-2 text-xs font-semibold text-primary shadow-sm transition disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            ثبت فاکتور
          </button>
        </div>
      </section>

      {/* Customer info panel */}
      {showCustomer && (
        <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <h3 className="mb-3 text-sm font-semibold flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            اطلاعات مشتری (اختیاری)
          </h3>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              value={customer.firstName ?? ""}
              onChange={(e) => setCustomer((c) => ({ ...c, firstName: e.target.value }))}
              placeholder="نام"
              className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              value={customer.lastName ?? ""}
              onChange={(e) => setCustomer((c) => ({ ...c, lastName: e.target.value }))}
              placeholder="نام خانوادگی"
              className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <input
            value={customer.phone ?? ""}
            onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
            placeholder="شماره تلفن"
            inputMode="tel"
            dir="ltr"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={saveCustomer}
            className="mt-2 w-full rounded-xl bg-primary/10 py-2 text-xs font-medium text-primary"
          >
            ذخیره اطلاعات مشتری
          </button>
        </div>
      )}

      {/* Payment method picker */}
      <div className="mb-4 rounded-2xl border border-border bg-card p-3 shadow-card">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">روش پرداخت</div>
        <div className="grid grid-cols-3 gap-2">
          {(["cash", "card", "credit"] as PaymentMethod[]).map((m) => {
            const active = paymentMethod === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setPaymentMethod(m);
                  setInv((prev) => ({ ...prev, paymentMethod: m }));
                }}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-background border border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                {PAYMENT_LABEL[m]}
              </button>
            );
          })}
        </div>
      </div>


      {/* Items list */}
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
        اقلام فاکتور ({inv.items.length})
      </h2>

      {inv.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <ScanLine className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            فاکتور خالی است. بارکد اسکن کنید یا محصول جستجو کنید.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link
              to="/scan"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <ScanLine className="h-4 w-4" />
              اسکن
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {inv.items.map((item) => (
            <li key={item.productId} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-card">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{item.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatToman(item.price)} × {item.quantity.toLocaleString("fa-IR")}
                  <span className="mr-2 font-semibold text-primary">= {formatToman(item.price * item.quantity)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background">
                <button onClick={() => update(item.productId, -1)} className="grid h-9 w-9 place-items-center text-muted-foreground hover:text-foreground" aria-label="کاهش">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-7 text-center text-sm font-semibold">{item.quantity.toLocaleString("fa-IR")}</span>
                <button onClick={() => update(item.productId, 1)} className="grid h-9 w-9 place-items-center text-muted-foreground hover:text-foreground" aria-label="افزایش">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button onClick={() => remove(item.productId)} className="grid h-9 w-9 place-items-center rounded-lg text-destructive hover:bg-destructive/10" aria-label="حذف">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}

function InvoicePage() {
  return <AuthGuard><InvoicePageInner /></AuthGuard>;
}
