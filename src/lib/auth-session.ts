/**
 * منطق خالص نشست: با JWT معتبر کاربر را به صفحهٔ ورود برنگردان.
 * نقش ادمین فقط از پاسخ زندهٔ سرور می‌آید، نه از کش قابل‌دستکاری.
 */
import type { ProfileStatus, UserProfile } from "@/lib/supabase";

export type SessionUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export type CachedProfile = { profile: UserProfile; isAdmin: boolean };

export type PickedProfile = {
  profile: UserProfile;
  /** فقط وقتی پروفایل زنده از سرور آمده true می‌شود */
  isAdmin: boolean;
  source: "live" | "cache" | "session";
};

const PROFILE_STATUSES: ProfileStatus[] = ["pending", "active", "expired", "rejected"];

export function synthesizeProfileFromSession(session: SessionUserLike): UserProfile {
  const md = session.user_metadata ?? {};
  const username =
    String(md.username ?? "")
      .trim()
      .toLowerCase() ||
    (session.email || "").split("@")[0] ||
    "user";
  const raw = String(md.status ?? "pending");
  const status: ProfileStatus = PROFILE_STATUSES.includes(raw as ProfileStatus)
    ? (raw as ProfileStatus)
    : "pending";
  return {
    id: session.id,
    username,
    first_name: typeof md.first_name === "string" ? md.first_name : null,
    last_name: typeof md.last_name === "string" ? md.last_name : null,
    plan: null,
    status,
    start_date: null,
    end_date: null,
    created_at: new Date(0).toISOString(),
  };
}

/**
 * پروفایل زنده برنده است. اگر خواندن پروفایل خطا داد یا ردیف خالی بود،
 * کش همان کاربر استفاده می‌شود. بدون کش، از metadata نشست یک پروفایل
 * محدود ساخته می‌شود تا JWT معتبر به «خروج» تبدیل نشود.
 *
 * نقش ادمین از کش یا metadata هرگز خوانده نمی‌شود.
 */
export function pickProfileForSession(opts: {
  session: SessionUserLike;
  live: UserProfile | null;
  liveIsAdmin: boolean;
  cached: CachedProfile | null;
}): PickedProfile {
  if (opts.live) {
    return { profile: opts.live, isAdmin: opts.liveIsAdmin, source: "live" };
  }
  if (opts.cached && opts.cached.profile.id === opts.session.id) {
    return { profile: opts.cached.profile, isAdmin: false, source: "cache" };
  }
  return {
    profile: synthesizeProfileFromSession(opts.session),
    isAdmin: false,
    source: "session",
  };
}

export function classifyUserAccess(
  profile: UserProfile,
  isAdmin: boolean,
  now = Date.now(),
): "authenticated" | "expired" | "pending" | "rejected" {
  if (isAdmin) return "authenticated";
  if (profile.status === "rejected") return "rejected";
  if (profile.status === "pending") return "pending";
  if (profile.end_date) {
    const end = new Date(profile.end_date).getTime();
    if (Number.isFinite(end) && end < now) return "expired";
  }
  if (profile.status === "expired") return "expired";
  return "authenticated";
}

/**
 * کدام رویداد auth باید دوباره پروفایل را از شبکه بخواند؟
 * SIGNED_IN تکراری (فوکوس تب / رفرش توکن) و USER_UPDATED نباید کاربر را
 * به خاطر خطای لحظه‌ای پروفایل از برنامه بیرون بیندازد.
 */
export function shouldSyncOnAuthEvent(event: string, currentStatus: string): boolean {
  if (event === "SIGNED_OUT") return true;
  if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
    return (
      currentStatus === "loading" ||
      currentStatus === "unauthenticated" ||
      currentStatus === "offline-cached"
    );
  }
  return false;
}

export const STAY_SIGNED_IN_KEY = "kamali.auth.stay.v1";

type StayStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function readStaySignedIn(storage?: StayStorage | null): string | null {
  const s = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!s) return null;
  try {
    const id = s.getItem(STAY_SIGNED_IN_KEY);
    return id && id !== "anon" ? id : null;
  } catch {
    return null;
  }
}

export function writeStaySignedIn(userId: string, storage?: StayStorage | null): void {
  const s = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!s || !userId || userId === "anon") return;
  try {
    s.setItem(STAY_SIGNED_IN_KEY, userId);
  } catch {
    /* quota */
  }
}

export function clearStaySignedIn(storage?: StayStorage | null): void {
  const s = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!s) return;
  try {
    s.removeItem(STAY_SIGNED_IN_KEY);
  } catch {
    /* ignore */
  }
}

/** اگر JWT هنوز هست یا «ماندن در دستگاه» فعال است، وضعیت unauthenticated را نپذیر. */
export function shouldKeepExistingSession(
  nextStatus: string,
  currentStatus: string,
  hasSession: boolean,
  staySignedIn = false,
): boolean {
  if (nextStatus !== "unauthenticated") return false;
  if (currentStatus === "unauthenticated" || currentStatus === "loading") return false;
  return hasSession || staySignedIn;
}

/** خروج واقعی فقط با دکمهٔ خروج؛ قطع توکن/شبکه کاربر را به ورود نفرستد. */
export function shouldRestoreDeviceSession(opts: {
  hasLiveSession: boolean;
  explicitSignOut: boolean;
  stayUserId: string | null;
}): boolean {
  if (opts.explicitSignOut) return false;
  if (opts.hasLiveSession) return false;
  return Boolean(opts.stayUserId);
}
