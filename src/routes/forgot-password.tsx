import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitPasswordResetRequest } from "@/lib/auth.functions";
import { ArrowRight, KeyRound, Loader2, Receipt, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "بازیابی رمز عبور | KAMIX" },
      { name: "description", content: "درخواست بازیابی رمز عبور حساب KAMIX." },
    ],
  }),
  component: ForgotPasswordPage,
});

function isValidIranPhone(p: string): boolean {
  const v = p.replace(/\s+/g, "").replace(/^\+98/, "0").replace(/^98/, "0");
  return /^09\d{9}$/.test(v);
}

function ForgotPasswordPage() {
  const submit = useServerFn(submitPasswordResetRequest);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    setError("");
    if (!firstName.trim() || !lastName.trim()) {
      setError("نام و نام خانوادگی را وارد کنید.");
      return;
    }
    if (!isValidIranPhone(phone)) {
      setError("شماره موبایل را به‌صورت ۰۹xxxxxxxxx وارد کنید.");
      return;
    }
    setLoading(true);
    try {
      await submit({
        data: { first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim() },
      });
      setDone(true);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || "ارسال درخواست ناموفق بود.");
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
          <div className="text-xs text-muted-foreground">بازیابی رمز عبور</div>
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-card">
        {done ? (
          <div className="space-y-3 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-green-500/10 text-green-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h1 className="text-base font-bold">درخواست ثبت شد</h1>
            <p className="text-xs leading-6 text-muted-foreground">
              درخواست بازیابی رمز عبور شما برای مدیر ارسال شد. پس از بررسی اطلاعات (نام، نام خانوادگی و شماره تلفن ثبت‌نام)، رمز جدید برایتان تنظیم می‌شود. لطفاً کمی بعد دوباره برای ورود تلاش کنید.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              بازگشت به ورود
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="mb-1 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <h1 className="text-sm font-bold">درخواست بازیابی رمز عبور</h1>
            </div>
            <p className="text-[11px] leading-5 text-muted-foreground">
              همان نام، نام خانوادگی و شماره موبایلی را وارد کنید که هنگام ثبت‌نام استفاده کرده‌اید. مدیر پس از تطبیق اطلاعات، رمز را بازیابی می‌کند.
            </p>
            <Field label="نام" value={firstName} onChange={setFirstName} placeholder="مثال: علی" />
            <Field label="نام خانوادگی" value={lastName} onChange={setLastName} placeholder="مثال: محمدی" />
            <Field
              label="شماره موبایل ثبت‌نام"
              value={phone}
              onChange={setPhone}
              placeholder="0912xxxxxxx"
              dir="ltr"
            />
            {error && (
              <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</div>
            )}
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              ارسال درخواست
            </button>
            <Link
              to="/login"
              className="flex items-center justify-center gap-1 pt-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              بازگشت به ورود
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  dir?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        placeholder={placeholder}
        dir={dir}
        className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
      />
    </div>
  );
}
