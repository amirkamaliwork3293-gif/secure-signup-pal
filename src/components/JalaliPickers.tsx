/**
 * JalaliPickers.tsx — انتخابگرهای تاریخ و ساعت شمسی
 * به‌جای تایپ دستی «۱۴۰۴/۰۵/۱۵»، کاربر سال/ماه/روز را انتخاب می‌کند.
 */
import { useEffect, useState } from "react";
import { toJalali, jalaliMonthLength, parseJalaliInput, JMONTHS_LONG } from "@/lib/store";

const SELECT =
  "w-full rounded-xl border border-input bg-background px-2 py-2.5 text-center text-sm outline-none focus:border-primary";

const pad2 = (n: number) => String(n).padStart(2, "0");

const JALALI_YEAR_MIN = 1200;
const JALALI_YEAR_MAX = 1700;

/** مقدار به‌صورت رشته‌ی «YYYY/MM/DD» (خالی = انتخاب‌نشده) */
export function JalaliDateSelect({
  value,
  onChange,
  yearsBack = 1,
  yearsForward = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  yearsBack?: number;
  yearsForward?: number;
}) {
  const today = toJalali(Date.now()) ?? { jy: 1404, jm: 1, jd: 1 };
  const parsed = parseJalaliInput(value);
  const jy = parsed?.jy ?? today.jy;
  const jm = parsed?.jm ?? today.jm;
  const jd = parsed?.jd ?? today.jd;

  const days = jalaliMonthLength(jy, jm);
  const parsedJd = parsed?.jd;
  useEffect(() => {
    if (parsedJd == null) return;
    if (parsedJd <= days) return;
    const next = `${jy}/${pad2(jm)}/${pad2(days)}`;
    if (next !== value) onChange(next);
  }, [days, parsedJd, jy, jm, value, onChange]);

  const set = (p: { jy?: number; jm?: number; jd?: number }) => {
    const ny = p.jy ?? jy;
    const nm = p.jm ?? jm;
    const maxD = jalaliMonthLength(ny, nm);
    const nd = Math.min(p.jd ?? jd, maxD);
    onChange(`${ny}/${pad2(nm)}/${pad2(nd)}`);
  };

  const yearsSet = new Set(
    Array.from(
      { length: Math.max(1, yearsBack + yearsForward + 1) },
      (_, i) => today.jy - yearsBack + i,
    ),
  );
  yearsSet.add(jy);
  yearsSet.add(today.jy);
  const years = [...yearsSet]
    .filter((y) => y >= JALALI_YEAR_MIN && y <= JALALI_YEAR_MAX)
    .sort((a, b) => a - b);

  return (
    <div className="grid grid-cols-3 gap-1.5">
      <select className={SELECT} value={jd} onChange={(e) => set({ jd: +e.target.value })}>
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select className={SELECT} value={jm} onChange={(e) => set({ jm: +e.target.value })}>
        {JMONTHS_LONG.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select className={SELECT} value={jy} onChange={(e) => set({ jy: +e.target.value })}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

/** مقدار به‌صورت «HH:MM» */
export function TimeSelect({
  value,
  onChange,
  required = false,
}: {
  value: string;
  onChange: (v: string) => void;
  /**
   * اگر true باشد، تا وقتی کاربر خودش ساعت و دقیقه را انتخاب نکرده، مقدار خالی
   * می‌ماند (گزینه‌ی «ساعت»/«دقیقه» نمایش داده می‌شود) — به‌جای اینکه بی‌صدا
   * ساعت فعلی جایگزین شود. برای ساعت دقیق واریز رسید استفاده می‌شود.
   */
  required?: boolean;
}) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
  const now = new Date();
  // انتخاب نیمه‌کاره (فقط ساعت یا فقط دقیقه) تا کامل شدن، محلی نگه داشته می‌شود
  const [partial, setPartial] = useState<{ h: number | null; min: number | null }>({
    h: null,
    min: null,
  });
  const emptyMode = required && !m;
  const h = m ? +m[1] : emptyMode ? partial.h : now.getHours();
  const min = m ? +m[2] : emptyMode ? partial.min : now.getMinutes();
  const set = (p: { h?: number; min?: number }) => {
    const nh = p.h ?? h;
    const nm = p.min ?? min;
    if (nh == null || nm == null) {
      setPartial({ h: nh, min: nm });
      return;
    }
    onChange(`${pad2(nh)}:${pad2(nm)}`);
  };

  return (
    <div className="grid grid-cols-2 gap-1.5" dir="ltr">
      <select
        className={SELECT}
        value={h ?? ""}
        aria-label="ساعت"
        onChange={(e) => e.target.value !== "" && set({ h: +e.target.value })}
      >
        {h == null && (
          <option value="" disabled>
            ساعت
          </option>
        )}
        {Array.from({ length: 24 }, (_, i) => i).map((x) => (
          <option key={x} value={x}>
            {pad2(x)}
          </option>
        ))}
      </select>
      <select
        className={SELECT}
        value={min ?? ""}
        aria-label="دقیقه"
        onChange={(e) => e.target.value !== "" && set({ min: +e.target.value })}
      >
        {min == null && (
          <option value="" disabled>
            دقیقه
          </option>
        )}
        {Array.from({ length: 60 }, (_, i) => i).map((x) => (
          <option key={x} value={x}>
            {pad2(x)}
          </option>
        ))}
      </select>
    </div>
  );
}
