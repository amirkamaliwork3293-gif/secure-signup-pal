import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  products,
  categories,
  invoice,
  purchases,
  settings,
  getUnitDefs,
  dataHealth,
  type HealthUndoEntry,
} from "@/lib/store";
import { auditCatalog, type HealthIssue, type HealthSeverity } from "@/lib/data-health";
import { saveFullBackup } from "@/lib/full-backup";
import { requireOnlineWrite } from "@/lib/online-status";
import {
  Stethoscope,
  ShieldCheck,
  DatabaseBackup,
  AlertTriangle,
  Info,
  XCircle,
  CheckCircle2,
  Undo2,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/data-health")({
  head: () => ({
    meta: [
      { title: "سلامت داده‌ها | KAMIX" },
      {
        name: "description",
        content: "بررسی هماهنگی انبار، محصولات، فاکتورها و مشتریان و اصلاح آگاهانه با پشتیبان.",
      },
    ],
  }),
  component: DataHealthPage,
});

const SEVERITY_META: Record<HealthSeverity, { label: string; icon: typeof Info; cls: string }> = {
  error: {
    label: "خطا",
    icon: XCircle,
    cls: "border-destructive/40 bg-destructive/5 text-destructive",
  },
  warning: {
    label: "هشدار",
    icon: AlertTriangle,
    cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  },
  info: { label: "اطلاع", icon: Info, cls: "border-border bg-secondary text-muted-foreground" },
};

/** مرحلهٔ «پشتیبان اول» — تا پشتیبان در همین نشست ذخیره نشود، دکمهٔ اصلاح فعال نیست */
export function BackupGate({ done, onDone }: { done: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div
      className={`rounded-2xl border p-3 ${done ? "border-success/40 bg-success/5" : "border-primary/30 bg-primary/5"}`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        {done ? (
          <ShieldCheck className="h-4 w-4 text-success" />
        ) : (
          <DatabaseBackup className="h-4 w-4 text-primary" />
        )}
        {done ? "پشتیبان ذخیره شد" : "قدم اول: پشتیبان کامل بگیرید"}
      </div>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
        پیش از هر اصلاح، یک فایل کامل از همهٔ اطلاعات روی دستگاه شما ذخیره می‌شود تا در هر حالتی
        قابل بازگشت باشد. سرور هم نسخه‌های خودکار نگه می‌دارد.
      </p>
      {!done && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setErr(null);
            setBusy(true);
            try {
              const ok = await saveFullBackup("before-data-fix");
              if (ok) onDone();
              else
                setErr(
                  "ذخیرهٔ فایل ممکن نشد. از صفحهٔ «پشتیبان‌گیری» فایل کامل بگیرید و دوباره تلاش کنید.",
                );
            } finally {
              setBusy(false);
            }
          }}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <DatabaseBackup className="h-4 w-4" />
          )}
          ذخیرهٔ پشتیبان کامل
        </button>
      )}
      {err && <p className="mt-2 text-[11px] text-destructive">{err}</p>}
    </div>
  );
}

function IssueRow({
  issue,
  checked,
  onToggle,
}: {
  issue: HealthIssue;
  checked: boolean;
  onToggle: () => void;
}) {
  const meta = SEVERITY_META[issue.severity];
  const Icon = meta.icon;
  const productName = issue.ref?.productId
    ? products.findById(issue.ref.productId)?.name
    : undefined;
  return (
    <li className={`rounded-xl border p-3 ${meta.cls}`}>
      <div className="flex items-start gap-2">
        {issue.fix ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
            aria-label="انتخاب برای اصلاح"
          />
        ) : (
          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{issue.title}</div>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{issue.detail}</p>
          <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-md bg-background/70 px-1.5 py-0.5">{meta.label}</span>
            {!issue.fix && (
              <span className="rounded-md bg-background/70 px-1.5 py-0.5">بررسی دستی</span>
            )}
            {productName && (
              <Link
                to="/products"
                search={{ q: productName }}
                className="font-medium text-primary hover:underline"
              >
                باز کردن محصول
              </Link>
            )}
            {issue.ref?.purchaseId && (
              <Link
                to="/purchases"
                search={{ q: issue.ref.purchaseId }}
                className="font-medium text-primary hover:underline"
              >
                باز کردن فاکتور خرید
              </Link>
            )}
            {issue.ref?.invoiceId && (
              <Link
                to="/history"
                search={{ q: issue.ref.invoiceId }}
                className="font-medium text-primary hover:underline"
              >
                باز کردن فاکتور
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function CatalogHealthSection({
  backupDone,
  onBackupDone,
}: {
  backupDone: boolean;
  onBackupDone: () => void;
}) {
  const [prodList] = products.useAll();
  const [catList] = categories.useAll();
  const [history] = invoice.useHistory();
  const [purList] = purchases.useAll();
  const [appSettings] = settings.useAll();
  const issues = useMemo(
    () =>
      auditCatalog({
        products: prodList,
        categories: catList,
        units: getUnitDefs(),
        invoices: history,
        purchases: purList,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prodList, catList, history, purList, appSettings.units],
  );
  const fixable = issues.filter((i) => i.fix);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lastUndo, setLastUndo] = useState<HealthUndoEntry[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const applyPicked = () => {
    if (!requireOnlineWrite()) return;
    const fixes = fixable.filter((i) => picked.has(i.key)).map((i) => i.fix!);
    if (!fixes.length) return;
    if (!confirm(`${fixes.length.toLocaleString("fa-IR")} اصلاح انتخاب‌شده اعمال شود؟`)) return;
    const res = dataHealth.apply(fixes);
    setLastUndo(res.undo.length ? res.undo : null);
    setPicked(new Set());
    setMessage(`${res.applied.toLocaleString("fa-IR")} مورد اصلاح شد.`);
  };

  const undo = () => {
    if (!lastUndo) return;
    const res = dataHealth.undo(lastUndo);
    setLastUndo(null);
    setMessage(
      res.skipped
        ? `${res.restored.toLocaleString("fa-IR")} مورد برگشت. ${res.skipped.toLocaleString("fa-IR")} مورد چون بعد از اصلاح دوباره تغییر کرده بود دست نخورد.`
        : `${res.restored.toLocaleString("fa-IR")} مورد به حالت قبل برگشت.`,
    );
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold">انبار، محصولات و فاکتورها</h2>
      {issues.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-success/40 bg-success/5 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 text-success" />
          مشکلی پیدا نشد. محصولات، انبار و فاکتورها با هم هماهنگ‌اند.
        </div>
      ) : (
        <>
          <p className="text-[11px] leading-5 text-muted-foreground">
            {issues.length.toLocaleString("fa-IR")} مورد پیدا شد. هیچ‌چیز خودکار تغییر نمی‌کند؛
            موردهای دارای تیک را می‌توانید پس از گرفتن پشتیبان اصلاح کنید و بقیه نیاز به تصمیم شما
            دارند.
          </p>
          {fixable.length > 0 && <BackupGate done={backupDone} onDone={onBackupDone} />}
          <ul className="space-y-2">
            {issues.map((i) => (
              <IssueRow
                key={i.key}
                issue={i}
                checked={picked.has(i.key)}
                onToggle={() => toggle(i.key)}
              />
            ))}
          </ul>
          {fixable.length > 0 && (
            <div className="sticky bottom-20 z-10 flex gap-2 rounded-2xl border border-border bg-card p-2 shadow-elegant">
              <button
                type="button"
                onClick={() =>
                  setPicked(
                    picked.size === fixable.length ? new Set() : new Set(fixable.map((i) => i.key)),
                  )
                }
                className="rounded-xl border border-border px-3 py-2 text-xs"
              >
                {picked.size === fixable.length ? "هیچ‌کدام" : "انتخاب همه"}
              </button>
              <button
                type="button"
                disabled={!backupDone || picked.size === 0}
                onClick={applyPicked}
                className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {backupDone
                  ? `اصلاح ${picked.size.toLocaleString("fa-IR")} مورد انتخاب‌شده`
                  : "اول پشتیبان بگیرید"}
              </button>
            </div>
          )}
        </>
      )}
      {message && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-xs">
          <span>{message}</span>
          {lastUndo && (
            <button
              type="button"
              onClick={undo}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 font-medium"
            >
              <Undo2 className="h-3.5 w-3.5" /> بازگردانی
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function DataHealthInner() {
  // پشتیبان یک بار در هر بازدید کافی است و برای هر دو بخش معتبر است
  const [backupDone, setBackupDone] = useState(false);
  return (
    <Layout>
      <div className="mb-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold">سلامت داده‌ها</h1>
            <p className="text-[11px] text-muted-foreground">
              بررسی هماهنگی انبار، محصولات، فاکتورها و مشتریان
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          این صفحه فقط می‌خواند و گزارش می‌دهد. هر اصلاحی با انتخاب و تأیید خود شما، پس از گرفتن
          پشتیبان کامل انجام می‌شود و تا وقتی از صفحه خارج نشده‌اید قابل بازگردانی است.
        </p>
      </div>
      <div className="space-y-6">
        <CatalogHealthSection backupDone={backupDone} onBackupDone={() => setBackupDone(true)} />
      </div>
    </Layout>
  );
}

function DataHealthPage() {
  return (
    <AuthGuard>
      <DataHealthInner />
    </AuthGuard>
  );
}
