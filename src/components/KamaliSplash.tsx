/**
 * KamaliSplash.tsx
 * انیمیشن ورود برند کمالی — نمایش یک‌بار در اولین بارگذاری هر session
 */
import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";

const SESSION_KEY = "kamali.splash.shown";

export function KamaliSplash() {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // نمایش فقط یک‌بار در هر session مرورگر
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, "1");
    setVisible(true);

    const exitTimer = setTimeout(() => setExiting(true), 1800);
    const hideTimer = setTimeout(() => setVisible(false), 2350);
    return () => { clearTimeout(exitTimer); clearTimeout(hideTimer); };
  }, []);

  if (!visible) return null;

  return (
    <div className={`kamali-splash${exiting ? " splash-exit" : ""}`} aria-hidden="true">
      <div className="kamali-splash-logo">
        <Receipt className="h-9 w-9 text-primary-foreground" />
      </div>
      <div className="kamali-splash-title">کمالی حسابداری</div>
      <div className="kamali-splash-subtitle">مدیریت فروش، انبار و حساب‌ها</div>
    </div>
  );
}
