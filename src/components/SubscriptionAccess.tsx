import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/AuthContext";
import { isSubscriptionReadOnly, WRITE_BLOCKED_EVENT } from "@/lib/subscription-access";
import { setBusinessWritesBlocked } from "@/lib/store";
import { RenewRequiredDialog } from "@/components/RenewRequiredDialog";

type Ctx = {
  readOnly: boolean;
  requireActive: () => boolean;
  openRenew: () => void;
};

const SubscriptionAccessContext = createContext<Ctx | null>(null);

export function useSubscriptionAccess(): Ctx {
  const ctx = useContext(SubscriptionAccessContext);
  if (ctx) return ctx;
  return {
    readOnly: false,
    requireActive: () => true,
    openRenew: () => {},
  };
}

export function SubscriptionAccessProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const readOnly = isSubscriptionReadOnly(state);
  const [renewOpen, setRenewOpen] = useState(false);

  useEffect(() => {
    setBusinessWritesBlocked(readOnly);
    return () => setBusinessWritesBlocked(false);
  }, [readOnly]);

  useEffect(() => {
    const onBlocked = () => setRenewOpen(true);
    window.addEventListener(WRITE_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(WRITE_BLOCKED_EVENT, onBlocked);
  }, []);

  const openRenew = useCallback(() => setRenewOpen(true), []);
  const requireActive = useCallback(() => {
    if (!readOnly) return true;
    setRenewOpen(true);
    return false;
  }, [readOnly]);

  const value = useMemo(
    () => ({ readOnly, requireActive, openRenew }),
    [readOnly, requireActive, openRenew],
  );

  return (
    <SubscriptionAccessContext.Provider value={value}>
      {children}
      {renewOpen && <RenewRequiredDialog onClose={() => setRenewOpen(false)} />}
    </SubscriptionAccessContext.Provider>
  );
}
