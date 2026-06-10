import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { checkRequestStatus, setPasswordAfterApproval } from "@/lib/auth.functions";
import { KeyRound, Loader2, Eye, EyeOff, Search, Clock, X, Check } from "lucide-react";
import { PLAN_LABEL } from "@/lib/supabase";

export const Route = createFileRoute("/set-password")({
  validateSearch: (s: Record<string, unknown>) => ({ u: (s.u as string) || "" }),
  head: () => ({ meta: [{ title: "تنظیم رمز عبور | کمالی" }] }),
  component: SetPasswordPage,
});

function SetPasswordPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [username, setUsername] = useState(search.u || "");
  const [checked, setChecked] = useState<null | {
    exists: boolean;
    status?: string;
    password_set?: boolean;
    first_name?: string;
    last_name?: string;
    plan?: string;
  }>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const check = useServerFn(checkRequestStatus);
  const setPass = useServerFn(setPasswordAfterApproval);

  const handleCheck = async () => {
    setError(""); setChecked(null);
    if (!username.trim()) { setError("یوزرنیم را وارد کنید."); return; }
    setLoading(true);
    try {
      const res = await check({ data: { username } });
      setChecked(res as any);
    } catch (e: any) { setError(e?.message || "خطا"); }
    setLoading(false);
  };

  const handleSetPassword = async () => {
    setError("");
    if (password.length < 6) { setError("رمز عبور باید حداقل ۶ کاراکتر باشد."); return; }
    if (password !== confirm) { setError("تکرار رمز عبور صحیح نیست."); return; }
    setLoading(true);
    try {
      await setPass({ data: { username, password } });
      navigate({ to: "/login" });
    } catch (e: any) { setError(e?.message || "خطا"); }
    setLoading(false);
  };

  const canSet = checked?.exists && checked.status === "approved" && !checked.password_set;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-5 flex flex-col items-center gap-2">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary shadow-elegant">
          <KeyRound className="h-6 w-6 text-primary-foreground" />
        </div>
        <div className="text-center">
          <div className="text-lg font-bold kamali-brand">تنظیم رمز عبور</div>
          <div className="text-xs text-muted-foreground">پس از تایید مدیر، رمز خود را تعیین کنید</div>
        </div>
      </div>

      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">یوزرنیم</label>
          <div className="flex gap-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCheck()}
              placeholder="ali123"
              dir="ltr"
              className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={handleCheck}
              disabled={loading}
              className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {checked && !checked.exists && (
          <Alert tone="warn" icon={<X className="h-4 w-4" />}>
            درخواستی با این یوزرنیم پیدا نشد.{" "}
            <Link to="/register" className="font-semibold underline">ثبت‌نام کنید</Link>
          </Alert>
        )}

        {checked?.exists && checked.status === "pending" && (
          <Alert tone="warn" icon={<Clock className="h-4 w-4" />}>
            درخواست شما در انتظار تایید مدیر است. لطفاً بعداً مراجعه کنید.
          </Alert>
        )}
        {checked?.exists && checked.status === "rejected" && (
          <Alert tone="error" icon={<X className="h-4 w-4" />}>
            درخواست شما توسط مدیر رد شده است.
          </Alert>
        )}
        {checked?.exists && checked.status === "approved" && checked.password_set && (
          <Alert tone="ok" icon={<Check className="h-4 w-4" />}>
            رمز عبور قبلاً تنظیم شده.{" "}
            <Link to="/login" className="font-semibold underline">وارد شوید</Link>
          </Alert>
        )}

        {canSet && (
          <>
            <Alert tone="ok" icon={<Check className="h-4 w-4" />}>
              <span>
                خوش‌آمدید <strong>{checked!.first_name} {checked!.last_name}</strong> — پلن:{" "}
                {PLAN_LABEL[checked!.plan as keyof typeof PLAN_LABEL]}
              </span>
            </Alert>

            <PasswordField label="رمز عبور جدید" value={password} onChange={setPassword} show={showPass} toggle={() => setShowPass(v => !v)} />
            <PasswordField label="تکرار رمز عبور" value={confirm} onChange={setConfirm} show={showPass} toggle={() => setShowPass(v => !v)} />

            {error && (
              <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</div>
            )}

            <button
              onClick={handleSetPassword}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              تنظیم رمز و ایجاد حساب
            </button>
          </>
        )}

        {!checked && error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/login" className="font-semibold text-primary hover:underline">بازگشت به ورود</Link>
        </p>
      </div>
    </div>
  );
}

function PasswordField({
  label, value, onChange, show, toggle,
}: { label: string; value: string; onChange: (v: string) => void; show: boolean; toggle: () => void }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          dir="ltr"
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 pl-10 text-sm outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={toggle}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Alert({ tone, icon, children }: { tone: "warn" | "error" | "ok"; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = {
    warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    error: "bg-destructive/10 text-destructive",
    ok: "bg-green-500/10 text-green-700 dark:text-green-400",
  }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${cls}`}>
      <span className="mt-0.5">{icon}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
