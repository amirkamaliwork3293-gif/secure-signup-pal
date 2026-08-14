import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
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
  customerFullName,
  customerBalance,
  cryptoId,
  addProductToInvoice,
  isWeightUnit,
  applyProductDiscount,
  PAYMENT_LABEL,
  type Customer,
  type CustomerInfo,
  type PaymentMethod,
} from "@/lib/store";
import { lineTotal, invoiceTotals } from "@/lib/invoice-math";
import { checkoutFields, normalizeTemplate, type InvoiceTemplate } from "@/lib/invoice-template";
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
  UserCheck,
  NotebookPen,
} from "lucide-react";
import { InvoiceActions } from "@/components/InvoiceActions";

/** صفحه فاکتور — جدا از مسیر `/` تا بازدیدکننده‌های لندینگ کد اپ را دانلود نکنند. */
export function InvoiceWorkspace() {
  const [inv, setInv] = invoice.useCurrent();
  const [board, tabs] = invoice.useTabs();
  const [appSettings] = settings.useAll();
  const [showCustomer, setShowCustomer] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [customer, setCustomer] = useState<CustomerInfo>(inv.customer ?? {});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(inv.paymentMethod ?? "cash");
  const [paidAmount, setPaidAmount] = useState<number>(inv.paidAmount ?? 0);
  const [checkAmount, setCheckAmount] = useState<number>(inv.checkAmount ?? 0);
  const [checkNumber, setCheckNumber] = useState<string>(inv.checkNumber ?? "");
  const [checkDueDate, setCheckDueDate] = useState<string>(inv.checkDueDate ?? "");
  const [notes, setNotes] = useState<string>(inv.notes ?? "");
  const [showSearch, setShowSearch] = useState(false);
  const [showDiscount, setShowDiscount] = useState(
    () => !!(inv.discountPercent || inv.discountAmount),
  );
  const [showTax, setShowTax] = useState(() => !!inv.taxPercent);
  const [searchQ, setSearchQ] = useState("");
  const [allProducts] = products.useAll();
  const [allCustomers] = customers.useAll();
  const [customerQ, setCustomerQ] = useState("");
  const [showManualItem, setShowManualItem] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualQty, setManualQty] = useState("1");
  const searchRef = useRef<HTMLInputElement>(null);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);

  // ── منبع واحد اعداد این صفحه ───────────────────────────────────────────────
  // مبالغ نقد/چک تا لحظه‌ی «ثبت فاکتور» فقط در state محلی بودند؛ به همین دلیل
  // فاکتورِ چاپ/اشتراک‌شده‌ی پیش از ثبت، «مانده نسیه» را برابر کل مبلغ نشان
  // می‌داد. حالا یک نسخه‌ی کامل از فاکتور ساخته می‌شود و همه‌جا (نمایش، چاپ،
  // ثبت) دقیقاً همان اعداد استفاده می‌شود.
  const deferred = paymentMethod === "credit" || paymentMethod === "check";
  const baseTotal = invoiceTotals(inv).total;
  const paidNow = Math.min(baseTotal, Math.max(0, Math.round(paidAmount || 0)));
  const checkNow =
    paymentMethod === "check"
      ? Math.min(
          baseTotal - paidNow,
          Math.max(0, Math.round(checkAmount || baseTotal - paidNow)),
        )
      : 0;
  // خانه‌های سفارشی «طراح فاکتور» که کاربر خواسته هنگام ثبت فاکتور پر شوند
  const askFields = useMemo(
    () => checkoutFields(normalizeTemplate(appSettings.invoiceTemplate as Partial<InvoiceTemplate> | undefined)),
    [appSettings.invoiceTemplate],
  );
  const filledFieldsCount = askFields.filter((f) => (customFields[f.id] ?? "").trim()).length;

  const draftInvoice = {
    ...inv,
    customer,
    paymentMethod,
    customFields: Object.keys(customFields).length ? customFields : undefined,
    paidAmount: deferred ? paidNow : undefined,
    checkAmount: paymentMethod === "check" ? checkNow : undefined,
    checkNumber: paymentMethod === "check" && checkNumber.trim() ? checkNumber.trim() : undefined,
    checkDueDate: paymentMethod === "check" && checkDueDate ? checkDueDate : undefined,
    notes: notes.trim() ? notes.trim() : undefined,
  };
  const totals = invoiceTotals(draftInvoice);

  // Sync local customer form whenever the active tab changes
  useEffect(() => {
    setCustomer(inv.customer ?? {});
    setPaymentMethod(inv.paymentMethod ?? "cash");
    setPaidAmount(inv.paidAmount ?? 0);
    setCheckAmount(inv.checkAmount ?? 0);
    setCheckNumber(inv.checkNumber ?? "");
    setCheckDueDate(inv.checkDueDate ?? "");
    setNotes(inv.notes ?? "");
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
      const items = prev.items.map((i) =>
        i.productId === productId
          ? { ...i, price, discountPercent: undefined, originalPrice: undefined }
          : i,
      );
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
    // مبلغ نقد پرداخت‌شده و مبلغ چک نمی‌توانند از «جمع کل پس از تخفیف» بیشتر باشند
    const paid = paidNow;
    const chk = checkNow;
    const finalInv = {
      ...inv,
      customer,
      paymentMethod,
      customFields: Object.keys(customFields).length ? customFields : undefined,
      shopName: appSettings.shopName,
      shopAddress: appSettings.storeAddress || undefined,
      shopPhone: (appSettings.storePhones && appSettings.storePhones[0]) || undefined,
      shopLogoUrl: appSettings.logoUrl || undefined,
      paidAmount: paymentMethod === "credit" || paymentMethod === "check" ? paid : undefined,
      checkAmount: paymentMethod === "check" ? chk : undefined,
      checkNumber: paymentMethod === "check" && checkNumber.trim() ? checkNumber.trim() : undefined,
      checkDueDate: paymentMethod === "check" && checkDueDate ? checkDueDate : undefined,
      notes: notes.trim() ? notes.trim() : undefined,
    };
    invoice.archive(finalInv);
    // ثبت بدهی: نسیه = باقیمانده پس از پرداخت نقدی؛ چک = مبلغ چک
    if (paymentMethod === "credit") {
      const debt = Math.max(0, baseTotal - paid);
      if (debt > 0) customers.recordInvoiceDebt(customer, finalInv, { amount: debt, note: "فاکتور نسیه" });
      else if (hasCustomer) customers.findOrCreate(customer);
    } else if (paymentMethod === "check") {
      if (chk > 0) customers.recordInvoiceDebt(customer, finalInv, { amount: chk, note: "چک دریافتی" });
      else if (hasCustomer) customers.findOrCreate(customer);
    } else if (hasCustomer) {
      // نقد/کارت با مشتری مشخص: هیچ بدهی‌ای ثبت نمی‌شود، اما مشتری در «مشتریان» ذخیره/به‌روز می‌شود
      customers.findOrCreate(customer);
    }
    setCustomer({});
    setPaymentMethod("cash");
    setPaidAmount(0);
    setCheckAmount(0);
    setCheckNumber("");
    setCheckDueDate("");
    setNotes("");
    setCustomerQ("");
    setShowCustomer(false);
    setCustomFields({});
    setShowFields(false);
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

  // انتخاب یکی از مشتریان ذخیره‌شده برای این فاکتور
  const selectCustomer = (c: Customer) => {
    setCustomer({ firstName: c.firstName, lastName: c.lastName, phone: c.phone });
    setCustomerQ("");
  };

  const customerMatches =
    customerQ.trim().length > 0
      ? filterAndRankSearch(allCustomers, customerQ, (c) => [customerFullName(c), c.phone]).slice(0, 6)
      : [];

  // افزودن کالای دستی به فاکتور — کالایی که در انبار/دسته‌بندی محصولات نیست
  const addManualItem = () => {
    const price = parseNumberInput(manualPrice);
    const qty = parseNumberInput(manualQty) || 1;
    if (!manualName.trim() || price <= 0 || qty <= 0) {
      alert("نام کالا، قیمت و تعداد معتبر وارد کنید.");
      return;
    }
    setInv((prev) =>
      recalc({
        ...prev,
        items: [
          ...prev.items,
          {
            productId: `manual-${cryptoId()}`,
            name: manualName.trim(),
            price,
            quantity: qty,
            unit: "عدد",
          },
        ],
      }),
    );
    setManualName("");
    setManualPrice("");
    setManualQty("1");
    setShowManualItem(false);
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
            <div className="mt-1 text-2xl font-bold">{formatToman(totals.total)}</div>
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
              <div className="absolute inset-x-0 top-full z-50 mt-1 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground shadow-lg">
                <p>محصولی یافت نشد</p>
                <button
                  type="button"
                  onClick={() => {
                    setManualName(searchQ);
                    setShowManualItem(true);
                    setShowSearch(false);
                    setSearchQ("");
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/50 py-2 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  <NotebookPen className="h-3.5 w-3.5" />
                  افزودن «{searchQ}» به‌عنوان کالای دستی
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowManualItem((v) => !v)}
              className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-background/10 py-1.5 text-[11px] font-medium backdrop-blur hover:bg-background/20"
            >
              <NotebookPen className="h-3 w-3" />
              افزودن کالای دستی (خارج از انبار)
            </button>
          </div>
        )}

        {/* فرم افزودن کالای دستی — کالایی که در انبار ثبت نیست، فقط نام و قیمت */}
        {showManualItem && (
          <div className="mt-2 space-y-2 rounded-xl bg-background/90 p-3 text-foreground">
            <input
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="نام کالا"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder="قیمت واحد (تومان)"
                inputMode="numeric"
                dir="ltr"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                value={manualQty}
                onChange={(e) => setManualQty(e.target.value)}
                placeholder="تعداد"
                inputMode="decimal"
                dir="ltr"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              type="button"
              onClick={addManualItem}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              افزودن به فاکتور
            </button>
          </div>
        )}

        {/* Bottom buttons */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowCustomer((v) => !v)}
            className="flex shrink-0 items-center justify-center gap-1 rounded-xl bg-background/10 px-3 py-2 text-xs font-medium backdrop-blur transition hover:bg-background/20"
          >
            <User className="h-3.5 w-3.5" />
            {showCustomer ? "بستن" : "مشتری"}
          </button>

          {askFields.length > 0 && (
            <button
              onClick={() => setShowFields((v) => !v)}
              className="flex shrink-0 items-center justify-center gap-1 rounded-xl bg-background/10 px-3 py-2 text-xs font-medium backdrop-blur transition hover:bg-background/20"
            >
              <FileText className="h-3.5 w-3.5" />
              {showFields ? "بستن" : "فیلدهای فاکتور"}
              {filledFieldsCount > 0 && (
                <span className="rounded-full bg-background px-1.5 text-[10px] font-bold text-primary">
                  {formatNumber(filledFieldsCount)}
                </span>
              )}
            </button>
          )}

          {/* پرینت / دانلود / ارسال — غیرفعال وقتی فاکتور خالیه */}
          {inv.items.length > 0 && (
            <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5">
              <InvoiceActions
                inv={{
                  ...draftInvoice,
                  shopName: appSettings.shopName,
                  shopAddress: appSettings.storeAddress || undefined,
                  shopPhone: (appSettings.storePhones && appSettings.storePhones[0]) || undefined,
                  shopLogoUrl: appSettings.logoUrl || undefined,
                  // فاکتور هنوز ثبت نهایی نشده — تاریخ/ساعت چاپ باید همین لحظه باشد،
                  // نه لحظه‌ی باز شدن این تب (که ممکن است قدیمی‌تر باشد)
                  createdAt: Date.now(),
                }}
                size="sm"
                showLabels={false}
              />
            </div>
          )}

          <button
            onClick={checkout}
            disabled={inv.items.length === 0}
            className="flex w-full shrink-0 items-center justify-center gap-1 rounded-xl bg-background px-3 py-2 text-xs font-semibold text-primary shadow-sm transition disabled:opacity-50 sm:w-auto"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            ثبت فاکتور
          </button>
        </div>
      </section>

      {/* خانه‌های سفارشی فاکتور — فقط اگر کاربر در «طراح فاکتور» تعریف کرده باشد */}
      {showFields && askFields.length > 0 && (
        <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" />
            فیلدهای سفارشی فاکتور
          </h3>
          <p className="mb-3 text-[11px] text-muted-foreground">
            این خانه‌ها را خودتان در «طراح فاکتور» تعریف کرده‌اید. هرچه اینجا بنویسید، روی
            فاکتور چاپی همین فاکتور می‌نشیند. خالی بگذارید تا نمایش داده نشود.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {askFields.map((f) => (
              <div key={f.id}>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  {f.label}
                  {f.blockTitle ? <span className="opacity-60"> · {f.blockTitle}</span> : null}
                </label>
                <input
                  value={customFields[f.id] ?? ""}
                  onChange={(e) =>
                    setCustomFields((p) => ({ ...p, [f.id]: e.target.value }))
                  }
                  placeholder={f.label}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customer info panel */}
      {showCustomer && (
        <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <h3 className="mb-3 text-sm font-semibold flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            اطلاعات مشتری (اختیاری)
          </h3>

          {/* انتخاب از مشتریان ذخیره‌شده */}
          <div className="relative mb-2">
            <UserCheck className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={customerQ}
              onChange={(e) => setCustomerQ(e.target.value)}
              placeholder="جستجو در مشتریان ذخیره‌شده..."
              className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
            />
            {customerMatches.length > 0 && (
              <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-44 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                {customerMatches.map((c) => {
                  const b = customerBalance(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-right text-xs last:border-0 hover:bg-accent"
                    >
                      <span className="truncate font-medium">{customerFullName(c)}</span>
                      <span
                        className={`shrink-0 ${b > 0 ? "text-destructive" : b < 0 ? "text-sky-600" : "text-muted-foreground"}`}
                      >
                        {b > 0 ? `بدهکار ${formatToman(b)}` : b < 0 ? `طلبکار ${formatToman(-b)}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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
        {inv.items.length > 0 && (
          <div className="mb-3 rounded-xl border border-dashed border-border bg-background/50 p-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={showDiscount}
                onChange={(e) => {
                  const on = e.target.checked;
                  setShowDiscount(on);
                  if (!on) setInv((prev) => recalc({ ...prev, discountPercent: undefined, discountAmount: undefined }));
                }}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <span className="text-xs font-semibold text-muted-foreground">اعمال تخفیف روی کل فاکتور</span>
            </label>
            {showDiscount && (<>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted-foreground">درصد تخفیف</span>
                <input
                  value={inv.discountPercent ? formatNumber(inv.discountPercent) : ""}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, parseNumberInput(e.target.value)));
                    setInv((prev) => recalc({ ...prev, discountPercent: v || undefined, discountAmount: undefined }));
                  }}
                  placeholder="۰"
                  inputMode="numeric"
                  dir="ltr"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted-foreground">مبلغ تخفیف</span>
                <input
                  value={inv.discountAmount ? formatNumber(inv.discountAmount) : ""}
                  onChange={(e) => {
                    const v = Math.max(0, parseNumberInput(e.target.value));
                    setInv((prev) => recalc({ ...prev, discountPercent: undefined, discountAmount: v || undefined }));
                  }}
                  placeholder="۰"
                  inputMode="numeric"
                  dir="ltr"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[5, 10, 15, 20].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setInv((prev) => recalc({ ...prev, discountPercent: p, discountAmount: undefined }))}
                  className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                >
                  {formatNumber(p)}٪
                </button>
              ))}
              <button
                type="button"
                onClick={() => setInv((prev) => recalc({ ...prev, discountPercent: undefined, discountAmount: undefined }))}
                className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
              >
                حذف تخفیف
              </button>
            </div>
            {totals.discount > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground">
                <span>جمع اقلام: <b className="block text-foreground">{formatToman(totals.subtotal)}</b></span>
                <span>
                  تخفیف{totals.discountPercent ? ` (٪${formatNumber(totals.discountPercent)})` : ""}:{" "}
                  <b className="block text-primary">{formatToman(totals.discount)}</b>
                </span>
                <span>قابل پرداخت: <b className="block text-foreground">{formatToman(totals.total)}</b></span>
              </div>
            )}
            </>)}
          </div>
        )}
        {/* مالیات کل فاکتور — اختیاری، دقیقاً با همان الگوی تخفیف */}
        {inv.items.length > 0 && (
          <div className="mb-3 rounded-xl border border-dashed border-border bg-background/50 p-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={showTax}
                onChange={(e) => {
                  const on = e.target.checked;
                  setShowTax(on);
                  if (!on) setInv((prev) => recalc({ ...prev, taxPercent: undefined }));
                }}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <span className="text-xs font-semibold text-muted-foreground">اعمال مالیات روی کل فاکتور</span>
            </label>
            {showTax && (<>
            <div className="mt-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted-foreground">درصد مالیات</span>
                <input
                  value={inv.taxPercent ? formatNumber(inv.taxPercent) : ""}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, parseNumberInput(e.target.value)));
                    setInv((prev) => recalc({ ...prev, taxPercent: v || undefined }));
                  }}
                  placeholder="۰"
                  inputMode="numeric"
                  dir="ltr"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[9, 10].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setInv((prev) => recalc({ ...prev, taxPercent: p }))}
                  className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                >
                  {formatNumber(p)}٪
                </button>
              ))}
              <button
                type="button"
                onClick={() => setInv((prev) => recalc({ ...prev, taxPercent: undefined }))}
                className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
              >
                حذف مالیات
              </button>
            </div>
            {totals.tax > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground">
                <span>
                  {totals.discount > 0 ? "پس از تخفیف" : "جمع اقلام"}:{" "}
                  <b className="block text-foreground">{formatToman(totals.subtotal - totals.discount)}</b>
                </span>
                <span>
                  مالیات{totals.taxPercent ? ` (٪${formatNumber(totals.taxPercent)})` : ""}:{" "}
                  <b className="block text-primary">{formatToman(totals.tax)}</b>
                </span>
                <span>قابل پرداخت: <b className="block text-foreground">{formatToman(totals.total)}</b></span>
              </div>
            )}
            </>)}
          </div>
        )}
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
              <span>جمع کل: <b className="text-foreground">{formatToman(totals.total)}</b></span>
              <span>باقی‌مانده (نسیه): <b className="text-destructive">{formatToman(totals.remaining)}</b></span>
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
                      : formatNumber(Math.max(0, totals.total - totals.paid))
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
              جمع کل: <b className="text-foreground">{formatToman(totals.total)}</b> · بدهی مشتری (چک):{" "}
              <b className="text-destructive">{formatToman(totals.checkAmount)}</b>
              {totals.remaining > 0 && (
                <> · مانده: <b className="text-destructive">{formatToman(totals.remaining)}</b></>
              )}
            </div>
          </div>
        )}
      </div>

      {/* توضیحات فاکتور (اختیاری) */}
      <div className="mb-4 rounded-2xl border border-border bg-card p-3 shadow-card">
        <label htmlFor="invoice-notes" className="mb-2 block text-xs font-semibold text-muted-foreground">
          توضیحات فاکتور (اختیاری)
        </label>
        <textarea
          id="invoice-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="یادداشتی برای این فاکتور بنویسید..."
          rows={2}
          className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
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
                    {!prod && (
                      <span className="rounded-md bg-slate-500/15 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 dark:text-slate-400">
                        دستی
                      </span>
                    )}
                    {isWholesale && (
                      <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-400">
                        عمده
                      </span>
                    )}
                    {!isWholesale && !!item.discountPercent && (
                      <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:text-emerald-400">
                        ٪{formatNumber(item.discountPercent)} تخفیف
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
                        {!!item.originalPrice && (
                          <span className="text-muted-foreground/60 line-through">
                            {formatToman(item.originalPrice)}
                          </span>
                        )}
                        {formatToman(item.price)}
                        <Pencil className="h-2.5 w-2.5 opacity-50" />
                      </button>
                    )}
                    <span>
                      × {formatNumber(item.quantity)}
                      {item.unit && item.unit !== "عدد" ? ` ${item.unit}` : ""}
                    </span>
                    <span className="font-semibold text-primary">
                      = {formatToman(lineTotal(item))}
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
                {weight && item.unit === "کیلوگرم" ? (
                  /* محصول کیلوگرمی: ورودی جداگانه کیلو + گرم باقیمانده — راحت‌تر از تایپ اعشار */
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-1.5">
                    <input
                      defaultValue={Math.floor(item.quantity)}
                      key={`${item.productId}-kg-${item.quantity}`}
                      onBlur={(e) => {
                        const kg = Math.max(0, Math.floor(parseNumberInput(e.target.value)));
                        const gram = Math.round((item.quantity - Math.floor(item.quantity)) * 1000);
                        const q = kg + gram / 1000;
                        if (q > 0 && q !== item.quantity) setQuantity(item.productId, q);
                        else e.target.value = String(Math.floor(item.quantity));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      inputMode="numeric"
                      dir="ltr"
                      className="h-9 w-9 bg-transparent text-center text-sm font-semibold outline-none"
                      aria-label="کیلوگرم"
                      title="کیلوگرم"
                    />
                    <span className="text-[10px] text-muted-foreground">کیلو</span>
                    <span className="text-muted-foreground/40">+</span>
                    <input
                      defaultValue={Math.round((item.quantity - Math.floor(item.quantity)) * 1000)}
                      key={`${item.productId}-g-${item.quantity}`}
                      onBlur={(e) => {
                        const gram = Math.max(0, Math.min(999, Math.round(parseNumberInput(e.target.value))));
                        const kg = Math.floor(item.quantity);
                        const q = kg + gram / 1000;
                        if (q > 0 && q !== item.quantity) setQuantity(item.productId, q);
                        else e.target.value = String(Math.round((item.quantity - Math.floor(item.quantity)) * 1000));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      inputMode="numeric"
                      dir="ltr"
                      className="h-9 w-11 bg-transparent text-center text-sm font-semibold outline-none"
                      aria-label="گرم"
                      title="گرم باقیمانده"
                    />
                    <span className="text-[10px] text-muted-foreground">گرم</span>
                  </div>
                ) : weight ? (
                  /* محصول وزنی (واحد گرم): مقدار اعشاری قابل تایپ */
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
                    <input
                      key={`${item.productId}-q-${item.quantity}`}
                      defaultValue={item.quantity}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => {
                        const q = Math.floor(parseNumberInput(e.target.value));
                        if (q > 0 && q !== item.quantity) setQuantity(item.productId, q);
                        else e.target.value = String(item.quantity);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      inputMode="numeric"
                      dir="ltr"
                      aria-label="تعداد"
                      title="برای ثبت تعداد دلخواه، عدد را تایپ کنید"
                      className="h-9 w-12 bg-transparent text-center text-sm font-semibold outline-none focus:rounded-md focus:bg-secondary"
                    />
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
