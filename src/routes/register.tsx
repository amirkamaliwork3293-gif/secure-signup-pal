import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase, PLAN_LABEL, PLAN_DURATION_LABEL, type SubscriptionPlan } from "@/lib/supabase";
import { submitSignupRequest, createTrialAccount, getPublicSettings } from "@/lib/auth.functions";
import { createReceiptUploadUrl } from "@/lib/receipts.functions";
import { effectivePrice, isDiscountActive, DEFAULT_PLANS, type PlansConfig } from "@/lib/plans";
import { ApkDownloadButton } from "@/components/ApkDownloadButton";
import { Receipt, Loader2, Copy, Check, CreditCard, ArrowRight, Upload, X, Clock, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "ثبت‌نام | کمالی حسابداری" }] }),
  component: RegisterPage,
});

const ALL_PLANS: SubscriptionPlan[] = ["trial", "1month", "3month", "6month", "12month"];
const TRIAL_DEVICE_KEY = "kamali.trial.used.v1";

function formatToman(n: number) {
  return new Intl.NumberFormat("fa-IR").format(n) + " تومان";
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} روز و ${h} ساعت`;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function isValidIranPhone(p: string): boolean {
  const v = p.replace(/\s+/g, "").replace(/^\+98/, "0").replace(/^98/, "0");
  return /^09\d{9}$/.test(v);
}

function RegisterPage() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [usernameField, setUsernameField] = useState("");
  const [phone, setPhone] = useState("");
  const [plan, setPlan] = useState<SubscriptionPlan>("1month");
  const [paid, setPaid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const submit = useServerFn(submitSignupRequest);
  const trial = useServerFn(createTrialAccount);
  const signReceiptUpload = useServerFn(createReceiptUploadUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const isTrial = plan === "trial";
  const trialAlreadyUsed = typeof window !== "undefined" && !!localStorage.getItem(TRIAL_DEVICE_KEY);

  const [card, setCard] = useState({
    card_number: "",
    card_holder: "",
    bank_name: "",
  });
  const [plansCfg, setPlansCfg] = useState<PlansConfig>(DEFAULT_PLANS);
  const [now, setNow] = useState(Date.now());

  // Live ticker for discount countdowns
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    getPublicSettings()
      .then((data) => {
        setCard({
          card_number: data.card_number || "",
          card_holder: data.card_holder || "",
          bank_name: data.bank_name || "",
        });
        setPlansCfg(data.plans);
      })
      .catch(() => {
        /* leave defaults */
      });
  }, []);

  // Only show enabled plans; auto-pick a sensible default if current pick was disabled
  const visiblePlans = ALL_PLANS.filter((p) => plansCfg[p]?.enabled);
  useEffect(() => {
    if (visiblePlans.length > 0 && !visiblePlans.includes(plan)) {
      setPlan(visiblePlans.find((p) => p !== "trial") ?? visiblePlans[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plansCfg]);

  const copyCard = async () => {
    await navigator.clipboard.writeText(card.card_number.replace(/[^0-9]/g, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onPickFile = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("فقط فایل عکس مجاز است."); return; }
    if (f.size > 5 * 1024 * 1024) { setError("حجم عکس نباید بیشتر از ۵ مگابایت باشد."); return; }
    setError("");
    setReceiptFile(f);
    setReceiptPreview(URL.createObjectURL(f));
  };

  const handleTrial = async () => {
    setError("");
    if (trialAlreadyUsed) { setError("نسخه تست قبلاً روی این دستگاه استفاده شده است."); return; }
    if (!firstName.trim() || !lastName.trim()) { setError("نام و نام خانوادگی الزامی است."); return; }
    if (!usernameField.trim()) { setError("یوزرنیم الزامی است."); return; }
    if (!isValidIranPhone(phone)) { setError("شماره موبایل معتبر وارد کنید (مثل 09xxxxxxxxx)."); return; }
    if (password.length < 6) { setError("رمز عبور باید حداقل ۶ کاراکتر باشد."); return; }
    if (password !== password2) { setError("تکرار رمز عبور مطابقت ندارد."); return; }
    setLoading(true);
    try {
      const { email } = await trial({
        data: {
          first_name: firstName,
          last_name: lastName,
          username: usernameField,
          password,
        },
      });
      try { localStorage.setItem(TRIAL_DEVICE_KEY, new Date().toISOString()); } catch {}
      // Auto sign-in
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signErr) throw new Error(signErr.message);
      navigate({ to: "/" });
    } catch (e: any) {
      setError(e?.message || "خطا در فعال‌سازی نسخه تست.");
    }
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (isTrial) return handleTrial();
    setError("");
    if (!firstName.trim() || !lastName.trim()) { setError("نام و نام خانوادگی الزامی است."); return; }
    if (!usernameField.trim()) { setError("یوزرنیم الزامی است."); return; }
    if (!isValidIranPhone(phone)) { setError("شماره موبایل معتبر وارد کنید (مثل 09xxxxxxxxx)."); return; }
    if (password.length < 6) { setError("رمز عبور باید حداقل ۶ کاراکتر باشد."); return; }
    if (password !== password2) { setError("تکرار رمز عبور مطابقت ندارد."); return; }
    if (!receiptFile) { setError("لطفاً عکس رسید پرداخت را آپلود کنید."); return; }
    if (!paid) { setError("لطفاً تایید کنید که پرداخت انجام شده است."); return; }
    setLoading(true);
    try {
      setUploading(true);
      const rawExt = (receiptFile.name.split(".").pop() || "jpg").toLowerCase();
      const ext = (/^(jpg|jpeg|png|webp|heic|heif)$/.test(rawExt) ? rawExt : "jpg") as
        "jpg" | "jpeg" | "png" | "webp" | "heic" | "heif";
      const { path, token } = await signReceiptUpload({
        data: { username: usernameField, ext, kind: "signup" },
      });
      const { error: upErr } = await supabase.storage
        .from("receipts")
        .uploadToSignedUrl(path, token, receiptFile, {
          contentType: receiptFile.type,
          upsert: false,
        });
      setUploading(false);
      if (upErr) throw new Error("خطا در آپلود رسید: " + upErr.message);

      await submit({
        data: {
          first_name: firstName,
          last_name: lastName,
          username: usernameField,
          password,
          plan,
          payment_confirmed: paid,
          receipt_url: path,
          phone: phone.trim() || undefined,
        },
      });
      setSuccess(true);
    } catch (e: any) {
      setError(e?.message || "خطا در ارسال درخواست.");
    }
    setLoading(false);
  };

  if (success) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-card">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-green-500/10">
            <Check className="h-7 w-7 text-green-600" />
          </div>
          <h1 className="text-lg font-bold">ثبت‌نام شما انجام شد</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            حساب شما با یوزرنیم{" "}
            <strong dir="ltr" className="inline-block">{usernameField.toLowerCase()}</strong>{" "}
            ساخته شد و در انتظار تایید مدیر است.
            <br />
            به‌محض تایید، با همین یوزرنیم و رمز عبوری که انتخاب کردید وارد شوید — بدون هیچ مرحله اضافه.
          </p>
          <Link
            to="/login"
            className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            رفتن به صفحه ورود
            <ArrowRight className="h-4 w-4 rotate-180" />
          </Link>
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-xs text-muted-foreground">
              اکنون می‌توانید اپلیکیشن اندروید را دانلود و نصب کنید:
            </p>
            <ApkDownloadButton className="w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <div className="mb-5 flex flex-col items-center gap-2">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary shadow-elegant">
          <Receipt className="h-6 w-6 text-primary-foreground" />
        </div>
        <div className="text-center">
          <div className="text-lg font-bold kamali-brand">ثبت‌نام در کمالی</div>
          <div className="text-xs text-muted-foreground">فرم زیر را تکمیل و واریز را انجام دهید</div>
        </div>
      </div>

      <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="grid grid-cols-2 gap-3">
          <Field label="نام" value={firstName} onChange={setFirstName} placeholder="مثال: علی" />
          <Field label="نام خانوادگی" value={lastName} onChange={setLastName} placeholder="مثال: محمدی" />
        </div>

        <Field
          label="یوزرنیم (انگلیسی)"
          value={usernameField}
          onChange={setUsernameField}
          placeholder="ali123"
          dir="ltr"
        />

        <Field
          label="شماره موبایل"
          value={phone}
          onChange={setPhone}
          placeholder="09xxxxxxxxx"
          dir="ltr"
        />

        {/* انتخاب رمز عبور همان ابتدا — پس از تایید مدیر، ورود فوری */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">رمز عبور</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              dir="ltr"
              autoComplete="new-password"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">تکرار رمز</label>
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              dir="ltr"
              autoComplete="new-password"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">پلن اشتراک</label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {visiblePlans.map((p) => {
              const isTrialBtn = p === "trial";
              const cfg = plansCfg[p];
              const original = cfg.price;
              const final = effectivePrice(cfg, now);
              const discounted = isDiscountActive(cfg, now);
              const remainingMs = cfg.discount_until ? new Date(cfg.discount_until).getTime() - now : Infinity;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlan(p)}
                  className={`relative flex flex-col items-center gap-1 rounded-xl border p-2.5 text-xs transition ${
                    plan === p
                      ? isTrialBtn
                        ? "border-amber-500 bg-amber-500/10 text-foreground"
                        : "border-primary bg-primary/5 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {discounted && !isTrialBtn && (
                    <span className="absolute -top-2 -right-2 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                      {cfg.discount_percent}%
                    </span>
                  )}
                  <span className="font-semibold">{isTrialBtn ? "تست رایگان" : PLAN_LABEL[p]}</span>
                  <span className="text-[10px] opacity-80">{PLAN_DURATION_LABEL[p]}</span>
                  {isTrialBtn ? (
                    <span className="text-[10px] font-medium text-amber-600">رایگان</span>
                  ) : discounted ? (
                    <span className="flex flex-col items-center leading-tight">
                      <span className="text-[10px] text-muted-foreground line-through">{formatToman(original)}</span>
                      <span className="text-[10px] font-bold text-rose-600">{formatToman(final)}</span>
                      {isFinite(remainingMs) && remainingMs > 0 && (
                        <span dir="ltr" className="mt-0.5 text-[9px] text-rose-600/80">⏳ {formatRemaining(remainingMs)}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-primary">{formatToman(original)}</span>
                  )}
                </button>
              );
            })}
          </div>
          {visiblePlans.length === 0 && (
            <div className="mt-2 rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              در حال حاضر هیچ پلنی برای ثبت‌نام فعال نیست.
            </div>
          )}
        </div>

        {isTrial ? (
          <>
            {/* Trial notice */}
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4" />
                نسخه تست — فقط ۱ ساعت
              </div>
              <p className="text-xs leading-6">
                این پلن فقط <strong>یک ساعت</strong> برای آشنایی با محیط برنامه در اختیار شماست.
                پس از پایان این یک ساعت، حساب کاربری و تمام اطلاعات ذخیره‌شده شما (محصولات، فاکتورها، تنظیمات و…) به‌طور کامل پاک می‌شود.
                لطفاً برای استفاده دائمی، یکی از پلن‌های پرداختی را انتخاب کنید.
              </p>
              {trialAlreadyUsed && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  نسخه تست قبلاً روی این دستگاه استفاده شده است.
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Card display */}
            <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
                <CreditCard className="h-4 w-4" />
                شماره کارت جهت واریز
              </div>
              <div className="flex items-center justify-between gap-2">
                <div dir="ltr" className="text-lg font-bold tracking-wider text-foreground">
                  {card.card_number || "—"}
                </div>
                <button
                  type="button"
                  onClick={copyCard}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-background hover:bg-accent"
                  title="کپی"
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              {(card.card_holder || card.bank_name) && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {card.card_holder && <span>به نام {card.card_holder}</span>}
                  {card.card_holder && card.bank_name && <span> — </span>}
                  {card.bank_name && <span>{card.bank_name}</span>}
                </div>
              )}
            </div>

            {/* Receipt upload */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                عکس رسید پرداخت <span className="text-destructive">*</span>
              </label>
              {receiptPreview ? (
                <div className="relative rounded-xl border border-border bg-background p-2">
                  <img src={receiptPreview} alt="رسید" className="mx-auto max-h-48 rounded-lg object-contain" />
                  <button
                    type="button"
                    onClick={() => { setReceiptFile(null); setReceiptPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                    className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-background/90 text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-background py-6 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <Upload className="h-5 w-5" />
                  <span>برای انتخاب عکس رسید کلیک کنید</span>
                  <span className="text-[10px] opacity-70">(JPG / PNG — حداکثر ۵ مگابایت)</span>
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={paid}
                onChange={(e) => setPaid(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span>پرداخت را انجام دادم ✅</span>
            </label>
          </>
        )}

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || (isTrial && trialAlreadyUsed)}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60 ${
            isTrial ? "bg-amber-600 hover:bg-amber-700" : "bg-primary"
          }`}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {uploading ? "در حال آپلود رسید..." : isTrial ? "شروع نسخه تست ۱ ساعته" : "ثبت درخواست"}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          حساب دارید؟{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            وارد شوید
          </Link>
        </p>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, dir,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; dir?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        dir={dir}
        className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
      />
    </div>
  );
}
