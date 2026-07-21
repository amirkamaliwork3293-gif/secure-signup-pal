import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  students as studentsStore,
  studentStatus,
  studentDaysToDue,
  formatToman,
  formatNumber,
  parseNumberInput,
  settings,
  formatJalaliDate,
  formatJalaliDateTime,
  type Student,
} from "@/lib/store";
import { shareText } from "@/lib/openExternal";
import { filterAndRankSearch } from "@/lib/search";
import {
  GraduationCap,
  Plus,
  X,
  Search,
  Phone,
  Trash2,
  Pencil,
  Send,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Wallet,
  Power,
  MessageCircle,
  Share2,
} from "lucide-react";

export const Route = createFileRoute("/students")({
  head: () => ({
    meta: [
      { title: "هنرجویان و شهریه | KAMIX" },
      {
        name: "description",
        content:
          "مدیریت هنرجویان کلاس‌ها و باشگاه‌ها، ثبت شهریه ماهانه و پیامک یادآوری پرداخت.",
      },
    ],
  }),
  component: StudentsPage,
});

const inputCls =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

type Filter = "all" | "due" | "active" | "archived";

function StudentsPage() {
  return (
    <AuthGuard>
      <Layout>
        <StudentsInner />
      </Layout>
    </AuthGuard>
  );
}

function StudentsInner() {
  const [list] = studentsStore.useAll();
  const [appSettings] = settings.useAll();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Student | null>(null);
  const [smsFor, setSmsFor] = useState<{ student: Student; payment?: { amount: number; nextDueAt: number } } | null>(null);

  const dueCount = list.filter((s) => {
    const st = studentStatus(s);
    return st === "overdue" || st === "due-today";
  }).length;
  const soonCount = list.filter((s) => studentStatus(s) === "soon").length;

  const filtered = useMemo(() => {
    const query = q.trim();
    const items = list.filter((s) => {
      const st = studentStatus(s);
      if (filter === "due" && !(st === "overdue" || st === "due-today")) return false;
      if (filter === "active" && !s.active) return false;
      if (filter === "archived" && s.active) return false;
      return true;
    });
    // مرتب‌سازی: بدهکار و امروز اول، سپس نزدیک، سپس بقیه
    const weight = (s: Student) => {
      const st = studentStatus(s);
      if (st === "overdue") return 0;
      if (st === "due-today") return 1;
      if (st === "soon") return 2;
      return 3;
    };
    const sorted = items.sort((a, b) => {
      const w = weight(a) - weight(b);
      if (w !== 0) return w;
      return a.nextDueAt - b.nextDueAt;
    });
    if (!query) return sorted;
    return filterAndRankSearch(sorted, query, (s) => [
      `${s.firstName} ${s.lastName ?? ""}`,
      s.discipline,
      s.phone,
    ]);
  }, [list, q, filter]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <GraduationCap className="h-5 w-5 text-primary" />
            هنرجویان
          </h1>
          <p className="text-xs text-muted-foreground">
            لیست هنرجوهای کلاس یا باشگاه و سررسید شهریه هر نفر
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-elegant"
        >
          <Plus className="h-4 w-4" />
          افزودن
        </button>
      </div>

      {/* Alerts */}
      {(dueCount > 0 || soonCount > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <div className={`rounded-xl border p-3 ${dueCount > 0 ? "border-red-500/40 bg-red-500/5" : "border-border"}`}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              سررسید شده / امروز
            </div>
            <div className="mt-1 text-lg font-bold text-red-500">{formatNumber(dueCount)} نفر</div>
          </div>
          <div className={`rounded-xl border p-3 ${soonCount > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-border"}`}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              نزدیک سررسید (۳ روز)
            </div>
            <div className="mt-1 text-lg font-bold text-amber-600">{formatNumber(soonCount)} نفر</div>
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو نام، تلفن، رشته…"
            className={`${inputCls} pr-9`}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            ["all", "همه"],
            ["due", "سررسید شده"],
            ["active", "فعال"],
            ["archived", "بایگانی"],
          ] as [Filter, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-xs ${filter === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {list.length === 0 ? "هنوز هنرجویی اضافه نکرده‌اید. برای شروع دکمهٔ «افزودن» را بزنید." : "نتیجه‌ای پیدا نشد."}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s) => {
            const st = studentStatus(s);
            const days = studentDaysToDue(s);
            const isOpen = expanded === s.id;
            const totalPaid = s.payments.reduce((a, p) => a + p.amount, 0);
            return (
              <li key={s.id} className="rounded-2xl border border-border bg-card">
                <div className="flex items-start justify-between gap-2 p-3">
                  <button className="flex-1 text-right" onClick={() => setExpanded(isOpen ? null : s.id)}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${
                        st === "overdue" ? "bg-red-500" :
                        st === "due-today" ? "bg-red-400" :
                        st === "soon" ? "bg-amber-500" :
                        s.active ? "bg-emerald-500" : "bg-muted"
                      }`} />
                      <span className="font-semibold">
                        {s.firstName} {s.lastName ?? ""}
                      </span>
                      {s.discipline && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {s.discipline}
                        </span>
                      )}
                      {!s.active && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          غیرفعال
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>شهریه: {formatToman(s.fee)}</span>
                      <span>دوره: {formatNumber(s.periodDays)} روز</span>
                      <span className={
                        st === "overdue" ? "font-semibold text-red-500" :
                        st === "due-today" ? "font-semibold text-red-500" :
                        st === "soon" ? "font-semibold text-amber-600" : ""
                      }>
                        {st === "overdue" ? `${formatNumber(-days)} روز عقب` :
                         st === "due-today" ? "امروز سررسید!" :
                         `${formatNumber(days)} روز مانده`}
                      </span>
                      <span>سررسید: {formatJalaliDate(s.nextDueAt)}</span>
                    </div>
                  </button>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => setPayFor(s)}
                      className="flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                      title="ثبت پرداخت شهریه"
                    >
                      <Wallet className="h-3.5 w-3.5" />
                      پرداخت
                    </button>
                    {s.phone && (
                      <button
                        onClick={() => setSmsFor({ student: s })}
                        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-accent"
                        title="پیامک یادآوری"
                      >
                        <Send className="h-3.5 w-3.5" />
                        پیامک
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-border/60 px-3 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                        <div className="text-muted-foreground">تاریخ شروع</div>
                        <div className="font-medium">{formatJalaliDate(s.startDate)}</div>
                      </div>
                      <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                        <div className="text-muted-foreground">جمع دریافتی</div>
                        <div className="font-medium text-emerald-600">{formatToman(totalPaid)}</div>
                      </div>
                      {s.phone && (
                        <a href={`tel:${s.phone}`} className="flex items-center gap-1 rounded-lg bg-muted/50 px-2 py-1.5 text-primary">
                          <Phone className="h-3.5 w-3.5" />
                          {s.phone}
                        </a>
                      )}
                      {s.note && (
                        <div className="rounded-lg bg-muted/50 px-2 py-1.5 col-span-2">
                          <div className="text-muted-foreground">یادداشت</div>
                          <div>{s.note}</div>
                        </div>
                      )}
                    </div>

                    {s.payments.length > 0 && (
                      <div>
                        <div className="mb-1 text-xs font-semibold text-muted-foreground">سابقهٔ پرداخت‌ها</div>
                        <ul className="space-y-1">
                          {s.payments.slice(0, 6).map((p) => (
                            <li key={p.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-2 py-1.5 text-xs">
                              <span className="text-muted-foreground">{formatJalaliDateTime(p.at)}</span>
                              <span className="font-semibold text-emerald-600">{formatToman(p.amount)}</span>
                            </li>
                          ))}
                          {s.payments.length > 6 && (
                            <li className="text-center text-[10px] text-muted-foreground">
                              و {formatNumber(s.payments.length - 6)} پرداخت دیگر…
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => { setEditing(s); setShowForm(true); }}
                        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        ویرایش
                      </button>
                      <button
                        onClick={() => {
                          const updated = { ...s, active: !s.active };
                          studentsStore.update(updated);
                        }}
                        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                      >
                        <Power className="h-3.5 w-3.5" />
                        {s.active ? "غیرفعال کن" : "فعال کن"}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`حذف هنرجو «${s.firstName}»؟`)) {
                            studentsStore.remove(s.id);
                          }
                        }}
                        className="flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-500/5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        حذف
                      </button>
                      <button
                        onClick={() => setExpanded(null)}
                        className="mr-auto flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                        بستن
                      </button>
                    </div>
                  </div>
                )}
                {!isOpen && (
                  <button
                    onClick={() => setExpanded(s.id)}
                    className="flex w-full items-center justify-center gap-1 border-t border-border/60 py-1.5 text-[11px] text-muted-foreground hover:bg-accent"
                  >
                    <ChevronDown className="h-3 w-3" />
                    جزئیات
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showForm && (
        <StudentForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={(s) => {
            if (editing) {
              studentsStore.update(s);
            } else {
              studentsStore.add(s);
            }
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {payFor && (
        <PaymentDialog
          student={payFor}
          onClose={() => setPayFor(null)}
          onDone={(amount, nextDueAt) => {
            const st = payFor;
            setPayFor(null);
            // پس از ثبت، پیشنهاد ارسال پیامک تشکر:
            setSmsFor({ student: { ...st }, payment: { amount, nextDueAt } });
          }}
        />
      )}

      {smsFor && (
        <SmsDialog
          student={smsFor.student}
          payment={smsFor.payment}
          shopName={appSettings.shopName}
          onClose={() => setSmsFor(null)}
        />
      )}
    </div>
  );
}

// ─── Form ────────────────────────────────────────────────────────────────────

function StudentForm({ initial, onClose, onSave }: {
  initial: Student | null;
  onClose: () => void;
  onSave: (s: Student) => void;
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [discipline, setDiscipline] = useState(initial?.discipline ?? "");
  const [feeStr, setFeeStr] = useState(initial ? String(initial.fee) : "");
  const [periodStr, setPeriodStr] = useState(String(initial?.periodDays ?? 30));
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(initial?.startDate ?? Date.now());
    return d.toISOString().slice(0, 10);
  });
  const [note, setNote] = useState(initial?.note ?? "");

  const submit = () => {
    const fee = parseNumberInput(feeStr);
    const periodDays = Math.max(1, Math.round(parseNumberInput(periodStr)));
    if (!firstName.trim()) { alert("نام هنرجو را وارد کنید."); return; }
    if (fee <= 0) { alert("مبلغ شهریه را وارد کنید."); return; }
    const startTs = new Date(startDate + "T00:00:00+03:30").getTime();
    if (initial) {
      onSave({
        ...initial,
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        phone: phone.trim() || undefined,
        discipline: discipline.trim() || undefined,
        fee,
        periodDays,
        startDate: startTs,
        note: note.trim() || undefined,
      });
    } else {
      // add returns a Student in the store; here we just build the shape passed to onSave via store.add
      onSave({
        id: "", createdAt: 0, active: true, nextDueAt: startTs + periodDays * 86_400_000, payments: [],
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        phone: phone.trim() || undefined,
        discipline: discipline.trim() || undefined,
        fee, periodDays, startDate: startTs,
        note: note.trim() || undefined,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-2 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-background p-4 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{initial ? "ویرایش هنرجو" : "افزودن هنرجو"}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">نام</label>
              <input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">نام خانوادگی</label>
              <input className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">شماره موبایل (برای پیامک)</label>
            <input className={inputCls} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xxxxxxxxx" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">رشته / کلاس (اختیاری)</label>
            <input className={inputCls} value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="مثلاً کاراته، بدنسازی" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">شهریهٔ هر دوره (تومان)</label>
              <input className={inputCls} inputMode="numeric" value={feeStr} onChange={(e) => setFeeStr(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">طول دوره (روز)</label>
              <input className={inputCls} inputMode="numeric" value={periodStr} onChange={(e) => setPeriodStr(e.target.value)} placeholder="۳۰" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">تاریخ شروع (ثبت‌نام)</label>
            <input className={inputCls} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">یادداشت (اختیاری)</label>
            <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-border py-2.5 text-sm">انصراف</button>
          <button onClick={submit} className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
            {initial ? "ذخیره" : "افزودن"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Payment ─────────────────────────────────────────────────────────────────

function PaymentDialog({ student, onClose, onDone }: {
  student: Student;
  onClose: () => void;
  onDone: (amount: number, nextDueAt: number) => void;
}) {
  const [amountStr, setAmountStr] = useState(String(student.fee));
  const [daysStr, setDaysStr] = useState(String(student.periodDays));
  const [note, setNote] = useState("");

  const submit = () => {
    const amount = parseNumberInput(amountStr);
    const days = Math.max(1, Math.round(parseNumberInput(daysStr)));
    if (amount <= 0) { alert("مبلغ نامعتبر"); return; }
    studentsStore.recordPayment(student.id, { amount, days, note: note.trim() || undefined });
    const updated = studentsStore.getAll().find((s) => s.id === student.id)!;
    onDone(amount, updated.nextDueAt);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-2 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-background p-4 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Wallet className="h-4 w-4 text-emerald-500" />
            ثبت پرداخت شهریه
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          هنرجو: <span className="font-semibold text-foreground">{student.firstName} {student.lastName ?? ""}</span>
        </p>
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">مبلغ (تومان)</label>
            <input className={inputCls} inputMode="numeric" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">تمدید دوره برای (روز)</label>
            <input className={inputCls} inputMode="numeric" value={daysStr} onChange={(e) => setDaysStr(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">یادداشت (اختیاری)</label>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-border py-2.5 text-sm">انصراف</button>
          <button onClick={submit} className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white">
            <CheckCircle2 className="ml-1 inline h-4 w-4" />
            ثبت پرداخت
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SMS ─────────────────────────────────────────────────────────────────────

function buildSmsBody(opts: {
  student: Student;
  shopName?: string;
  payment?: { amount: number; nextDueAt: number };
}): string {
  const name = `${opts.student.firstName} ${opts.student.lastName ?? ""}`.trim();
  const shop = opts.shopName || "باشگاه";
  if (opts.payment) {
    return `سلام ${name} عزیز،\nپرداخت شهریه شما به مبلغ ${formatToman(opts.payment.amount)} با موفقیت ثبت شد.\nسررسید بعدی: ${formatJalaliDate(opts.payment.nextDueAt)}\nبا تشکر — ${shop}`;
  }
  // یادآوری
  const days = studentDaysToDue(opts.student);
  const st = studentStatus(opts.student);
  if (st === "overdue") {
    return `سلام ${name} عزیز،\nموعد پرداخت شهریه شما ${formatNumber(-days)} روز گذشته است.\nمبلغ: ${formatToman(opts.student.fee)}\nلطفاً در اسرع وقت تسویه فرمایید.\n${shop}`;
  }
  if (st === "due-today") {
    return `سلام ${name} عزیز،\nامروز موعد پرداخت شهریه شما به مبلغ ${formatToman(opts.student.fee)} می‌باشد.\nمنتظر حضور شما هستیم.\n${shop}`;
  }
  return `سلام ${name} عزیز،\nیادآوری: ${formatNumber(days)} روز دیگر موعد شهریه شما (${formatToman(opts.student.fee)}) فرا می‌رسد.\n${shop}`;
}

function SmsDialog({ student, payment, shopName, onClose }: {
  student: Student;
  payment?: { amount: number; nextDueAt: number };
  shopName?: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(() => buildSmsBody({ student, payment, shopName }));
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const phoneRaw = student.phone ?? "";
  const intl = toIntlPhone(phoneRaw);
  const smsUrl = phoneRaw ? `sms:${phoneRaw}?body=${encodeURIComponent(text)}` : "#";
  const waUrl = intl ? `https://wa.me/${intl}?text=${encodeURIComponent(text)}` : "#";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-2 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-background p-4 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Send className="h-4 w-4 text-primary" />
            ارسال پیامک {payment ? "تشکر" : "یادآوری"}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          گیرنده: <span className="font-semibold text-foreground">{student.firstName} {student.lastName ?? ""}</span>
          {student.phone && <> — <span className="text-primary" dir="ltr">{student.phone}</span></>}
        </p>
        <textarea
          className={`${inputCls} min-h-[140px] leading-6`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          dir="rtl"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          متن قابل ویرایش است. با انتخاب هر گزینه، مستقیماً وارد چت با هنرجو در همان پیام‌رسان می‌شوید.
        </p>
        {!phoneRaw ? (
          <p className="mt-3 text-center text-[11px] text-destructive">شماره موبایل هنرجو ثبت نشده است.</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-green-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-green-700 ${!intl ? "pointer-events-none opacity-50" : ""}`}
              >
                <MessageCircle className="h-4 w-4" />
                واتساپ
              </a>
              <a
                href={smsUrl}
                onClick={onClose}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                <Send className="h-4 w-4" />
                پیامک
              </a>
            </div>
            <button
              onClick={async () => {
                const result = await shareText({ title: "پیام به هنرجو", text });
                setShareNotice(
                  result === "shared"
                    ? "پنجره اشتراک باز شد؛ اگر متن نیامد، از کلیپ‌بورد Paste کنید."
                    : "متن در کلیپ‌بورد کپی شد؛ در روبیکا/بله/ایتا/تلگرام Paste کنید.",
                );
              }}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-semibold hover:bg-accent"
            >
              <Share2 className="h-4 w-4" />
              اشتراک‌گذاری در روبیکا / بله / ایتا / تلگرام …
            </button>
            {shareNotice && <p className="mt-2 text-center text-[11px] text-primary">{shareNotice}</p>}
            {!intl && (
              <p className="mt-2 text-center text-[11px] text-destructive">شماره برای واتساپ نامعتبر است.</p>
            )}
          </>
        )}
        <button onClick={onClose} className="mt-3 w-full rounded-xl border border-border py-2 text-sm">بستن</button>
      </div>
    </div>
  );
}

function toIntlPhone(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0098")) return digits.slice(2);
  if (digits.startsWith("98")) return digits;
  if (digits.startsWith("0")) return "98" + digits.slice(1);
  if (digits.startsWith("9") && digits.length === 10) return "98" + digits;
  return digits;
}
