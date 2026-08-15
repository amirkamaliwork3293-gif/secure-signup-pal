/**
 * ابزار مشترک جستجو: هرجا کاربر عبارتی تایپ می‌کند، مواردی که یکی از فیلدهایشان
 * دقیقاً با همان عبارت شروع می‌شود باید همیشه بالاتر از مواردی باشند که فقط
 * در وسط متن پیدا شده‌اند — تا کاربر سریع‌تر چیزی را که دنبالش است پیدا کند.
 *
 * ترتیب اصلی آرایه (مثلاً جدیدترین اول) در هر دو گروه حفظ می‌شود (پایدار).
 */

/** نرمال‌سازی برای مقایسه: ی/ك عربی، فاصلهٔ مجازی، ارقام فارسی، حروف کوچک */
export function normalizeSearchText(s: string | undefined | null): string {
  if (!s) return "";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let out = "";
  for (const ch of s.toString()) {
    const fi = fa.indexOf(ch);
    const ai = ar.indexOf(ch);
    if (fi >= 0) out += String(fi);
    else if (ai >= 0) out += String(ai);
    else out += ch;
  }
  return out
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/‌/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function norm(s: string | undefined | null): string {
  return normalizeSearchText(s);
}

/**
 * فیلدهای قابل‌جستجوی نام شخص: نام، نام خانوادگی، نام کامل، و هر کلمه جدا.
 * تا جستجوی «علی» و «کمالی» و «علی کمالی» هر سه کار کنند.
 */
export function personNameSearchFields(
  person?: { firstName?: string; lastName?: string } | null,
): string[] {
  if (!person) return [];
  const first = (person.firstName ?? "").trim();
  const last = (person.lastName ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ");
  const words = [...first.split(/\s+/), ...last.split(/\s+/)].map((w) => w.trim()).filter(Boolean);
  return [first, last, full, ...words];
}

function fieldMatchesQuery(fields: string[], q: string, tokens: string[]): boolean {
  if (fields.some((f) => f.includes(q))) return true;
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return fields.some((f) => f.includes(tokens[0]));
  // چندکلمه‌ای («علی کمالی»): همهٔ کلمه‌ها باید در فیلدهای نام پیدا شوند
  return tokens.every((t) => fields.some((f) => f.includes(t)));
}

function fieldStartsQuery(fields: string[], q: string, tokens: string[]): boolean {
  if (fields.some((f) => f.startsWith(q))) return true;
  return tokens.some((t) => t.length >= 2 && fields.some((f) => f.startsWith(t)));
}

/**
 * لیستی از آیتم‌ها را بر اساس عبارت جستجو فیلتر و اولویت‌بندی می‌کند.
 * - `getFields` باید همه‌ی متن‌های قابل‌جستجوی آن آیتم را برگرداند (مثلاً [نام, کد, دسته]).
 * - اگر query خالی باشد، لیست بدون تغییر برگردانده می‌شود.
 * - عبارت چندکلمه‌ای وقتی همهٔ کلمه‌ها در فیلدها باشند هم مطابقت می‌کند
 *   (مثلاً «علی کمالی» روی فاکتوری که نام و فامیل جدا ذخیره شده).
 */
export function filterAndRankSearch<T>(
  items: T[],
  query: string,
  getFields: (item: T) => Array<string | undefined | null>,
): T[] {
  const q = norm(query);
  if (!q) return items;
  const tokens = q.split(" ").filter((t) => t.length >= 2);

  const startsGroup: T[] = [];
  const containsGroup: T[] = [];

  for (const item of items) {
    const fields = getFields(item).map(norm).filter(Boolean);
    if (fields.length === 0) continue;
    if (fieldStartsQuery(fields, q, tokens)) {
      startsGroup.push(item);
      continue;
    }
    if (fieldMatchesQuery(fields, q, tokens)) containsGroup.push(item);
  }

  return [...startsGroup, ...containsGroup];
}

/** فقط رتبه‌بندی (بدون فیلتر) — برای جاهایی که فیلتر جدا انجام شده و فقط ترتیب مهم است. */
export function rankBySearchMatch<T>(
  items: T[],
  query: string,
  getFields: (item: T) => Array<string | undefined | null>,
): T[] {
  const q = norm(query);
  if (!q) return items;
  const tokens = q.split(" ").filter((t) => t.length >= 2);
  const startsGroup: T[] = [];
  const restGroup: T[] = [];
  for (const item of items) {
    const fields = getFields(item).map(norm);
    if (fieldStartsQuery(fields, q, tokens)) startsGroup.push(item);
    else restGroup.push(item);
  }
  return [...startsGroup, ...restGroup];
}

/**
 * آیا دو نام (روی فاکتور / در فهرست مشتریان) به یک نفر اشاره می‌کنند؟
 * نام و نام‌خانوادگی جدا یا چسبیده، و جستجوی فقط‌فامیل یا فقط‌اسم، هر دو قبول است.
 * دو نفر با فامیل یکسان و نام متفاوت یکی گرفته نمی‌شوند.
 */
export function namesReferToSamePerson(
  a?: { firstName?: string; lastName?: string } | null,
  b?: { firstName?: string; lastName?: string } | null,
): boolean {
  if (!a || !b) return false;
  const pack = (p: { firstName?: string; lastName?: string }) => {
    const first = normalizeSearchText(p.firstName);
    const last = normalizeSearchText(p.lastName);
    const full = [first, last].filter(Boolean).join(" ");
    const words = new Set(
      [...first.split(" "), ...last.split(" ")].map((w) => w.trim()).filter((w) => w.length >= 2),
    );
    return { first, last, full, words };
  };
  const A = pack(a);
  const B = pack(b);
  if (!A.full || !B.full) return false;
  if (A.full === B.full) return true;
  if (A.full.includes(B.full) || B.full.includes(A.full)) return true;
  if (A.first && A.last && B.first && B.last) {
    return (A.first === B.first && A.last === B.last) || (A.first === B.last && A.last === B.first);
  }
  for (const w of A.words) {
    if (B.words.has(w) || B.first === w || B.last === w || B.full.includes(w)) return true;
  }
  return false;
}
