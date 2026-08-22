import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  reminders as remindersStore,
  activeReminders,
  reminderStatus,
  customers as customersStore,
  customerFullName,
  customerBalance,
  formatNumber,
  formatJalaliDate,
  jalaliToTimestamp,
  toJalali,
  jalaliMonthLength,
  JMONTHS_LONG,
  type Reminder,
  type ReminderStatus,
  type Customer,
} from "@/lib/store";
import {
  Bell,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Repeat,
  User,
  CalendarClock,
  ListChecks,
  Phone,
  Send,
} from "lucide-react";
import { openExternal, telHref } from "@/lib/openExternal";
import { DebtContactDialog } from "@/components/DebtContactDialog";

export const Route = createFileRoute("/reminders")({
  head: () => ({
    meta: [
      { title: "یادآوری‌ها | KAMIX" },
      {
        name: "description",
        content: "یادآوری وظایف، سررسیدها و پیگیری مشتریان — هیچ‌چیز از قلم نمی‌افتد.",
      },
      { property: "og:title", content: "یادآوری‌ها | KAMIX" },
      {
        property: "og:description",
        content: "پیگیری مشتریان و وظایف کسب‌وکار را با یادآوری‌های زمان‌دار مدیریت کنید.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RemindersPage,
});

const INPUT =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";
const SELECT =
  "w-full rounded-xl border border-input bg-background px-2 py-2.5 text-center text-sm outline-none focus:border-primary";

const STATUS_META: Record<ReminderStatus, { label: string; className: string }> = {
  overdue: { label: "سررسید گذشته", className: "bg-destructive/10 text-destructive" },
  "due-today": { label: "امروز", className: "bg-amber-500/15 text-amber-600" },
  soon: { label: "به‌زودی", className: "bg-primary/10 text-primary" },
  upcoming: { label: "آینده", className: "bg-muted text-muted-foreground" },
  done: { label: "انجام‌شده", className: "bg-success/15 text-success" },
};

type Tab = "active" | "done";

function RemindersPageInner() {
  const [list] = remindersStore.useAll();
  const [customersList] = customersStore.useAll();
  const [tab, setTab] = useState<Tab>("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [contactTarget, setContactTarget] = useState<{ customer: Customer; title: string } | null>(
    null,
  );

  const active = useMemo(() => activeReminders(list), [list]);
  const done = useMemo(
    () => list.filter((r) => r.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
    [list],
  );
  const visible = tab === "active" ? active : done;

  const overdueCount = active.filter((r) => reminderStatus(r) === "overdue").length;
  const todayCount = active.filter((r) => reminderStatus(r) === "due-today").length;

  return (
    <Layout>
      <h1 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <Bell className="h-5 w-5 text-primary" />
        یادآوری‌ها
      </h1>

      {(overdueCount > 0 || todayCount > 0) && (
        <section className="mb-4 grid grid-cols-2 gap-2">
          {overdueCount > 0 && (
            <div className="rounded-2xl bg-destructive/10 p-3 text-center">
              <div className="text-lg font-bold text-destructive">{formatNumber(overdueCount)}</div>
              <div className="text-[11px] text-destructive/80">سررسید گذشته</div>
            </div>
          )}
          {todayCount > 0 && (
            <div className="rounded-2xl bg-amber-500/10 p-3 text-center">
              <div className="text-lg font-bold text-amber-600">{formatNumber(todayCount)}</div>
              <div className="text-[11px] text-amber-600/80">سررسید امروز</div>
            </div>
          )}
        </section>
      )}

      <div className="mb-4 flex gap-2">
        {(
          [
            ["active", `فعال (${formatNumber(active.length)})`],
            ["done", `انجام‌شده (${formatNumber(done.length)})`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl px-2 py-2 text-xs font-medium transition ${
              tab === t
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!showForm && !editingId && (
        <button
          onClick={() => {
            setShowForm(true);
            setEditingId(null);
          }}
          className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          یادآوری جدید
        </button>
      )}

      {showForm && !editingId && (
        <ReminderForm
          customers={customersList}
          onCancel={() => setShowForm(false)}
          onSave={(r) => {
            remindersStore.add(r);
            setShowForm(false);
          }}
        />
      )}

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {tab === "active" ? (
            <div className="flex flex-col items-center gap-2">
              <ListChecks className="h-6 w-6 text-muted-foreground/60" />
              یادآوری فعالی وجود ندارد.
            </div>
          ) : (
            "هنوز هیچ یادآوری‌ای انجام نشده است."
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) =>
            editingId === r.id ? (
              <ReminderForm
                key={r.id}
                initial={r}
                customers={customersList}
                onCancel={() => setEditingId(null)}
                onSave={(updated) => {
                  remindersStore.update({ ...r, ...updated });
                  setEditingId(null);
                }}
              />
            ) : (
              <li key={r.id} className="rounded-2xl border border-border bg-card p-3 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{r.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span
                        className={`rounded-full px-2 py-0.5 ${STATUS_META[reminderStatus(r)].className}`}
                      >
                        {STATUS_META[reminderStatus(r)].label}
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        {formatJalaliDate(r.dueAt)}
                      </span>
                      {r.customerName && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {r.customerName}
                        </span>
                      )}
                      {!!r.recurringDays && (
                        <span className="flex items-center gap-1 text-primary">
                          <Repeat className="h-3 w-3" />
                          هر {formatNumber(r.recurringDays)} روز
                        </span>
                      )}
                    </div>
                    {r.note && (
                      <div className="mt-1 text-[11px] text-muted-foreground">{r.note}</div>
                    )}
                    {!r.done &&
                      r.customerId &&
                      (() => {
                        const linked = customersList.find((c) => c.id === r.customerId);
                        if (!linked) return null;
                        const phone = linked.phone?.trim();
                        return (
                          <div className="mt-2 grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => setContactTarget({ customer: linked, title: r.title })}
                              className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary/10 py-1.5 text-[11px] font-semibold text-primary"
                            >
                              <Send className="h-3 w-3" />
                              پیامک
                            </button>
                            <button
                              type="button"
                              disabled={!phone}
                              onClick={() => phone && openExternal(telHref(phone))}
                              className="inline-flex items-center justify-center gap-1 rounded-lg bg-sky-500/10 py-1.5 text-[11px] font-semibold text-sky-700 disabled:opacity-40 dark:text-sky-400"
                            >
                              <Phone className="h-3 w-3" />
                              تماس
                            </button>
                          </div>
                        );
                      })()}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="flex gap-1">
                      {!r.done ? (
                        <button
                          onClick={() => remindersStore.markDone(r.id)}
                          className="grid h-7 w-7 place-items-center rounded-lg border border-border text-success hover:bg-success/10"
                          title="انجام شد"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => remindersStore.markUndone(r.id)}
                          className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent"
                          title="برگرداندن به فعال"
                        >
                          <Repeat className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditingId(r.id);
                          setShowForm(false);
                        }}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent"
                        title="ویرایش"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("این یادآوری حذف شود؟")) remindersStore.remove(r.id);
                        }}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-border text-destructive hover:bg-destructive/10"
                        title="حذف"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {contactTarget && (
        <DebtContactDialog
          customer={contactTarget.customer}
          heading="ارسال یادآوری به مشتری"
          presetText={
            customerBalance(contactTarget.customer) > 0
              ? undefined
              : `سلام ${customerFullName(contactTarget.customer)} عزیز،\nیادآوری: ${contactTarget.title}\nلطفاً پیگیری بفرمایید.`
          }
          onClose={() => setContactTarget(null)}
        />
      )}
    </Layout>
  );
}

function ReminderForm({
  initial,
  customers,
  onSave,
  onCancel,
}: {
  initial?: Reminder;
  customers: Customer[];
  onSave: (r: Omit<Reminder, "id" | "createdAt" | "done" | "doneAt">) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const nowJ = toJalali(Date.now()) ?? { jy: 1403, jm: 1, jd: 1, h: 9, min: 0 };
  const initJ = initial ? (toJalali(initial.dueAt) ?? nowJ) : { ...nowJ, h: 9, min: 0 };
  const [jy, setJy] = useState(initJ.jy);
  const [jm, setJm] = useState(initJ.jm);
  const [jd, setJd] = useState(initJ.jd);
  const [hh, setHh] = useState(initJ.h);
  const [mm, setMm] = useState(initJ.min);
  const [recurring, setRecurring] = useState(!!initial?.recurringDays);
  const [recurringDays, setRecurringDays] = useState(initial?.recurringDays ?? 7);
  const [err, setErr] = useState<string | null>(null);

  const daysInSelectedMonth = jalaliMonthLength(jy, jm);
  useEffect(() => {
    if (jd > daysInSelectedMonth) setJd(daysInSelectedMonth);
  }, [daysInSelectedMonth, jd]);
  const YEARS = Array.from({ length: 4 }, (_, i) => nowJ.jy - 1 + i);

  const submit = () => {
    if (!title.trim()) {
      setErr("عنوان یادآوری را وارد کنید.");
      return;
    }
    const customer = customers.find((c) => c.id === customerId);
    onSave({
      title: title.trim(),
      note: note.trim() || undefined,
      dueAt: jalaliToTimestamp(jy, jm, jd, hh, mm),
      customerId: customer?.id,
      customerName: customer ? customerFullName(customer) : undefined,
      recurringDays: recurring ? Math.max(1, recurringDays) : undefined,
    });
  };

  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
      <Field label="عنوان یادآوری">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="مثلاً پیگیری پرداخت آقای رضایی"
          className={INPUT}
        />
      </Field>

      {customers.length > 0 && (
        <Field label="مرتبط با مشتری (اختیاری)">
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={INPUT}
          >
            <option value="">— بدون مشتری —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {customerFullName(c)}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="سررسید (شمسی)">
        <div className="grid grid-cols-3 gap-1.5">
          <select value={jd} onChange={(e) => setJd(+e.target.value)} className={SELECT}>
            {Array.from({ length: daysInSelectedMonth }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {formatNumber(d)}
              </option>
            ))}
          </select>
          <select value={jm} onChange={(e) => setJm(+e.target.value)} className={SELECT}>
            {JMONTHS_LONG.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
          <select value={jy} onChange={(e) => setJy(+e.target.value)} className={SELECT}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {formatNumber(y)}
              </option>
            ))}
          </select>
        </div>
      </Field>

      <Field label="ساعت">
        <div className="grid grid-cols-2 gap-1.5">
          <select value={hh} onChange={(e) => setHh(+e.target.value)} className={SELECT} dir="ltr">
            {Array.from({ length: 24 }, (_, i) => i).map((h) => (
              <option key={h} value={h}>
                {formatNumber(String(h).padStart(2, "0"))}
              </option>
            ))}
          </select>
          <select value={mm} onChange={(e) => setMm(+e.target.value)} className={SELECT} dir="ltr">
            {Array.from({ length: 60 }, (_, i) => i).map((m) => (
              <option key={m} value={m}>
                {formatNumber(String(m).padStart(2, "0"))}
              </option>
            ))}
          </select>
        </div>
      </Field>

      <Field label="توضیحات (اختیاری)">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
      </Field>

      <div className="rounded-xl border border-border bg-background p-3">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            className="h-4 w-4"
          />
          <Repeat className="h-3.5 w-3.5 text-primary" />
          یادآوری تکرارشونده
        </label>
        {recurring && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">هر</span>
            <input
              inputMode="numeric"
              value={formatNumber(recurringDays)}
              onChange={(e) =>
                setRecurringDays(Math.max(1, +e.target.value.replace(/\D/g, "") || 1))
              }
              className="w-20 rounded-lg border border-input bg-card px-2 py-1.5 text-center outline-none focus:border-primary"
            />
            <span className="text-muted-foreground">
              روز یک‌بار — پس از «انجام شد»، یادآوری بعدی خودکار ساخته می‌شود
            </span>
          </div>
        )}
      </div>

      {err && (
        <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>
      )}

      <div className="flex gap-2">
        <button
          onClick={submit}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Check className="h-4 w-4" />
          ذخیره یادآوری
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm"
        >
          <X className="h-4 w-4" />
          لغو
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function RemindersPage() {
  return (
    <AuthGuard>
      <RemindersPageInner />
    </AuthGuard>
  );
}
