/**
 * تست تبدیل تاریخ سررسید چک (ISO میلادی نباید شمسی پارس شود)
 * و تبدیل ورودی ریال/تومان.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-jalali-currency.ts
 */
import assert from "node:assert/strict";
import {
  parseJalaliInput,
  toJalaliInputFromDue,
  jalaliInputToIsoDate,
  jalaliToTimestamp,
  jalaliMonthLength,
  isoDateFromTimestamp,
  toDisplayAmount,
  fromDisplayAmount,
  parseDisplayAmountInput,
} from "../src/lib/store.ts";

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("ok:", label);
  else {
    failed++;
    console.error("FAIL:", label, detail ?? "");
  }
}

// ── تاریخ چک: ISO میلادی را شمسی نگیر ──────────────────────────────────────
check("ISO due is not jalali", parseJalaliInput("2026-09-25") === null);
check("dashed jalali still parses", parseJalaliInput("1405-06-03") !== null);
check("slash jalali parses", parseJalaliInput("1405/06/03")?.jd === 3);

const fromIso = toJalaliInputFromDue("2026-09-25");
check("ISO due converts to jalali string", /^\d{4}\/\d{2}\/\d{2}$/.test(fromIso));
check("ISO due year is jalali range", (() => {
  const y = Number(fromIso.slice(0, 4));
  return y >= 1400 && y <= 1410;
})(), fromIso);

const isoBack = jalaliInputToIsoDate(fromIso);
check("jalali → ISO round trip stays gregorian 2026", isoBack.startsWith("2026-"), isoBack);
check(
  "second conversion does not jump centuries",
  toJalaliInputFromDue(isoBack) === fromIso,
  { isoBack, again: toJalaliInputFromDue(isoBack), fromIso },
);

// قبلاً با پارس اشتباه ISO، سال به ۳۲۶۸ می‌رسید و jalCal پرتاب می‌کرد
check("far year timestamp does not throw", Number.isNaN(jalaliToTimestamp(3268, 1, 1)));
check("far year month length does not throw", jalaliMonthLength(3268, 1) > 0);
check("invalid month length safe", jalaliMonthLength(1404, 0) === 30);

const todayIso = isoDateFromTimestamp(Date.now() + 30 * 86_400_000);
const shown = toJalaliInputFromDue(todayIso);
const afterChange = jalaliInputToIsoDate(shown);
check("emptyCheque-style ISO survives one edit", /^\d{4}-\d{2}-\d{2}$/.test(afterChange), afterChange);
check(
  "edit does not produce year >= 1700 as jalali parse",
  parseJalaliInput(afterChange) === null,
  afterChange,
);

// ── تبدیل ریال/تومان ────────────────────────────────────────────────────────
check("toDisplay rial 25000 → 250000", toDisplayAmount(25_000, "rial") === 250_000);
check("fromDisplay rial 250000 → 25000", fromDisplayAmount(250_000, "rial") === 25_000);
check("round trip rial", fromDisplayAmount(toDisplayAmount(12_345, "rial"), "rial") === 12_345);
check("toman identity", fromDisplayAmount(toDisplayAmount(12_345, "toman"), "toman") === 12_345);
check("parseDisplay rial", parseDisplayAmountInput("۲۵۰٬۰۰۰", "rial") === 25_000);
check("zero stays zero", toDisplayAmount(0, "rial") === 0 && fromDisplayAmount(0, "rial") === 0);

assert.equal(failed, 0, `${failed} check(s) failed`);
console.log("all checks passed");
