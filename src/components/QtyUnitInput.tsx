import { useEffect, useRef, useState } from "react";
import { COUNT_UNIT, formatNumber, isWeightUnit, parseNumberInput } from "@/lib/store";
import { GRAM_UNIT, KG_UNIT, joinKgGrams, roundQty, splitKgGrams } from "@/lib/units";

/**
 * ورودی مقدار وابسته به واحد — همان راحتیِ فاکتور فروش:
 *  - کیلوگرم: دو خانهٔ «کیلو + گرم» (۱ کیلو و ۳۰۰ گرم بدون تایپ اعشار)
 *  - گرم و واحدهای اعشاری دیگر: یک خانه که تایپ «۰٫۵» و «۱/۲۵» را می‌پذیرد
 *  - عدد/بسته: عدد صحیح
 * مقدار هنگام تایپ (نه فقط با خروج از خانه) اعمال می‌شود تا جمع ردیف زنده بماند.
 */
export function QtyUnitInput({
  value,
  unit,
  onChange,
  className = "",
}: {
  value: number;
  unit?: string;
  onChange: (qty: number) => void;
  className?: string;
}) {
  const u = unit || COUNT_UNIT;
  if (u === KG_UNIT) return <KgGramInput value={value} onChange={onChange} className={className} />;
  return (
    <SingleQtyInput
      value={value}
      decimal={isWeightUnit(u)}
      suffix={u === COUNT_UNIT ? "" : u}
      onChange={onChange}
      className={className}
    />
  );
}

/** متن نمایشی عدد برای خانهٔ ورودی (ارقام فارسی، بدون جداکنندهٔ هزارگان مزاحم برای اعشار) */
function shown(n: number): string {
  if (!n) return "";
  return formatNumber(roundQty(n));
}

/** خانهٔ عددی با متن محلی: تا وقتی کاربر تایپ می‌کند، «۱.» یا «۰.۰» خراب نمی‌شود */
function useLocalNumber(value: number, toText: (n: number) => string) {
  const [text, setText] = useState(() => toText(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return {
    text,
    setText,
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      focused.current = true;
      e.currentTarget.select();
    },
    onBlur: () => {
      focused.current = false;
      setText(toText(value));
    },
  };
}

function SingleQtyInput({
  value,
  decimal,
  suffix,
  onChange,
  className,
}: {
  value: number;
  decimal: boolean;
  suffix: string;
  onChange: (n: number) => void;
  className: string;
}) {
  const f = useLocalNumber(value, shown);
  return (
    <div
      className={`flex items-center gap-1 rounded-lg border border-input bg-background px-2 focus-within:border-primary ${className}`}
    >
      <input
        value={f.text}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        onChange={(e) => {
          f.setText(e.target.value);
          const n = parseNumberInput(e.target.value);
          onChange(Math.max(0, decimal ? roundQty(n) : Math.floor(n)));
        }}
        inputMode={decimal ? "decimal" : "numeric"}
        dir="ltr"
        aria-label="مقدار"
        placeholder="۰"
        className="h-9 w-full min-w-0 bg-transparent text-center text-sm font-semibold outline-none"
      />
      {suffix && <span className="shrink-0 text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function KgGramInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  className: string;
}) {
  const parts = splitKgGrams(value);
  const kg = useLocalNumber(parts.kg, (n) => (n ? formatNumber(n) : ""));
  const g = useLocalNumber(parts.g, (n) => (n ? formatNumber(n) : ""));
  return (
    <div
      className={`flex items-center gap-1 rounded-lg border border-input bg-background px-1.5 focus-within:border-primary ${className}`}
    >
      <input
        value={kg.text}
        onFocus={kg.onFocus}
        onBlur={kg.onBlur}
        onChange={(e) => {
          kg.setText(e.target.value);
          onChange(joinKgGrams(parseNumberInput(e.target.value), splitKgGrams(value).g));
        }}
        inputMode="numeric"
        dir="ltr"
        aria-label="کیلوگرم"
        placeholder="۰"
        className="h-9 w-10 min-w-0 flex-1 bg-transparent text-center text-sm font-semibold outline-none"
      />
      <span className="shrink-0 text-[10px] text-muted-foreground">کیلو</span>
      <span className="text-muted-foreground/40">+</span>
      <input
        value={g.text}
        onFocus={g.onFocus}
        onBlur={g.onBlur}
        onChange={(e) => {
          g.setText(e.target.value);
          onChange(joinKgGrams(splitKgGrams(value).kg, parseNumberInput(e.target.value)));
        }}
        inputMode="numeric"
        dir="ltr"
        aria-label="گرم"
        placeholder="۰"
        className="h-9 w-12 min-w-0 flex-1 bg-transparent text-center text-sm font-semibold outline-none"
      />
      <span className="shrink-0 text-[10px] text-muted-foreground">{GRAM_UNIT}</span>
    </div>
  );
}

/**
 * انتخاب واحد ورود برای کالای وزنی/حجمی (مثلاً خرید کالای کیلوگرمی به گرم).
 * با تعویض، مقدار و قیمت واحد طوری تبدیل می‌شوند که جمع ردیف ثابت بماند.
 */
export function EntryUnitSwitch({
  units,
  value,
  onChange,
}: {
  units: string[];
  value: string;
  onChange: (unit: string) => void;
}) {
  if (units.length < 2) return null;
  return (
    <div
      className="inline-flex rounded-lg border border-border bg-background p-0.5"
      role="radiogroup"
    >
      {units.map((u) => (
        <button
          key={u}
          type="button"
          role="radio"
          aria-checked={value === u}
          onClick={() => value !== u && onChange(u)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
            value === u
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
