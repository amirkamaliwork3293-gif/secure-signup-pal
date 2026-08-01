import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  expenses as expensesStore,
  emptyExpense,
  expensesByCategory,
  expensesTotal,
  expenseNextDue,
  EXPENSE_CATEGORIES,
  formatToman,
  formatNumber,
  formatJalaliDate,
  parseNumberInput,
  jalaliToTimestamp,
  toJalali,
  jalaliMonthLength,
  JMONTHS_LONG,
  PAYMENT_LABEL,
  accounts as accountsStore,
  accountTxs as accountTxsStore,
  accountBalance,
  maskCardNumber,
  type Expense,
  type PaymentMethod,
  type Account,
} from "@/lib/store";
import {
  Wallet, Plus, Trash2, Pencil, Check, X, Search, Repeat, CalendarClock, PieChart,
  Landmark, ArrowDownCircle, ArrowUpCircle, CreditCard,
} from "lucide-react";

export const Route = createFileRoute("/expenses")({
  head: () => ({
    meta: [
      { title: "هزینه‌ها | KAMIX" },
      { name: "description", content: "ثبت و مدیریت هزینه‌های کسب‌وکار: اجاره، حقوق، قبوض و هزینه‌های ثابت ماهانه." },
      { property: "og:title", content: "مدیریت هزینه‌ها | KAMIX" },
      { property: "og:description", content: "هزینه‌های ثابت و متغیر کسب‌وکارتان را ثبت کنید و سود واقعی را ببینید." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpensesPage,
});

const INPUT =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

type Range = "month" | "year" | "all";
const RANGE_LABEL: Record<Range, string> = { month: "این ماه", year: "امسال", all: "کل" };

// نکته مهم: کل برنامه تاریخ‌ها را به تقویم شمسی نمایش و ذخیره می‌کند، پس بازه‌ی
// «این ماه»/«امسال» هم باید بر اساس ماه/سال شمسی محاسبه شود، نه میلادی —
// در غیر این صورت هزینه‌ای که همین ماهِ شمسی ثبت شده ممکن است چون هنوز به
// اول ماهِ میلادی نرسیده، در فیلتر «این ماه» دیده نشود ولی در «امسال» باشد.
function startOfMonth() {
  const j = toJalali(Date.now());
  if (!j) return 0;
  return jalaliToTimestamp(j.jy, j.jm, 1, 0, 0);
}
function startOfYear() {
  const j = toJalali(Date.now());
  if (!j) return 0;
  return jalaliToTimestamp(j.jy, 1, 1, 0, 0);
}

function ExpensesPageInner() {
  const [page, setPage] = useState<"expenses" | "accounts">("expenses");
  const [list] = expensesStore.useAll();
  const [range, setRange] = useState<Range>("month");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const inRange = useMemo(() => {
    const from = range === "all" ? 0 : range === "month" ? startOfMonth() : startOfYear();
    return list.filter((e) => e.at >= from);
  }, [list, range]);

  const visible = useMemo(() => {
    const q = query.trim();
    const base = [...inRange].sort((a, b) => b.at - a.at);
    if (!q) return base;
    return base.filter((e) =>
      [e.title, e.category, e.note].filter(Boolean).some((t) => String(t).includes(q)),
    );
  }, [inRange, query]);

  const total = expensesTotal(inRange);
  const byCategory = useMemo(() => expensesByCategory(inRange), [inRange]);
  const recurring = useMemo(
    () =>
      list
        .filter((e) => e.recurringDays && e.recurringDays > 0)
        .map((e) => ({ e, due: expenseNextDue(e) }))
        .filter((r) => r.due != null)
        .sort((a, b) => (a.due as number) - (b.due as number)),
    [list],
  );

  return (
    <Layout>
      <h1 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <Wallet className="h-5 w-5 text-primary" />
        هزینه‌ها
      </h1>

      <div className="mb-4 flex gap-2">
        {([
          ["expenses", "هزینه‌ها", Wallet],
          ["accounts", "حساب‌ها و کارت‌ها", Landmark],
        ] as [typeof page, string, typeof Wallet][]).map(([p, label, Icon]) => (
          <button
            key={p}
            type="button"
            onClick={() => setPage(p)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-medium transition ${
              page === p
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {page === "accounts" ? (
        <AccountsPanel />
      ) : (
        <>
      <div className="mb-4 flex gap-2">
        {(["month", "year", "all"] as Range[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`flex-1 rounded-xl px-2 py-2 text-xs font-medium transition ${
              range === r
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      <section className="mb-4 rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-elegant">
        <div className="text-xs opacity-80">مجموع هزینه‌ها ({RANGE_LABEL[range]})</div>
        <div className="mt-1 text-xl font-bold">{formatToman(total)}</div>
        <div className="mt-0.5 text-xs opacity-80">{formatNumber(inRange.length)} مورد</div>
      </section>

      {!showForm && !editingId && (
        <button
          onClick={() => { setShowForm(true); setEditingId(null); }}
          className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          ثبت هزینه جدید
        </button>
      )}

      {showForm && !editingId && (
        <ExpenseForm
          initial={emptyExpense()}
          onCancel={() => setShowForm(false)}
          onSave={(e) => { expensesStore.add(e); setShowForm(false); }}
        />
      )}

      {recurring.length > 0 && (
        <section className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-primary" />
            هزینه‌های ثابت و سررسید بعدی
          </h2>
          <ul className="space-y-1.5">
            {recurring.slice(0, 6).map(({ e, due }) => {
              const overdue = (due as number) <= Date.now();
              return (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium">{e.title || e.category}</span>
                  <span className={overdue ? "shrink-0 font-semibold text-destructive" : "shrink-0 text-muted-foreground"}>
                    {overdue ? "سررسید گذشته: " : "سررسید: "}
                    {formatJalaliDate(due as number)}
                  </span>
                  <span className="shrink-0 font-semibold text-primary">{formatToman(e.amount)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {byCategory.length > 0 && (
        <section className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <PieChart className="h-4 w-4 text-primary" />
            هزینه به تفکیک دسته ({RANGE_LABEL[range]})
          </h2>
          <ul className="space-y-2">
            {byCategory.map(({ category, total: t }) => (
              <li key={category} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{category}</span>
                  <span className="font-semibold text-primary">{formatToman(t)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-gradient-primary" style={{ width: `${(t / Math.max(1, total)) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجو در هزینه‌ها..."
          className="w-full bg-transparent text-sm outline-none"
        />
        {query && (
          <button onClick={() => setQuery("")} className="text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          هزینه‌ای در این بازه ثبت نشده است.
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((e) =>
            editingId === e.id ? (
              <li key={e.id}>
                <ExpenseForm
                  initial={e}
                  onCancel={() => setEditingId(null)}
                  onSave={(updated) => { expensesStore.update(updated); setEditingId(null); }}
                />
              </li>
            ) : (
              <li key={e.id} className="rounded-2xl border border-border bg-card p-3 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{e.title || e.category}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5">{e.category}</span>
                      <span>{formatJalaliDate(e.at)}</span>
                      {e.paymentMethod && <span>{PAYMENT_LABEL[e.paymentMethod]}</span>}
                      {!!e.recurringDays && (
                        <span className="flex items-center gap-1 text-primary">
                          <Repeat className="h-3 w-3" />
                          هر {formatNumber(e.recurringDays)} روز
                        </span>
                      )}
                    </div>
                    {e.note && <div className="mt-1 text-[11px] text-muted-foreground">{e.note}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-bold text-destructive">{formatToman(e.amount)}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setEditingId(e.id); setShowForm(false); }}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent"
                        title="ویرایش"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => { if (confirm("این هزینه حذف شود؟")) expensesStore.remove(e.id); }}
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
        </>
      )}
    </Layout>
  );
}

function ExpenseForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Expense;
  onSave: (e: Expense) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [amount, setAmount] = useState(initial.amount);
  const [category, setCategory] = useState(initial.category || EXPENSE_CATEGORIES[0]);
  const [note, setNote] = useState(initial.note ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initial.paymentMethod ?? "cash");
  const initJ = toJalali(initial.at) ?? { jy: 1403, jm: 1, jd: 1, h: 0, min: 0 };
  const [jy, setJy] = useState(initJ.jy);
  const [jm, setJm] = useState(initJ.jm);
  const [jd, setJd] = useState(initJ.jd);
  const [hh, setHh] = useState(initJ.h);
  const [mm, setMm] = useState(initJ.min);
  const [recurring, setRecurring] = useState(!!initial.recurringDays);
  const [recurringDays, setRecurringDays] = useState(initial.recurringDays ?? 30);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    if (amount <= 0) { setErr("مبلغ هزینه را وارد کنید."); return; }
    onSave({
      ...initial,
      title: title.trim() || category,
      amount,
      category,
      note: note.trim() || undefined,
      paymentMethod,
      at: jalaliToTimestamp(jy, jm, jd, hh, mm),
      recurringDays: recurring ? Math.max(1, recurringDays) : undefined,
    });
  };

  const daysInSelectedMonth = jalaliMonthLength(jy, jm);
  useEffect(() => {
    if (jd > daysInSelectedMonth) setJd(daysInSelectedMonth);
  }, [daysInSelectedMonth, jd]);
  const nowJ = toJalali(Date.now()) ?? { jy: 1403 };
  const YEARS = Array.from({ length: 4 }, (_, i) => nowJ.jy - 2 + i);
  const SELECT =
    "w-full rounded-xl border border-input bg-background px-2 py-2.5 text-center text-sm outline-none focus:border-primary";

  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="grid grid-cols-2 gap-2">
        <Field label="عنوان هزینه">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً اجاره مغازه" className={INPUT} />
        </Field>
        <Field label="مبلغ (تومان)">
          <input
            inputMode="numeric"
            value={formatNumber(amount)}
            onChange={(e) => setAmount(Math.max(0, parseNumberInput(e.target.value)))}
            className={INPUT}
          />
        </Field>
      </div>

      <Field label="دسته‌بندی">
        <div className="flex flex-wrap gap-1.5">
          {EXPENSE_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1.5 text-[11px] transition ${
                category === c
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </Field>

      <Field label="تاریخ (شمسی)">
        <div className="grid grid-cols-3 gap-1.5">
          <select value={jd} onChange={(e) => setJd(+e.target.value)} className={SELECT}>
            {Array.from({ length: daysInSelectedMonth }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{formatNumber(d)}</option>
            ))}
          </select>
          <select value={jm} onChange={(e) => setJm(+e.target.value)} className={SELECT}>
            {JMONTHS_LONG.map((name, i) => (
              <option key={name} value={i + 1}>{name}</option>
            ))}
          </select>
          <select value={jy} onChange={(e) => setJy(+e.target.value)} className={SELECT}>
            {YEARS.map((y) => (
              <option key={y} value={y}>{formatNumber(y)}</option>
            ))}
          </select>
        </div>
      </Field>

      <Field label="ساعت">
        <div className="grid grid-cols-2 gap-1.5">
          <select value={hh} onChange={(e) => setHh(+e.target.value)} className={SELECT} dir="ltr">
            {Array.from({ length: 24 }, (_, i) => i).map((h) => (
              <option key={h} value={h}>{formatNumber(String(h).padStart(2, "0"))}</option>
            ))}
          </select>
          <select value={mm} onChange={(e) => setMm(+e.target.value)} className={SELECT} dir="ltr">
            {Array.from({ length: 60 }, (_, i) => i).map((m) => (
              <option key={m} value={m}>{formatNumber(String(m).padStart(2, "0"))}</option>
            ))}
          </select>
        </div>
      </Field>

      <Field label="روش پرداخت">
        <div className="flex gap-1.5">
          {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPaymentMethod(m)}
              className={`flex-1 rounded-xl px-2 py-2 text-[11px] transition ${
                paymentMethod === m
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              {PAYMENT_LABEL[m]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="توضیحات (اختیاری)">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
      </Field>

      <div className="rounded-xl border border-border bg-background p-3">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="h-4 w-4" />
          <Repeat className="h-3.5 w-3.5 text-primary" />
          هزینه‌ی تکرارشونده (ثابت)
        </label>
        {recurring && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">هر</span>
            <input
              inputMode="numeric"
              value={formatNumber(recurringDays)}
              onChange={(e) => setRecurringDays(Math.max(1, parseNumberInput(e.target.value)))}
              className="w-20 rounded-lg border border-input bg-card px-2 py-1.5 text-center outline-none focus:border-primary"
            />
            <span className="text-muted-foreground">روز یک‌بار (۳۰ = ماهانه)</span>
          </div>
        )}
      </div>

      {err && <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}

      <div className="flex gap-2">
        <button
          onClick={submit}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Check className="h-4 w-4" />
          ذخیره هزینه
        </button>
        <button onClick={onCancel} className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm">
          <X className="h-4 w-4" />
          لغو
        </button>
      </div>
    </div>
  );
}

function AccountsPanel() {
  const [accountsList] = accountsStore.useAll();
  const [txsList] = accountTxsStore.useAll();
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [txFormFor, setTxFormFor] = useState<string | null>(null);
  const [openHistoryFor, setOpenHistoryFor] = useState<string | null>(null);

  const totalBalance = accountsList.reduce((s, a) => s + accountBalance(a, txsList), 0);

  return (
    <div>
      <section className="mb-4 rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-elegant">
        <div className="text-xs opacity-80">مجموع موجودی همه‌ی حساب‌ها و کارت‌ها</div>
        <div className="mt-1 text-xl font-bold">{formatToman(totalBalance)}</div>
        <div className="mt-0.5 text-xs opacity-80">{formatNumber(accountsList.length)} حساب</div>
      </section>

      {!showAccountForm && (
        <button
          onClick={() => setShowAccountForm(true)}
          className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          افزودن حساب یا کارت جدید
        </button>
      )}

      {showAccountForm && (
        <AccountForm
          onCancel={() => setShowAccountForm(false)}
          onSave={(a) => { accountsStore.add(a); setShowAccountForm(false); }}
        />
      )}

      {accountsList.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          هنوز حساب یا کارتی ثبت نشده است. صندوق فروشگاه یا کارت بانکی خود را اضافه کنید.
        </div>
      ) : (
        <ul className="space-y-2">
          {accountsList.map((a) => {
            const balance = accountBalance(a, txsList);
            const accountTxs = txsList
              .filter((t) => t.accountId === a.id)
              .sort((x, y) => y.at - x.at);
            return (
              <li key={a.id} className="rounded-2xl border border-border bg-card p-3 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <CreditCard className="h-4 w-4 text-primary shrink-0" />
                      <span className="truncate">{a.name}</span>
                    </div>
                    {a.cardNumber && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground" dir="ltr">
                        {maskCardNumber(a.cardNumber)}
                      </div>
                    )}
                    <div className={`mt-1 text-sm font-bold ${balance < 0 ? "text-destructive" : "text-success"}`}>
                      {formatToman(balance)}
                    </div>
                  </div>
                  <button
                    onClick={() => { if (confirm(`حساب «${a.name}» و تراکنش‌های آن حذف شود؟`)) accountsStore.remove(a.id); }}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border text-destructive hover:bg-destructive/10"
                    title="حذف حساب"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={() => setTxFormFor(txFormFor === a.id ? null : a.id)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-[11px] font-medium hover:bg-accent"
                  >
                    <ArrowDownCircle className="h-3.5 w-3.5 text-success" />
                    <ArrowUpCircle className="h-3.5 w-3.5 text-destructive -mr-1" />
                    ثبت واریز / برداشت
                  </button>
                  {accountTxs.length > 0 && (
                    <button
                      onClick={() => setOpenHistoryFor(openHistoryFor === a.id ? null : a.id)}
                      className="rounded-lg border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent"
                    >
                      {openHistoryFor === a.id ? "بستن تاریخچه" : `تاریخچه (${formatNumber(accountTxs.length)})`}
                    </button>
                  )}
                </div>

                {txFormFor === a.id && (
                  <AccountTxForm
                    accountId={a.id}
                    onDone={() => setTxFormFor(null)}
                  />
                )}

                {openHistoryFor === a.id && (
                  <ul className="mt-2 space-y-1 border-t border-border pt-2">
                    {accountTxs.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          {t.type === "deposit" ? (
                            <ArrowDownCircle className="h-3 w-3 text-success" />
                          ) : (
                            <ArrowUpCircle className="h-3 w-3 text-destructive" />
                          )}
                          {formatJalaliDate(t.at)}
                          {t.note ? ` — ${t.note}` : ""}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className={t.type === "deposit" ? "font-semibold text-success" : "font-semibold text-destructive"}>
                            {t.type === "deposit" ? "+" : "−"}{formatToman(t.amount)}
                          </span>
                          <button
                            onClick={() => { if (confirm("این تراکنش حذف شود؟")) accountTxsStore.remove(t.id); }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AccountForm({
  onSave,
  onCancel,
}: {
  onSave: (a: Omit<Account, "id" | "createdAt">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [openingBalance, setOpeningBalance] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) { setErr("نام حساب یا کارت را وارد کنید."); return; }
    onSave({ name: name.trim(), cardNumber: cardNumber.replace(/\D/g, "") || undefined, openingBalance });
  };

  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
      <Field label="نام حساب یا کارت">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً صندوق فروشگاه یا کارت ملی" className={INPUT} />
      </Field>
      <Field label="شماره کارت (اختیاری)">
        <input
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          inputMode="numeric"
          dir="ltr"
          placeholder="۱۶ رقم شماره کارت"
          className={INPUT}
        />
      </Field>
      <Field label="موجودی اولیه (تومان)">
        <input
          inputMode="numeric"
          value={formatNumber(openingBalance)}
          onChange={(e) => setOpeningBalance(Math.max(0, parseNumberInput(e.target.value)))}
          className={INPUT}
        />
      </Field>
      {err && <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Check className="h-4 w-4" />
          ذخیره حساب
        </button>
        <button onClick={onCancel} className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm">
          <X className="h-4 w-4" />
          لغو
        </button>
      </div>
    </div>
  );
}

function AccountTxForm({ accountId, onDone }: { accountId: string; onDone: () => void }) {
  const [type, setType] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    if (amount <= 0) { setErr("مبلغ را وارد کنید."); return; }
    accountTxsStore.add({ accountId, type, amount, note: note.trim() || undefined, at: Date.now() });
    onDone();
  };

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setType("deposit")}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition ${
            type === "deposit" ? "bg-success/15 text-success" : "border border-border text-muted-foreground"
          }`}
        >
          <ArrowDownCircle className="h-3.5 w-3.5" />
          واریز
        </button>
        <button
          type="button"
          onClick={() => setType("withdraw")}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition ${
            type === "withdraw" ? "bg-destructive/10 text-destructive" : "border border-border text-muted-foreground"
          }`}
        >
          <ArrowUpCircle className="h-3.5 w-3.5" />
          برداشت
        </button>
      </div>
      <input
        inputMode="numeric"
        value={formatNumber(amount)}
        onChange={(e) => setAmount(Math.max(0, parseNumberInput(e.target.value)))}
        placeholder="مبلغ (تومان)"
        className={INPUT}
      />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیحات (اختیاری)" className={INPUT} />
      {err && <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
      <button
        onClick={submit}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground"
      >
        <Check className="h-3.5 w-3.5" />
        ثبت تراکنش
      </button>
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

function ExpensesPage() {
  return (
    <AuthGuard>
      <ExpensesPageInner />
    </AuthGuard>
  );
}