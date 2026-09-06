/**
 * وضعیت اشتراک برای رابط کاربری: هشدار ۷روزه، ورودِ فقط‌خواندنی پس از انقضا.
 * بررسی امنیتی سمت سرور (requireActiveSubscription) جدا می‌ماند.
 */

/** از این تعداد روز باقی‌مانده، آیکون کاربر قرمز می‌شود */
export const SUBSCRIPTION_WARN_DAYS = 7;

export const WRITE_BLOCKED_EVENT = "kamix-write-blocked";

type SessionLike = {
  status: string;
  session?: { user?: { id?: string } };
  profile?: { username?: string };
  username?: string;
  userId?: string;
};

/** روزهای باقی‌مانده تا پایان اشتراک (بالا-گرد). منفی یعنی منقضی. */
export function daysLeftFrom(endDate?: string | null, now = Date.now()): number | null {
  if (!endDate) return null;
  const ms = new Date(endDate).getTime();
  if (!isFinite(ms)) return null;
  return Math.ceil((ms - now) / 86_400_000);
}

/** اشتراک فعال است ولی تا ۷ روز دیگر تمام می‌شود (یا همین امروز). */
export function isSubscriptionExpiringSoon(endDate?: string | null, now = Date.now()): boolean {
  const left = daysLeftFrom(endDate, now);
  return left !== null && left <= SUBSCRIPTION_WARN_DAYS;
}

export function isAppSession(state: SessionLike): boolean {
  return (
    state.status === "authenticated" ||
    state.status === "expired" ||
    state.status === "offline-cached"
  );
}

export function isSubscriptionReadOnly(state: SessionLike): boolean {
  if (state.status === "expired") return true;
  if (state.status === "offline-cached") {
    const end = (state as { profile?: { end_date?: string | null; status?: string } }).profile;
    if (end?.status === "expired") return true;
    if (end?.end_date) {
      const t = new Date(end.end_date).getTime();
      if (Number.isFinite(t) && t < Date.now()) return true;
    }
  }
  return false;
}

export function authUserId(state: SessionLike): string | null {
  if (state.status === "offline-cached") return state.userId ?? null;
  if (state.status !== "authenticated" && state.status !== "expired") return null;
  return state.session?.user?.id ?? null;
}

export function authProfileUsername(state: SessionLike): string {
  if (
    state.status === "authenticated" ||
    state.status === "expired" ||
    state.status === "offline-cached"
  ) {
    return state.profile?.username ?? "";
  }
  if (state.status === "pending" || state.status === "rejected") return state.username ?? "";
  return "";
}
