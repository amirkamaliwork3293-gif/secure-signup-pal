/**
 * ابزار مشترک جستجو: هرجا کاربر عبارتی تایپ می‌کند، مواردی که یکی از فیلدهایشان
 * دقیقاً با همان عبارت شروع می‌شود باید همیشه بالاتر از مواردی باشند که فقط
 * در وسط متن پیدا شده‌اند — تا کاربر سریع‌تر چیزی را که دنبالش است پیدا کند.
 *
 * ترتیب اصلی آرایه (مثلاً جدیدترین اول) در هر دو گروه حفظ می‌شود (پایدار).
 */

/** یک رشته را برای مقایسه نرمال می‌کند (بدون‌حساسیت به بزرگی/کوچکی حروف + فاصله‌های اضافی) */
function norm(s: string | undefined | null): string {
  return (s ?? "").toString().trim().toLowerCase();
}

/**
 * لیستی از آیتم‌ها را بر اساس عبارت جستجو فیلتر و اولویت‌بندی می‌کند.
 * - `getFields` باید همه‌ی متن‌های قابل‌جستجوی آن آیتم را برگرداند (مثلاً [نام, کد, دسته]).
 * - اگر query خالی باشد، لیست بدون تغییر برگردانده می‌شود.
 */
export function filterAndRankSearch<T>(
  items: T[],
  query: string,
  getFields: (item: T) => Array<string | undefined | null>,
): T[] {
  const q = norm(query);
  if (!q) return items;

  const startsGroup: T[] = [];
  const containsGroup: T[] = [];

  for (const item of items) {
    const fields = getFields(item).map(norm).filter(Boolean);
    if (fields.length === 0) continue;
    const isStart = fields.some((f) => f.startsWith(q));
    if (isStart) {
      startsGroup.push(item);
      continue;
    }
    const isMatch = fields.some((f) => f.includes(q));
    if (isMatch) containsGroup.push(item);
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
  const startsGroup: T[] = [];
  const restGroup: T[] = [];
  for (const item of items) {
    const fields = getFields(item).map(norm);
    if (fields.some((f) => f.startsWith(q))) startsGroup.push(item);
    else restGroup.push(item);
  }
  return [...startsGroup, ...restGroup];
}
