/**
 * AuthContext — session + profile + subscription expiry awareness.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type UserProfile } from "@/lib/supabase";
import {
  setStorageScope,
  hydrateFromCloud,
  stopCloudSync,
  beginUserScope,
  flushPendingCloudWrites,
} from "@/lib/store";
import { isNativeApp } from "@/lib/isWebView";
import { isCapacitorOfflineReadOnly } from "@/lib/online-status";
import { clearUserOfflineCache } from "@/lib/offline-cache";
import { ONLINE_CONFIRMED_EVENT } from "@/lib/online-status-core";
import {
  classifyUserAccess,
  clearStaySignedIn,
  pickProfileForSession,
  readStaySignedIn,
  shouldKeepExistingSession,
  shouldRestoreDeviceSession,
  shouldSyncOnAuthEvent,
  writeStaySignedIn,
} from "@/lib/auth-session";
import { keepLiveAdminRole } from "@/lib/account-isolation";
import {
  forgetOfflineLogin,
  hasOfflineLoginFor,
  isInvalidCredentialsError,
  rememberOfflineLogin,
  usernameToAuthEmail,
} from "@/lib/offline-login";

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "expired"; username: string; profile: UserProfile; session: Session }
  | { status: "offline-cached"; username: string; profile: UserProfile; userId: string }
  | { status: "pending"; username: string }
  | { status: "rejected"; username: string }
  | { status: "authenticated"; session: Session; profile: UserProfile; isAdmin: boolean };

type AuthContextValue = {
  state: AuthState;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /**
   * ورود بدون اینترنت (اپ اندروید): بعد از تطبیق رمز با اثر ذخیره‌شده روی گوشی،
   * کاربر با داده‌های همین گوشی وارد می‌شود. false یعنی دادهٔ این حساب روی گوشی نیست.
   */
  enterOfflineSession: (userId: string, username: string, password: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const UNSYNCED_SIGN_OUT_MESSAGE =
  "بعضی از تغییرات شما هنوز روی سرور ذخیره نشده‌اند (احتمالاً اینترنت قطع است).\n\n" +
  "اگر الان خارج شوید، این تغییرات روی همین دستگاه می‌مانند و دفعهٔ بعد که با همین حساب " +
  "وارد شوید ذخیره می‌شوند؛ ولی تا آن موقع روی دستگاه‌های دیگر دیده نمی‌شوند.\n\n" +
  "برای اطمینان: «انصراف» را بزنید، اینترنت را وصل کنید و چند ثانیه بعد دوباره خارج شوید.\n\n" +
  "با این حال خارج می‌شوید؟";

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// ── Offline profile cache ────────────────────────────────────────────────────
// Supabase stores the session token in localStorage, so getSession() works
// offline. The problem is the subsequent DB queries for profile and user_roles.
// We cache those after every successful load and fall back to cache when offline.

const profileCacheKey = (uid: string) => `auth_profile:${uid}`;

function saveProfileCache(uid: string, profile: UserProfile, isAdmin: boolean) {
  try {
    localStorage.setItem(profileCacheKey(uid), JSON.stringify({ profile, isAdmin }));
  } catch {}
}

function readProfileCache(uid: string): { profile: UserProfile; isAdmin: boolean } | null {
  try {
    const raw = localStorage.getItem(profileCacheKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function toAuthState(session: Session, profile: UserProfile, isAdmin: boolean): AuthState {
  const kind = classifyUserAccess(profile, isAdmin);
  if (kind === "rejected") return { status: "rejected", username: profile.username };
  if (kind === "pending") return { status: "pending", username: profile.username };
  if (kind === "expired") {
    if (isAdmin) {
      return { status: "authenticated", session, profile, isAdmin: true };
    }
    try {
      if (!isCapacitorOfflineReadOnly()) {
        void supabase.from("profiles").update({ status: "expired" }).eq("id", session.user.id);
      }
    } catch {}
    return { status: "expired", username: profile.username, profile, session };
  }
  return { status: "authenticated", session, profile, isAdmin };
}

async function loadState(
  session: Session,
  prev?: { userId: string | null; isAdmin: boolean },
): Promise<AuthState> {
  beginUserScope(session.user.id);

  const skipNetwork = capacitorNetworkDown();
  if (!skipNetwork) {
    try {
      await Promise.race([
        hydrateFromCloud(session.user.id),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2800);
        }),
      ]);
    } catch {
      /* local store remains source of truth */
    }
  }

  let live: UserProfile | null = null;
  let liveIsAdmin = false;
  let roleQuerySucceeded = false;

  if (!skipNetwork) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!error && data) {
        live = data as UserProfile;
        try {
          const { data: roleRow, error: roleErr } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", session.user.id)
            .eq("role", "admin")
            .maybeSingle();
          if (!roleErr) {
            liveIsAdmin = !!roleRow;
            roleQuerySucceeded = true;
          }
        } catch {
          roleQuerySucceeded = false;
        }
        saveProfileCache(session.user.id, live, roleQuerySucceeded ? liveIsAdmin : false);
      }
    } catch {
      // شبکه/RLS — پایین‌تر از کش استفاده می‌شود. JWT معتبر را دور نمی‌اندازیم.
    }
  }

  const picked = pickProfileForSession({
    session: session.user,
    live,
    liveIsAdmin,
    cached: readProfileCache(session.user.id),
  });
  const isAdmin = keepLiveAdminRole({
    sameUser: Boolean(prev?.userId && prev.userId === session.user.id),
    previousIsAdmin: Boolean(prev?.isAdmin),
    roleQuerySucceeded,
    liveIsAdmin: picked.source === "live" ? liveIsAdmin : false,
  });
  writeStaySignedIn(session.user.id);
  return toAuthState(session, picked.profile, isAdmin);
}

function deviceAuthFor(userId: string): AuthState | null {
  const cached = readProfileCache(userId);
  if (!cached || cached.profile.id !== userId) return null;
  setStorageScope(userId);
  const kind = classifyUserAccess(cached.profile, false);
  if (kind === "pending") return { status: "pending", username: cached.profile.username };
  if (kind === "rejected") return { status: "rejected", username: cached.profile.username };
  return {
    status: "offline-cached",
    username: cached.profile.username,
    profile: cached.profile,
    userId,
  };
}

function restoreDeviceAuth(): AuthState | null {
  const stayId = readStaySignedIn();
  if (!stayId) return null;
  return deviceAuthFor(stayId);
}

/**
 * یوزرنیم/رمزی که با آن ورود آفلاین انجام شده — فقط در حافظهٔ همین اجرا (نه
 * روی دیسک) تا وقتی سرور دوباره در دسترس شد، بی‌صدا ورود واقعی انجام شود و
 * تغییرات آفلاین به سرور بروند. با بسته شدن برنامه از بین می‌رود؛ آن‌وقت نوار
 * «یک‌بار دوباره وارد شوید» نشان داده می‌شود و داده‌ها روی گوشی منتظر می‌مانند.
 */
let offlineReauth: { userId: string; username: string; password: string } | null = null;
let reauthInFlight = false;

function capacitorNetworkDown(): boolean {
  if (!isNativeApp()) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return isCapacitorOfflineReadOnly();
}

function scopedUserId(state: AuthState): string | null {
  if (state.status === "authenticated" || state.status === "expired") return state.session.user.id;
  if (state.status === "offline-cached") return state.userId;
  return null;
}

function optimisticStateFromCache(session: Session): AuthState | null {
  const cached = readProfileCache(session.user.id);
  if (!cached || cached.profile.id !== session.user.id) return null;
  // نقش ادمین عمداً از کش نمی‌آید؛ localStorage قابل دستکاری است.
  return toAuthState(session, cached.profile, false);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // نکته‌ی مهم SEO: مقدار اولیه‌ی وضعیت عمداً "unauthenticated" است، نه "loading".
  // این کامپوننت هم روی سرور (SSR) و هم در اولین رندر کلاینت (پیش از اجرای
  // useEffect زیر) دقیقاً یک خروجی یکسان تولید می‌کند تا هیدریشن به‌هم نخورد.
  // نتیجه: صفحه‌ی اصلی برای گوگل‌بات و هر بازدیدکننده‌ای، همان لحظه‌ی اول،
  // محتوای واقعی صفحه‌ی معرفی (LandingPage) را نشان می‌دهد — نه یک اسپینر
  // خالی «در حال بررسی هویت...» که هیچ متنی برای ایندکس‌شدن نداشت.
  // برای کاربرانِ واقعاً واردشده، همین useEffect در چند صد میلی‌ثانیه‌ی اول
  // وضعیت را به authenticated اصلاح می‌کند؛ رفتار برنامه تغییری نمی‌کند.
  const [state, setState] = useState<AuthState>({ status: "unauthenticated" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const explicitSignOutRef = useRef(false);

  const adoptNoSession = () => {
    if (explicitSignOutRef.current) {
      explicitSignOutRef.current = false;
      clearStaySignedIn();
      setStorageScope(null);
      setState({ status: "unauthenticated" });
      return;
    }
    const stayId = readStaySignedIn();
    if (
      shouldRestoreDeviceSession({
        hasLiveSession: false,
        explicitSignOut: false,
        stayUserId: stayId,
      })
    ) {
      const local = restoreDeviceAuth();
      if (local) {
        setState(local);
        return;
      }
    }
    if (shouldKeepExistingSession("unauthenticated", stateRef.current.status, false, Boolean(stayId))) {
      return;
    }
    setStorageScope(null);
    setState({ status: "unauthenticated" });
  };

  const trySilentReauth = async () => {
    const creds = offlineReauth;
    const cur = stateRef.current;
    if (!creds || reauthInFlight) return;
    if (cur.status !== "offline-cached" || cur.userId !== creds.userId) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    reauthInFlight = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: usernameToAuthEmail(creds.username),
        password: creds.password,
      });
      if (error) {
        if (isInvalidCredentialsError(error)) {
          // رمز روی سرور عوض شده — رمز قدیمی دیگر نه آفلاین و نه بی‌صدا استفاده نمی‌شود.
          offlineReauth = null;
          forgetOfflineLogin(creds.username);
        }
        return;
      }
      offlineReauth = null;
      if (data.user?.id) void rememberOfflineLogin(creds.username, creds.password, data.user.id);
      // رویداد SIGNED_IN خودش syncSession را اجرا می‌کند (وضعیت offline-cached است).
    } catch {
      /* هنوز در دسترس نیست — دفعهٔ بعد */
    } finally {
      reauthInFlight = false;
    }
  };

  const refreshProfile = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      adoptNoSession();
      void trySilentReauth();
      return;
    }
    const cur = stateRef.current;
    const next = await loadState(session, {
      userId: scopedUserId(cur),
      isAdmin: cur.status === "authenticated" && cur.isAdmin,
    });
    if (shouldKeepExistingSession(next.status, stateRef.current.status, true, true)) {
      return;
    }
    setState(next);
  };

  useEffect(() => {
    let disposed = false;
    let revision = 0;

    const syncSession = async (session: Session | null) => {
      const currentRevision = ++revision;

      if (!session) {
        stopCloudSync();
        if (!disposed && currentRevision === revision) {
          adoptNoSession();
        }
        return;
      }

      // Avoid the loading flicker when the same user's session is re-emitted
      // (e.g. mobile WebView resumes after the native file picker closes —
      // Supabase fires SIGNED_IN again, which would otherwise unmount the
      // current page and discard the in-progress file selection / form state).
      const cur = stateRef.current;
      const sameUser =
        scopedUserId(cur) === session.user.id ||
        ((cur.status === "pending" || cur.status === "rejected") &&
          readProfileCache(session.user.id)?.profile.id === session.user.id);
      if (!disposed && currentRevision === revision && !sameUser) {
        const optimistic = optimisticStateFromCache(session);
        if (optimistic) {
          setStorageScope(session.user.id);
          setState(optimistic);
        } else {
          setState({ status: "loading" });
        }
      }

      const nextState = await loadState(session, {
        userId: scopedUserId(cur),
        isAdmin: cur.status === "authenticated" && cur.isAdmin,
      });
      if (!disposed && currentRevision === revision) {
        if (shouldKeepExistingSession(nextState.status, stateRef.current.status, true, true)) {
          return;
        }
        setState(nextState);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncSession(session);
    });

    let signedOutTimer: ReturnType<typeof setTimeout> | null = null;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const cur = stateRef.current;
      const curId = scopedUserId(cur);
      if (event === "SIGNED_OUT") {
        if (signedOutTimer) clearTimeout(signedOutTimer);
        signedOutTimer = setTimeout(() => {
          signedOutTimer = null;
          void syncSession(null);
        }, 350);
        return;
      }
      if (signedOutTimer) {
        clearTimeout(signedOutTimer);
        signedOutTimer = null;
      }
      if (!shouldSyncOnAuthEvent(event, cur.status, curId, session?.user.id ?? null)) return;
      void syncSession(session);
    });

    const onOnline = () => {
      try {
        void supabase.auth.startAutoRefresh();
      } catch {
        /* noop */
      }
      void refreshProfile();
    };
    // ورود آفلاین: تا وقتی ورود واقعی انجام نشده، هر دقیقه بی‌صدا امتحان کن
    // (برای وقتی که سایت باز می‌شود ولی سرور داده هنوز در دسترس نیست).
    // نشست زنده نیست (offline-cached): هر ۳۰ ثانیه اگر نشست ذخیره‌شده دوباره معتبر شد
    // (سرور برگشت) وارد شو تا تغییرات آفلاین ارسال شوند؛ وگرنه ورود بی‌صدا با رمز همین اجرا.
    const reauthTimer = setInterval(() => {
      if (stateRef.current.status !== "offline-cached") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      void supabase.auth
        .getSession()
        .then(({ data: { session } }) => {
          if (session) void refreshProfile();
          else void trySilentReauth();
        })
        .catch(() => {});
    }, 30_000);
    const onOffline = () => {
      try {
        void supabase.auth.stopAutoRefresh();
      } catch {
        /* noop */
      }
    };
    if (isNativeApp()) {
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      window.addEventListener(ONLINE_CONFIRMED_EVENT, onOnline);
      if (typeof navigator !== "undefined" && navigator.onLine === false) onOffline();
    }

    return () => {
      disposed = true;
      clearInterval(reauthTimer);
      if (signedOutTimer) clearTimeout(signedOutTimer);
      subscription.unsubscribe();
      if (isNativeApp()) {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
        window.removeEventListener(ONLINE_CONFIRMED_EVENT, onOnline);
      }
    };
  }, []);

  const signOut = async () => {
    // قبلاً صف ذخیره بدون ارسال دور ریخته می‌شد و در اپ اندروید حافظهٔ محلی کاربر
    // (همراه تغییرات ذخیره‌نشده) پاک می‌شد: هر چه در چند ثانیهٔ آخر یا آفلاین ثبت
    // شده بود برای همیشه از بین می‌رفت. حالا اول ذخیره می‌کنیم.
    const synced = await flushPendingCloudWrites();
    if (!synced && typeof window !== "undefined" && !window.confirm(UNSYNCED_SIGN_OUT_MESSAGE)) {
      return;
    }
    explicitSignOutRef.current = true;
    offlineReauth = null;
    clearStaySignedIn();
    const prev = stateRef.current;
    const prevId = scopedUserId(prev);
    stopCloudSync();
    await supabase.auth.signOut();
    if (prev.status === "offline-cached") {
      // بدون نشست زنده، signOut رویداد SIGNED_OUT نمی‌دهد؛ پرچم را همین‌جا برگردان.
      explicitSignOutRef.current = false;
    }
    // تغییرات ذخیره‌نشده روی همین دستگاه می‌مانند تا ورود بعدی همین حساب آن‌ها را بفرستد.
    // اگر ورود آفلاین برای این حساب روی این گوشی فعال است، داده‌ها (مثل سایت) روی
    // گوشی می‌مانند تا بعد از خروج هم بدون اینترنت بتوان دوباره وارد شد و کار کرد.
    if (isNativeApp() && prevId && synced && !hasOfflineLoginFor(prevId)) {
      clearUserOfflineCache(prevId);
    }
    setStorageScope(null);
    setState({ status: "unauthenticated" });
  };

  const enterOfflineSession = (userId: string, username: string, password: string): boolean => {
    if (!userId) return false;
    const cur = stateRef.current;
    if (scopedUserId(cur) && scopedUserId(cur) !== userId) stopCloudSync();
    const next = deviceAuthFor(userId);
    if (!next) return false;
    explicitSignOutRef.current = false;
    writeStaySignedIn(userId);
    offlineReauth = next.status === "offline-cached" ? { userId, username, password } : null;
    setState(next);
    return true;
  };

  return (
    <AuthContext.Provider value={{ state, signOut, refreshProfile, enterOfflineSession }}>
      {children}
    </AuthContext.Provider>
  );
}
