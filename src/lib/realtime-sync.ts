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
let onChange: ((updatedAt: string | null) => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
const MAX_FAILURES = 6;

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function removeChannel() {
  const ch = channel;
  channel = null;
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
      (payload: { new?: { updated_at?: string } }) => {
        if (activeUser !== userId) return;
        onChange?.(payload?.new?.updated_at ?? null);
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
      // ممکن است در مدت قطعی سیگنالی را از دست داده باشیم
      onChange?.(null);
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      failures += 1;
      if (failures > MAX_FAILURES) return; // دریافت دوره‌ای کافی است؛ با بازگشت به برنامه دوباره
      clearRetry();
      const delay = Math.min(60_000, 2_000 * 2 ** (failures - 1));
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (activeUser === userId) subscribe(userId);
      }, delay);
    }
  });
}

export function startRealtimeSync(userId: string, handler: (updatedAt: string | null) => void) {
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
