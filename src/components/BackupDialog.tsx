import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DatabaseBackup,
  Download,
  FileSpreadsheet,
  FileJson,
  FileText,
  Loader2,
  X,
  Smartphone,
  Printer,
} from "lucide-react";
import { isWebView } from "@/lib/isWebView";
import {
  writeBackupExcel,
  buildBackupSheets,
  collectBackupSnapshot,
  BACKUP_SECTION_LABEL,
  type BackupSectionKey,
} from "@/lib/backup-export";
import { exportBackupPdf } from "@/lib/backup-pdf";
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
} from "@/lib/store";

type SectionKey = BackupSectionKey;

/**
 * بک‌آپ کامل داده‌های کاربر — فقط خواندن از استور محلی/همگام‌شده است
 * و هیچ نوشتن یا حذفی روی داده‌ها انجام نمی‌دهد.
 */
export function BackupSection({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-bold">پشتیبان‌گیری از اطلاعات</h2>
        </div>
        <p className="mb-3 text-[11px] leading-6 text-muted-foreground">
          از هر بخشی که بخواهید (محصولات، مشتریان، فاکتورها و…) فایل اکسل، نسخهٔ کامل JSON یا
          پروندهٔ PDF چاپی بگیرید. برنامه مثل همیشه کار می‌کند.
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
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const anySelected = Object.values(selected).some(Boolean);
  const inApp = useMemo(() => isWebView(), []);

  const toggle = (k: SectionKey) => setSelected((s) => ({ ...s, [k]: !s[k] }));

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

  async function exportExcel() {
    setError(null);
    const sheets = buildBackupSheets(collectBackupSnapshot(), selected);
    if (!sheets.length) {
      setError("در بخش‌های انتخاب‌شده داده‌ای برای پشتیبان‌گیری وجود ندارد.");
      return;
    }
    setBusy("excel");
    try {
      await writeBackupExcel(sheets, `kamix-backup-${stamp()}.xlsx`);
    } catch (e) {
      console.error("[backup] excel export failed", e);
      setError("ساخت فایل اکسل ناموفق بود. لطفاً دوباره تلاش کنید.");
    } finally {
      setBusy(null);
    }
  }

  async function exportPdf() {
    setError(null);
    setBusy("pdf");
    try {
      const result = await exportBackupPdf(selected);
      if (!result.ok) setError(result.error);
    } finally {
      setBusy(null);
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

  const sectionPicker = (
    <>
      <p className="mb-3 text-[11px] leading-6 text-muted-foreground">
        بخش‌هایی را که می‌خواهید در پرونده پشتیبان باشند تیک بزنید.
      </p>
      <div className="space-y-1.5">
        {(Object.keys(BACKUP_SECTION_LABEL) as SectionKey[]).map((k) => (
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
              {BACKUP_SECTION_LABEL[k]}
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
                (Object.keys(BACKUP_SECTION_LABEL) as SectionKey[]).map((k) => [k, true]),
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
                (Object.keys(BACKUP_SECTION_LABEL) as SectionKey[]).map((k) => [k, false]),
              ) as Record<SectionKey, boolean>,
            )
          }
          className="flex-1 rounded-lg border border-border py-1.5 text-[11px] hover:bg-accent"
        >
          حذف انتخاب‌ها
        </button>
      </div>
    </>
  );

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

        {inApp && (
          <div className="mb-3 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-[11px] leading-6 text-foreground">
            <div className="mb-1 flex items-center gap-2 font-semibold text-primary">
              <Printer className="h-4 w-4" />
              ذخیره PDF از چاپ
            </div>
            داخل اپ دانلود فایل باز نمی‌شود. دکمهٔ PDF پنجرهٔ چاپ را باز می‌کند؛ مقصد را «ذخیره
            به‌صورت PDF» بگذارید تا پرونده روی گوشی بماند.
          </div>
        )}

        {sectionPicker}

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-600">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-2">
          <button
            disabled={!anySelected || busy !== null}
            onClick={() => void exportPdf()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy === "pdf" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            چاپ و ذخیره PDF
          </button>

          {!inApp && (
            <>
              <button
                disabled={!anySelected || busy !== null}
                onClick={() => void exportExcel()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {busy === "excel" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                دریافت فایل اکسل
              </button>
              <button
                disabled={!anySelected || busy !== null}
                onClick={exportJson}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                <FileJson className="h-4 w-4" />
                دریافت فایل کامل (JSON)
              </button>
            </>
          )}
        </div>

        {inApp ? (
          <div className="mt-3 rounded-2xl border border-border bg-card p-3 text-[11px] leading-6 text-muted-foreground">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
              <Smartphone className="h-3.5 w-3.5 text-primary" />
              اکسل از سایت
            </div>
            اگر فایل اکسل هم می‌خواهید، با همان نام کاربری در{" "}
            <span className="font-semibold" dir="ltr">
              kamixapp.ir
            </span>{" "}
            وارد شوید و از «پشتیبان‌گیری» اکسل را بگیرید.
          </div>
        ) : (
          <p className="mt-2 text-center text-[11px] leading-5 text-muted-foreground">
            PDF برای چاپ و بایگانی خواناست. فایل JSON نسخه‌ی کامل داده‌هاست؛ اکسل برای کار در رایانه
            مناسب‌تر است.
          </p>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(body, document.body) : null;
}
