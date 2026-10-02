import { useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowRight,
  ArrowUpCircle,
  Bell,
  CalendarClock,
  ChevronDown,
  FileText,
  IdCard,
  MessageCircle,
  Pencil,
  Phone,
  Pin,
  Receipt,
  Search,
  Send,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  customers,
  customerBalance,
  customerFullName,
  formatJalaliDate,
  formatJalaliDateTime,
  formatJalaliYmd,
  formatNumber,
  formatToman,
  JMONTHS_LONG,
  PAYMENT_LABEL,
  products,
  reminders,
  settings,
  settlementAlertKind,
  toJalali,
  jalaliToTimestamp,
  parseJalaliInput,
  toJalaliInputDate,
  type Customer,
  type CustomerTx,
  type Invoice,
  type PaymentMethod,
  type Purchase,
} from "@/lib/store";
import { invoiceTotals, purchaseTotals } from "@/lib/invoice-math";
import {
  customerInsights,
  filterCustomerDocs,
  ledgerWithBalance,
  statementText,
  type CustomerStatus,
  type DocFilter,
} from "@/lib/customer-insights";
import { customerFields } from "@/lib/customer-fields";
import { openExternal, shareText, telHref, toIntlPhone } from "@/lib/openExternal";
import { InvoiceActions } from "@/components/InvoiceActions";
import { PurchaseActions } from "@/components/PurchaseActions";
import { formatQtyWithUnit } from "@/lib/qty-format";

type Tab = "overview" | "docs" | "ledger" | "info";

const STATUS_META: Record<CustomerStatus, { label: string; cls: string }> = {
  new: { label: "مشتری تازه", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  active: { label: "فعال", cls: "bg-success/10 text-success" },
  slipping: {
    label: "در حال فاصله گرفتن",
    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  lost: { label: "مدتی است نیامده", cls: "bg-destructive/10 text-destructive" },
  none: { label: "بدون خرید", cls: "bg-secondary text-muted-foreground" },
};

const PAGE = 40;

/**
 * پروندهٔ کامل مشتری: خلاصه و بینش، همهٔ فاکتورها با جستجو/فیلتر/چاپ/ارسال،
 * دفتر حساب با ماندهٔ جاری، اطلاعات تکمیلی و اقدامات سریع.
 * فاکتورها از ایندکس صفحه (یک‌بار برای همه) می‌آیند، پس با داده‌ی زیاد هم سریع است.
 */
export function CustomerProfile({
  customer,
  invoices,
  purchases,
  onClose,
  onDebt,
  onPayment,
  onEdit,
  onDelete,
  onRemindDebt,
  onNewInvoice,
}: {
  customer: Customer;
  invoices: Invoice[];
  purchases: Purchase[];
  onClose: () => void;
  onDebt: () => void;
  onPayment: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRemindDebt: () => void;
  onNewInvoice: () => void;
}) {
  const [appSettings] = settings.useAll();
  const [productList] = products.useAll();
  const [tab, setTab] = useState<Tab>("overview");
  const balance = customerBalance(customer);
  const dueKind = settlementAlertKind(customer);
  const name = customerFullName(customer);
  const insights = useMemo(
    () => customerInsights(customer, invoices, purchases, productList, toJalali),
    [customer, invoices, purchases, productList],
  );
  const [showReminder, setShowReminder] = useState(false);
  const phone = customer.phone?.trim() || "";
  const fields = customerFields(customer).filter((f) => f.value.trim());

  const shareStatement = async () => {
    const text = statementText(customer, appSettings.shopName, formatToman, (t) =>
      formatJalaliDate(t),
    );
    const r = await shareText({ title: `صورت‌حساب ${name}`, text });
    if (r === "copied") alert("متن صورت‌حساب کپی شد.");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-foreground/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`پرونده ${name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-background sm:h-[92vh] sm:rounded-3xl sm:border sm:border-border sm:shadow-elegant">
        {/* هدر */}
        <header className="border-b border-border bg-card px-4 pb-3 pt-[calc(0.75rem+var(--safe-top,0px))]">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              aria-label="بازگشت"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl hover:bg-secondary"
            >
              <ArrowRight className="h-5 w-5" />
            </button>
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-primary text-base font-bold text-primary-foreground">
              {(customer.firstName || "؟").trim().charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-bold">{name}</h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {phone && (
                  <span dir="ltr" className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {phone}
                  </span>
                )}
                <span className={`rounded-md px-1.5 py-0.5 ${STATUS_META[insights.status].cls}`}>
                  {STATUS_META[insights.status].label}
                </span>
              </div>
            </div>
            <button
              onClick={onEdit}
              aria-label="ویرایش مشتری"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-primary hover:bg-primary/10"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>

          {/* اقدامات سریع */}
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            <QuickAction icon={ShoppingCart} label="فاکتور" onClick={onNewInvoice} primary />
            <QuickAction icon={ArrowDownCircle} label="دریافت" onClick={onPayment} />
            <QuickAction
              icon={Phone}
              label="تماس"
              disabled={!phone}
              onClick={() => {
                const href = telHref(phone);
                if (href) openExternal(href);
              }}
            />
            <QuickAction
              icon={MessageCircle}
              label="پیامک"
              disabled={!phone}
              onClick={() => openExternal(`sms:${phone.replace(/[^\d+]/g, "")}`)}
            />
            <QuickAction icon={Bell} label="یادآوری" onClick={() => setShowReminder(true)} />
          </div>
        </header>

        {/* تب‌ها */}
        <nav className="flex gap-1 border-b border-border bg-card px-2" role="tablist">
          {(
            [
              ["overview", "خلاصه"],
              ["docs", `فاکتورها (${formatNumber(invoices.length + purchases.length)})`],
              ["ledger", `حساب (${formatNumber(customer.txs.length)})`],
              ["info", "اطلاعات"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`flex-1 border-b-2 px-1 py-2.5 text-xs font-semibold transition ${
                tab === k
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+var(--safe-bottom,0px))]">
          {tab === "overview" && (
            <Overview
              customer={customer}
              balance={balance}
              dueKind={dueKind}
              insights={insights}
              onDebt={onDebt}
              onPayment={onPayment}
              onRemindDebt={onRemindDebt}
              onShareStatement={shareStatement}
              phone={phone}
              shopName={appSettings.shopName}
            />
          )}
          {tab === "docs" && (
            <Docs invoices={invoices} purchases={purchases} logoUrl={appSettings.logoUrl} />
          )}
          {tab === "ledger" && (
            <Ledger
              customer={customer}
              balance={balance}
              onDebt={onDebt}
              onPayment={onPayment}
              onShareStatement={shareStatement}
            />
          )}
          {tab === "info" && (
            <Info customer={customer} fields={fields} onEdit={onEdit} onDelete={onDelete} />
          )}
        </div>
      </div>
      {showReminder && <QuickReminder customer={customer} onClose={() => setShowReminder(false)} />}
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: typeof Phone;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition disabled:opacity-40 ${
        primary
          ? "bg-primary text-primary-foreground shadow-elegant"
          : "bg-secondary text-foreground hover:bg-accent"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Overview({
  customer,
  balance,
  dueKind,
  insights,
  onDebt,
  onPayment,
  onRemindDebt,
  onShareStatement,
  phone,
  shopName,
}: {
  customer: Customer;
  balance: number;
  dueKind: ReturnType<typeof settlementAlertKind>;
  insights: ReturnType<typeof customerInsights>;
  onDebt: () => void;
  onPayment: () => void;
  onRemindDebt: () => void;
  onShareStatement: () => void;
  phone: string;
  shopName: string;
}) {
  const max = Math.max(1, ...insights.monthly.map((m) => m.total));
  const tips: string[] = [];
  if (
    insights.daysSinceLast != null &&
    insights.avgGapDays &&
    insights.daysSinceLast > insights.avgGapDays * 1.5
  ) {
    tips.push(
      `معمولاً هر ${formatNumber(insights.avgGapDays)} روز خرید می‌کند ولی ${formatNumber(insights.daysSinceLast)} روز است نیامده — یک پیام یا تماس پیگیری مناسب است.`,
    );
  }
  if (balance > 0 && dueKind === "overdue") tips.push("موعد تسویهٔ بدهی گذشته است.");
  if (balance > 0 && !customer.settlementDate)
    tips.push("برای بدهی این مشتری تاریخ تسویه ثبت نشده؛ با ثبت تاریخ، یادآوری خودکار می‌گیرید.");
  if (insights.topProducts[0] && insights.invoiceCount >= 3)
    tips.push(`پرخریدترین کالا: «${insights.topProducts[0].name}».`);

  return (
    <div className="space-y-4">
      {/* مانده حساب */}
      <div
        className={`rounded-2xl p-4 ${
          balance > 0
            ? "bg-destructive/10 text-destructive"
            : balance < 0
              ? "bg-sky-500/10 text-sky-700 dark:text-sky-400"
              : "bg-success/10 text-success"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] opacity-80">
              {balance > 0 ? "بدهکار به شما" : balance < 0 ? "طلبکار از شما" : "وضعیت حساب"}
            </div>
            <div className="mt-1 text-xl font-bold">
              {balance === 0 ? "تسویه است" : formatToman(Math.abs(balance))}
            </div>
            {customer.settlementDate && balance > 0 && (
              <div className="mt-1 flex items-center gap-1 text-[11px] opacity-80">
                <CalendarClock className="h-3 w-3" />
                موعد تسویه: {formatJalaliYmd(customer.settlementDate)}
                {dueKind === "overdue"
                  ? " · گذشته"
                  : dueKind === "today"
                    ? " · امروز"
                    : dueKind === "tomorrow"
                      ? " · فردا"
                      : ""}
              </div>
            )}
          </div>
          <Wallet className="h-6 w-6 opacity-60" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={onDebt}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-card px-3 py-2 text-xs font-semibold text-destructive"
          >
            <ArrowUpCircle className="h-3.5 w-3.5" /> ثبت بدهی
          </button>
          <button
            onClick={onPayment}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-card px-3 py-2 text-xs font-semibold text-success"
          >
            <ArrowDownCircle className="h-3.5 w-3.5" /> ثبت دریافت
          </button>
          {balance > 0 && (
            <button
              onClick={onRemindDebt}
              disabled={!phone}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-card px-3 py-2 text-xs font-semibold text-primary disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" /> پیام یادآور بدهی
            </button>
          )}
          <button
            onClick={onShareStatement}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-card px-3 py-2 text-xs font-semibold text-foreground ${balance > 0 ? "" : "col-span-2"}`}
          >
            <Share2 className="h-3.5 w-3.5" /> صورت‌حساب
          </button>
        </div>
      </div>

      {tips.length > 0 && (
        <div className="space-y-1.5 rounded-2xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" /> پیشنهاد برای {shopName ? "شما" : "فروشگاه"}
          </div>
          {tips.map((t) => (
            <p key={t} className="text-[11px] leading-5 text-muted-foreground">
              • {t}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat
          label="جمع خرید از شما"
          value={formatToman(insights.salesTotal)}
          sub={`${formatNumber(insights.invoiceCount)} فاکتور`}
        />
        <Stat label="میانگین هر فاکتور" value={formatToman(insights.avgInvoice)} />
        <Stat
          label="آخرین خرید"
          value={insights.lastAt ? formatJalaliDate(insights.lastAt) : "—"}
          sub={
            insights.daysSinceLast != null
              ? `${formatNumber(insights.daysSinceLast)} روز پیش`
              : undefined
          }
        />
        <Stat
          label="ریتم خرید"
          value={insights.avgGapDays ? `هر ${formatNumber(insights.avgGapDays)} روز` : "—"}
          sub={insights.firstAt ? `از ${formatJalaliDate(insights.firstAt)}` : undefined}
        />
        <Stat
          label="سود ناخالص از این مشتری"
          value={insights.profitKnown ? formatToman(insights.profit) : "—"}
          sub={insights.profitKnown ? undefined : "قیمت خرید کالاها ثبت نشده"}
        />
        <Stat
          label="مشتری از"
          value={customer.createdAt ? formatJalaliDate(customer.createdAt) : "—"}
          sub={STATUS_META[insights.status].label}
        />
        {insights.purchaseCount > 0 && (
          <Stat
            label="خرید شما از این شخص"
            value={formatToman(insights.purchaseTotal)}
            sub={`${formatNumber(insights.purchaseCount)} فاکتور خرید`}
          />
        )}
      </div>

      {/* نمودار ۱۲ ماه */}
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
          <TrendingUp className="h-3.5 w-3.5 text-primary" /> خرید ۱۲ ماه اخیر
        </div>
        <div className="flex h-24 items-end gap-1" aria-label="نمودار خرید ماهانه">
          {insights.monthly.map((m) => {
            const mi = Number(m.key.split("/")[1]) - 1;
            const h = m.total ? Math.max(6, Math.round((m.total / max) * 100)) : 2;
            return (
              <div key={m.key} className="flex h-full flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t ${m.total ? "bg-primary" : "bg-border"}`}
                    style={{ height: `${h}%` }}
                    title={`${JMONTHS_LONG[mi] ?? m.key}: ${formatToman(m.total)}`}
                  />
                </div>
                <span className="text-[8px] text-muted-foreground">
                  {(JMONTHS_LONG[mi] ?? "").slice(0, 3)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {insights.topProducts.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="mb-2 text-xs font-semibold">کالاهای مورد علاقه</div>
          <ul className="space-y-1.5">
            {insights.topProducts.map((p) => (
              <li
                key={p.productId || p.name}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatQtyWithUnit(p.qty, p.unit)} · {formatToman(p.revenue)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(insights.paymentMix).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(insights.paymentMix) as [PaymentMethod, number][]).map(([k, n]) => (
            <span
              key={k}
              className="rounded-lg bg-secondary px-2 py-1 text-[11px] text-muted-foreground"
            >
              {PAYMENT_LABEL[k]}: {formatNumber(n)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Docs({
  invoices,
  purchases,
  logoUrl,
}: {
  invoices: Invoice[];
  purchases: Purchase[];
  logoUrl?: string;
}) {
  const [f, setF] = useState<DocFilter>({ q: "", kind: "all", payment: "all", days: 0 });
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => filterCustomerDocs(invoices, purchases, f), [invoices, purchases, f]);
  const sum = useMemo(
    () => list.reduce((s, d) => s + (d.kind === "sale" ? invoiceTotals(d.doc).total : 0), 0),
    [list],
  );
  const set = (patch: Partial<DocFilter>) => {
    setF((p) => ({ ...p, ...patch }));
    setShown(PAGE);
  };
  const chip = (active: boolean) =>
    `shrink-0 rounded-lg border px-2.5 py-1 text-[11px] ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 rounded-xl border border-input bg-card px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={f.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="جستجو: شماره فاکتور، کالا، توضیحات…"
          className="w-full bg-transparent text-sm outline-none"
        />
        {f.q && (
          <button onClick={() => set({ q: "" })} aria-label="پاک کردن">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </label>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(
          [
            ["all", "همه"],
            ["sales", "فروش"],
            ["purchases", "خرید"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={chip(f.kind === k)} onClick={() => set({ kind: k })}>
            {l}
          </button>
        ))}
        <span className="mx-1 w-px shrink-0 bg-border" />
        {(
          [
            ["all", "هر پرداختی"],
            ["open", "دارای نسیه/چک"],
            ["cash", "نقد"],
            ["card", "کارت"],
            ["credit", "نسیه"],
            ["check", "چک"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={chip(f.payment === k)} onClick={() => set({ payment: k })}>
            {l}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(
          [
            [0, "همه زمان‌ها"],
            [30, "۳۰ روز"],
            [90, "۳ ماه"],
            [365, "یک سال"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={chip(f.days === k)} onClick={() => set({ days: k })}>
            {l}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {formatNumber(list.length)} سند
        {sum > 0 && ` · جمع فروش: ${formatToman(sum)}`}
      </p>
      {list.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">سندی با این فیلتر نیست.</p>
      ) : (
        <ul className="space-y-2">
          {list
            .slice(0, shown)
            .map((d) =>
              d.kind === "sale" ? (
                <SaleRow key={`s-${d.doc.id}`} inv={d.doc} logoUrl={logoUrl} />
              ) : (
                <PurchaseRow key={`p-${d.doc.id}`} p={d.doc} />
              ),
            )}
        </ul>
      )}
      {list.length > shown && (
        <button
          onClick={() => setShown((n) => n + PAGE)}
          className="flex w-full items-center justify-center gap-1 rounded-xl border border-border py-2 text-xs"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          نمایش بیشتر ({formatNumber(list.length - shown)})
        </button>
      )}
    </div>
  );
}

function SaleRow({ inv, logoUrl }: { inv: Invoice; logoUrl?: string }) {
  const t = invoiceTotals(inv);
  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Receipt className="h-3.5 w-3.5 text-primary" />
            {formatToman(t.total)}
            {t.remaining > 0 && (
              <span
                className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive"
                title="بخش نسیه/چک همین فاکتور در زمان صدور؛ پرداخت‌های بعدی در «حساب» ثبت می‌شوند"
              >
                نسیه {formatToman(t.remaining)}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {formatJalaliDateTime(inv.createdAt)}
            {inv.paymentMethod && ` · ${PAYMENT_LABEL[inv.paymentMethod]}`} · #
            {inv.id.slice(0, 6).toUpperCase()}
          </div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">
            {inv.items.map((i) => i.name).join("، ")}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-0.5 border-t border-border pt-2">
        <InvoiceActions inv={{ ...inv, shopLogoUrl: inv.shopLogoUrl || logoUrl }} size="sm" />
      </div>
    </li>
  );
}

function PurchaseRow({ p }: { p: Purchase }) {
  const t = purchaseTotals(p);
  return (
    <li className="rounded-xl border border-sky-500/30 bg-card p-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-sky-700 dark:text-sky-400">
        <ShoppingBag className="h-3.5 w-3.5" />
        خرید از این شخص · {formatToman(t.total)}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {formatJalaliDateTime(p.createdAt)}
        {p.paymentMethod && ` · ${PAYMENT_LABEL[p.paymentMethod]}`}
      </div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">
        {p.items.map((i) => i.name).join("، ")}
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-0.5 border-t border-border pt-2">
        <PurchaseActions p={p} size="sm" />
      </div>
    </li>
  );
}

function Ledger({
  customer,
  balance,
  onDebt,
  onPayment,
  onShareStatement,
}: {
  customer: Customer;
  balance: number;
  onDebt: () => void;
  onPayment: () => void;
  onShareStatement: () => void;
}) {
  const rows = useMemo(() => ledgerWithBalance(customer), [customer]);
  const [shown, setShown] = useState(PAGE);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-3">
        <div>
          <div className="text-[11px] text-muted-foreground">مانده فعلی</div>
          <div
            className={`text-base font-bold ${balance > 0 ? "text-destructive" : balance < 0 ? "text-sky-700 dark:text-sky-400" : "text-success"}`}
          >
            {balance === 0
              ? "تسویه"
              : `${formatToman(Math.abs(balance))} ${balance > 0 ? "بدهکار" : "طلبکار"}`}
          </div>
        </div>
        <button
          onClick={onShareStatement}
          className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs"
        >
          <FileText className="h-3.5 w-3.5" /> صورت‌حساب
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onDebt}
          className="rounded-xl bg-destructive/10 py-2 text-xs font-semibold text-destructive"
        >
          + بدهی
        </button>
        <button
          onClick={onPayment}
          className="rounded-xl bg-success/10 py-2 text-xs font-semibold text-success"
        >
          + دریافت
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">تراکنشی ثبت نشده است.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, shown).map((r) => (
            <LedgerRowView key={r.tx.id} tx={r.tx} balance={r.balance} customer={customer} />
          ))}
        </ul>
      )}
      {rows.length > shown && (
        <button
          onClick={() => setShown((n) => n + PAGE)}
          className="w-full rounded-xl border border-border py-2 text-xs"
        >
          نمایش بیشتر ({formatNumber(rows.length - shown)})
        </button>
      )}
    </div>
  );
}

function LedgerRowView({
  tx,
  balance,
  customer,
}: {
  tx: CustomerTx;
  balance: number;
  customer: Customer;
}) {
  const isDebt = tx.type === "debt";
  const label = tx.purchaseId ? "طلب (خرید نسیه)" : isDebt ? "بدهی" : "دریافت";
  return (
    <li className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs">
      {isDebt ? (
        <ArrowUpCircle className="h-4 w-4 shrink-0 text-destructive" />
      ) : (
        <ArrowDownCircle className="h-4 w-4 shrink-0 text-success" />
      )}
      <div className="min-w-0 flex-1">
        <div className={`font-semibold ${isDebt ? "text-destructive" : "text-success"}`}>
          {label} {formatToman(tx.amount)}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">
          {formatJalaliDateTime(tx.at)}
          {tx.note && ` · ${tx.note}`}
        </div>
      </div>
      <div className="shrink-0 text-left">
        <div className="text-[10px] text-muted-foreground">مانده</div>
        <div
          className={`text-[11px] font-semibold ${balance > 0 ? "text-destructive" : balance < 0 ? "text-sky-700 dark:text-sky-400" : ""}`}
        >
          {balance === 0 ? "۰" : formatToman(Math.abs(balance))}
        </div>
      </div>
      <button
        onClick={() => {
          if (confirm("این تراکنش حذف شود؟")) customers.removeTx(customer.id, tx.id);
        }}
        aria-label="حذف تراکنش"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function Info({
  customer,
  fields,
  onEdit,
  onDelete,
}: {
  customer: Customer;
  fields: ReturnType<typeof customerFields>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const phone = customer.phone?.trim();
  const rows: [string, string | undefined][] = [
    ["نام", customerFullName(customer)],
    ["تلفن", phone],
    ["مشتری از", customer.createdAt ? formatJalaliDate(customer.createdAt) : undefined],
    ["موعد تسویه", customer.settlementDate ? formatJalaliYmd(customer.settlementDate) : undefined],
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-3">
        <dl className="space-y-2 text-xs">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium" dir={k === "تلفن" ? "ltr" : undefined}>
                  {v}
                </dd>
              </div>
            ))}
        </dl>
      </div>
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
          <IdCard className="h-3.5 w-3.5 text-primary" /> اطلاعات تکمیلی
        </div>
        {fields.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            کد ملی، نام شرکت، نشانی یا هر اطلاعات دیگری را از «ویرایش» اضافه کنید تا روی فاکتورها
            خودکار بیاید.
          </p>
        ) : (
          <dl className="space-y-2 text-xs">
            {fields.map((f) => (
              <div key={f.id} className="flex justify-between gap-3">
                <dt className="flex items-center gap-1 text-muted-foreground">
                  {f.pinned && <Pin className="h-3 w-3 text-primary" aria-label="روی فاکتور" />}
                  {f.label}
                </dt>
                <dd className="text-left font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {customer.note && (
        <div className="rounded-2xl border border-border bg-card p-3 text-xs leading-6 text-muted-foreground">
          {customer.note}
        </div>
      )}
      {phone && (
        <button
          onClick={() => openExternal(`https://wa.me/${toIntlPhone(phone)}`)}
          className="w-full rounded-xl border border-border py-2.5 text-xs font-medium"
        >
          گفتگو در واتساپ
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onEdit}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-primary/40 py-2.5 text-xs font-semibold text-primary"
        >
          <Pencil className="h-3.5 w-3.5" /> ویرایش
        </button>
        <button
          onClick={onDelete}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-destructive/40 py-2.5 text-xs font-semibold text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" /> حذف مشتری
        </button>
      </div>
    </div>
  );
}

/** یادآوری پیگیری برای همین مشتری (در بخش «یادآوری‌ها» هم دیده می‌شود) */
function QuickReminder({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const name = customerFullName(customer);
  const [title, setTitle] = useState(`پیگیری ${name}`);
  const [date, setDate] = useState(() => toJalaliInputDate(Date.now() + 86_400_000));
  const [time, setTime] = useState("10:00");
  const save = () => {
    const d = parseJalaliInput(date);
    const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!d) {
      alert("تاریخ نامعتبر است. مثال: ۱۴۰۵/۰۷/۱۵");
      return;
    }
    reminders.add({
      title: title.trim() || `پیگیری ${name}`,
      dueAt: jalaliToTimestamp(d.jy, d.jm, d.jd, m ? Number(m[1]) : 10, m ? Number(m[2]) : 0),
      customerId: customer.id,
      customerName: name,
    });
    onClose();
  };
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-t-3xl border border-border bg-card p-4 sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 text-sm font-bold">
          <Bell className="h-4 w-4 text-primary" /> یادآوری برای {name}
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <div className="flex gap-2" dir="ltr">
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            inputMode="numeric"
            aria-label="تاریخ"
            className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            inputMode="numeric"
            aria-label="ساعت"
            className="w-24 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            [1, "فردا"],
            [3, "۳ روز دیگر"],
            [7, "هفتهٔ بعد"],
            [30, "ماه بعد"],
          ].map(([d, l]) => (
            <button
              key={d}
              type="button"
              onClick={() => setDate(toJalaliInputDate(Date.now() + Number(d) * 86_400_000))}
              className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground"
            >
              {l}
            </button>
          ))}
        </div>
        <button
          onClick={save}
          className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          ثبت یادآوری
        </button>
        <button onClick={onClose} className="w-full rounded-xl border border-border py-2.5 text-sm">
          انصراف
        </button>
      </div>
    </div>
  );
}
