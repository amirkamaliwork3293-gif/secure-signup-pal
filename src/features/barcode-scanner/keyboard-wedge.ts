/**
 * keyboard-wedge.ts — پشتیبانی از بارکدخوان سخت‌افزاری (USB / بلوتوث / OTG).
 *
 * این دستگاه‌ها خود را کیبورد معرفی می‌کنند و کد را با سرعت بسیار زیاد «تایپ»
 * می‌کنند و معمولاً با Enter (یا Tab) تمام می‌کنند. انسان هرگز این‌قدر سریع
 * تایپ نمی‌کند؛ همین تفاوت سرعت، تشخیص را قابل اعتماد می‌کند.
 *
 * دو نکتهٔ مهم:
 *   - وقتی فوکوس داخل یک فیلد ورودی است (مثلاً جست‌وجوی دستی)، هیچ کاری
 *     نمی‌کنیم؛ کد مثل همیشه داخل همان فیلد تایپ می‌شود.
 *   - اگر زبان کیبورد سیستم فارسی باشد، `e.key` حروف فارسی می‌دهد (مثلاً «ش»
 *     به جای A). کاراکتر از `e.code` (کلید فیزیکی) بازسازی می‌شود. ارقام فارسی و
 *     عربی هم به لاتین تبدیل می‌شوند.
 */

/** فاصلهٔ بیشینهٔ دو کلید پشت‌سرهم در یک اسکن. */
export const MAX_KEY_GAP_MS = 60;
/** میانگین فاصلهٔ کلیدها باید کمتر از این باشد (انسان سریع حدود ۱۰۰ms است). */
export const MAX_AVG_GAP_MS = 35;
export const MIN_LENGTH = 3;
/** دستگاه‌هایی که Enter نمی‌فرستند: بعد از این سکوت، اسکن تمام‌شده فرض می‌شود. */
export const IDLE_FLUSH_MS = 120;
/** برای پایان بدون Enter، طول بیشتری لازم است تا تایپ سریع اتفاقی اشتباه گرفته نشود. */
export const MIN_LENGTH_WITHOUT_TERMINATOR = 6;

const SHIFTED_DIGITS: Record<string, string> = {
  Digit1: "!",
  Digit2: "@",
  Digit3: "#",
  Digit4: "$",
  Digit5: "%",
  Digit6: "^",
  Digit7: "&",
  Digit8: "*",
  Digit9: "(",
  Digit0: ")",
};

const PUNCTUATION: Record<string, [string, string]> = {
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  Period: [".", ">"],
  Comma: [",", "<"],
  Slash: ["/", "?"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Backquote: ["`", "~"],
  Space: [" ", " "],
  NumpadAdd: ["+", "+"],
  NumpadSubtract: ["-", "-"],
  NumpadMultiply: ["*", "*"],
  NumpadDivide: ["/", "/"],
  NumpadDecimal: [".", "."],
};

/** ارقام فارسی (۰-۹) و عربی (٠-٩) به لاتین. */
function latinDigit(ch: string): string | null {
  const c = ch.charCodeAt(0);
  if (c >= 0x06f0 && c <= 0x06f9) return String(c - 0x06f0);
  if (c >= 0x0660 && c <= 0x0669) return String(c - 0x0660);
  return null;
}

type KeyLike = {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

/**
 * کاراکتر اسکی معادل یک رویداد کلید، یا null اگر کاراکتر چاپی نیست.
 * خالص؛ تست‌شده.
 */
export function keyToChar(e: KeyLike): string | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const { key, code = "" } = e;
  if (key.length === 1) {
    const c = key.charCodeAt(0);
    if (c >= 0x20 && c < 0x7f) return key;
    const d = latinDigit(key);
    if (d) return d;
  }
  // چیدمان غیرلاتین (فارسی و…): از کلید فیزیکی.
  if (/^Key[A-Z]$/.test(code)) {
    const letter = code.slice(3);
    return e.shiftKey ? letter : letter.toLowerCase();
  }
  if (/^Digit\d$/.test(code)) return e.shiftKey ? (SHIFTED_DIGITS[code] ?? null) : code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  const punct = PUNCTUATION[code];
  if (punct) return e.shiftKey ? punct[1] : punct[0];
  return null;
}

export type WedgeResult = { code: string } | null;

/**
 * ماشین حالت خالص: کلیدها با زمانشان وارد می‌شوند و در صورت تشخیص یک اسکن
 * کامل، کد را برمی‌گرداند.
 */
export class WedgeBuffer {
  private chars: string[] = [];
  private times: number[] = [];

  get length(): number {
    return this.chars.length;
  }

  clear(): void {
    this.chars = [];
    this.times = [];
  }

  /** یک کاراکتر. اگر فاصله از قبلی زیاد باشد، بافر از نو شروع می‌شود. */
  push(ch: string, now: number): void {
    const last = this.times[this.times.length - 1];
    if (last !== undefined && now - last > MAX_KEY_GAP_MS) this.clear();
    this.chars.push(ch);
    this.times.push(now);
    if (this.chars.length > 256) this.clear();
  }

  /** آیا بافر فعلی شبیه خروجی دستگاه است؟ */
  looksMachineTyped(minLength: number): boolean {
    const n = this.chars.length;
    if (n < minLength) return false;
    const avg = (this.times[n - 1] - this.times[0]) / Math.max(1, n - 1);
    return avg <= MAX_AVG_GAP_MS;
  }

  /** پایان با Enter/Tab. */
  terminate(now: number): WedgeResult {
    const last = this.times[this.times.length - 1];
    const fresh = last !== undefined && now - last <= MAX_KEY_GAP_MS * 2;
    const ok = fresh && this.looksMachineTyped(MIN_LENGTH);
    const code = this.chars.join("").trim();
    this.clear();
    return ok && code.length >= MIN_LENGTH ? { code } : null;
  }

  /** پایان با سکوت (دستگاه بدون پسوند Enter). */
  flushIdle(): WedgeResult {
    const ok = this.looksMachineTyped(MIN_LENGTH_WITHOUT_TERMINATOR);
    const code = this.chars.join("").trim();
    this.clear();
    return ok && code.length >= MIN_LENGTH_WITHOUT_TERMINATOR ? { code } : null;
  }
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return ![
      "button",
      "checkbox",
      "radio",
      "range",
      "submit",
      "reset",
      "file",
      "color",
      "image",
    ].includes(type);
  }
  return false;
}

/**
 * شنود سراسری کیبورد. تابع برگشتی شنود را برمی‌دارد.
 * `enabled` در هر رویداد خوانده می‌شود (مثلاً وقتی اسکنر متوقف است).
 */
export function listenForHardwareScanner(
  onCode: (code: string) => void,
  enabled: () => boolean,
): () => void {
  if (typeof window === "undefined") return () => {};
  const buffer = new WedgeBuffer();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!enabled() || e.isComposing || isEditable(e.target)) {
      buffer.clear();
      clearIdle();
      return;
    }
    const now = performance.now();
    if (e.key === "Enter" || e.key === "Tab") {
      clearIdle();
      const res = buffer.terminate(now);
      if (res) {
        // جلوی «کلیک» دکمهٔ فوکوس‌دار با Enter دستگاه یا پرش فوکوس با Tab را می‌گیرد.
        e.preventDefault();
        e.stopPropagation();
        onCode(res.code);
      }
      return;
    }
    const ch = keyToChar(e);
    if (ch === null) {
      if (e.key !== "Shift" && e.key !== "CapsLock") buffer.clear();
      return;
    }
    buffer.push(ch, now);
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      const res = buffer.flushIdle();
      if (res && enabled()) onCode(res.code);
    }, IDLE_FLUSH_MS);
  };

  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    clearIdle();
    window.removeEventListener("keydown", onKeyDown, true);
  };
}
