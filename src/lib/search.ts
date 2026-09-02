/**
 * ابزار مشترک جستجو: هرجا کاربر عبارتی تایپ می‌کند، مواردی که کل عبارت
 * (نه فقط کلمه‌ی اول) را پوشش می‌دهند باید بالاتر از مواردی باشند که فقط
 * بخشی از کلمات را دارند.
 *
 * اولویت:
 *  ۱) تطبیق دقیق کل عبارت
 *  ۲) شروع شدن فیلد با کل عبارت
 *  ۳) وجود کل عبارت به‌صورت پیوسته در فیلد (حتی اگر کلمه‌ی دوم/سوم باشد)
 *  ۴) وجود همه‌ی کلمه‌ها (ترجیحاً به همان ترتیب)
 *  ۵) تطبیق جزئی کلمه‌ها — تطبیق فقط کلمه‌ی اول در جستجوی چندکلمه‌ای ضعیف است
 *
 * ترتیب اصلی آرایه در امتیاز برابر حفظ می‌شود (پایدار).
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
 * رقم‌های یک شماره را یکدست می‌کند: ارقام فارسی، فاصله، +98 / 0098 / 98 → 0.
 * برای جستجو است، نه اعتبارسنجی سخت‌گیرانه.
 */
export function normalizePhoneDigits(input: string | null | undefined): string {
  const n = normalizeSearchText(input);
  if (!n) return "";
  let d = n.replace(/[^\d+]/g, "").replace(/^\+/, "").replace(/^00/, "");
  if (d.startsWith("98") && d.length >= 12) d = `0${d.slice(2)}`;
  if (d.length === 10 && d.startsWith("9")) d = `0${d}`;
  return d;
}

/** آیا عبارت تقریباً فقط شماره است (با فاصله و پیش‌شماره)؟ */
export function isPhoneLikeQuery(query: string): boolean {
  const n = normalizeSearchText(query);
  if (!n) return false;
  const digits = n.replace(/[^\d]/g, "");
  if (digits.length < 4) return false;
  const rest = n.replace(/[\d\s+\-()]/g, "");
  return rest.length === 0;
}

/**
 * شکل‌های قابل‌جستجوی یک شماره: 0912…، 912…، 98912…
 * تا ادمین با هر فرمت رایجی همان کاربر را پیدا کند.
 */
export function phoneSearchKeys(input: string | null | undefined): string[] {
  const digits = normalizePhoneDigits(input);
  if (digits.length < 4) return [];
  const keys = new Set<string>([digits]);
  if (digits.startsWith("0")) keys.add(digits.slice(1));
  if (digits.length >= 10) keys.add(digits.slice(-10));
  if (digits.length === 11 && digits.startsWith("09")) {
    keys.add(`98${digits.slice(1)}`);
    keys.add(`+98${digits.slice(1)}`);
  }
  return [...keys];
}

export function phonesLikelySame(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const A = normalizePhoneDigits(a);
  const B = normalizePhoneDigits(b);
  if (!A || !B || A.length < 10 || B.length < 10) return false;
  if (A === B) return true;
  return A.slice(-10) === B.slice(-10);
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

/** نام + یوزرنیم + شکل‌های شماره تلفن — برای پنل ادمین و انتخاب کاربر */
export function identitySearchFields(
  person?: {
    username?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  } | null,
  phone?: string | null,
): string[] {
  if (!person) return phoneSearchKeys(phone);
  const first = person.first_name ?? person.firstName ?? "";
  const last = person.last_name ?? person.lastName ?? "";
  const tel = phone ?? person.phone ?? null;
  return [person.username ?? "", ...personNameSearchFields({ firstName: first, lastName: last }), tel ?? "", ...phoneSearchKeys(tel)];
}

function tokensInOrder(field: string, tokens: string[]): boolean {
  let pos = 0;
  for (const t of tokens) {
    const i = field.indexOf(t, pos);
    if (i < 0) return false;
    pos = i + t.length;
  }
  return true;
}

/**
 * امتیاز بالاتر = اولویت بیشتر. `null` یعنی هیچ تطبیقی نیست (حذف از نتایج).
 *
 * کل عبارت همیشه بر تک‌کلمه‌ی اول اولویت دارد؛ مثلاً جستجوی «گلس آیفون»
 * محصول «گلس آیفون ۱۳» را بالاتر از «گلس سامسونگ» می‌آورد.
 */
function scoreNormalizedFields(normalized: string[], q: string): number | null {
  const tokens = q.split(" ").filter((t) => t.length >= 1);

  let best = -1;

  for (const f of normalized) {
    if (f === q) {
      best = Math.max(best, 10000);
      continue;
    }
    if (f.startsWith(q)) {
      // نام کوتاه‌تر که با کل عبارت شروع شود نزدیک‌تر است
      best = Math.max(best, 9000 - Math.min(f.length - q.length, 400));
      continue;
    }
    const idx = f.indexOf(q);
    if (idx >= 0) {
      const atBoundary = idx === 0 || f[idx - 1] === " ";
      best = Math.max(best, (atBoundary ? 8200 : 7600) - Math.min(idx, 200));
    }
  }

  if (best >= 0) return best;

  const meaningful = tokens.filter((t) => t.length >= 2);
  const useTokens = meaningful.length > 0 ? meaningful : tokens;

  if (useTokens.length === 0) return null;

  const tokenInFields = (t: string) => normalized.some((f) => f.includes(t));
  const hits = useTokens.filter(tokenInFields);
  if (hits.length === 0) return null;

  const allPresent = hits.length === useTokens.length;
  if (allPresent && useTokens.length > 1) {
    const inOrder = normalized.some((f) => tokensInOrder(f, useTokens));
    return (inOrder ? 6200 : 5400) + useTokens.length * 40;
  }

  if (allPresent && useTokens.length === 1) {
    // تک‌کلمه که در وسط نام آمده (مثلاً «آیفون» داخل «گلس آیفون»)
    const atStart = normalized.some((f) => f.startsWith(useTokens[0]));
    return atStart ? 5000 : 4500;
  }

  // تطبیق جزئی: هرچه کلمه‌های بیشتری (مخصوصاً کلمه‌های بعدی) جور شوند بهتر است
  let laterHits = 0;
  useTokens.forEach((t, i) => {
    if (i > 0 && tokenInFields(t)) laterHits++;
  });
  const firstOnlyPenalty =
    useTokens.length > 1 && hits.length === 1 && tokenInFields(useTokens[0]) && laterHits === 0
      ? 500
      : 0;
  return 1200 + hits.length * 220 + laterHits * 180 - firstOnlyPenalty;
}

export function scoreSearchFields(fields: string[], query: string): number | null {
  const q = norm(query);
  if (!q) return 0;
  const normalized = [
    ...new Set([...fields.map(norm).filter(Boolean), ...fields.flatMap((f) => phoneSearchKeys(f))]),
  ];
  if (normalized.length === 0) return null;

  let best = scoreNormalizedFields(normalized, q);
  if (isPhoneLikeQuery(query)) {
    for (const qk of phoneSearchKeys(query)) {
      if (qk === q) continue;
      const s = scoreNormalizedFields(normalized, qk);
      if (s !== null) best = best === null ? s : Math.max(best, s);
    }
  }
  return best;
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

  const scored: { item: T; score: number; index: number }[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const fields = getFields(item).map(norm).filter(Boolean);
    if (fields.length === 0) continue;
    const score = scoreSearchFields(fields, q);
    if (score === null) continue;
    scored.push({ item, score, index });
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}

/** فقط رتبه‌بندی (بدون فیلتر) — برای جاهایی که فیلتر جدا انجام شده و فقط ترتیب مهم است. */
export function rankBySearchMatch<T>(
  items: T[],
  query: string,
  getFields: (item: T) => Array<string | undefined | null>,
): T[] {
  const q = norm(query);
  if (!q) return items;
  const scored = items.map((item, index) => {
    const fields = getFields(item).map(norm);
    return { item, score: scoreSearchFields(fields, q) ?? -1, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
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
