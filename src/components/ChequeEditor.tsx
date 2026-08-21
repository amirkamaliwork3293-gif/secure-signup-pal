import { Plus, Trash2, Landmark, CalendarClock } from "lucide-react";
import { JalaliDateSelect } from "@/components/JalaliPickers";
import {
  cryptoId,
  formatNumber,
  formatToman,
  parseNumberInput,
  toJalaliInputFromDue,
  jalaliInputToIsoDate,
  isoDateFromTimestamp,
  formatChequeDue,
  type InvoiceCheque,
} from "@/lib/store";
import { IRAN_BANK_NAMES, digitsOnly, formatSayadiDisplay, isValidSayadi } from "@/lib/iran-banks";

const INPUT =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary";

export function emptyCheque(partial?: Partial<InvoiceCheque>): InvoiceCheque {
  return {
    id: cryptoId(),
    amount: 0,
    dueDate: isoDateFromTimestamp(Date.now() + 30 * 86_400_000),
    ...partial,
  };
}

export function ChequeEditor({
  cheques,
  onChange,
  remaining,
  customerName,
}: {
  cheques: InvoiceCheque[];
  onChange: (next: InvoiceCheque[]) => void;
  /** مبلغ باقی‌مانده فاکتور پس از نقد — برای راهنما و پر کردن خودکار */
  remaining: number;
  customerName?: string;
}) {
  const sum = cheques.reduce((s, c) => s + Math.max(0, Math.round(c.amount || 0)), 0);
  const leftover = Math.max(0, remaining - sum);

  const update = (id: string, patch: Partial<InvoiceCheque>) => {
    onChange(cheques.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const remove = (id: string) => {
    if (cheques.length <= 1) {
      onChange([emptyCheque({ drawerName: customerName, amount: remaining })]);
      return;
    }
    onChange(cheques.filter((c) => c.id !== id));
  };

  const add = () => {
    onChange([
      ...cheques,
      emptyCheque({
        amount: leftover > 0 ? leftover : 0,
        drawerName: customerName,
      }),
    ]);
  };

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-dashed border-amber-500/35 bg-amber-50/40 p-3 dark:bg-amber-950/20">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold">چک‌های دریافتی ({formatNumber(cheques.length)} برگ)</div>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          برگ چک جدید
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        تاریخ سررسید را شمسی انتخاب کنید. شناسه صیادی ۱۶ رقمی را از روی چک وارد کنید. اگر مشتری چند
        چک بدهد، هر برگ را جدا اضافه کنید.
      </p>

      <ul className="space-y-2">
        {cheques.map((c, idx) => {
          const sayadiDigits = digitsOnly(c.sayadi);
          const sayadiWarn = sayadiDigits.length > 0 && !isValidSayadi(c.sayadi);
          return (
            <li key={c.id} className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-[11px] text-primary">
                    {formatNumber(idx + 1)}
                  </span>
                  چک {formatNumber(idx + 1)}
                </div>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                  title="حذف این برگ"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted-foreground">مبلغ چک</span>
                  <input
                    value={c.amount ? formatNumber(c.amount) : ""}
                    onChange={(e) => update(c.id, { amount: parseNumberInput(e.target.value) })}
                    placeholder={leftover > 0 && c.amount <= 0 ? formatNumber(leftover) : "۰"}
                    inputMode="numeric"
                    dir="ltr"
                    className={INPUT}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted-foreground">شماره سریال</span>
                  <input
                    value={c.serial ?? ""}
                    onChange={(e) => update(c.id, { serial: e.target.value })}
                    placeholder="سریال چک"
                    className={INPUT}
                  />
                </label>
              </div>

              <label className="mt-2 block">
                <span className="mb-1 block text-[11px] text-muted-foreground">
                  شناسه صیادی (۱۶ رقم)
                </span>
                <input
                  value={c.sayadi ?? ""}
                  onChange={(e) =>
                    update(c.id, { sayadi: digitsOnly(e.target.value).slice(0, 16) })
                  }
                  placeholder="مثلاً ۱۲۳۴ ۵۶۷۸ ۹۰۱۲ ۳۴۵۶"
                  inputMode="numeric"
                  dir="ltr"
                  className={INPUT}
                />
                {sayadiDigits.length > 0 && (
                  <span
                    className={`mt-0.5 block text-[10px] ${sayadiWarn ? "text-destructive" : "text-muted-foreground"}`}
                    dir="ltr"
                  >
                    {sayadiWarn
                      ? `شناسه صیادی باید ۱۶ رقم باشد (${formatNumber(sayadiDigits.length)} رقم وارد شده)`
                      : formatSayadiDisplay(c.sayadi)}
                  </span>
                )}
              </label>

              <label className="mt-2 block">
                <span className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Landmark className="h-3 w-3" /> نام بانک عهده
                </span>
                <select
                  value={c.bankName ?? ""}
                  onChange={(e) => update(c.id, { bankName: e.target.value || undefined })}
                  className={INPUT}
                >
                  <option value="">انتخاب بانک…</option>
                  {IRAN_BANK_NAMES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-2">
                <span className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CalendarClock className="h-3 w-3" /> تاریخ سررسید (شمسی)
                </span>
                <JalaliDateSelect
                  value={
                    toJalaliInputFromDue(c.dueDate) ||
                    toJalaliInputFromDue(isoDateFromTimestamp(Date.now()))
                  }
                  onChange={(v) => update(c.id, { dueDate: jalaliInputToIsoDate(v) || v })}
                  yearsBack={0}
                  yearsForward={3}
                />
              </div>

              <label className="mt-2 block">
                <span className="mb-1 block text-[11px] text-muted-foreground">
                  عهده / صادرکننده (اختیاری)
                </span>
                <input
                  value={c.drawerName ?? ""}
                  onChange={(e) => update(c.id, { drawerName: e.target.value })}
                  placeholder={customerName || "نام صاحب چک"}
                  className={INPUT}
                />
              </label>
            </li>
          );
        })}
      </ul>

      {cheques.some((c) => c.dueDate) && (
        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
            سررسیدها در یک نگاه
          </div>
          <ul className="space-y-0.5">
            {cheques
              .filter((c) => c.dueDate)
              .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
              .map((c, i) => (
                <li key={c.id} className="flex justify-between gap-2 text-[11px]">
                  <span>
                    چک {formatNumber(i + 1)}
                    {c.bankName ? ` · ${c.bankName}` : ""}
                    {c.sayadi ? ` · صیادی ${formatSayadiDisplay(c.sayadi)}` : ""}
                  </span>
                  <span className="shrink-0 font-medium">
                    {formatChequeDue(c.dueDate)}
                    {c.amount > 0 ? ` — ${formatToman(c.amount)}` : ""}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="text-[11px] text-muted-foreground">
        جمع چک‌ها: <b className="text-foreground">{formatToman(sum)}</b>
        {leftover > 0 && (
          <>
            {" "}
            · باقی تا جمع فاکتور: <b className="text-destructive">{formatToman(leftover)}</b>
          </>
        )}
        {sum > remaining && remaining > 0 && <> · بیشتر از مانده فاکتور است</>}
      </div>
    </div>
  );
}
