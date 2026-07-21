import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase";
import { verifyAdminLogin } from "@/lib/auth.functions";
import { LoginHelpDialog } from "@/components/LoginHelpDialog";
import { Receipt, Eye, EyeOff, Loader2, ShieldCheck, User, Smartphone } from "lucide-react";

const LOGIN_URL = "https://secure-signup-pal.lovable.app/login";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "ورود به KAMIX (کامیکس) — حسابداری فروشگاهی" },
      { name: "description", content: "وارد حساب KAMIX (کامیکس) شوید. سیستم حسابداری، فاکتور و انبار موبایل با اسکن بارکد." },
      { property: "og:url", content: LOGIN_URL },
      { property: "og:title", content: "ورود به KAMIX (کامیکس)" },
      { property: "og:description", content: "وارد حساب KAMIX (کامیکس) شوید. سیستم حسابداری، فاکتور و انبار موبایل." },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: LOGIN_URL }],
  }),
  component: LoginPage,
});

function toEmail(username: string) {
  return `${username.trim().toLowerCase()}@kamali.local`;
}

export function LoginPage() {
  const [tab, setTab] = useState<"user" | "admin">("user");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const adminLogin = useServerFn(verifyAdminLogin);

  const handleSubmit = async () => {
    setError("");
    const u = username.trim();
    if (!u || !password) { setError("یوزرنیم و رمز عبور را وارد کنید."); return; }

    setLoading(true);

    if (tab === "admin") {
      try {
        const { email } = await adminLogin({ data: { username: u, password } });
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) { setError(err.message); setLoading(false); return; }
        navigate({ to: "/admin" });
      } catch (e: any) {
        setError(e?.message || "یوزرنیم یا رمز عبور ادمین اشتباه است.");
      }
      setLoading(false);
      return;
    }

    // Regular user login
    const { error: err } = await supabase.auth.signInWithPassword({
      email: toEmail(u),
      password,
    });
    if (err) {
      setError(
        err.message.includes("Invalid login")
          ? "یوزرنیم یا رمز عبور اشتباه است."
          : err.message,
      );
    } else {
      navigate({ to: "/" });
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-primary shadow-elegant">
          <Receipt className="h-7 w-7 text-primary-foreground" />
        </div>
        <div className="text-center">
          <div className="text-xl font-bold kamali-brand">KAMIX</div>
          <div className="text-xs text-muted-foreground">مدیریت فروش، انبار و حساب‌ها</div>
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-card">
        {/* Tabs */}
        <div className="mb-5 flex rounded-xl bg-muted p-1">
          {([
            { id: "user", label: "ورود کاربر", icon: User },
            { id: "admin", label: "ورود ادمین", icon: ShieldCheck },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setTab(id); setError(""); }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors ${
                tab === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">یوزرنیم</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder={tab === "admin" ? "Amirkamali" : "مثال: ali123"}
              dir="ltr"
              autoComplete="username"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">رمز عبور</label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="••••••••"
                dir="ltr"
                autoComplete="current-password"
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 pl-10 text-sm outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            ورود به سیستم
          </button>
        </div>

        {tab === "user" && (
          <div className="mt-5 space-y-2 text-center text-xs">
            <div className="text-muted-foreground">
              حساب ندارید؟{" "}
              <Link to="/register" className="font-semibold text-primary hover:underline">
                ثبت‌نام کنید
              </Link>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 w-full max-w-sm rounded-2xl border border-primary/30 bg-primary/5 p-4 text-center">
        <div className="mb-1.5 flex items-center justify-center gap-2">
          <Smartphone className="h-5 w-5 text-primary" />
          <p className="text-sm font-bold text-foreground">
            لینک دانلود اپلیکیشن اندروید
          </p>
        </div>
        <p className="text-[11px] leading-6 text-muted-foreground">
          بعد از تکمیل ثبت‌نام، لینک دانلود اپلیکیشن اندروید (APK) به همراه راهنمای تصویری نصب برای شما نمایش داده می‌شود.
        </p>
      </div>

      <LoginHelpDialog />
    </div>
  );
}
