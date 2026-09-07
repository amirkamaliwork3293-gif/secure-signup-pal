import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  reminders as remindersStore,
  reminderStatus,
  customers as customersStore,
  customerFullName,
  customerBalance,
  formatNumber,
  formatJalaliDate,
  formatJalaliShort,
  jalaliToTimestamp,
  toJalali,
  jalaliMonthLength,
  JMONTHS_LONG,
  type Reminder,
  type Customer,
} from "@/lib/store";
import {
  WEEKDAY_SAT_FIRST,
  WEEKDAY_SHORT,
  jalaliDayKey,
  remindersOnDay,
  saturdayOfWeek,
  weekDays,
  weekStats,
  startOfJalaliDay,
} from "@/lib/reminder-week";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Repeat,
  User,
  Phone,
  Send,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
} from "lucide-react";
import { openExternal, telHref } from "@/lib/openExternal";
import { DebtContactDialog } from "@/components/DebtContactDialog";

export const Route = createFileRoute("/reminders")({
  head: () => ({
    meta: [
      { title: "برنامه هفته | KAMIX" },
      {
        name: "description",
        content: "برنامهٔ هفتگی مغازه: کار امروز، سررسیدها و یادآوری‌ها در یک نگاه.",
      },
      { property: "og:title", content: "برنامه هفته | KAMIX" },
      {
        property: "og:description",
        content: "کارهای هفته را ببینید، تیک بزنید و طبق برنامه پیش بروید.",
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

type Board = "week" | "later" | "done";

function RemindersPageInner() {
  const [list] = remindersStore.useAll();
  const [customersList] = customersStore.useAll();
  const [board, setBoard] = useState<Board>("week");
  const [anchor, setAnchor] = useState(() => Date.now());
  const [selectedKey, setSelectedKey] = useState(() => jalaliDayKey(Date.now()));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formDueAt, setFormDueAt] = useState<number | undefined>(undefined);
  const [contactTarget, setContactTarget] = useState<{ customer: Customer; title: string } | null>(
    null,
  );

  const days = useMemo(() => weekDays(anchor), [anchor]);
  const weekStart = days[0]?.start ?? saturdayOfWeek(anchor);
  const selected = days.find((d) => d.key === selectedKey) ?? days.find((d) => d.isToday) ?? days[0];

  useEffect(() => {
    if (!days.some((d) => d.key === selectedKey)) {
      const today = days.find((d) => d.isToday);
      setSelectedKey(today?.key ?? days[0]?.key ?? "");
    }
  }, [days, selectedKey]);

  const stats = useMemo(() => weekStats(list, weekStart, Date.now()), [list, weekStart]);
  const overdue = useMemo(
    () =>
      list
        .filter((r) => !r.done && reminderStatus(r) === "overdue")
        .sort((a, b) => a.dueAt - b.dueAt),
    [list],
  );
  const dayItems = useMemo(
    () => (selected ? remindersOnDay(list, selected.key) : []),
    [list, selected],
  );
  const dayOpen = dayItems.filter((r) => !r.done && reminderStatus(r) !== "overdue");
  const dayDone = dayItems.filter((r) => r.done);
  const later = useMemo(() => {
    const end = weekStart + 7 * 86_400_000;
    return list
      .filter((r) => !r.done && startOfJalaliDay(r.dueAt) >= end)
      .sort((a, b) => a.dueAt - b.dueAt);
  }, [list, weekStart]);
  const doneList = useMemo(
    () => list.filter((r) => r.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
    [list],
  );

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormDueAt(undefined);
  };

  const openNew = (dueAt?: number) => {
    setEditingId(null);
    setFormDueAt(dueAt);
    setShowForm(true);
  };

  const weekLabel = (() => {
    const a = days[0];
    const b = days[6];
    if (!a || !b) return "";
    if (a.jm === b.jm) {
      return `${formatNumber(a.jd)} تا ${formatNumber(b.jd)} ${JMONTHS_LONG[a.jm - 1]}`;
    }
    return `${formatNumber(a.jd)} ${JMONTHS_LONG[a.jm - 1]} تا ${formatNumber(b.jd)} ${JMONTHS_LONG[b.jm - 1]}`;
  })();

  const shiftWeek = (dir: number) => {
    const next = weekStart + dir * 7 * 86_400_000;
    setAnchor(next + 12 * 60 * 60 * 1000);
    setBoard("week");
    const nextDays = weekDays(next + 12 * 60 * 60 * 1000);
    const today = nextDays.find((d) => d.isToday);
    setSelectedKey(today?.key ?? nextDays[0]?.key ?? "");
  };

  return (
    <Layout>
      <header className="mb-4 overflow-hidden rounded-3xl border border-border bg-card shadow-card">
        <div className="bg-gradient-primary px-4 py-4 text-primary-foreground">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-medium text-primary-foreground/80">برنامه مغازه</div>
              <h1 className="text-lg font-bold leading-tight">هفته کاری</h1>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftWeek(-1)}
                className="grid h-8 w-8 place-items-center rounded-xl bg-white/15 hover:bg-white/25"
                aria-label="هفته قبل"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = Date.now();
                  setAnchor(now);
                  setSelectedKey(jalaliDayKey(now));
                  setBoard("week");
                }}
                className="rounded-xl bg-white/15 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-white/25"
              >
                این هفته
              </button>
              <button
                type="button"
                onClick={() => shiftWeek(1)}
                className="grid h-8 w-8 place-items-center rounded-xl bg-white/15 hover:bg-white/25"
                aria-label="هفته بعد"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-1 text-[12px] text-primary-foreground/85">{weekLabel}</div>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[11px] text-primary-foreground/80">
              <span>
                {stats.total === 0
                  ? "هنوز کاری برای این هفته نیست"
                  : `${formatNumber(stats.done)} از ${formatNumber(stats.total)} انجام شد`}
              </span>
              <span>{stats.todayOpen > 0 ? `${formatNumber(stats.todayOpen)} کار امروز` : "امروز خالی است"}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-all duration-500"
                style={{ width: `${Math.round(stats.progress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-2xl bg-muted/70 p-1">
        {(
          [
            ["week", "این هفته"],
            ["later", later.length ? `بعداً (${formatNumber(later.length)})` : "بعداً"],
            ["done", "انجام‌شده"],
          ] as [Board, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setBoard(id)}
            className={`rounded-xl px-2 py-2 text-[11px] font-semibold transition ${
              board === id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {board === "week" && (
        <>
          <div className="mb-3 grid grid-cols-7 gap-1">
            {days.map((day) => {
              const items = remindersOnDay(list, day.key);
              const openCount = items.filter((r) => !r.done).length;
              const hasOverdue = items.some((r) => !r.done && reminderStatus(r) === "overdue");
              const active = selected?.key === day.key;
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => {
                    setSelectedKey(day.key);
                    setBoard("week");
                  }}
                  className={`relative rounded-2xl px-0.5 py-2 text-center transition ${
                    active
                      ? "bg-primary text-primary-foreground shadow-elegant"
                      : day.isToday
                        ? "bg-primary/10 text-foreground"
                        : "bg-card text-muted-foreground ring-1 ring-border"
                  }`}
                >
                  <div className="text-[10px] font-medium opacity-80">{WEEKDAY_SHORT[day.dowSat]}</div>
                  <div className="text-sm font-bold leading-tight">{formatNumber(day.jd)}</div>
                  <div className="mt-1 flex h-1.5 items-center justify-center gap-0.5">
                    {openCount > 0 ? (
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          hasOverdue ? "bg-destructive" : active ? "bg-primary-foreground" : "bg-primary"
                        }`}
                      />
                    ) : (
                      <span className={`h-1 w-1 rounded-full ${active ? "bg-primary-foreground/40" : "bg-border"}`} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {overdue.length > 0 && (
            <section className="mb-3">
              <SectionTitle tone="danger">عقب‌افتاده · باید زودتر انجام شود</SectionTitle>
              <ul className="space-y-2">
                {overdue.map((r) => (
                  <ReminderCard
                    key={r.id}
                    reminder={r}
                    customers={customersList}
                    editing={editingId === r.id}
                    onEdit={() => {
                      setShowForm(false);
                      setEditingId(r.id);
                    }}
                    onCancelEdit={() => setEditingId(null)}
                    onContact={setContactTarget}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="mb-3">
            <div className="mb-2 flex items-end justify-between gap-2">
              <SectionTitle>
                {selected?.isToday ? "امروز" : selected ? WEEKDAY_SAT_FIRST[selected.dowSat] : "روز"}
                {selected ? ` · ${formatJalaliShort(selected.start)}` : ""}
              </SectionTitle>
              <span className="text-[11px] text-muted-foreground">
                {dayOpen.length === 0
                  ? "کاری باز نیست"
                  : `${formatNumber(dayOpen.length)} کار باز`}
              </span>
            </div>

            {!showForm && !editingId && (
              <button
                type="button"
                onClick={() =>
                  openNew(
                    selected
                      ? jalaliToTimestamp(selected.jy, selected.jm, selected.jd, 9, 0)
                      : undefined,
                  )
                }
                className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-elegant"
              >
                <Plus className="h-4 w-4" />
                کار جدید برای این روز
              </button>
            )}

            {showForm && !editingId && (
              <ReminderForm
                customers={customersList}
                presetDueAt={formDueAt}
                onCancel={closeForm}
                onSave={(r) => {
                  remindersStore.add(r);
                  closeForm();
                  setSelectedKey(jalaliDayKey(r.dueAt));
                  setAnchor(r.dueAt);
                  setBoard("week");
                }}
              />
            )}

            {dayOpen.length === 0 && dayDone.length === 0 && !showForm ? (
              <EmptyDay />
            ) : (
              <ul className="space-y-2">
                {dayOpen.map((r) => (
                  <ReminderCard
                    key={r.id}
                    reminder={r}
                    customers={customersList}
                    editing={editingId === r.id}
                    onEdit={() => {
                      setShowForm(false);
                      setEditingId(r.id);
                    }}
                    onCancelEdit={() => setEditingId(null)}
                    onContact={setContactTarget}
                  />
                ))}
                {dayDone.length > 0 && (
                  <li className="pt-1 text-[11px] font-medium text-muted-foreground">
                    {selected?.isToday ? "انجام‌شده امروز" : "انجام‌شده این روز"}
                  </li>
                )}
                {dayDone.map((r) => (
                  <ReminderCard
                    key={r.id}
                    reminder={r}
                    customers={customersList}
                    editing={editingId === r.id}
                    onEdit={() => {
                      setShowForm(false);
                      setEditingId(r.id);
                    }}
                    onCancelEdit={() => setEditingId(null)}
                    onContact={setContactTarget}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {board === "later" && (
        <section>
          <SectionTitle>بعد از این هفته</SectionTitle>
          {later.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              کار دورتری ثبت نشده است.
            </p>
          ) : (
            <ul className="space-y-2">
              {later.map((r) => (
                <ReminderCard
                  key={r.id}
                  reminder={r}
                  customers={customersList}
                  editing={editingId === r.id}
                  onEdit={() => setEditingId(r.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onContact={setContactTarget}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {board === "done" && (
        <section>
          <SectionTitle>کارهای انجام‌شده</SectionTitle>
          {doneList.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              هنوز تیکی نخورده است. با زدن دایره کنار هر کار، انجام می‌شود.
            </p>
          ) : (
            <ul className="space-y-2">
              {doneList.map((r) => (
                <ReminderCard
                  key={r.id}
                  reminder={r}
                  customers={customersList}
                  editing={editingId === r.id}
                  onEdit={() => setEditingId(r.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onContact={setContactTarget}
                />
              ))}
            </ul>
          )}
        </section>
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

function SectionTitle({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <h2
      className={`mb-2 text-[12px] font-bold ${
        tone === "danger" ? "text-destructive" : "text-foreground"
      }`}
    >
      {children}
    </h2>
  );
}

function EmptyDay() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-8 text-center">
      <CalendarDays className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">برای این روز هنوز کاری نیست.</p>
      <p className="mt-1 text-[11px] text-muted-foreground/80">یک کار کوچک هم کافی است تا برنامه جلو برود.</p>
    </div>
  );
}

function clockFa(ts: number): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${formatNumber(String(j.h).padStart(2, "0"))}:${formatNumber(String(j.min).padStart(2, "0"))}`;
}

function ReminderCard({
  reminder: r,
  customers,
  editing,
  onEdit,
  onCancelEdit,
  onContact,
}: {
  reminder: Reminder;
  customers: Customer[];
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onContact: (target: { customer: Customer; title: string }) => void;
}) {
  if (editing) {
    return (
      <li>
        <ReminderForm
          initial={r}
          customers={customers}
          onCancel={onCancelEdit}
          onSave={(updated) => {
            remindersStore.update({ ...r, ...updated });
            onCancelEdit();
          }}
        />
      </li>
    );
  }

  const st = reminderStatus(r);
  const linked = r.customerId ? customers.find((c) => c.id === r.customerId) : undefined;
  const phone = linked?.phone?.trim();

  return (
    <li
      className={`rounded-2xl border bg-card p-3 shadow-card transition ${
        r.done
          ? "border-success/20 bg-success/[0.04]"
          : st === "overdue"
            ? "border-destructive/25"
            : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => (r.done ? remindersStore.markUndone(r.id) : remindersStore.markDone(r.id))}
          className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-all duration-200 ${
            r.done
              ? "border-success bg-success text-success-foreground shadow-sm"
              : "border-border bg-background hover:border-primary hover:bg-primary/5"
          }`}
          title={r.done ? "برگرداندن به برنامه" : "انجام شد"}
          aria-label={r.done ? "برگرداندن به برنامه" : "انجام شد"}
        >
          <Check
            className={`h-4 w-4 transition-all duration-200 ${
              r.done ? "scale-100 opacity-100" : "scale-75 opacity-30"
            }`}
            strokeWidth={r.done ? 3 : 2}
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div
              className={`text-sm font-semibold leading-snug ${
                r.done ? "text-muted-foreground line-through decoration-success/50" : ""
              }`}
            >
              {r.title}
            </div>
            <div className="shrink-0 pt-0.5 text-[12px] font-bold tabular-nums text-primary">
              {clockFa(r.dueAt)}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{formatJalaliDate(r.dueAt)}</span>
            {r.customerName && (
              <span className="inline-flex items-center gap-0.5">
                <User className="h-3 w-3" />
                {r.customerName}
              </span>
            )}
            {!!r.recurringDays && (
              <span className="inline-flex items-center gap-0.5 text-primary">
                <Repeat className="h-3 w-3" />
                هر {formatNumber(r.recurringDays)} روز
              </span>
            )}
          </div>
          {r.note && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{r.note}</p>}

          {!r.done && linked && (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onContact({ customer: linked, title: r.title })}
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
          )}
        </div>
      </div>

      <div className="mt-2 flex justify-end gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
          title="ویرایش"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm("این کار از برنامه حذف شود؟")) remindersStore.remove(r.id);
          }}
          className="grid h-7 w-7 place-items-center rounded-lg text-destructive/80 hover:bg-destructive/10"
          title="حذف"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function ReminderForm({
  initial,
  customers,
  presetDueAt,
  onSave,
  onCancel,
}: {
  initial?: Reminder;
  customers: Customer[];
  presetDueAt?: number;
  onSave: (r: Omit<Reminder, "id" | "createdAt" | "done" | "doneAt">) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const nowJ = toJalali(Date.now()) ?? { jy: 1403, jm: 1, jd: 1, h: 9, min: 0 };
  const seed = initial?.dueAt ?? presetDueAt;
  const initJ = seed ? (toJalali(seed) ?? nowJ) : { ...nowJ, h: 9, min: 0 };
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
      setErr("عنوان کار را بنویسید.");
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
      <Field label="چه کاری است؟">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="مثلاً پیگیری پرداخت آقای رضایی"
          className={INPUT}
          autoFocus={!initial}
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

      <Field label="روز">
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

      <Field label="توضیح کوتاه (اختیاری)">
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
          تکرار شود
        </label>
        {recurring && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-1.5">
              {[
                [7, "هر هفته"],
                [30, "هر ماه"],
              ].map(([n, label]) => (
                <button
                  key={String(n)}
                  type="button"
                  onClick={() => setRecurringDays(Number(n))}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${
                    recurringDays === n
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">هر</span>
              <input
                inputMode="numeric"
                value={formatNumber(recurringDays)}
                onChange={(e) =>
                  setRecurringDays(Math.max(1, +e.target.value.replace(/\D/g, "") || 1))
                }
                className="w-20 rounded-lg border border-input bg-card px-2 py-1.5 text-center outline-none focus:border-primary"
              />
              <span className="text-muted-foreground">روز یک‌بار</span>
            </div>
          </div>
        )}
      </div>

      {err && (
        <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Check className="h-4 w-4" />
          ذخیره در برنامه
        </button>
        <button
          type="button"
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
