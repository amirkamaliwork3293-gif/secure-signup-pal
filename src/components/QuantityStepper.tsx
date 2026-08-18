import { Minus, Plus } from "lucide-react";
import { parseNumberInput } from "@/lib/store";

/**
 * کنترل تعداد: دکمه‌های +/− به‌علاوه‌ی ورود دستی عدد.
 * در همه‌ی جاهایی که تعداد کالا عوض می‌شود باید از همین استفاده شود
 * تا کاربر مجبور نباشد فقط با دکمه جلو برود.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  step = 1,
  allowDecimal = false,
  className = "",
  inputClassName = "",
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
  allowDecimal?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const commit = (raw: string) => {
    const parsed = allowDecimal ? parseNumberInput(raw) : Math.floor(parseNumberInput(raw));
    if (!Number.isFinite(parsed) || parsed < min) {
      onChange(Math.max(min, value));
      return;
    }
    if (parsed !== value) onChange(parsed);
  };

  return (
    <div className={`flex items-center gap-0.5 rounded-lg border border-border bg-card ${className}`}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, roundQty(value - step, allowDecimal)))}
        className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground"
        aria-label="کاهش"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        key={value}
        defaultValue={value}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        inputMode={allowDecimal ? "decimal" : "numeric"}
        dir="ltr"
        aria-label="تعداد"
        title="برای ثبت تعداد دلخواه، عدد را تایپ کنید"
        className={`h-8 w-12 bg-transparent text-center text-sm font-semibold outline-none focus:rounded-md focus:bg-secondary ${inputClassName}`}
      />
      <button
        type="button"
        onClick={() => onChange(roundQty(value + step, allowDecimal))}
        className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground"
        aria-label="افزایش"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function roundQty(n: number, allowDecimal: boolean): number {
  if (!allowDecimal) return Math.round(n);
  return Math.round(n * 1000) / 1000;
}
