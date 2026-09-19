/**
 * amount-words.ts — نوشتن عدد به حروف فارسی
 *
 * فقط برای نمایش روی فاکتور («مبلغ به حروف») استفاده می‌شود و هیچ محاسبه‌ای
 * را تغییر نمی‌دهد. خروجی نامعتبر یا خارج از بازه، رشته‌ی خالی است تا قالب
 * فاکتور بتواند این سطر را نادیده بگیرد.
 */

const ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
const TEENS = [
  "ده",
  "یازده",
  "دوازده",
  "سیزده",
  "چهارده",
  "پانزده",
  "شانزده",
  "هفده",
  "هجده",
  "نوزده",
];
const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
const SCALES = ["", "هزار", "میلیون", "میلیارد", "هزار میلیارد"];

/** عدد سه‌رقمی (۱ تا ۹۹۹) به حروف */
function tripletToWords(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(HUNDREDS[hundreds]);
  if (rest >= 20) {
    const ones = rest % 10;
    parts.push(
      ones ? `${TENS[Math.floor(rest / 10)]} و ${ONES[ones]}` : TENS[Math.floor(rest / 10)],
    );
  } else if (rest >= 10) {
    parts.push(TEENS[rest - 10]);
  } else if (rest > 0) {
    parts.push(ONES[rest]);
  }
  return parts.join(" و ");
}

/**
 * عدد صحیح مثبت به حروف فارسی — «۹۶۲۹۴۹۶۰» → «نود و شش میلیون و دویست و نود
 * و چهار هزار و نهصد و شصت». برای عدد خیلی بزرگ یا نامعتبر، رشته‌ی خالی.
 */
export function amountToPersianWords(value: number): string {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "صفر";
  if (n >= 1e15) return "";

  const groups: number[] = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }

  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    const scale = SCALES[i];
    words.push(scale ? `${tripletToWords(g)} ${scale}` : tripletToWords(g));
  }
  return words.join(" و ");
}
