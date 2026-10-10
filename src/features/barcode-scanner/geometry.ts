/**
 * geometry.ts — هندسهٔ خالص: نگاشت بین «پیکسل ویدیو» و «آنچه کاربر روی صفحه
 * می‌بیند»، و تعریف ناحیه‌هایی که در هر پاس دیکود می‌شوند.
 *
 * ویدیو با `object-fit: cover` نمایش داده می‌شود، پس بخشی از فریم بیرون از کادر
 * است. همهٔ محاسبه‌ها از ناحیهٔ «دیده‌شده» شروع می‌شوند تا آنچه کاربر داخل کادر
 * می‌بیند دقیقاً همان چیزی باشد که دیکود می‌شود.
 */

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** کادر اسکن به‌صورت کسری از نمای روی صفحه (۰ تا ۱). */
export const RETICLE: Rect = { x: 0.08, y: 0.22, width: 0.84, height: 0.56 };

/**
 * پاس‌های دیکود. هر پاس یک ناحیه و یک اندازهٔ هدف دارد:
 *
 *   focus — خودِ کادر با وضوح کامل؛ مسیر اصلی بارکدهای معمولی. سخت‌گیر: بارکد
 *           خطی باید روی دو خط اسکن پیدا شود، پس یک خوانش کافی است.
 *   soft  — همان focus ولی بارکد خطی با یک خط هم پذیرفته می‌شود (فریم تار).
 *           دقت با تأیید دوم در `consensus.ts` حفظ می‌شود.
 *   wide  — کل نمای دیده‌شده، کوچک‌شده؛ بارکد/QR بزرگ یا نزدیک که از کادر بیرون زده.
 *   micro — مرکز کادر، بزرگ‌نمایی‌شده؛ بارکدهای ریز یا دور (نرم).
 *   inverse — خودِ کادر با رنگ معکوس؛ بارکد خطی روشن روی لیبل تیره. zxing
 *             گزینهٔ tryInvert را فقط برای کدهای دوبعدی (QR…) اعمال می‌کند.
 *
 * ترتیب چرخش در `PASS_CYCLE` است: نیمی از تلاش‌ها روی خودِ کادر است.
 *
 * چرا سخت‌گیر/نرم جدا: با `minLineCount: 2` بارکد تمیز در **یک فریم** پذیرفته
 * می‌شود ولی بارکد تار هرگز؛ با ۱، تار هم خوانده می‌شود ولی zxing بعد از اولین
 * خط متوقف می‌شود و هر خوانش تأیید دوم می‌خواهد. هر دو در چرخه‌اند (اندازه‌گیری
 * در `scripts/test-scanner.ts`).
 */
export type PassName = "focus" | "soft" | "wide" | "micro" | "inverse";

/**
 * نحوهٔ دیکود یک برش:
 *   deep    — `tryHarder` (خطوط اسکن متراکم‌تر): ~۳ برابر کندتر ولی بارکد تار و
 *             کم‌کنتراست را هم می‌خواند. پاس‌های سریع بدون آن ~۱۰ برابر سریع‌ترند.
 *   lenient — بارکد خطی با یک خط اسکن هم پذیرفته شود (نیازمند تأیید دوم).
 *   invert  — رنگ‌ها معکوس شوند (لیبل روشن روی زمینهٔ تیره؛ zxing گزینهٔ
 *             tryInvert را برای بارکد خطی اعمال نمی‌کند).
 */
export type DecodeMode = { deep?: boolean; lenient?: boolean; invert?: boolean };

type PassSpec = {
  /** ناحیه به‌صورت کسری از نمای دیده‌شده. */
  region: Rect;
  /** سقف ضلع بلند خروجی (پیکسل). */
  maxSide: number;
  /** حداکثر بزرگ‌نمایی نسبت به پیکسل‌های واقعی ویدیو. */
  maxUpscale: number;
  mode: DecodeMode;
};

export const PASSES: Record<PassName, PassSpec> = {
  focus: { region: RETICLE, maxSide: 1280, maxUpscale: 2, mode: {} },
  soft: { region: RETICLE, maxSide: 1280, maxUpscale: 2, mode: { deep: true, lenient: true } },
  wide: { region: { x: 0, y: 0, width: 1, height: 1 }, maxSide: 960, maxUpscale: 1, mode: {} },
  micro: {
    region: { x: 0.3, y: 0.35, width: 0.4, height: 0.3 },
    maxSide: 1200,
    maxUpscale: 3,
    mode: { deep: true, lenient: true },
  },
  inverse: { region: RETICLE, maxSide: 1280, maxUpscale: 1, mode: { invert: true } },
};

export const PASS_CYCLE: readonly PassName[] = [
  "focus",
  "soft",
  "wide",
  "soft",
  "focus",
  "micro",
  "soft",
  "inverse",
];

/** وقتی دیکود روی ترد اصلی است، فریم‌ها کوچک‌تر می‌شوند تا UI روان بماند. */
export const MAIN_THREAD_MAX_SIDE = 720;

/**
 * ناحیهٔ دیده‌شدهٔ ویدیو (در مختصات پیکسل ویدیو) وقتی با `object-fit: cover`
 * در ظرفی با اندازهٔ `view` نمایش داده می‌شود.
 */
export function visibleVideoRect(video: Size, view: Size): Rect {
  if (video.width <= 0 || video.height <= 0 || view.width <= 0 || view.height <= 0) {
    return { x: 0, y: 0, width: Math.max(0, video.width), height: Math.max(0, video.height) };
  }
  const scale = Math.max(view.width / video.width, view.height / video.height);
  const width = Math.min(video.width, view.width / scale);
  const height = Math.min(video.height, view.height / scale);
  return { x: (video.width - width) / 2, y: (video.height - height) / 2, width, height };
}

/** یک ناحیهٔ کسری را داخل یک مستطیل (مثلاً ناحیهٔ دیده‌شده) قرار می‌دهد. */
export function subRect(outer: Rect, fraction: Rect): Rect {
  return {
    x: outer.x + outer.width * fraction.x,
    y: outer.y + outer.height * fraction.y,
    width: outer.width * fraction.width,
    height: outer.height * fraction.height,
  };
}

/** مستطیل را به مرزهای فریم محدود و به پیکسل صحیح گرد می‌کند. */
export function clampRect(r: Rect, bounds: Size): Rect {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const right = Math.min(bounds.width, Math.ceil(r.x + r.width));
  const bottom = Math.min(bounds.height, Math.ceil(r.y + r.height));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/**
 * اندازهٔ خروجی برای یک ناحیه: ضلع بلند حداکثر `maxSide`، و بزرگ‌نمایی حداکثر
 * `maxUpscale`. نسبت ابعاد حفظ می‌شود.
 *
 * بزرگ‌نمایی فقط با ضریب **صحیح** (۱×، ۲×، ۳×) انجام می‌شود. اندازه‌گیری روی
 * بارکد با مدول ۱ پیکسل: ضریب کسری (۱.۰۶× یا ۱.۵×) با درون‌یابی، میله‌ها را
 * ناهمسان می‌کند و بارکد ریز دیگر خوانده نمی‌شود؛ ضریب صحیح خوانده می‌شود.
 * کوچک‌سازی (ضریب < ۱) کسری می‌ماند؛ برای بارکدهای بزرگ بی‌خطر است.
 */
export function outputSize(src: Size, maxSide: number, maxUpscale: number): Size {
  const long = Math.max(src.width, src.height);
  if (long <= 0) return { width: 0, height: 0 };
  let scale = Math.min(maxSide / long, maxUpscale);
  if (scale >= 1) scale = Math.max(1, Math.floor(scale + 1e-9));
  return {
    width: Math.max(1, Math.round(src.width * scale)),
    height: Math.max(1, Math.round(src.height * scale)),
  };
}

export type CropPlan = {
  pass: PassName;
  source: Rect;
  output: Size;
  mode: DecodeMode;
};

/** برنامهٔ برش برای یک پاس، یا null اگر هنوز ابعاد معتبری نداریم. */
export function planCrop(
  pass: PassName,
  video: Size,
  view: Size,
  mainThread: boolean,
): CropPlan | null {
  if (video.width < 16 || video.height < 16) return null;
  const spec = PASSES[pass];
  const visible = visibleVideoRect(video, view);
  const source = clampRect(subRect(visible, spec.region), video);
  if (source.width < 16 || source.height < 16) return null;
  const maxSide = mainThread ? Math.min(spec.maxSide, MAIN_THREAD_MAX_SIDE) : spec.maxSide;
  return {
    pass,
    source,
    output: outputSize(source, maxSide, spec.maxUpscale),
    mode: spec.mode,
  };
}

/** نقطه‌ای در خروجی برش را به مختصات ویدیو برمی‌گرداند. */
export function outputPointToVideo(p: Point, plan: Pick<CropPlan, "source" | "output">): Point {
  return {
    x: plan.source.x + (p.x * plan.source.width) / plan.output.width,
    y: plan.source.y + (p.y * plan.source.height) / plan.output.height,
  };
}

/** نقطه‌ای در مختصات ویدیو را به کسر نمای روی صفحه (۰ تا ۱) نگاشت می‌کند. */
export function videoPointToView(p: Point, video: Size, view: Size): Point {
  const visible = visibleVideoRect(video, view);
  if (visible.width <= 0 || visible.height <= 0) return { x: 0.5, y: 0.5 };
  return { x: (p.x - visible.x) / visible.width, y: (p.y - visible.y) / visible.height };
}

/**
 * ناحیهٔ هدف: کادر با کمی حاشیه. بارکدی که مرکزش بیرون از این ناحیه است
 * (مثلاً کالای کناری روی پیشخوان که لبهٔ تصویر دیده می‌شود) نادیده گرفته
 * می‌شود؛ آنچه کاربر داخل کادر گرفته همان است که خوانده می‌شود.
 */
export const AIM_MARGIN = 0.06;

/** آیا مرکز این نقاط (کسر نما) داخل ناحیهٔ هدف است؟ بدون نقطه: بله. */
export function insideAimZone(points: readonly Point[]): boolean {
  if (points.length === 0) return true;
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  x /= points.length;
  y /= points.length;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  return (
    x >= RETICLE.x - AIM_MARGIN &&
    x <= RETICLE.x + RETICLE.width + AIM_MARGIN &&
    y >= RETICLE.y - AIM_MARGIN &&
    y <= RETICLE.y + RETICLE.height + AIM_MARGIN
  );
}
