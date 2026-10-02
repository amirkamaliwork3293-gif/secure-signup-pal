import { useEffect, useRef, useState } from "react";
import {
  currencyLabel,
  formatNumber,
  fromDisplayAmount,
  getCurrencyUnit,
  parseNumberInput,
} from "@/lib/store";

/**
 * ورودی مبلغ در «واحد نمایش» فروشگاه (تومان یا ریال)؛ مقدار ذخیره‌شده همیشه تومان است.
 * قیمت‌های تبدیل‌شده (مثلاً قیمت هر گرم) ممکن است کسری از تومان باشند و تا وقتی
 * کاربر خانه را عوض نکند دست نمی‌خورند.
 */
export function MoneyInput({
  value,
  onChange,
  className = "",
  placeholder = "۰",
  showUnit = true,
  ariaLabel,
}: {
  value: number;
  onChange: (toman: number) => void;
  className?: string;
  placeholder?: string;
  showUnit?: boolean;
  ariaLabel?: string;
}) {
  const unit = getCurrencyUnit();
  const toText = (toman: number) => {
    if (!toman) return "";
    const display = unit === "rial" ? toman * 10 : toman;
    return formatNumber(Math.round(display * 10000) / 10000);
  };
  const [text, setText] = useState(() => toText(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, unit]);
  return (
    <div
      className={`flex items-center gap-1 rounded-lg border border-input bg-background px-2 focus-within:border-primary ${className}`}
    >
      <input
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          setText(toText(value));
        }}
        onChange={(e) => {
          const raw = e.target.value;
          const n = parseNumberInput(raw);
          setText(n ? formatNumber(n) + (/[.٫/]$/.test(raw) ? "." : "") : raw.trim() ? raw : "");
          onChange(Math.max(0, fromDisplayAmount(n, unit)));
        }}
        inputMode="numeric"
        dir="ltr"
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="h-9 w-full min-w-0 bg-transparent text-sm outline-none"
      />
      {showUnit && (
        <span className="shrink-0 text-[10px] text-muted-foreground">{currencyLabel()}</span>
      )}
    </div>
  );
}
