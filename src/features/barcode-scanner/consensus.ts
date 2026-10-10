/**
 * consensus.ts — دروازهٔ پذیرش. تصمیم می‌گیرد کدام خوانش واقعاً به اپ برسد.
 *
 * خالص و بدون DOM؛ زمان از بیرون داده می‌شود تا تست‌پذیر باشد.
 *
 * رفتار شبیه بارکدخوان سخت‌افزاری در حالت «ارائه» (presentation mode):
 *
 * 1. **دقت** — فرمت قوی (EAN/UPC، CODE-128، QR …) با یک خوانش پذیرفته می‌شود.
 *    فرمت ضعیف (CODE-39، ITF، Codabar) یا خوانش خطی zxing که فقط روی یک خط
 *    اسکن پیدا شده (`lineCount < 2`، معمولاً فریم تار)، دو خوانش یکسان در
 *    `CONFIRM_WINDOW_MS` لازم دارد. خوانش دوم می‌تواند از موتور دیگر یا پاس دیگر
 *    باشد؛ این یعنی تأیید معمولاً فقط یک فریم (~۳۰ میلی‌ثانیه) طول می‌کشد.
 *
 * 2. **بدون تکرار ناخواسته** — بارکدی که جلوی دوربین مانده در هر فریم خوانده
 *    می‌شود ولی فقط یک بار پذیرفته می‌شود. برای اسکن دوبارهٔ همان کالا، بارکد
 *    باید حداقل `REARM_GAP_MS` از دید خارج شود (و حداقل `MIN_REPEAT_MS` از
 *    پذیرش قبلی گذشته باشد). بارکد دیگر وقتی پذیرفته می‌شود که بارکد قبلی از
 *    دید خارج شده باشد (`EXCLUSIVE_MS`) — هر لحظه فقط یک کالا.
 *
 * 3. **منابع قابل اعتماد** — بارکدخوان سخت‌افزاری (کیبورد) و عکس انتخاب‌شده
 *    عمل آگاهانهٔ کاربرند؛ مشمول تأیید دوم و جلوگیری از تکرار نمی‌شوند.
 */
import { normalizeScannedCode } from "@/lib/barcode-match";
import { formatInfo, isPlausible, type CanonicalFormat } from "./formats";

export type ReadSource = "native" | "zxing" | "keyboard" | "image";

export type Reading = {
  text: string;
  format: CanonicalFormat;
  source: ReadSource;
  /** فقط zxing: تعداد خطوط اسکنی که بارکد خطی روی آن پیدا شد. */
  lineCount?: number;
};

export type Verdict =
  | { kind: "accept"; code: string; format: CanonicalFormat }
  | { kind: "pending" }
  | { kind: "repeat" }
  | { kind: "busy" }
  | { kind: "reject" };

/** خوانش تأییدکننده باید در این بازه برسد. */
export const CONFIRM_WINDOW_MS = 1200;
/** بارکد پذیرفته‌شده باید این مدت دیده نشود تا دوباره قابل پذیرش باشد. */
export const REARM_GAP_MS = 650;
/** حداقل فاصلهٔ دو پذیرش از یک کد، حتی اگر از دید خارج شده باشد. */
export const MIN_REPEAT_MS = 900;
/**
 * تا وقتی بارکد پذیرفته‌شده‌ای هنوز در دید است (در این بازه دیده شده)، بارکد
 * دیگری پذیرفته نمی‌شود. دو کالای کنار هم یا کالایی با دو بارکد، فقط یک بار
 * و فقط اولی ثبت می‌شود؛ مثل لیزر دستگاه که در هر لحظه یک بارکد را می‌خواند.
 */
export const EXCLUSIVE_MS = 300;
/** حافظهٔ کدهای پذیرفته‌شده بعد از این مدت ندیدن پاک می‌شود (دیگر اثری ندارند). */
const FORGET_MS = 10_000;

type Pending = { key: string; firstAt: number; hits: number };
type Seen = { acceptedAt: number; seenAt: number };

export class Consensus {
  private pending: Pending[] = [];
  /** کدهای پذیرفته‌شدهٔ اخیر. نه فقط آخرین: با دو بارکد در دید، تناوب A,B,A,B نباید هر بار پذیرفته شود. */
  private recent = new Map<string, Seen>();

  /** حالت را پاک می‌کند (مثلاً بعد از تعویض دوربین). */
  reset(): void {
    this.pending = [];
    this.recent.clear();
  }

  offer(reading: Reading, now: number): Verdict {
    const code = normalizeScannedCode(reading.text);
    if (!code || !isPlausible(reading.format, code)) return { kind: "reject" };

    const key = identityKey(reading.format, code);
    const trusted = reading.source === "keyboard" || reading.source === "image";

    if (trusted) {
      this.accepted(key, now);
      return { kind: "accept", code, format: reading.format };
    }

    const seen = this.recent.get(key);
    if (seen) {
      const away = now - seen.seenAt;
      seen.seenAt = now;
      if (away < REARM_GAP_MS || now - seen.acceptedAt < MIN_REPEAT_MS) return { kind: "repeat" };
    }

    for (const [other, s] of this.recent) {
      if (other !== key && now - s.seenAt < EXCLUSIVE_MS) return { kind: "busy" };
    }

    if (needsConfirmation(reading)) {
      this.pending = this.pending.filter((p) => now - p.firstAt <= CONFIRM_WINDOW_MS);
      const entry = this.pending.find((p) => p.key === key);
      if (!entry) {
        this.pending.push({ key, firstAt: now, hits: 1 });
        if (this.pending.length > 8) this.pending.shift();
        return { kind: "pending" };
      }
      entry.hits += 1;
      if (entry.hits < 2) return { kind: "pending" };
    }

    this.accepted(key, now);
    return { kind: "accept", code, format: reading.format };
  }

  private accepted(key: string, now: number): void {
    for (const [k, s] of this.recent) if (now - s.seenAt > FORGET_MS) this.recent.delete(k);
    this.recent.set(key, { acceptedAt: now, seenAt: now });
    this.pending = [];
  }
}

export function needsConfirmation(reading: Reading): boolean {
  const info = formatInfo(reading.format);
  if (!info || info.strength === "weak") return true;
  if (reading.source === "zxing" && info.linear) return (reading.lineCount ?? 0) < 2;
  return false;
}

/**
 * کلید هویت برای مقایسهٔ دو خوانش. UPC-A ممکن است ۱۲ رقمی (BarcodeDetector) یا
 * ۱۳ رقمی با صفر پیشوند (zxing) برسد؛ هر دو یک کالا هستند.
 */
export function identityKey(format: CanonicalFormat, code: string): string {
  if ((format === "upca" || format === "ean13") && /^\d{12}$/.test(code)) return `0${code}`;
  return code;
}
