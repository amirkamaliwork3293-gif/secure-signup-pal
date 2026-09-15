/**
 * accept.ts — دروازهٔ پذیرش خوانش. خالص و قابل تست، بدون DOM و بدون state ری‌اکت.
 *
 * دو کار انجام می‌دهد:
 *   1. **جلوگیری از تکرار** — بارکدی که جلوی دوربین نگه داشته شده در هر فریم
 *      خوانده می‌شود؛ فقط یک بار در هر پنجرهٔ زمانی باید emit شود.
 *   2. **تأیید دوم برای فرمت‌های بی‌رقم‌کنترلی** — CODE-39 و ITF رقم کنترلی الزامی
 *      ندارند، پس یک خوانش تنها می‌تواند نتیجهٔ برش ناقص یا انعکاس نور باشد.
 *      دو خوانش یکسان در پنجرهٔ تأیید لازم است.
 *
 * مقایسه با `scannedCodesMatch` انجام می‌شود تا UPC-A و همان کد با صفر پیشوند
 * یکی شمرده شوند (منطق مشترک با جست‌وجوی محصول در `store.ts`).
 */
import { normalizeScannedCode, scannedCodesMatch } from "@/lib/barcode-match";
import { needsConfirmation } from "./formats";

/** تا این مدت بعد از یک پذیرش، همان کد دوباره emit نمی‌شود. */
export const REPEAT_SUPPRESS_MS = 900;
/** خوانش دومِ تأییدکننده باید داخل این پنجره برسد، وگرنه شمارش از نو. */
export const CONFIRM_WINDOW_MS = 1500;

export type AcceptState = {
  accepted: { code: string; at: number } | null;
  pending: { code: string; at: number } | null;
};

export const initialAcceptState: AcceptState = { accepted: null, pending: null };

export type AcceptDecision = {
  state: AcceptState;
  /** کد نرمال‌شده برای emit، یا null اگر این خوانش نباید به اپ برود. */
  emit: string | null;
};

export function acceptScan(
  state: AcceptState,
  raw: string,
  outputFormat: string,
  now: number,
): AcceptDecision {
  const code = normalizeScannedCode(raw);
  if (!code) return { state, emit: null };

  const { accepted } = state;
  if (
    accepted &&
    now - accepted.at < REPEAT_SUPPRESS_MS &&
    scannedCodesMatch(accepted.code, code)
  ) {
    return { state, emit: null };
  }

  if (needsConfirmation(outputFormat)) {
    const pending = state.pending;
    const fresh = pending && now - pending.at <= CONFIRM_WINDOW_MS;
    if (!fresh || !scannedCodesMatch(pending.code, code)) {
      return { state: { accepted: state.accepted, pending: { code, at: now } }, emit: null };
    }
  }

  return { state: { accepted: { code, at: now }, pending: null }, emit: code };
}
