/**
 * AuthContext — session + profile + subscription expiry awareness.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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

async function loadState(session: Session): Promise<AuthState> {
  setStorageScope(session.user.id);
  await hydrateFromCloud(session.user.id);

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();

  if (!profile) return { status: "unauthenticated" };

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", session.user.id)
    .eq("role", "admin")
    .maybeSingle();
  const isAdmin = !!roleRow;

  // Admins always authenticated regardless of subscription
  if (isAdmin) {
    return { status: "authenticated", session, profile: profile as UserProfile, isAdmin: true };
  }

  if (profile.status === "rejected") return { status: "rejected", username: profile.username };
  if (profile.status === "pending") return { status: "pending", username: profile.username };

  // Check expiry
  if (profile.end_date && new Date(profile.end_date) < new Date()) {
    // Mark expired in DB (best-effort)
    await supabase.from("profiles").update({ status: "expired" }).eq("id", session.user.id);
    return { status: "expired", username: profile.username, profile: profile as UserProfile };
  }
  if (profile.status === "expired") {
    return { status: "expired", username: profile.username, profile: profile as UserProfile };
  }

  return { status: "authenticated", session, profile: profile as UserProfile, isAdmin: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

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

      if (!disposed && currentRevision === revision) {
        setState({ status: "loading" });
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
