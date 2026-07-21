/**
 * AuthContext — session + profile + subscription expiry awareness.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type UserProfile } from "@/lib/supabase";
import { setStorageScope, hydrateFromCloud, stopCloudSync } from "@/lib/store";

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "expired"; username: string; profile: UserProfile }
  | { status: "pending"; username: string }
  | { status: "rejected"; username: string }
  | { status: "authenticated"; session: Session; profile: UserProfile; isAdmin: boolean };

type AuthContextValue = {
  state: AuthState;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

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
  } catch { return null; }
}

async function loadState(session: Session): Promise<AuthState> {
  setStorageScope(session.user.id);

  // hydrateFromCloud fails when offline — that's fine, local data is source of truth
  try { await hydrateFromCloud(session.user.id); } catch {}

  let profile: UserProfile | null = null;
  let isAdmin = false;

  try {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();

    if (!data) return { status: "unauthenticated" };

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .eq("role", "admin")
      .maybeSingle();

    isAdmin = !!roleRow;
    profile = data as UserProfile;
    saveProfileCache(session.user.id, profile, isAdmin);
  } catch {
    // Offline path: fall back to cached profile
    const cached = readProfileCache(session.user.id);
    if (!cached) return { status: "unauthenticated" };
    profile = cached.profile;
    isAdmin = cached.isAdmin;
  }

  if (isAdmin) {
    return { status: "authenticated", session, profile, isAdmin: true };
  }

  if (profile.status === "rejected") return { status: "rejected", username: profile.username };
  if (profile.status === "pending") return { status: "pending", username: profile.username };

  if (profile.end_date && new Date(profile.end_date) < new Date()) {
    // Best-effort DB update — ignore failure when offline
    try { await supabase.from("profiles").update({ status: "expired" }).eq("id", session.user.id); } catch {}
    return { status: "expired", username: profile.username, profile };
  }
  if (profile.status === "expired") {
    return { status: "expired", username: profile.username, profile };
  }

  return { status: "authenticated", session, profile, isAdmin: false };
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

  const refreshProfile = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setStorageScope(null);
      setState({ status: "unauthenticated" });
      return;
    }
    setState(await loadState(session));
  };

  useEffect(() => {
    let disposed = false;
    let revision = 0;

    const syncSession = async (session: Session | null) => {
      const currentRevision = ++revision;

      if (!session) {
        stopCloudSync();
        setStorageScope(null);
        if (!disposed && currentRevision === revision) {
          setState({ status: "unauthenticated" });
        }
        return;
      }

      // Avoid the loading flicker when the same user's session is re-emitted
      // (e.g. mobile WebView resumes after the native file picker closes —
      // Supabase fires SIGNED_IN again, which would otherwise unmount the
      // current page and discard the in-progress file selection / form state).
      const cur = stateRef.current;
      const sameUser =
        (cur.status === "authenticated" && cur.session.user.id === session.user.id) ||
        (cur.status === "expired" && cur.profile.id === session.user.id);
      if (!disposed && currentRevision === revision && !sameUser) {
        // Optimistic hydration: اگر پروفایل این کاربر در کش داریم،
        // مستقیم وضعیت authenticated را نشان بده تا اسپینر
        // «در حال احراز هویت...» ظاهر نشود. loadState در پس‌زمینه
        // اجرا می‌شود و در صورت تغییر، وضعیت را reconcile می‌کند.
        const cached = readProfileCache(session.user.id);
        const usableCache =
          cached &&
          (cached.isAdmin ||
            (cached.profile.status !== "pending" &&
              cached.profile.status !== "rejected" &&
              cached.profile.status !== "expired" &&
              (!cached.profile.end_date ||
                new Date(cached.profile.end_date) >= new Date())));
        if (usableCache) {
          setStorageScope(session.user.id);
          setState({
            status: "authenticated",
            session,
            profile: cached!.profile,
            isAdmin: cached!.isAdmin,
          });
        } else {
          setState({ status: "loading" });
        }
      }

      const nextState = await loadState(session);
      if (!disposed && currentRevision === revision) {
        setState(nextState);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      // SIGNED_IN for the already-authenticated (or pending/expired) user is a
      // no-op on tab focus / mobile resume — Supabase re-emits it after every
      // TOKEN_REFRESHED and window focus. Re-running loadState there causes
      // the "در حال احراز هویت..." flicker the user is complaining about.
      const cur = stateRef.current;
      if (event === "SIGNED_IN" && session) {
        // Any resolved state means we've already loaded this user's profile.
        // A truly new user only arrives after an explicit SIGNED_OUT.
        if (cur.status !== "loading" && cur.status !== "unauthenticated") return;
      }
      void syncSession(session);
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    stopCloudSync();
    await supabase.auth.signOut();
    setStorageScope(null);
    setState({ status: "unauthenticated" });
  };

  return (
    <AuthContext.Provider value={{ state, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
