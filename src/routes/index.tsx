import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { Layout } from "@/components/Layout";
import {
  invoice,
  recalc,
  formatToman,
  formatNumber,
  parseNumberInput,
  settings,
  products,
  customers,
  addProductToInvoice,
  isWeightUnit,
  applyProductDiscount,
  PAYMENT_LABEL,
  type CustomerInfo,
  type PaymentMethod,
} from "@/lib/store";
import { filterAndRankSearch } from "@/lib/search";
import {
  Minus,
  Plus,
  Trash2,
  ScanLine,
  CheckCircle2,
  Receipt,
  User,
  Search,
  X,
  FileText,
  Plus as PlusIcon,
  Pencil,
  Mic,
  Package,
} from "lucide-react";
import { InvoiceActions } from "@/components/InvoiceActions";

const HOME_URL = "https://kamixapp.ir/";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "KAMIX (کامیکس) — حسابداری فروشگاهی، فاکتور و انبار موبایل" },
      { name: "description", content: "KAMIX (کامیکس) — سیستم حسابداری ساده فارسی برای فروشگاه، انبار و صدور فاکتور با اسکن بارکد و QR توسط دوربین موبایل. ثبت‌نام، دانلود APK و شروع رایگان." },
      { name: "keywords", content: "کامیکس, حسابداری کامیکس, حسابداری فروشگاهی, فاکتور موبایل, صدور فاکتور, انبار موبایل, اسکن بارکد, QR, حسابداری اندروید" },
      { property: "og:url", content: HOME_URL },
      { property: "og:title", content: "KAMIX (کامیکس) — حسابداری فروشگاهی، فاکتور و انبار موبایل" },
      { property: "og:description", content: "KAMIX (کامیکس) — سیستم حسابداری ساده فارسی برای فروشگاه، انبار و صدور فاکتور با اسکن بارکد و QR توسط دوربین موبایل." },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "canonical", href: HOME_URL },
    ],
  }),
  component: InvoicePage,
});

function InvoicePageInner() {
  const [inv, setInv] = invoice.useCurrent();
  const [board, tabs] = invoice.useTabs();
  const [appSettings] = settings.useAll();
  const [showCustomer, setShowCustomer] = useState(false);
  const [customer, setCustomer] = useState<CustomerInfo>(inv.customer ?? {});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(inv.paymentMethod ?? "cash");
  const [paidAmount, setPaidAmount] = useState<number>(inv.paidAmount ?? 0);
  const [checkAmount, setCheckAmount] = useState<number>(inv.checkAmount ?? 0);
  const [checkNumber, setCheckNumber] = useState<string>(inv.checkNumber ?? "");
  const [checkDueDate, setCheckDueDate] = useState<string>(inv.checkDueDate ?? "");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [allProducts] = products.useAll();
  const searchRef = useRef<HTMLInputElement>(null);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);

  // Sync local customer form whenever the active tab changes
  useEffect(() => {
    setCustomer(inv.customer ?? {});
    setPaymentMethod(inv.paymentMethod ?? "cash");
    setPaidAmount(inv.paidAmount ?? 0);
    setCheckAmount(inv.checkAmount ?? 0);
    setCheckNumber(inv.checkNumber ?? "");
    setCheckDueDate(inv.checkDueDate ?? "");
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
    setInv((prev) =>
      recalc({ ...prev, items: prev.items.filter((i) => i.productId !== productId) }),
    );
  };

  const setItemPrice = (productId: string, price: number) => {
    if (price <= 0) return;
    setInv((prev) => {
      const items = prev.items.map((i) => (i.productId === productId ? { ...i, price } : i));
      return recalc({ ...prev, items });
    });
  };

  // تنظیم مستقیم مقدار (برای محصولات وزنی — کیلوگرم/گرم)
  const setQuantity = (productId: string, quantity: number) => {
    setInv((prev) => {
      const items = prev.items
        .map((i) => (i.productId === productId ? { ...i, quantity } : i))
        .filter((i) => i.quantity > 0);
      return recalc({ ...prev, items });
    });
  };

  const checkout = () => {
    if (inv.items.length === 0) return;
    const hasCustomer = !!(
      customer.firstName?.trim() ||
      customer.lastName?.trim() ||
      customer.phone?.trim()
    );
    if ((paymentMethod === "credit" || paymentMethod === "check") && !hasCustomer) {
      setShowCustomer(true);
      alert(
        "برای فاکتور نسیه یا چک، نام یا تلفن مشتری را وارد کنید تا بدهی او در بخش «مشتریان» ثبت شود.",
      );
      return;
    }
    // مبلغ نقد پرداخت‌شده و مبلغ چک نمی‌توانند از جمع کل بیشتر باشند
    const paid = Math.min(inv.total, Math.max(0, Math.round(paidAmount || 0)));
    const chk = paymentMethod === "check"
      ? Math.min(inv.total - paid, Math.max(0, Math.round(checkAmount || (inv.total - paid))))
      : 0;
    const finalInv = {
      ...inv,
      customer,
      paymentMethod,
      shopName: appSettings.shopName,
      paidAmount: paymentMethod === "credit" || paymentMethod === "check" ? paid : undefined,
      checkAmount: paymentMethod === "check" ? chk : undefined,
      checkNumber: paymentMethod === "check" && checkNumber.trim() ? checkNumber.trim() : undefined,
      checkDueDate: paymentMethod === "check" && checkDueDate ? checkDueDate : undefined,
    };
    invoice.archive(finalInv);
    // ثبت بدهی: نسیه = باقیمانده پس از پرداخت نقدی؛ چک = مبلغ چک
    if (paymentMethod === "credit") {
      const debt = Math.max(0, inv.total - paid);
      if (debt > 0) customers.recordInvoiceDebt(customer, finalInv, { amount: debt, note: "فاکتور نسیه" });
    } else if (paymentMethod === "check") {
      if (chk > 0) customers.recordInvoiceDebt(customer, finalInv, { amount: chk, note: "چک دریافتی" });
    }
    setCustomer({});
    setPaymentMethod("cash");
    setPaidAmount(0);
    setCheckAmount(0);
    setCheckNumber("");
    setCheckDueDate("");
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
    ? filterAndRankSearch(allProducts, searchQ, (p) => [p.name, p.code])
    : [];

  return (
    <Layout>
      {/* Invoice tabs */}
      <div className="mb-3 flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 shadow-card">
        {board.open.map((it, idx) => {
          const isActive = it.id === board.activeId;
          const cust = it.customer;
          const label =
            cust?.firstName || cust?.lastName
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
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? "bg-primary/20" : "bg-muted"}`}
                  >
                    {it.items.length.toLocaleString("fa-IR")}
                  </span>
                )}
              </button>
              {board.open.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      it.items.length > 0 &&
                      !confirm("این فاکتور باز خالی نیست — بستنش مطمئنید؟")
                    )
                      return;
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
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Link
            to="/scan"
            className="flex items-center justify-center gap-2 rounded-xl bg-background/15 px-3 py-2.5 text-sm font-medium backdrop-blur transition hover:bg-background/25"
          >
            <ScanLine className="h-4 w-4" />
            اسکن
          </Link>
          <Link
            to="/voice"
            className="flex items-center justify-center gap-2 rounded-xl bg-background/15 px-3 py-2.5 text-sm font-medium backdrop-blur transition hover:bg-background/25"
          >
            <Mic className="h-4 w-4" />
            ثبت صوتی
          </Link>
          <button
            onClick={() => {
              setShowSearch((v) => !v);
              setTimeout(() => searchRef.current?.focus(), 100);
            }}
            className="flex items-center justify-center gap-2 rounded-xl bg-background/15 px-3 py-2.5 text-sm font-medium backdrop-blur transition hover:bg-background/25"
          >
            <Search className="h-4 w-4" />
            جستجو
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
              <button
                onClick={() => setSearchQ("")}
                className="absolute left-2 top-2.5 text-muted-foreground"
              >
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
                    <span className="text-xs text-primary font-semibold">
                      {formatToman(p.price)}
                    </span>
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
        <div className="grid grid-cols-4 gap-2">
          {(["cash", "card", "credit", "check"] as PaymentMethod[]).map((m) => {
            const active = paymentMethod === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setPaymentMethod(m);
                  setInv((prev) => ({ ...prev, paymentMethod: m }));
                }}
                className={`rounded-xl px-2 py-2 text-xs sm:text-sm font-medium transition ${
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

        {/* پرداخت جزئی نقدی برای نسیه */}
        {paymentMethod === "credit" && inv.items.length > 0 && (
          <div className="mt-3 space-y-1.5 rounded-xl border border-dashed border-border bg-background/50 p-3">
            <label className="block text-[11px] font-medium text-muted-foreground">
              مبلغ پرداخت‌شده نقد (اختیاری) — بقیه نسیه ثبت می‌شود
            </label>
            <input
              value={paidAmount ? formatNumber(paidAmount) : ""}
              onChange={(e) => setPaidAmount(parseNumberInput(e.target.value))}
              placeholder="۰"
              inputMode="numeric"
              dir="ltr"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>جمع کل: <b className="text-foreground">{formatToman(inv.total)}</b></span>
              <span>باقی‌مانده (نسیه): <b className="text-destructive">{formatToman(Math.max(0, inv.total - (paidAmount || 0)))}</b></span>
            </div>
          </div>
        )}

        {/* پرداخت با چک */}
        {paymentMethod === "check" && inv.items.length > 0 && (
          <div className="mt-3 space-y-2 rounded-xl border border-dashed border-border bg-background/50 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground">مبلغ نقدی (اختیاری)</label>
                <input
                  value={paidAmount ? formatNumber(paidAmount) : ""}
                  onChange={(e) => setPaidAmount(parseNumberInput(e.target.value))}
                  placeholder="۰"
                  inputMode="numeric"
                  dir="ltr"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground">مبلغ چک</label>
                <input
                  value={
                    checkAmount
                      ? formatNumber(checkAmount)
                      : formatNumber(Math.max(0, inv.total - (paidAmount || 0)))
                  }
                  onChange={(e) => setCheckAmount(parseNumberInput(e.target.value))}
                  placeholder="۰"
                  inputMode="numeric"
                  dir="ltr"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
                placeholder="شماره چک (اختیاری)"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                type="date"
                value={checkDueDate ? checkDueDate.slice(0, 10) : ""}
                onChange={(e) => setCheckDueDate(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                title="تاریخ سررسید چک"
              />
            </div>
            <div className="text-[11px] text-muted-foreground">
              جمع کل: <b className="text-foreground">{formatToman(inv.total)}</b> · بدهی مشتری (چک):{" "}
              <b className="text-destructive">
                {formatToman(
                  checkAmount || Math.max(0, inv.total - (paidAmount || 0)),
                )}
              </b>
            </div>
          </div>
        )}
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
          {inv.items.map((item) => {
            const weight = isWeightUnit(item.unit);
            const prod = allProducts.find((p) => p.id === item.productId);
            const wholesalePrice = prod?.wholesalePrice || 0;
            const retailPrice = prod ? applyProductDiscount(prod) : item.price;
            const isWholesale = wholesalePrice > 0 && item.price === wholesalePrice;
            return (
              <li
                key={item.productId}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-card"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{item.name}</span>
                    {isWholesale && (
                      <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-400">
                        عمده
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {editingPrice === item.productId ? (
                      <input
                        autoFocus
                        defaultValue={item.price}
                        onBlur={(e) => {
                          const p = parseNumberInput(e.target.value);
                          if (p > 0) setItemPrice(item.productId, p);
                          setEditingPrice(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingPrice(null);
                        }}
                        inputMode="numeric"
                        dir="ltr"
                        className="w-28 rounded border border-primary bg-background px-2 py-0.5 text-xs text-foreground outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingPrice(item.productId)}
                        className="flex items-center gap-0.5 hover:text-primary"
                        title="ویرایش قیمت"
                      >
                        {formatToman(item.price)}
                        <Pencil className="h-2.5 w-2.5 opacity-50" />
                      </button>
                    )}
                    <span>
                      × {formatNumber(item.quantity)}
                      {weight ? ` ${item.unit}` : ""}
                    </span>
                    <span className="font-semibold text-primary">
                      = {formatToman(Math.round(item.price * item.quantity))}
                    </span>
                    {wholesalePrice > 0 && !weight && (
                      <button
                        type="button"
                        onClick={() =>
                          setItemPrice(item.productId, isWholesale ? retailPrice : wholesalePrice)
                        }
                        className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${
                          isWholesale
                            ? "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                            : "border-border bg-background text-muted-foreground hover:border-primary hover:text-primary"
                        }`}
                        title={
                          isWholesale
                            ? `تغییر به قیمت تکی: ${formatToman(retailPrice)}`
                            : `تغییر به قیمت عمده: ${formatToman(wholesalePrice)}`
                        }
                      >
                        <Package className="h-2.5 w-2.5" />
                        {isWholesale ? "قیمت تکی" : "قیمت عمده"}
                      </button>
                    )}
                  </div>
                </div>
                {weight ? (
                  /* محصول وزنی: مقدار اعشاری قابل تایپ (مثلاً ۲.۵ کیلوگرم) */
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2">
                    <input
                      defaultValue={item.quantity}
                      key={`${item.productId}-${item.quantity}`}
                      onBlur={(e) => {
                        const q = parseNumberInput(e.target.value);
                        if (q > 0 && q !== item.quantity) setQuantity(item.productId, q);
                        else e.target.value = String(item.quantity);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      inputMode="decimal"
                      dir="ltr"
                      className="h-9 w-16 bg-transparent text-center text-sm font-semibold outline-none"
                      aria-label="مقدار"
                    />
                    <span className="text-[10px] text-muted-foreground">{item.unit}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-background">
                    <button
                      onClick={() => update(item.productId, -1)}
                      className="grid h-9 w-9 place-items-center text-muted-foreground hover:text-foreground"
                      aria-label="کاهش"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="min-w-7 text-center text-sm font-semibold">
                      {formatNumber(item.quantity)}
                    </span>
                    <button
                      onClick={() => update(item.productId, 1)}
                      className="grid h-9 w-9 place-items-center text-muted-foreground hover:text-foreground"
                      aria-label="افزایش"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <button
                  onClick={() => remove(item.productId)}
                  className="grid h-9 w-9 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                  aria-label="حذف"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Layout>
  );
}

function InvoicePage() {
  return (
    <AuthGuard>
      <InvoicePageInner />
    </AuthGuard>
  );
}
