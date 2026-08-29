import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DatabaseBackup,
  Download,
  FileSpreadsheet,
  FileJson,
  Loader2,
  X,
  Smartphone,
} from "lucide-react";
import { isWebView } from "@/lib/isWebView";
import { writeBackupExcel } from "@/lib/backup-export";
import {
  products as productsStore,
  categories as categoriesStore,
  customers as customersStore,
  invoice as invoiceStore,
  purchases as purchasesStore,
  expenses as expensesStore,
  reminders as remindersStore,
  students as studentsStore,
  accounts as accountsStore,
  accountTxs as accountTxsStore,
  production as productionStore,
  manualLedger as ledgerStore,
  customerBalance,
  customerFullName,
  formatJalaliDateTime,
  formatJalaliDate,
  PAYMENT_LABEL,
  MANUAL_LEDGER_LABEL,
  accountBalance,
  formatChequeDue,
} from "@/lib/store";
import {
  invoiceTotals,
  lineTotal,
  purchaseLineTotal,
  invoiceCheques,
  chequeLineLabel,
} from "@/lib/invoice-math";

type Row = Record<string, string | number>;

/**
 * ستون‌هایی که مقدارشان «مبلغ/عدد» است و در اکسل باید با جداکننده‌ی هزارگان
 * نمایش داده شوند (به‌صورت عدد واقعی ذخیره می‌شوند تا در اکسل قابل جمع‌زدن باشند).
 */
type SectionKey =
  | "products"
  | "customers"
  | "invoices"
  | "purchases"
  | "expenses"
  | "reminders"
  | "students"
  | "accounts";

const SECTION_LABEL: Record<SectionKey, string> = {
  products: "محصولات و انبار",
  customers: "مشتریان و بدهکاران",
  invoices: "فاکتورهای فروش",
  purchases: "فاکتورهای خرید",
  expenses: "هزینه‌ها",
  reminders: "یادآوری‌ها",
  students: "هنرجویان",
  accounts: "حساب‌ها و تراکنش‌ها",
};

const d = (ts?: number | null) => (ts ? formatJalaliDateTime(ts) : "");
const dd = (ts?: number | null) => (ts ? formatJalaliDate(ts) : "");

/**
 * بک‌آپ کامل داده‌های کاربر — فقط خواندن از استور محلی/همگام‌شده است
 * و هیچ نوشتن یا حذفی روی داده‌ها انجام نمی‌دهد.
 */
export function BackupSection() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-bold">پشتیبان‌گیری از اطلاعات</h2>
        </div>
        <p className="mb-3 text-[11px] leading-6 text-muted-foreground">
          از هر بخشی که بخواهید (محصولات، مشتریان، فاکتورها و…) یک نسخه‌ی پشتیبان اکسل یا فایل کامل
          JSON بگیرید. این کار فقط یک کپی می‌سازد و هیچ داده‌ای را تغییر نمی‌دهد.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 py-2.5 text-sm font-semibold text-primary hover:bg-primary/5"
        >
          <Download className="h-4 w-4" />
          گرفتن نسخه پشتیبان
        </button>
      </div>
      {open && <BackupDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function BackupDialog({ onClose }: { onClose: () => void }) {
  const [prods] = productsStore.useAll();
  const [cats] = categoriesStore.useAll();
  const [custs] = customersStore.useAll();
  const [invs] = invoiceStore.useHistory();
  const [purch] = purchasesStore.useAll();
  const [exps] = expensesStore.useAll();
  const [rems] = remindersStore.useAll();
  const [studs] = studentsStore.useAll();
  const [accs] = accountsStore.useAll();
  const [txs] = accountTxsStore.useAll();
  const [prodEvents] = productionStore.useAll();
  const [ledger] = ledgerStore.useAll();

  const counts: Record<SectionKey, number> = {
    products: prods.length,
    customers: custs.length,
    invoices: invs.length,
    purchases: purch.length,
    expenses: exps.length,
    reminders: rems.length,
    students: studs.length,
    accounts: accs.length,
  };

  const [selected, setSelected] = useState<Record<SectionKey, boolean>>({
    products: true,
    customers: true,
    invoices: true,
    purchases: true,
    expenses: true,
    reminders: true,
    students: true,
    accounts: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anySelected = Object.values(selected).some(Boolean);
  const inApp = useMemo(() => isWebView(), []);

  const toggle = (k: SectionKey) => setSelected((s) => ({ ...s, [k]: !s[k] }));

  function buildSheets(): { name: string; rows: Row[] }[] {
    const out: { name: string; rows: Row[] }[] = [];

    // ── برگه‌ی «خلاصه» — نمای کلی کسب‌وکار در یک نگاه، ابتدای فایل ──────────
    const summary: Row[] = [];
    const addSummary = (title: string, count: number, amountLabel: string, amount: number) =>
      summary.push({ بخش: title, "تعداد رکورد": count, "شرح مبلغ": amountLabel, مبلغ: amount });

    if (selected.products) {
      addSummary(
        "محصولات و انبار",
        prods.length,
        "ارزش موجودی انبار (به قیمت فروش)",
        prods.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0),
      );
    }
    if (selected.customers) {
      const receivable = custs.reduce((s, c) => s + Math.max(0, customerBalance(c)), 0);
      const payable = custs.reduce((s, c) => s + Math.max(0, -customerBalance(c)), 0);
      addSummary("مشتریان — طلب شما", custs.length, "مجموع بدهی مشتریان به شما", receivable);
      addSummary("مشتریان — بدهی شما", custs.length, "مجموع طلب مشتریان از شما", payable);
    }
    if (selected.invoices) {
      const totals = invs.map((i) => invoiceTotals(i));
      addSummary(
        "فاکتورهای فروش",
        invs.length,
        "مجموع فروش",
        totals.reduce((s, t) => s + t.total, 0),
      );
      const unpaid = totals.reduce((s, t) => s + t.remaining, 0);
      if (unpaid > 0)
        addSummary("فاکتورهای نسیه/چک", invs.length, "مجموع مانده‌ی وصول‌نشده", unpaid);
      if (ledger.length > 0) {
        addSummary(
          "فروش دستی",
          ledger.filter((e) => e.kind === "sales").length,
          "مجموع فروش بدون فاکتور",
          ledger.filter((e) => e.kind === "sales").reduce((s, e) => s + (e.amount || 0), 0),
        );
        addSummary(
          "سود دستی",
          ledger.filter((e) => e.kind === "profit").length,
          "مجموع سود ثبت‌شده دستی",
          ledger.filter((e) => e.kind === "profit").reduce((s, e) => s + (e.amount || 0), 0),
        );
      }
    }
    if (selected.purchases) {
      addSummary(
        "فاکتورهای خرید",
        purch.length,
        "مجموع خرید",
        purch.reduce((s, p) => s + (p.total || 0), 0),
      );
    }
    if (selected.expenses) {
      addSummary(
        "هزینه‌ها",
        exps.length,
        "مجموع هزینه‌ها",
        exps.reduce((s, e) => s + (e.amount || 0), 0),
      );
    }
    if (selected.accounts) {
      addSummary(
        "حساب‌ها و کارت‌ها",
        accs.length,
        "مجموع موجودی حساب‌ها",
        accs.reduce((s, a) => s + accountBalance(a, txs), 0),
      );
    }
    if (summary.length > 0) {
      out.push({
        name: "خلاصه",
        rows: [
          {
            بخش: "تاریخ تهیه نسخه پشتیبان",
            "تعداد رکورد": "",
            "شرح مبلغ": formatJalaliDateTime(Date.now()),
            مبلغ: "",
          },
          ...summary,
        ],
      });
    }

    if (selected.products) {
      out.push({
        name: "محصولات",
        rows: prods.map((p) => ({
          نام: p.name,
          کد: p.code ?? "",
          دسته‌بندی: p.category ?? "",
          واحد: p.unit ?? "",
          موجودی: p.stock ?? 0,
          "قیمت فروش": p.price ?? 0,
          "قیمت خرید": p.buyPrice ?? "",
          "قیمت مصرف‌کننده": p.consumerPrice ?? "",
          "قیمت همکار": p.sellerPrice ?? "",
          "قیمت عمده": p.wholesalePrice ?? "",
          "حداقل تعداد عمده": p.wholesaleMinQty ?? "",
          "درصد تخفیف": p.discountPercent ?? "",
          "حد هشدار موجودی": p.lowStockThreshold ?? "",
          "تاریخ انقضا": dd(p.expiryAt),
          توضیحات: p.description ?? "",
        })),
      });
      out.push({
        name: "دسته‌بندی‌ها",
        rows: cats.map((c) => ({ نام: c.name, رنگ: c.color ?? "" })),
      });
    }

    if (selected.customers) {
      out.push({
        name: "مشتریان",
        rows: custs.map((c) => ({
          نام: customerFullName(c),
          تلفن: c.phone ?? "",
          "مانده حساب": customerBalance(c),
          "تاریخ تسویه": c.settlementDate ?? "",
          "تعداد تراکنش": c.txs?.length ?? 0,
          "تاریخ ثبت": d(c.createdAt),
          یادداشت: c.note ?? "",
        })),
      });
      out.push({
        name: "تراکنش مشتریان",
        rows: custs.flatMap((c) =>
          (c.txs ?? []).map((t) => ({
            مشتری: customerFullName(c),
            نوع: t.type === "debt" ? "بدهی" : "پرداخت",
            مبلغ: t.amount,
            تاریخ: d(t.at),
            "شماره فاکتور": t.invoiceId ?? "",
            یادداشت: t.note ?? "",
          })),
        ),
      });
    }

    if (selected.invoices) {
      out.push({
        name: "فاکتورهای فروش",
        // مبالغ از همان منبعی می‌آیند که فاکتور چاپی استفاده می‌کند (invoice-math)
        rows: invs.map((inv) => {
          const t = invoiceTotals(inv);
          return {
            "شماره فاکتور": inv.id.toUpperCase(),
            تاریخ: d(inv.createdAt),
            مشتری: [inv.customer?.firstName, inv.customer?.lastName].filter(Boolean).join(" "),
            "تلفن مشتری": inv.customer?.phone ?? "",
            "تعداد اقلام": inv.items?.length ?? 0,
            "جمع اقلام": t.subtotal,
            "درصد تخفیف": t.discountPercent || "",
            "مبلغ تخفیف": t.discount || "",
            "درصد مالیات": t.taxPercent || "",
            "مبلغ مالیات": t.tax || "",
            "جمع کل": t.total,
            "روش پرداخت": inv.paymentMethod ? PAYMENT_LABEL[inv.paymentMethod] : "",
            "پرداخت نقدی": t.paid || "",
            "مبلغ چک": t.checkAmount || "",
            "جزئیات چک": invoiceCheques(inv)
              .map(
                (c, i) =>
                  chequeLineLabel(c, i, formatChequeDue) + (c.amount ? ` = ${c.amount}` : ""),
              )
              .join(" | "),
            مانده: t.remaining || "",
            توضیحات: inv.notes ?? "",
          };
        }),
      });
      out.push({
        name: "اقلام فاکتور فروش",
        rows: invs.flatMap((inv) =>
          (inv.items ?? []).map((it) => ({
            "شماره فاکتور": inv.id.toUpperCase(),
            تاریخ: d(inv.createdAt),
            مشتری: [inv.customer?.firstName, inv.customer?.lastName].filter(Boolean).join(" "),
            کالا: it.name,
            تعداد: it.quantity,
            واحد: it.unit ?? "",
            "قیمت واحد": it.price,
            "قیمت خرید": it.buyPrice ?? "",
            جمع: lineTotal(it),
          })),
        ),
      });
    }

    if (selected.invoices && ledger.length > 0) {
      out.push({
        name: "فروش و سود دستی",
        rows: ledger.map((e) => ({
          نوع: MANUAL_LEDGER_LABEL[e.kind],
          عنوان: e.title,
          مبلغ: e.amount || 0,
          تاریخ: d(e.at),
          یادداشت: e.note ?? "",
          منبع: e.source === "assistant" ? "دستیار هوشمند" : "ثبت دستی",
        })),
      });
    }

    if (selected.purchases) {
      out.push({
        name: "فاکتورهای خرید",
        rows: purch.map((p) => ({
          "شماره فاکتور": p.id.toUpperCase(),
          تاریخ: d(p.createdAt),
          تامین‌کننده: p.supplierName ?? "",
          تلفن: p.supplierPhone ?? "",
          "تعداد اقلام": p.items?.length ?? 0,
          "جمع کل": p.total ?? 0,
          "روش پرداخت": p.paymentMethod ? PAYMENT_LABEL[p.paymentMethod] : "",
          پرداخت‌شده: p.paidAmount ?? "",
          یادداشت: p.note ?? "",
        })),
      });
      out.push({
        name: "اقلام فاکتور خرید",
        rows: purch.flatMap((p) =>
          (p.items ?? []).map((it) => ({
            "شماره فاکتور": p.id.toUpperCase(),
            تاریخ: d(p.createdAt),
            تامین‌کننده: p.supplierName ?? "",
            کالا: it.name,
            تعداد: it.quantity,
            واحد: it.unit ?? "",
            "قیمت خرید": it.buyPrice,
            جمع: purchaseLineTotal(it),
          })),
        ),
      });
    }

    if (selected.expenses) {
      out.push({
        name: "هزینه‌ها",
        rows: exps.map((e) => ({
          عنوان: e.title,
          مبلغ: e.amount,
          دسته‌بندی: e.category,
          تاریخ: d(e.at),
          "روش پرداخت": e.paymentMethod ? PAYMENT_LABEL[e.paymentMethod] : "",
          "دوره تکرار (روز)": e.recurringDays ?? "",
          یادداشت: e.note ?? "",
        })),
      });
    }

    if (selected.reminders) {
      out.push({
        name: "یادآوری‌ها",
        rows: rems.map((r) => ({
          عنوان: r.title,
          سررسید: d(r.dueAt),
          مشتری: r.customerName ?? "",
          "انجام شده": r.done ? "بله" : "خیر",
          "تاریخ انجام": d(r.doneAt),
          "دوره تکرار (روز)": r.recurringDays ?? "",
          یادداشت: r.note ?? "",
        })),
      });
    }

    if (selected.students) {
      out.push({
        name: "هنرجویان",
        rows: studs.map((s) => ({
          نام: [s.firstName, s.lastName].filter(Boolean).join(" "),
          تلفن: s.phone ?? "",
          رشته: s.discipline ?? "",
          شهریه: s.fee,
          "طول دوره (روز)": s.periodDays,
          "تاریخ شروع": dd(s.startDate),
          "سررسید بعدی": dd(s.nextDueAt),
          فعال: s.active ? "بله" : "خیر",
          اقساطی: s.installmentMode ? "بله" : "خیر",
          "تعداد پرداخت": s.payments?.length ?? 0,
          یادداشت: s.note ?? "",
        })),
      });
      out.push({
        name: "پرداخت هنرجویان",
        rows: studs.flatMap((s) =>
          ((s.payments ?? []) as any[]).map((p) => ({
            هنرجو: [s.firstName, s.lastName].filter(Boolean).join(" "),
            مبلغ: p.amount ?? 0,
            تاریخ: d(p.at ?? p.createdAt),
            یادداشت: p.note ?? "",
          })),
        ),
      });
    }

    if (selected.accounts) {
      out.push({
        name: "حساب‌ها",
        rows: accs.map((a) => ({
          نام: a.name,
          "صاحب حساب": a.holderName ?? "",
          بانک: a.bankName ?? "",
          "رنگ کارت": a.cardColor ?? "",
          "شماره کارت": a.cardNumber ?? "",
          شبا: a.iban ?? "",
          "موجودی اولیه": a.openingBalance,
          "موجودی فعلی": accountBalance(a, txs),
          "تاریخ ایجاد": d(a.createdAt),
        })),
      });
      out.push({
        name: "تراکنش حساب‌ها",
        rows: txs.map((t) => ({
          حساب: accs.find((a) => a.id === t.accountId)?.name ?? "",
          نوع: t.type === "deposit" ? "واریز" : "برداشت",
          مبلغ: t.amount,
          تاریخ: d(t.at),
          یادداشت: t.note ?? "",
        })),
      });
    }

    return out.filter((s) => s.rows.length > 0);
  }

  function buildJson() {
    const data: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      version: 1,
    };
    if (selected.products) {
      data.products = prods;
      data.categories = cats;
    }
    if (selected.customers) data.customers = custs;
    if (selected.invoices) {
      data.invoices = invs;
      data.manualLedger = ledger;
    }
    if (selected.purchases) data.purchases = purch;
    if (selected.expenses) data.expenses = exps;
    if (selected.reminders) data.reminders = rems;
    if (selected.students) data.students = studs;
    if (selected.accounts) {
      data.accounts = accs;
      data.accountTxs = txs;
    }
    if (selected.products) data.production = prodEvents;
    return data;
  }

  const stamp = () => new Date().toISOString().slice(0, 10);

  /**
   * ساخت فایل اکسل خوانا: هر بخش یک برگه، ستون‌ها با عرض متناسب محتوا،
   * مبالغ به‌صورت عدد واقعی با جداکننده‌ی هزارگان (قابل جمع‌زدن در اکسل)،
   * فیلتر روی سطر عنوان و جهت راست‌به‌چپ.
   */
  async function exportExcel() {
    setError(null);
    const sheets = buildSheets();
    if (!sheets.length) {
      setError("در بخش‌های انتخاب‌شده داده‌ای برای پشتیبان‌گیری وجود ندارد.");
      return;
    }
    setBusy(true);
    try {
      await writeBackupExcel(sheets, `kamix-backup-${stamp()}.xlsx`);
    } catch (e) {
      console.error("[backup] excel export failed", e);
      setError("ساخت فایل اکسل ناموفق بود. لطفاً دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  function exportJson() {
    setError(null);
    try {
      const blob = new Blob([JSON.stringify(buildJson(), null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kamix-backup-${stamp()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setError("ساخت فایل پشتیبان ناموفق بود.");
    }
  }

  const body = (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[88svh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-background p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <DatabaseBackup className="h-5 w-5 text-primary" />
            نسخه پشتیبان
          </h2>
          <button
            onClick={onClose}
            aria-label="بستن"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {inApp ? (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs leading-6">
            <div className="mb-1 flex items-center gap-2 font-bold text-amber-700 dark:text-amber-400">
              <Smartphone className="h-4 w-4" />
              در نسخه‌ی اپلیکیشن در دسترس نیست
            </div>
            ذخیره‌ی فایل پشتیبان داخل اپلیکیشن اندروید به‌درستی کار نمی‌کند. لطفاً با همین حساب
            کاربری از طریق مرورگر وارد سایت شوید و از بخش «تنظیمات ← پشتیبان‌گیری» فایل را دریافت
            کنید. تمام اطلاعات شما همگام‌سازی شده و در سایت هم در دسترس است.
          </div>
        ) : (
          <>
            <p className="mb-3 text-[11px] leading-6 text-muted-foreground">
              بخش‌هایی را که می‌خواهید در فایل پشتیبان باشند تیک بزنید.
            </p>
            <div className="space-y-1.5">
              {(Object.keys(SECTION_LABEL) as SectionKey[]).map((k) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected[k]}
                      onChange={() => toggle(k)}
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    {SECTION_LABEL[k]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {counts[k].toLocaleString("fa-IR")} مورد
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() =>
                  setSelected(
                    Object.fromEntries(
                      (Object.keys(SECTION_LABEL) as SectionKey[]).map((k) => [k, true]),
                    ) as Record<SectionKey, boolean>,
                  )
                }
                className="flex-1 rounded-lg border border-border py-1.5 text-[11px] hover:bg-accent"
              >
                انتخاب همه
              </button>
              <button
                onClick={() =>
                  setSelected(
                    Object.fromEntries(
                      (Object.keys(SECTION_LABEL) as SectionKey[]).map((k) => [k, false]),
                    ) as Record<SectionKey, boolean>,
                  )
                }
                className="flex-1 rounded-lg border border-border py-1.5 text-[11px] hover:bg-accent"
              >
                حذف انتخاب‌ها
              </button>
            </div>

            {error && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-600">
                {error}
              </div>
            )}

            <div className="mt-4 space-y-2">
              <button
                disabled={!anySelected || busy}
                onClick={exportExcel}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                دریافت فایل اکسل
              </button>
              <button
                disabled={!anySelected}
                onClick={exportJson}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                <FileJson className="h-4 w-4" />
                دریافت فایل کامل (JSON)
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] leading-5 text-muted-foreground">
              فایل JSON نسخه‌ی کامل و بدون کم‌وکاست داده‌هاست؛ فایل اکسل برای مشاهده و چاپ مناسب‌تر
              است.
            </p>
          </>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(body, document.body) : null;
}
