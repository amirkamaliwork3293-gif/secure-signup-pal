import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  customers,
  customerBalance,
  customerFullName,
  formatToman,
  formatNumber,
  parseNumberInput,
  cryptoId,
  settings,
  storePublicUrl,
  formatJalaliDateTime,
  type Customer,
  type CustomerTx,
} from "@/lib/store";
import { useAuth } from "@/lib/AuthContext";
import { shareText } from "@/lib/openExternal";
import {
  Users,
  Plus,
  X,
  Search,
  Phone,
  Trash2,
  Pencil,
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronDown,
  ChevronUp,
  Wallet,
  Bell,
  MessageCircle,
  Send,
  Megaphone,
  Check,
  Link2,
  Share2,
} from "lucide-react";
import { z } from "zod";

const searchSchema = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/customers")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "مشتریان و بدهکاران | KAMIX" },
      { name: "description", content: "مدیریت حساب مشتریان، بدهی‌ها و پرداخت‌ها." },
    ],
  }),
  component: CustomersPage,
});

type Filter = "all" | "debtor" | "settled";

const inputCls =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

function CustomersPageInner() {
  const { q: incomingQuery } = Route.useSearch();
  const [list, setList] = customers.useAll();
  const [searchQ, setSearchQ] = useState(incomingQuery ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Customer | null>(null);
  const [txTarget, setTxTarget] = useState<{ customer: Customer; type: "debt" | "payment" } | null>(
    null,
  );
  const [reminderTarget, setReminderTarget] = useState<Customer | null>(null);
  const [showCampaign, setShowCampaign] = useState(false);

  useEffect(() => {
    if (incomingQuery != null) setSearchQ(incomingQuery);
  }, [incomingQuery]);

  const totals = useMemo(() => {
    let receivable = 0; // مجموع طلب ما از بدهکارها
    let debtors = 0;
    for (const c of list) {
      const b = customerBalance(c);
      if (b > 0) {
        receivable += b;
        debtors++;
      }
    }
    return { receivable, debtors };
  }, [list]);

  const filtered = useMemo(() => {
    const q = searchQ.trim();
    return list
      .filter((c) => {
        if (q && !customerFullName(c).includes(q) && !(c.phone ?? "").includes(q)) return false;
        const b = customerBalance(c);
        if (filter === "debtor") return b > 0;
        if (filter === "settled") return b <= 0;
        return true;
      })
      .sort((a, b) => customerBalance(b) - customerBalance(a));
  }, [list, searchQ, filter]);

  const removeCustomer = (c: Customer) => {
    if (!confirm(`حساب «${customerFullName(c)}» حذف شود؟ تمام سوابق بدهی و پرداخت پاک می‌شود.`))
      return;
    customers.remove(c.id);
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <Users className="h-5 w-5 text-primary" />
            مشتریان و بدهکاران
          </h1>
          <p className="text-xs text-muted-foreground">{formatNumber(list.length)} مشتری ثبت شده</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-elegant"
        >
          <Plus className="h-3.5 w-3.5" />
          مشتری جدید
        </button>
      </div>

      {/* پنل پیامکی — ارسال گروهی */}
      <button
        onClick={() => setShowCampaign(true)}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/10"
      >
        <Megaphone className="h-4 w-4" />
        پنل پیامکی — ارسال جشنواره / تخفیف / تبلیغ
      </button>

      {/* جمع کل طلب */}
      <section className="mb-4 rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-elegant">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs opacity-80">مجموع طلب شما (بدهی مشتریان)</div>
            <div className="mt-1 text-2xl font-bold">{formatToman(totals.receivable)}</div>
            <div className="mt-0.5 text-xs opacity-80">{formatNumber(totals.debtors)} بدهکار</div>
          </div>
          <Wallet className="h-10 w-10 opacity-80" />
        </div>
      </section>

      {/* جستجو و فیلتر */}
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="جستجوی نام یا تلفن..."
            className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="all">همه</option>
          <option value="debtor">بدهکاران</option>
          <option value="settled">تسویه‌شده</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <Users className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {list.length === 0
              ? "هنوز مشتری‌ای ثبت نکرده‌اید. فاکتورهای نسیه به‌صورت خودکار اینجا ثبت می‌شوند."
              : "مشتری‌ای با این مشخصات یافت نشد."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <CustomerCard
              key={c.id}
              customer={c}
              onDebt={() => setTxTarget({ customer: c, type: "debt" })}
              onPayment={() => setTxTarget({ customer: c, type: "payment" })}
              onEdit={() => setEditTarget(c)}
              onDelete={() => removeCustomer(c)}
              onRemind={() => setReminderTarget(c)}
            />
          ))}
        </ul>
      )}

      {showAdd && (
        <CustomerModal
          onClose={() => setShowAdd(false)}
          onSave={(c) => {
            setList([{ ...c, id: cryptoId(), createdAt: Date.now(), txs: [] }, ...list]);
            setShowAdd(false);
          }}
        />
      )}

      {editTarget && (
        <CustomerModal
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={(c) => {
            customers.update({ ...editTarget, ...c });
            setEditTarget(null);
          }}
        />
      )}

      {txTarget && (
        <TxModal
          customer={txTarget.customer}
          type={txTarget.type}
          onClose={() => setTxTarget(null)}
        />
      )}

      {reminderTarget && (
        <ReminderModal customer={reminderTarget} onClose={() => setReminderTarget(null)} />
      )}

      {showCampaign && <SmsCampaignModal customers={list} onClose={() => setShowCampaign(false)} />}
    </Layout>
  );
}

// ─── کارت مشتری ──────────────────────────────────────────────────────────────

function CustomerCard({
  customer,
  onDebt,
  onPayment,
  onEdit,
  onDelete,
  onRemind,
}: {
  customer: Customer;
  onDebt: () => void;
  onPayment: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRemind: () => void;
}) {
  const [open, setOpen] = useState(false);
  const balance = customerBalance(customer);
  const canRemind = balance > 0 && !!customer.phone;

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate font-medium">{customerFullName(customer)}</span>
            {balance > 0 ? (
              <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                بدهکار
              </span>
            ) : (
              <span className="rounded-md bg-green-500/10 px-1.5 py-0.5 text-[10px] font-bold text-green-600">
                تسویه
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span
              className={`font-semibold ${balance > 0 ? "text-destructive" : "text-green-600"}`}
            >
              {balance > 0 ? `بدهی: ${formatToman(balance)}` : "بدون بدهی"}
            </span>
            {customer.phone && (
              <span className="flex items-center gap-1" dir="ltr">
                <Phone className="h-3 w-3" />
                {customer.phone}
              </span>
            )}
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              onClick={onDebt}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
            >
              <ArrowUpCircle className="h-3.5 w-3.5" />
              ثبت بدهی
            </button>
            <button
              onClick={onPayment}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-green-500/10 px-3 py-2 text-xs font-semibold text-green-700 dark:text-green-400"
            >
              <ArrowDownCircle className="h-3.5 w-3.5" />
              ثبت پرداخت
            </button>
          </div>

          {canRemind && (
            <button
              onClick={onRemind}
              className="mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
            >
              <Bell className="h-3.5 w-3.5" />
              ارسال یادآور بدهی
            </button>
          )}

          {customer.txs.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">تراکنشی ثبت نشده است.</p>
          ) : (
            <ul className="space-y-1.5 max-h-56 overflow-y-auto">
              {customer.txs.map((t) => (
                <TxRow key={t.id} tx={t} customer={customer} />
              ))}
            </ul>
          )}

          {customer.note && (
            <div className="mt-2 rounded-lg bg-accent px-3 py-2 text-xs text-muted-foreground">
              {customer.note}
            </div>
          )}

          <div className="mt-3 flex justify-end gap-1">
            <button
              onClick={onEdit}
              className="grid h-8 w-8 place-items-center rounded-lg text-primary hover:bg-primary/10"
              title="ویرایش"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={onDelete}
              className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
              title="حذف"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function TxRow({ tx, customer }: { tx: CustomerTx; customer: Customer }) {
  const isDebt = tx.type === "debt";
  const removeTx = () => {
    if (!confirm("این تراکنش حذف شود؟")) return;
    customers.update({ ...customer, txs: customer.txs.filter((t) => t.id !== tx.id) });
  };
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs">
      {isDebt ? (
        <ArrowUpCircle className="h-4 w-4 shrink-0 text-destructive" />
      ) : (
        <ArrowDownCircle className="h-4 w-4 shrink-0 text-green-600" />
      )}
      <div className="min-w-0 flex-1">
        <div className={`font-semibold ${isDebt ? "text-destructive" : "text-green-600"}`}>
          {isDebt ? "بدهی" : "پرداخت"} — {formatToman(tx.amount)}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {formatJalaliDateTime(tx.at)}
          {tx.note && ` · ${tx.note}`}
        </div>
      </div>
      <button
        onClick={removeTx}
        className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

// ─── مودال مشتری ─────────────────────────────────────────────────────────────

function CustomerModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: Customer;
  onClose: () => void;
  onSave: (c: Pick<Customer, "firstName" | "lastName" | "phone" | "note">) => void;
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) {
      alert("نام مشتری الزامی است.");
      return;
    }
    onSave({
      firstName: firstName.trim(),
      lastName: lastName.trim() || undefined,
      phone: phone.trim() || undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">{initial ? "ویرایش مشتری" : "مشتری جدید"}</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="نام *"
              className={inputCls}
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="نام خانوادگی"
              className={inputCls}
            />
          </div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="شماره تلفن"
            inputMode="tel"
            dir="ltr"
            className={inputCls}
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="یادداشت (اختیاری)"
            className={`${inputCls} resize-none`}
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            ذخیره
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── مودال ثبت بدهی / پرداخت ────────────────────────────────────────────────

function TxModal({
  customer,
  type,
  onClose,
}: {
  customer: Customer;
  type: "debt" | "payment";
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const isDebt = type === "debt";
  const balance = customerBalance(customer);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseNumberInput(amount);
    if (!n || n <= 0) {
      alert("مبلغ معتبر وارد کنید.");
      return;
    }
    customers.addTx(customer.id, { type, amount: n, note: note.trim() || undefined });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-1 flex items-center justify-between">
          <h3 className={`text-base font-bold ${isDebt ? "text-destructive" : "text-green-600"}`}>
            {isDebt ? "ثبت بدهی جدید" : "ثبت پرداخت / تسویه"}
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {customerFullName(customer)}
          {balance > 0 && (
            <>
              {" "}
              — بدهی فعلی: <strong className="text-destructive">{formatToman(balance)}</strong>
            </>
          )}
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              مبلغ (تومان)
            </label>
            <input
              value={amount ? formatNumber(parseNumberInput(amount)) : ""}
              onChange={(e) => {
                const n = parseNumberInput(e.target.value);
                setAmount(n ? String(n) : "");
              }}
              inputMode="numeric"
              autoFocus
              placeholder="۱۰۰٬۰۰۰"
              className={inputCls}
            />
          </div>
          {!isDebt && balance > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(balance))}
              className="w-full rounded-xl border border-dashed border-green-500/50 px-3 py-2 text-xs text-green-700 dark:text-green-400 hover:bg-green-500/10"
            >
              تسویه کامل — {formatToman(balance)}
            </button>
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="بابت... (اختیاری)"
            className={inputCls}
          />
          <button
            type="submit"
            className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${isDebt ? "bg-destructive" : "bg-green-600"}`}
          >
            ثبت
          </button>
        </form>
      </div>
    </div>
  );
}

function CustomersPage() {
  return (
    <AuthGuard>
      <CustomersPageInner />
    </AuthGuard>
  );
}

// ─── مودال یادآور (واتساپ / پیامک) ─────────────────────────────────────────

function toIntlPhone(raw: string): string {
  // فقط اعداد و تبدیل ارقام فارسی/عربی
  const en = raw
    .replace(/[\u06F0-\u06F9]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[\u0660-\u0669]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const digits = en.replace(/\D/g, "");
  if (digits.startsWith("0098")) return digits.slice(2);
  if (digits.startsWith("98")) return digits;
  if (digits.startsWith("0")) return "98" + digits.slice(1);
  if (digits.startsWith("9") && digits.length === 10) return "98" + digits;
  return digits;
}

function ReminderModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const balance = customerBalance(customer);
  const shopName = settings.get().shopName || "فروشگاه ما";
  const defaultMsg =
    `سلام ${customerFullName(customer)} عزیز،\n` +
    `یادآور بدهی شما به ${shopName}:\n` +
    `مبلغ: ${formatToman(balance)}\n` +
    `لطفاً در اولین فرصت نسبت به تسویه اقدام بفرمایید. با تشکر.`;
  const [text, setText] = useState(defaultMsg);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const phoneRaw = customer.phone ?? "";
  const intl = toIntlPhone(phoneRaw);
  const waUrl = `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
  const smsUrl = `sms:${phoneRaw}?body=${encodeURIComponent(text)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <Bell className="h-4 w-4 text-primary" />
            ارسال یادآور بدهی
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          به <strong className="text-foreground">{customerFullName(customer)}</strong> —{" "}
          <span dir="ltr">{phoneRaw}</span>
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          className={`${inputCls} resize-none leading-6`}
        />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-green-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-green-700"
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
            const result = await shareText({
              title: "یادآور بدهی",
              text,
            });
            setShareNotice(
              result === "shared"
                ? "پنجره اشتراک باز شد؛ اگر متن داخل اپ نیامد، متن آماده کپی شده و Paste کنید."
                : "متن آماده کپی شد؛ وارد روبیکا، بله یا ایتا شوید و Paste کنید.",
            );
          }}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-semibold hover:bg-accent"
        >
          <Share2 className="h-4 w-4" />
          اشتراک‌گذاری در روبیکا / بله / ایتا / تلگرام ...
        </button>
        {shareNotice && <p className="mt-2 text-center text-[11px] text-primary">{shareNotice}</p>}
        {!intl && (
          <p className="mt-2 text-center text-[11px] text-destructive">شماره تلفن نامعتبر است.</p>
        )}
      </div>
    </div>
  );
}

// ─── پنل پیامکی (ارسال گروهی) ──────────────────────────────────────────────

type Audience = "all" | "debtors" | "settled";

const TEMPLATES: { id: string; label: string; body: (shop: string) => string }[] = [
  {
    id: "festival",
    label: "🎉 جشنواره",
    body: (shop) =>
      `مشتری گرامی،\n${shop} با افتخار جشنواره ویژه‌ای برگزار می‌کند.\nبا تخفیف‌های شگفت‌انگیز در انتظار شما هستیم.\nمنتظر دیدارتان هستیم 🌹`,
  },
  {
    id: "discount",
    label: "🏷️ تخفیف",
    body: (shop) =>
      `سلام،\nتخفیف ویژه ${shop} فعال شد!\nفرصت را از دست ندهید و همین حالا از محصولات منتخب با قیمت استثنایی بهره‌مند شوید.`,
  },
  {
    id: "promo",
    label: "📣 تبلیغ",
    body: (shop) =>
      `با سلام،\nمحصولات جدید ${shop} رسید!\nبرای مشاهده تازه‌ترین کالاها به فروشگاه ما سر بزنید.\nبا تشکر از همراهی شما.`,
  },
  {
    id: "thanks",
    label: "🙏 تشکر",
    body: (shop) =>
      `مشتری گرامی،\nاز اینکه ${shop} را انتخاب کرده‌اید سپاسگزاریم.\nهمیشه در خدمت شما هستیم.`,
  },
];

// هنگام ارسال انبوه، گیرندگان به گروه‌های ۱۰ نفره تقسیم می‌شوند تا اپ پیامک
// گوشی با تعداد زیاد گیرنده دچار مشکل نشود. شماره‌های ارسال‌شده در همین نشست
// نگه‌داری می‌شوند تا با بستن/بازکردن دوباره‌ی پنل هم مشخص بماند.
const SMS_GROUP_SIZE = 10;
const SMS_SENT_KEY = "acc.sms.sentPhones.v1";

function readSentPhones(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SMS_SENT_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeSentPhones(set: Set<string>) {
  try {
    sessionStorage.setItem(SMS_SENT_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function SmsCampaignModal({
  customers: list,
  onClose,
}: {
  customers: Customer[];
  onClose: () => void;
}) {
  const shopName = settings.get().shopName || "فروشگاه ما";
  const { state: authState } = useAuth();
  const userId = authState.status === "authenticated" ? authState.session.user.id : null;
  const [audience, setAudience] = useState<Audience>("all");
  const [text, setText] = useState(TEMPLATES[0].body(shopName));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [customMode, setCustomMode] = useState(false);
  const [includeLink, setIncludeLink] = useState(true);
  const [sentPhones, setSentPhones] = useState<Set<string>>(() => readSentPhones());
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  const audienceList = useMemo(() => {
    return list.filter((c) => {
      if (!c.phone) return false;
      const b = customerBalance(c);
      if (audience === "debtors") return b > 0;
      if (audience === "settled") return b <= 0;
      return true;
    });
  }, [list, audience]);

  const finalList = useMemo(
    () => (customMode ? audienceList.filter((c) => selectedIds.has(c.id)) : audienceList),
    [customMode, audienceList, selectedIds],
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // لینک عمومی صفحه فروشگاه فقط برای واتساپ/اشتراک‌گذاری استفاده می‌شود.
  // برای پیامک عادی طبق درخواست، هیچ لینکی افزوده نمی‌شود تا ارسال پیامک خراب نشود.
  const storeLink = userId && includeLink ? storePublicUrl(userId) : "";
  // حذف کاراکترهای نامرئی جهت متن (RLM/LRM/RLE/PDF/...) که گاهی توسط ادیتور یا
  // مرورگر هنگام ترکیب متن فارسی + لینک انگلیسی به‌صورت خودکار تزریق می‌شوند و
  // باعث می‌شوند برخی اپ‌های پیامک اندرویدی URL را خراب تفسیر کنند.
  const stripBidi = (s: string) =>
    s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
  const shareFinalText = stripBidi(storeLink ? `${text}\n${storeLink}` : text);
  const smsText = stripBidi(text);

  const markSent = (phones: string[]) =>
    setSentPhones((prev) => {
      const next = new Set(prev);
      phones.forEach((p) => next.add(p));
      writeSentPhones(next);
      return next;
    });

  // تقسیم گیرندگان به گروه‌های ۱۰ نفره
  const groups = useMemo(() => {
    const out: Customer[][] = [];
    for (let i = 0; i < finalList.length; i += SMS_GROUP_SIZE)
      out.push(finalList.slice(i, i + SMS_GROUP_SIZE));
    return out;
  }, [finalList]);

  const groupSent = (group: Customer[]) =>
    group.length > 0 && group.every((c) => sentPhones.has((c.phone ?? "").trim()));

  // ارسال پیامک به یک گروه (چند گیرنده در یک لینک sms:)
  const sendSmsGroup = (group: Customer[]) => {
    const numbers = group.map((c) => (c.phone ?? "").trim()).filter(Boolean);
    if (numbers.length === 0) {
      alert("هیچ گیرنده‌ای انتخاب نشده.");
      return;
    }
    window.location.href = `sms:${numbers.join(",")}?body=${encodeURIComponent(smsText)}`;
    markSent(numbers);
  };

  const sendWhatsAppOne = (c: Customer) => {
    const intl = toIntlPhone(c.phone ?? "");
    if (!intl) return;
    let personal = text.replace(/\{name\}/g, customerFullName(c));
    if (storeLink) personal = `${personal}\n${storeLink}`;
    const url = `https://wa.me/${intl}?text=${encodeURIComponent(personal)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    markSent([(c.phone ?? "").trim()]);
  };

  const shareForApps = async (message: string, sentPhonesToMark: string[] = []) => {
    const result = await shareText({ title: shopName, text: message });
    if (sentPhonesToMark.length) markSent(sentPhonesToMark);
    setShareNotice(
      result === "shared"
        ? "پنجره اشتراک باز شد؛ روبیکا، بله یا ایتا را انتخاب کنید. اگر متن نیامد، متن کپی شده و Paste کنید."
        : "متن پیام کپی شد؛ وارد روبیکا، بله یا ایتا شوید و Paste کنید.",
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card shadow-elegant sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <Megaphone className="h-4 w-4 text-primary" />
            پنل پیامکی
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          {/* قالب آماده */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              قالب آماده
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setText(t.body(shopName))}
                  className="rounded-xl border border-border bg-background px-2 py-2 text-xs font-medium hover:bg-accent"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* متن پیام */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              متن پیام{" "}
              <span className="text-[10px] opacity-70">
                (در واتساپ، {"{name}"} با نام مشتری جایگزین می‌شود)
              </span>
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className={`${inputCls} resize-none leading-6`}
              placeholder="متن پیام جشنواره/تخفیف..."
            />
            <div className="mt-1 text-[10px] text-muted-foreground text-left">
              {text.length} کاراکتر
            </div>
          </div>

          {/* گیرندگان */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              گیرندگان
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { v: "all", l: "همه" },
                  { v: "debtors", l: "بدهکاران" },
                  { v: "settled", l: "تسویه‌شده" },
                ] as { v: Audience; l: string }[]
              ).map((o) => (
                <button
                  key={o.v}
                  onClick={() => {
                    setAudience(o.v);
                    setSelectedIds(new Set());
                  }}
                  className={`rounded-xl border px-2 py-2 text-xs font-medium ${audience === o.v ? "border-primary bg-primary/10 text-primary" : "border-border bg-background"}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={customMode}
                onChange={(e) => setCustomMode(e.target.checked)}
                className="h-4 w-4"
              />
              انتخاب دستی مشتریان
            </label>
          </div>

          {/* لیست گیرندگان */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {customMode ? "انتخاب کنید" : "پیش‌نمایش گیرندگان"}
              </span>
              <span className="text-[11px] font-semibold text-primary">
                {formatNumber(finalList.length)} نفر
              </span>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-xl border border-border bg-background">
              {audienceList.length === 0 ? (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  مشتری دارای شماره تلفن در این گروه نیست.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {audienceList.map((c) => {
                    const checked = customMode ? selectedIds.has(c.id) : true;
                    return (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                        {customMode ? (
                          <button
                            onClick={() => toggle(c.id)}
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                          >
                            {checked && <Check className="h-3 w-3" />}
                          </button>
                        ) : (
                          <Check className="h-4 w-4 shrink-0 text-green-600" />
                        )}
                        <span className="flex-1 truncate">{customerFullName(c)}</span>
                        <span className="text-muted-foreground" dir="ltr">
                          {c.phone}
                        </span>
                        <button
                          onClick={() => sendWhatsAppOne(c)}
                          title="ارسال واتساپ به این مشتری"
                          className="grid h-7 w-7 place-items-center rounded-lg text-green-600 hover:bg-green-500/10"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            const personal = text.replace(/\{name\}/g, customerFullName(c));
                            const msg = storeLink ? `${personal}\n${storeLink}` : personal;
                            await shareForApps(msg, [(c.phone ?? "").trim()].filter(Boolean));
                          }}
                          title="اشتراک‌گذاری (روبیکا/بله/ایتا/...)"
                          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-primary hover:bg-primary/10"
                        >
                          <Share2 className="h-3.5 w-3.5" />
                          <span className="text-[10px] font-semibold">اشتراک</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-accent/50 p-2.5 text-[11px] leading-5 text-muted-foreground">
            💡 پیامک عادی بدون لینک ارسال می‌شود تا اپ پیامک و اپراتور آن را خراب نکنند. برای ارسال
            لینک اصلی فروشگاه از دکمه «اشتراک در اپ‌های ایرانی» استفاده کنید؛ متن همزمان کپی می‌شود تا داخل اپ Paste کنید.
          </div>
        </div>

        <div className="space-y-3 border-t border-border p-4">
          {/* افزودن لینک صفحه فروشگاه به اشتراک‌گذاری؛ پیامک عادی همیشه بدون لینک است */}
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
            <span className="flex items-center gap-2 text-xs">
              <Link2 className="h-4 w-4 text-primary" />
              افزودن لینک اصلی فروشگاه به اشتراک‌گذاری
            </span>
            <input
              type="checkbox"
              checked={includeLink}
              onChange={(e) => setIncludeLink(e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </label>
          {includeLink && !userId && (
            <p className="text-[10px] text-amber-600">برای افزودن لینک باید وارد حساب باشید.</p>
          )}

          <button
            type="button"
            onClick={() => shareForApps(shareFinalText)}
            disabled={!shareFinalText.trim()}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" />
            اشتراک در روبیکا / بله / ایتا
          </button>
          {shareNotice && <p className="text-center text-[11px] leading-5 text-primary">{shareNotice}</p>}

          {finalList.length === 0 ? (
            <button
              disabled
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground opacity-50"
            >
              <Send className="h-4 w-4" />
              ارسال پیامک
            </button>
          ) : finalList.length <= SMS_GROUP_SIZE ? (
            <button
              onClick={() => sendSmsGroup(finalList)}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                groupSent(finalList)
                  ? "bg-green-600 text-white"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              {groupSent(finalList) ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {groupSent(finalList)
                ? "ارسال شد"
                : `ارسال پیامک به ${formatNumber(finalList.length)} نفر`}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] leading-5 text-muted-foreground">
                به‌دلیل تعداد زیاد، گیرندگان به گروه‌های ۱۰ نفره تقسیم شدند. هر گروه را جداگانه و با
                کمی فاصله بفرستید.
              </p>
              <div className="max-h-44 space-y-1.5 overflow-y-auto">
                {groups.map((group, i) => {
                  const isSent = groupSent(group);
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
                    >
                      <span className="text-sm font-medium">
                        گروه {formatNumber(i + 1)} ({formatNumber(group.length)} نفر)
                      </span>
                      <button
                        onClick={() => sendSmsGroup(group)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                          isSent ? "bg-green-600 text-white" : "bg-primary text-primary-foreground"
                        }`}
                      >
                        {isSent ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        {isSent ? "ارسال شد" : "ارسال"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
