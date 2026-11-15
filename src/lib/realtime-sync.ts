/**
 * سیگنال لحظه‌ای «دادهٔ این حساب روی دستگاه دیگری عوض شد».
 *
 * جدول کوچک user_data_sync_signal (مهاجرت 20261002120200) فقط user_id و updated_at
 * دارد؛ خود داده از این مسیر نمی‌آید. دستگاه با رسیدن سیگنال updated_at را
 * مقایسه و در صورت تغییر داده را دریافت می‌کند. اگر مهاجرت اجرا نشده یا اتصال
 * قطع است، همان دریافت دوره‌ای / هنگام برگشت به برنامه کار را انجام می‌دهد.
 */
import { supabase } from "@/integrations/supabase/client";

type Channel = ReturnType<typeof supabase.channel>;

let channel: Channel | null = null;
let activeUser: string | null = null;
type ChangeHandler = (updatedAt: string | null, seq: number | null) => void;
let onChange: ChangeHandler | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
/** بعد از این تعداد شکست، فاصلهٔ تلاش‌ها روی سقف می‌ماند (ولی تلاش قطع نمی‌شود) */
const MAX_BACKOFF_STEPS = 6;
const MAX_RETRY_DELAY_MS = 120_000;
/** کانال همین حالا وصل است و سیگنال‌ها می‌رسند */
let connected = false;

/** آیا سیگنال لحظه‌ای وصل است؟ (دریافت دوره‌ای در این حالت کمتر لازم است) */
export function isRealtimeSyncConnected(): boolean {
  return connected && channel !== null && activeUser !== null;
}

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function removeChannel() {
  const ch = channel;
  channel = null;
  connected = false;
  if (!ch) return;
  try {
    void supabase.removeChannel(ch);
  } catch {
    /* noop */
  }
}

function subscribe(userId: string) {
  removeChannel();
  if (typeof supabase.channel !== "function") return; // محیط تست / کلاینت بدون realtime
  let ch: Channel;
  try {
    ch = supabase.channel(`user-data-sync:${userId}`).on(
      "postgres_changes" as never,
      {
        event: "*",
        schema: "public",
        table: "user_data_sync_signal",
        filter: `user_id=eq.${userId}`,
      },
      (payload: { new?: { updated_at?: string; seq?: unknown } }) => {
        if (activeUser !== userId) return;
        // seq فقط بعد از مهاجرت 20261115120000 در سیگنال هست
        const seq = Number(payload?.new?.seq);
        onChange?.(payload?.new?.updated_at ?? null, Number.isSafeInteger(seq) && seq > 0 ? seq : null);
      },
    );
  } catch (e) {
    console.warn("[realtime-sync] channel setup failed", e);
    return;
  }
  channel = ch;
  ch.subscribe((status: string) => {
    if (channel !== ch || activeUser !== userId) return;
    if (status === "SUBSCRIBED") {
      failures = 0;
      connected = true;
      // ممکن است در مدت قطعی سیگنالی را از دست داده باشیم
      onChange?.(null, null);
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      connected = false;
      failures += 1;
      // قبلاً بعد از ۶ شکست تا برگشتن کاربر به برنامه دیگر تلاشی نمی‌شد؛ برنامه‌ای که
      // تمام روز باز است (صندوق فروشگاه) برای همیشه بدون سیگنال می‌ماند. حالا با
      // فاصلهٔ زیاد ادامه می‌دهیم؛ در این مدت بررسی دوره‌ای کار را انجام می‌دهد.
      clearRetry();
      const delay = Math.min(
        MAX_RETRY_DELAY_MS,
        2_000 * 2 ** (Math.min(failures, MAX_BACKOFF_STEPS) - 1),
      );
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (activeUser === userId) subscribe(userId);
      }, delay);
    }
  });
}

export function startRealtimeSync(userId: string, handler: ChangeHandler) {
  onChange = handler;
  if (activeUser === userId && channel) return;
  stopRealtimeSync();
  activeUser = userId;
  onChange = handler;
  failures = 0;
  subscribe(userId);
}

/** برگشت برنامه از پس‌زمینه / وصل شدن اینترنت: اگر کانال افتاده، دوباره وصل شو */
export function ensureRealtimeSync() {
  if (!activeUser) return;
  if (channel && failures === 0) return;
  failures = 0;
  clearRetry();
  subscribe(activeUser);
}

export function stopRealtimeSync() {
  activeUser = null;
  onChange = null;
  failures = 0;
  clearRetry();
  removeChannel();
}
