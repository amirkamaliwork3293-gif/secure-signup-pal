import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { requestPasswordOtp, verifyPasswordOtp, resetPasswordWithOtp } from "@/lib/sms.functions";
import { Receipt, Loader2, Eye, EyeOff, ArrowRight, CheckCircle2 } from "lucide-react";

const INPUT = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "بازیابی رمز عبور | KAMIX" }] }),
  component: ForgotPasswordPage,
});

type Step = "username" | "code" | "password" | "done";

function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("username");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [hint, setHint] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const sendCode = useServerFn(requestPasswordOtp);
  const verifyCode = useServerFn(verifyPasswordOtp);
  const setNewPassword = useServerFn(resetPasswordWithOtp);

  const run = async (fn: () => Promise<void>) => {
    setError("");
    setLoading(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || "خطایی رخ داد. دوباره تلاش کنید.");
    }
    setLoading(false);
  };

  const handleSendCode = () =>
    run(async () => {
      const u = username.trim();
      if (!u) throw new Error("یوزرنیم را وارد کنید.");
      const res = await sendCode({ data: { username: u } });
      setHint(res.phone_hint);
      setCode("");
      setStep("code");
    });

  const handleVerify = () =>
    run(async () => {
      if (!/^\d{4}$/.test(code.trim())) throw new Error("کد تایید باید ۴ رقم باشد.");
      const res = await verifyCode({ data: { username: username.trim(), code: code.trim() } });
      setToken(res.reset_token);
      setStep("password");
    });

  const handleReset = () =>
    run(async () => {
      if (password.length < 6) throw new Error("رمز عبور باید حداقل ۶ کاراکتر باشد.");
      if (password !== password2) throw new Error("رمز عبور و تکرار آن یکسان نیستند.");
      await setNewPassword({ data: { username: username.trim(), reset_token: token, new_password: password } });
      setStep("done");
    });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-primary shadow-elegant">
          <Receipt className="h-7 w-7 text-primary-foreground" />
        </div>
        <div className="text-center">
          <div className="text-xl font-bold kamali-brand">بازیابی رمز عبور</div>
          <div className="text-xs text-muted-foreground">کد تایید به موبایل ثبت‌شده پیامک می‌شود</div>
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-card">
        {step === "username" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">یوزرنیم</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                placeholder="مثال: ali123"
                dir="ltr"
                autoComplete="username"
                className={INPUT}
              />
            </div>
            <Err error={error} />
            <Submit loading={loading} onClick={handleSendCode} label="ارسال کد تایید" />
          </div>
        )}

        {step === "code" && (
          <div className="space-y-3">
            <div className="rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
              کد ۴ رقمی به شماره <span dir="ltr" className="font-medium text-foreground">{hint}</span> فرستاده شد.
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">کد تایید</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                placeholder="- - - -"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                className={`${INPUT} text-center text-lg tracking-[0.5em]`}
              />
            </div>
            <Err error={error} />
            <Submit loading={loading} onClick={handleVerify} label="تایید کد" />
            <button
              onClick={() => { setStep("username"); setError(""); }}
              className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              تغییر یوزرنیم یا ارسال دوباره
            </button>
          </div>
        )}

        {step === "password" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">رمز عبور جدید</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="حداقل ۶ کاراکتر"
                  dir="ltr"
                  autoComplete="new-password"
                  className={`${INPUT} pl-10`}
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
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">تکرار رمز عبور</label>
              <input
                type={showPass ? "text" : "password"}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleReset()}
                dir="ltr"
                autoComplete="new-password"
                className={INPUT}
              />
            </div>
            <Err error={error} />
            <Submit loading={loading} onClick={handleReset} label="ثبت رمز جدید" />
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-green-500/10">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <div className="text-sm font-medium">رمز عبور شما با موفقیت تغییر کرد.</div>
            <button
              onClick={() => navigate({ to: "/login" })}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
            >
              ورود به سیستم
            </button>
          </div>
        )}

        {step !== "done" && (
          <div className="mt-5 text-center text-xs text-muted-foreground">
            <Link to="/login" className="font-semibold text-primary hover:underline">
              بازگشت به صفحه ورود
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Err({ error }: { error: string }) {
  if (!error) return null;
  return <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</div>;
}

function Submit({ loading, onClick, label }: { loading: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {label}
    </button>
  );
}
