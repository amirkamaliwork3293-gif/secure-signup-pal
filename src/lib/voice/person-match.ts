/**
 * تطبیق نام شخص — سخت‌گیرانه‌تر از scoreProduct خام.
 *
 * مشکل قبلی: «علی کمالی» روی «صدرا کمالی» به‌خاطر فامیلی مشترک برنده‌ی واضح
 * می‌شد و بدهی به مشتری اشتباه اضافه می‌گردید. اینجا اگر نام کوچک‌ها فرق
 * داشته باشد، امتیاز صفر است و مشتری جدید ساخته می‌شود (یا از کاربر پرسیده).
 */

import { customerFullName, type Customer } from "@/lib/store";
import { normalizeFa, scoreProduct } from "@/lib/voice/persian-nlu";

export type PersonHit = { customer: Customer; score: number };

const HONORIFICS = new Set([
  "اقا",
  "اقای",
  "خانم",
  "خانوم",
  "جناب",
  "حاج",
  "حاجی",
  "مهندس",
  "دکتر",
  "سید",
  "استاد",
  "سرکار",
]);

export function spokenNameParts(s: string): string[] {
  return normalizeFa(s)
    .split(" ")
    .filter((t) => t && !HONORIFICS.has(t));
}

function firstNamesCompatible(a: string, b: string): boolean {
  if (!a || !b) return true;
  const x = normalizeFa(a);
  const y = normalizeFa(b);
  if (!x || !y) return true;
  if (x === y) return true;
  // پیشوند کوتاه («علی» / «علیرضا») شخص دیگری است؛ فقط یک حرف اختلاف (امیر/امیره)
  if (x.startsWith(y) || y.startsWith(x)) {
    const longer = x.length >= y.length ? x : y;
    const shorter = x.length >= y.length ? y : x;
    return shorter.length >= 3 && longer.length - shorter.length <= 1;
  }
  return false;
}

/** امتیاز ۰ تا ۱؛ نام‌های کوچک متفاوت → ۰ */
export function scorePersonName(spoken: string, customer: Customer): number {
  const parts = spokenNameParts(spoken);
  if (parts.length === 0) return 0;
  const spokenNorm = parts.join(" ");
  const full = customerFullName(customer);
  const first = (customer.firstName || "").trim();
  const last = (customer.lastName || "").trim();
  const fullScore = scoreProduct(spokenNorm, full);

  if (parts.length >= 2 && first) {
    if (!firstNamesCompatible(parts[0], first)) return 0;
  }

  if (parts.length === 1 && last && first) {
    const token = parts[0];
    const lastHit = scoreProduct(token, last) >= 0.85;
    const firstHit = firstNamesCompatible(token, first);
    if (lastHit && !firstHit) return Math.min(fullScore, 0.44);
  }

  return fullScore;
}

export function matchPersons(phrase: string, list: Customer[], minScore = 0.4): PersonHit[] {
  if (!phrase.trim()) return [];
  return list
    .map((customer) => ({ customer, score: scorePersonName(phrase, customer) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

/** فقط وقتی نام کامل به‌اندازه‌ی کافی جور است، بدون پرسیدن ثبت شود */
export function isClearPersonWinner(hits: PersonHit[]): boolean {
  const [best, second] = hits;
  if (!best) return false;
  return best.score >= 0.82 && (second === undefined || best.score - second.score >= 0.2);
}
