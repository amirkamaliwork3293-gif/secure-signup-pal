/**
 * ساخت فایل اکسل پشتیبان — فقط خواندن از استور؛ هیچ داده‌ای را تغییر نمی‌دهد.
 */
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
  type Product,
  type Category,
  type Customer,
  type Invoice,
  type Purchase,
  type Expense,
  type Reminder,
  type Student,
  type Account,
  type AccountTx,
  type ManualLedgerEntry,
} from "@/lib/store";
import type { ProductionEvent } from "@/lib/production";
import {
  invoiceTotals,
  lineTotal,
  purchaseLineTotal,
  invoiceCheques,
  chequeLineLabel,
} from "@/lib/invoice-math";

export type BackupRow = Record<string, string | number>;

export type BackupSectionKey =
  | "products"
  | "customers"
  | "invoices"
  | "purchases"
  | "expenses"
  | "reminders"
  | "students"
  | "accounts";

export const BACKUP_SECTION_LABEL: Record<BackupSectionKey, string> = {
  products: "محصولات و انبار",
  customers: "مشتریان و بدهکاران",
  invoices: "فاکتورهای فروش",
  purchases: "فاکتورهای خرید",
  expenses: "هزینه‌ها",
  reminders: "یادآوری‌ها",
  students: "هنرجویان",
  accounts: "حساب‌ها و تراکنش‌ها",
};

export const ALL_BACKUP_SECTIONS: Record<BackupSectionKey, boolean> = {
  products: true,
  customers: true,
  invoices: true,
  purchases: true,
  expenses: true,
  reminders: true,
  students: true,
  accounts: true,
};

const MONEY_HEADER = /مبلغ|قیمت|جمع|مانده|تخفیف|شهریه|پرداخت|ارزش|بدهی|موجودی|واریز|برداشت/;
const COUNT_HEADER = /تعداد|دوره|حد |طول/;

export type BackupSnapshot = {
  products: Product[];
  categories: Category[];
  customers: Customer[];
  invoices: Invoice[];
  purchases: Purchase[];
  expenses: Expense[];
  reminders: Reminder[];
  students: Student[];
  accounts: Account[];
  accountTxs: AccountTx[];
  production: ProductionEvent[];
  ledger: ManualLedgerEntry[];
};

export function collectBackupSnapshot(): BackupSnapshot {
  return {
    products: productsStore.getAll(),
    categories: categoriesStore.getAll(),
    customers: customersStore.getAll(),
    invoices: invoiceStore.getHistory(),
    purchases: purchasesStore.getAll(),
    expenses: expensesStore.getAll(),
    reminders: remindersStore.getAll(),
    students: studentsStore.getAll(),
    accounts: accountsStore.getAll(),
    accountTxs: accountTxsStore.getAll(),
    production: productionStore.getAll(),
    ledger: ledgerStore.getAll(),
  };
}

export function backupSectionCounts(data: BackupSnapshot): Record<BackupSectionKey, number> {
  return {
    products: data.products.length,
    customers: data.customers.length,
    invoices: data.invoices.length,
    purchases: data.purchases.length,
    expenses: data.expenses.length,
    reminders: data.reminders.length,
    students: data.students.length,
    accounts: data.accounts.length,
  };
}

const d = (ts?: number | null) => (ts ? formatJalaliDateTime(ts) : "");
const dd = (ts?: number | null) => (ts ? formatJalaliDate(ts) : "");

export function buildBackupSheets(
  data: BackupSnapshot,
  selected: Record<BackupSectionKey, boolean>,
): { name: string; rows: BackupRow[] }[] {
  const out: { name: string; rows: BackupRow[] }[] = [];
  const prods = data.products;
  const cats = data.categories;
  const custs = data.customers;
  const invs = data.invoices;
  const purch = data.purchases;
  const exps = data.expenses;
  const rems = data.reminders;
  const studs = data.students;
  const accs = data.accounts;
  const txs = data.accountTxs;
  const ledger = data.ledger;

  const summary: BackupRow[] = [];
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
    if (unpaid > 0) addSummary("فاکتورهای نسیه/چک", invs.length, "مجموع مانده‌ی وصول‌نشده", unpaid);
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
              (c, i) => chequeLineLabel(c, i, formatChequeDue) + (c.amount ? ` = ${c.amount}` : ""),
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
        (
          (s.payments ?? []) as {
            amount?: number;
            at?: number;
            createdAt?: number;
            note?: string;
          }[]
        ).map((p) => ({
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

  void data.production;
  return out.filter((s) => s.rows.length > 0);
}

export function backupStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function writeBackupExcel(
  sheets: { name: string; rows: BackupRow[] }[],
  filename = `kamix-backup-${backupStamp()}.xlsx`,
): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  wb.Workbook = { ...(wb.Workbook ?? {}), Views: [{ RTL: true }] };

  for (const s of sheets) {
    const headers = Object.keys(s.rows[0] ?? {});
    const ws = XLSX.utils.json_to_sheet(s.rows, { header: headers });
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");

    ws["!cols"] = headers.map((h) => {
      const longest = s.rows.reduce((m, r) => {
        const v = r[h];
        const len =
          typeof v === "number" ? String(Math.round(v)).length + 3 : String(v ?? "").length;
        return Math.max(m, len);
      }, h.length);
      return { wch: Math.min(42, Math.max(10, longest + 2)) };
    });

    headers.forEach((h, c) => {
      const fmt = MONEY_HEADER.test(h) ? "#,##0" : COUNT_HEADER.test(h) ? "#,##0.###" : null;
      if (!fmt) return;
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.t === "n") cell.z = fmt;
      }
    });

    if (headers.length > 0 && s.rows.length > 1) ws["!autofilter"] = { ref: ws["!ref"] as string };

    XLSX.utils.book_append_sheet(wb, ws, s.name.replace(/[\\/?*[\]:]/g, "-").slice(0, 30));
  }

  const { saveOrShareFile, XLSX_MIME } = await import("@/lib/nativeDownload");
  const base64 = XLSX.write(wb, { bookType: "xlsx", type: "base64", compression: true });
  await saveOrShareFile({ filename, mimeType: XLSX_MIME, base64Data: base64 });
}

/** خروجی کامل اکسل از همهٔ بخش‌ها — همان منطق صفحهٔ پشتیبان‌گیری. */
export async function exportFullBackupExcel(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const sheets = buildBackupSheets(collectBackupSnapshot(), ALL_BACKUP_SECTIONS);
    if (!sheets.length) {
      return { ok: false, error: "داده‌ای برای پشتیبان‌گیری وجود ندارد." };
    }
    await writeBackupExcel(sheets);
    return { ok: true };
  } catch (e) {
    console.error("[backup] excel export failed", e);
    return { ok: false, error: "ساخت فایل اکسل ناموفق بود. لطفاً دوباره تلاش کنید." };
  }
}
