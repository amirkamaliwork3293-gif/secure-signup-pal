import { useMemo, useState } from "react";
import { Link2, CheckCircle2, Undo2, Phone, User } from "lucide-react";
import {
  customers,
  invoice,
  purchases,
  customerFullName,
  formatJalaliDate,
  formatToman,
  dataHealth,
  type HealthUndoEntry,
} from "@/lib/store";
import { linkSuggestions, type LinkSuggestion } from "@/lib/customer-link";
import type { HealthFix } from "@/lib/data-health";
import { requireOnlineWrite } from "@/lib/online-status";
import { BackupGate } from "@/components/BackupGate";

const PAGE = 60;

/**
 * فاکتورهای قدیمی که شناسهٔ مشتری ندارند. برنامه فقط پیشنهاد می‌دهد؛ اتصال
 * دائمی با انتخاب کاربر (تیک یا انتخاب شخص) و پس از پشتیبان انجام می‌شود.
 * بعد از اتصال، ویرایش نام/تلفن مشتری دیگر فاکتور را از پرونده جدا نمی‌کند.
 */
export function CustomerLinkReview({
  backupDone,
  onBackupDone,
}: {
  backupDone: boolean;
  onBackupDone: () => void;
}) {
  const [custList] = customers.useAll();
  const [history] = invoice.useHistory();
  const [purList] = purchases.useAll();
  const list = useMemo(
    () => linkSuggestions(custList, history, purList),
    [custList, history, purList],
  );
  /** کلید سند → شناسهٔ مشتری انتخاب‌شده */
  const [choice, setChoice] = useState<Map<string, string>>(new Map());
  const [shown, setShown] = useState(PAGE);
  const [lastUndo, setLastUndo] = useState<HealthUndoEntry[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const keyOf = (s: LinkSuggestion) => `${s.kind}:${s.docId}`;
  const sure = list.filter((s) => s.reason === "phone");
  const setOne = (s: LinkSuggestion, customerId: string | null) =>
    setChoice((prev) => {
      const next = new Map(prev);
      if (customerId) next.set(keyOf(s), customerId);
      else next.delete(keyOf(s));
      return next;
    });

  const apply = () => {
    if (!requireOnlineWrite()) return;
    const fixes: HealthFix[] = [];
    for (const s of list) {
      const cid = choice.get(keyOf(s));
      if (!cid) continue;
      fixes.push(
        s.kind === "invoice"
          ? { kind: "link-invoice-customer", invoiceId: s.docId, customerId: cid }
          : { kind: "link-purchase-supplier", purchaseId: s.docId, customerId: cid },
      );
    }
    if (!fixes.length) return;
    if (
      !confirm(`${fixes.length.toLocaleString("fa-IR")} فاکتور به پرونده‌های انتخاب‌شده وصل شود؟`)
    )
      return;
    const res = dataHealth.apply(fixes);
    setChoice(new Map());
    setLastUndo(res.undo.length ? res.undo : null);
    setMessage(
      `${res.applied.toLocaleString("fa-IR")} فاکتور وصل شد. نام و تلفن چاپ‌شده روی فاکتورها تغییری نکرد.`,
    );
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold">اتصال فاکتورهای قدیمی به مشتری</h2>
      {list.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-success/40 bg-success/5 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 text-success" />
          همهٔ فاکتورهایی که مشتری دارند به پرونده‌ی مشتری وصل‌اند.
        </div>
      ) : (
        <>
          <p className="text-[11px] leading-5 text-muted-foreground">
            این فاکتورها پیش از به‌روزرسانی ثبت شده‌اند و فقط با نام/تلفن به مشتری ربط داده می‌شوند؛
            اگر نام یا تلفن مشتری عوض شود از پرونده‌اش جدا می‌شوند، و فاکتور مشتریان هم‌نام قاطی
            می‌شود. پیشنهادها را بررسی و تأیید کنید تا برای همیشه وصل شوند.
            {sure.length > 0 &&
              ` ${sure.length.toLocaleString("fa-IR")} مورد تلفن یکسان دارند (مطمئن‌ترین).`}
          </p>
          <BackupGate done={backupDone} onDone={onBackupDone} />
          {sure.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setChoice((prev) => {
                  const next = new Map(prev);
                  for (const s of sure) next.set(keyOf(s), s.suggested!.id);
                  return next;
                })
              }
              className="rounded-xl border border-border px-3 py-1.5 text-xs"
            >
              انتخاب همهٔ موارد با تلفن یکسان
            </button>
          )}
          <ul className="space-y-2">
            {list.slice(0, shown).map((s) => {
              const picked = choice.get(keyOf(s));
              return (
                <li key={keyOf(s)} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {s.kind === "invoice" ? "فاکتور فروش" : "فاکتور خرید"} ·{" "}
                        {formatJalaliDate(s.createdAt)} · {formatToman(s.total)}
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        روی فاکتور: {s.label || "—"}
                        {s.phone && (
                          <span dir="ltr" className="mr-1">
                            {s.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${
                        s.reason === "phone"
                          ? "bg-success/10 text-success"
                          : s.reason === "name"
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {s.reason === "phone"
                        ? "تلفن یکسان"
                        : s.reason === "name"
                          ? "فقط نام یکسان"
                          : "چند مشتری هم‌نام"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={picked === c.id}
                        onClick={() => setOne(s, picked === c.id ? null : c.id)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${
                          picked === c.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        <User className="h-3 w-3" />
                        {customerFullName(c)}
                        {c.phone && (
                          <span className="inline-flex items-center gap-0.5 opacity-80" dir="ltr">
                            <Phone className="h-2.5 w-2.5" />
                            {c.phone.slice(-4)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          {list.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="w-full rounded-xl border border-border py-2 text-xs"
            >
              نمایش بیشتر ({(list.length - shown).toLocaleString("fa-IR")} مورد دیگر)
            </button>
          )}
          <div className="sticky bottom-20 z-10 rounded-2xl border border-border bg-card p-2 shadow-elegant">
            <button
              type="button"
              disabled={!backupDone || choice.size === 0}
              onClick={apply}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Link2 className="h-4 w-4" />
              {backupDone
                ? `وصل کردن ${choice.size.toLocaleString("fa-IR")} فاکتور انتخاب‌شده`
                : "اول پشتیبان بگیرید"}
            </button>
          </div>
        </>
      )}
      {message && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-xs">
          <span>{message}</span>
          {lastUndo && (
            <button
              type="button"
              onClick={() => {
                const r = dataHealth.undo(lastUndo);
                setLastUndo(null);
                setMessage(`${r.restored.toLocaleString("fa-IR")} اتصال برگشت.`);
              }}
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
