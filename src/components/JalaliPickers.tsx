/**
 * JalaliPickers.tsx — انتخابگرهای تاریخ و ساعت شمسی
 * به‌جای تایپ دستی «۱۴۰۴/۰۵/۱۵»، کاربر سال/ماه/روز را انتخاب می‌کند.
 */
import { useEffect } from "react";
import {
  toJalali,
  jalaliMonthLength,
  parseJalaliInput,
  JMONTHS_LONG,
} from "@/lib/store";

const SELECT =
  "w-full rounded-xl border border-input bg-background px-2 py-2.5 text-center text-sm outline-none focus:border-primary";

const pad2 = (n: number) => String(n).padStart(2, "0");

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
  useEffect(() => {
    if (parsed && parsed.jd > days) onChange(`${jy}/${pad2(jm)}/${pad2(days)}`);
  }, [days, parsed, jy, jm, onChange]);

  const set = (p: { jy?: number; jm?: number; jd?: number }) => {
    const ny = p.jy ?? jy;
    const nm = p.jm ?? jm;
    const maxD = jalaliMonthLength(ny, nm);
    const nd = Math.min(p.jd ?? jd, maxD);
    onChange(`${ny}/${pad2(nm)}/${pad2(nd)}`);
  };

  const years = Array.from(
    { length: yearsBack + yearsForward + 1 },
    (_, i) => today.jy - yearsBack + i,
  );

  return (
    <div className="grid grid-cols-3 gap-1.5">
      <select className={SELECT} value={jd} onChange={(e) => set({ jd: +e.target.value })}>
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select className={SELECT} value={jm} onChange={(e) => set({ jm: +e.target.value })}>
        {JMONTHS_LONG.map((m, i) => (
          <option key={m} value={i + 1}>{m}</option>
        ))}
      </select>
      <select className={SELECT} value={jy} onChange={(e) => set({ jy: +e.target.value })}>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}

/** مقدار به‌صورت «HH:MM» */
export function TimeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
  const now = new Date();
  const h = m ? +m[1] : now.getHours();
  const min = m ? +m[2] : now.getMinutes();
  const set = (p: { h?: number; min?: number }) =>
    onChange(`${pad2(p.h ?? h)}:${pad2(p.min ?? min)}`);

  return (
    <div className="grid grid-cols-2 gap-1.5" dir="ltr">
      <select className={SELECT} value={h} onChange={(e) => set({ h: +e.target.value })}>
        {Array.from({ length: 24 }, (_, i) => i).map((x) => (
          <option key={x} value={x}>{pad2(x)}</option>
        ))}
      </select>
      <select className={SELECT} value={min} onChange={(e) => set({ min: +e.target.value })}>
        {Array.from({ length: 60 }, (_, i) => i).map((x) => (
          <option key={x} value={x}>{pad2(x)}</option>
        ))}
      </select>
    </div>
  );
}
