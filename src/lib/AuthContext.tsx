/**
 * AuthContext — session + profile + subscription expiry awareness.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type UserProfile } from "@/lib/supabase";
import { setStorageScope, hydrateFromCloud, stopCloudSync } from "@/lib/store";
import { isCapacitor } from "@/lib/isWebView";
import { isCapacitorOfflineReadOnly } from "@/lib/online-status";
import { clearUserOfflineCache } from "@/lib/offline-cache";
import {
  classifyUserAccess,
  pickProfileForSession,
  shouldKeepExistingSession,
  shouldSyncOnAuthEvent,
} from "@/lib/auth-session";

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "expired"; username: string; profile: UserProfile; session: Session }
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

async function loadState(session: Session): Promise<AuthState> {
  setStorageScope(session.user.id);

  // hydrateFromCloud fails when offline — that's fine, local data is source of truth
  try {
    await hydrateFromCloud(session.user.id);
  } catch {}

  let live: UserProfile | null = null;
  let liveIsAdmin = false;

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
        liveIsAdmin = !roleErr && !!roleRow;
      } catch {
        liveIsAdmin = false;
      }
      saveProfileCache(session.user.id, live, liveIsAdmin);
    }
  } catch {
    // شبکه/RLS — پایین‌تر از کش استفاده می‌شود. JWT معتبر را دور نمی‌اندازیم.
  }

  const picked = pickProfileForSession({
    session: session.user,
    live,
    liveIsAdmin,
    cached: readProfileCache(session.user.id),
  });
  return toAuthState(session, picked.profile, picked.isAdmin);
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

  const refreshProfile = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setStorageScope(null);
      setState({ status: "unauthenticated" });
      return;
    }
    const next = await loadState(session);
    if (shouldKeepExistingSession(next.status, stateRef.current.status, true)) {
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
        const prev = stateRef.current;
        const prevId =
          prev.status === "authenticated" || prev.status === "expired"
            ? prev.session.user.id
            : null;
        stopCloudSync();
        if (isCapacitor() && prevId) clearUserOfflineCache(prevId);
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
        (cur.status === "expired" && cur.session.user.id === session.user.id) ||
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

      const nextState = await loadState(session);
      if (!disposed && currentRevision === revision) {
        if (shouldKeepExistingSession(nextState.status, stateRef.current.status, true)) {
          return;
        }
        setState(nextState);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const cur = stateRef.current;
      if (!shouldSyncOnAuthEvent(event, cur.status)) return;
      void syncSession(session);
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    const prev = stateRef.current;
    const prevId =
      prev.status === "authenticated" || prev.status === "expired" ? prev.session.user.id : null;
    stopCloudSync();
    await supabase.auth.signOut();
    if (isCapacitor() && prevId) clearUserOfflineCache(prevId);
    setStorageScope(null);
    setState({ status: "unauthenticated" });
  };

  return (
    <AuthContext.Provider value={{ state, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
