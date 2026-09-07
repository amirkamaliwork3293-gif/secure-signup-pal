import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase, PLAN_LABEL, PLAN_DURATION_LABEL, type SubscriptionPlan } from "@/lib/supabase";
import { submitSignupRequest, getPublicSettings } from "@/lib/auth.functions";
import { createReceiptUploadUrl, receiptNote } from "@/lib/receipts.functions";
import { effectivePrice, isDiscountActive, DEFAULT_PLANS, type PlansConfig } from "@/lib/plans";
import { ApkDownloadButton } from "@/components/ApkDownloadButton";
import { JalaliDateSelect, TimeSelect } from "@/components/JalaliPickers";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { toJalaliInputDate, toJalaliInputTime } from "@/lib/store";
import { markPendingOnboarding } from "@/lib/onboarding";
import {
  clientTurnstileSiteKey,
  turnstileMissingTokenError,
  type TurnstileWidgetStatus,
} from "@/lib/turnstile";
import { formatCardNumberDisplay } from "@/lib/iran-banks";
import { resolveCardTheme } from "@/lib/card-theme";
import {
  Loader2,
  Copy,
  Check,
  ArrowRight,
  Upload,
  X,
  Eye,
  EyeOff,
  KeyRound,
  Smartphone,
  Mic,
  ScanLine,
  Package,
  BarChart3,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const REGISTER_URL = "https://kamixapp.ir/register";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "ثبت‌نام KAMIX (کامیکس) — حسابداری فروشگاهی رایگان" },
      {
        name: "description",
        content:
          "در KAMIX (کامیکس) ثبت‌نام کنید: حسابداری فروشگاهی، صدور فاکتور، انبار و اسکن بارکد روی موبایل. پس از ثبت‌نام، APK اندروید را دریافت کنید.",
      },
      {
        name: "keywords",
        content: "ثبت‌نام کامیکس, حسابداری کامیکس, اپلیکیشن حسابداری اندروید, فاکتور موبایل",
      },
      { property: "og:url", content: REGISTER_URL },
      { property: "og:title", content: "ثبت‌نام KAMIX (کامیکس) — حسابداری فروشگاهی رایگان" },
      {
        property: "og:description",
        content:
          "در KAMIX (کامیکس) ثبت‌نام کنید: حسابداری فروشگاهی، صدور فاکتور، انبار و اسکن بارکد روی موبایل.",
      },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: REGISTER_URL }],
  }),
  headers: () => ({
    "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    Vary: "Accept, Accept-Encoding",
  }),
  component: RegisterPage,
});

const ALL_PLANS: SubscriptionPlan[] = ["1month", "3month", "6month", "12month"];

const PLAN_MONTHS: Record<Exclude<SubscriptionPlan, "trial">, number> = {
  "1month": 1,
  "3month": 3,
  "6month": 6,
  "12month": 12,
};

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
  if (h > 0)
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function isValidIranPhone(p: string): boolean {
  const v = p.replace(/\s+/g, "").replace(/^\+98/, "0").replace(/^98/, "0");
  return /^09\d{9}$/.test(v);
}

function planSavings(p: SubscriptionPlan, cfg: PlansConfig, now: number): number {
  if (p === "trial" || p === "1month") return 0;
  const monthly = cfg["1month"];
  if (!monthly?.enabled) return 0;
  const months = PLAN_MONTHS[p];
  const full = effectivePrice(monthly, now) * months;
  return Math.max(0, full - effectivePrice(cfg[p], now));
}

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message?: unknown }).message || "");
  }
  return "";
}

function CredentialsHint({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="flex items-start gap-1.5 text-[11px] leading-5 text-destructive">
      <KeyRound className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function RegisterPage() {
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
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const submit = useServerFn(submitSignupRequest);
  const signReceiptUpload = useServerFn(createReceiptUploadUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // جایگزین متنی رسید — برای کاربرانی که نمی‌توانند/نمی‌خواهند عکس آپلود کنند
  const [receiptRef, setReceiptRef] = useState("");
  const [receiptDate, setReceiptDate] = useState(() => toJalaliInputDate(Date.now()));
  const [receiptTime, setReceiptTime] = useState(() => toJalaliInputTime(Date.now()));
  const [honeypot, setHoneypot] = useState("");
  const formStartedAt = useRef(Date.now());
  const [turnstileSiteKey, setTurnstileSiteKey] = useState(() => clientTurnstileSiteKey());
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [turnstileStatus, setTurnstileStatus] = useState<TurnstileWidgetStatus>("loading");

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
        if (data.turnstile_site_key) setTurnstileSiteKey(data.turnstile_site_key);
      })
      .catch(() => {
        /* leave defaults */
      });
  }, []);

  // Only show enabled plans; auto-pick a sensible default if current pick was disabled
  const visiblePlans = ALL_PLANS.filter((p) => plansCfg[p]?.enabled);
  useEffect(() => {
    if (visiblePlans.length > 0 && !visiblePlans.includes(plan)) {
      setPlan(visiblePlans[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plansCfg]);

  const copyCard = async () => {
    await navigator.clipboard.writeText(card.card_number.replace(/[^0-9]/g, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // عکس رسید همان لحظه‌ی انتخاب فشرده می‌شود (حداکثر ۱۶۰۰ پیکسل، کیفیت ۰٫۸۵ —
  // متن و مبلغ رسید کاملاً خوانا می‌ماند ولی حجم آپلود چند برابر کمتر می‌شود).
  // اگر فایل با فرمتی باشد که مرورگر نتواند فشرده کند (مثلاً HEIC آیفون) و از سقف
  // رد شود، کاربر پیام فارسی می‌گیرد و می‌تواند از کادر متنی جایگزین استفاده کند.
  const onPickFile = async (f: File | null) => {
    if (!f) return;
    setError("");
    try {
      const { prepareImageUpload } = await import("@/lib/imageCompress");
      const prepared = await prepareImageUpload(f, "receipt");
      setReceiptFile(prepared);
      try {
        setReceiptPreview(URL.createObjectURL(prepared));
      } catch {
        // پیش‌نمایش برای بعضی فرمت‌ها ساخته نمی‌شود — فایل همچنان قابل ارسال است.
        setReceiptPreview(null);
      }
    } catch (e: unknown) {
      setReceiptFile(null);
      setReceiptPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      setError(
        (errorMessage(e) || "این فایل قابل استفاده نیست.") +
          " می‌توانید به‌جای عکس، کد پیگیری و تاریخ واریز را در کادر پایین بنویسید.",
      );
    }
  };

  const handleSubmit = async () => {
    setError("");
    if (!firstName.trim() || !lastName.trim()) {
      setError("نام و نام خانوادگی الزامی است.");
      return;
    }
    if (!usernameField.trim()) {
      setError("یوزرنیم الزامی است.");
      return;
    }
    if (!isValidIranPhone(phone)) {
      setError("شماره موبایل معتبر وارد کنید (مثل 09xxxxxxxxx).");
      return;
    }
    if (password.length < 8 || !/[a-zA-Z؀-ۿ]/.test(password) || !/\d/.test(password)) {
      setError("رمز عبور باید حداقل ۸ کاراکتر باشد و هم حرف و هم عدد داشته باشد.");
      return;
    }
    if (password !== password2) {
      setError("تکرار رمز عبور مطابقت ندارد.");
      return;
    }
    const note = receiptNote(receiptRef, receiptDate, receiptTime);
    if (!receiptFile && !note) {
      setError(
        "لطفاً عکس رسید پرداخت را آپلود کنید یا کد پیگیری، تاریخ و ساعت دقیق واریز را بنویسید.",
      );
      return;
    }
    if (!paid) {
      setError("لطفاً تایید کنید که پرداخت انجام شده است.");
      return;
    }
    if (turnstileSiteKey && !turnstileToken) {
      setError(turnstileMissingTokenError(turnstileStatus));
      return;
    }
    setLoading(true);
    try {
      let path: string | null = null;
      if (receiptFile) {
        setUploading(true);
        // پسوند واقعی فایل (هر چیزی، نه فقط چند فرمت خاص) — اگر نامعتبر/خالی بود، jpg پیش‌فرض است
        // سرور فقط پسوندهای تصویری را می‌پذیرد (جلوگیری از میزبانی HTML روی
        // دامنه‌ی استوریج). هر پسوند ناشناخته به jpg نگاشت می‌شود تا آپلود
        // کاربران با فایل‌های غیرمعمول شکست نخورد.
        const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"];
        const rawExt = (receiptFile.name.split(".").pop() || "jpg")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const ext = ALLOWED_EXT.includes(rawExt) ? rawExt : "jpg";
        const signed = await signReceiptUpload({
          data: { username: usernameField, ext, kind: "signup" },
        });
        const { error: upErr } = await supabase.storage
          .from("receipts")
          .uploadToSignedUrl(signed.path, signed.token, receiptFile, {
            // نوع محتوا همیشه تصویری تثبیت می‌شود. اگر مرورگر نوع را خالی یا
            // غیرتصویری گزارش کند، image/jpeg جایگزین می‌شود تا هیچ فایلی
            // به‌عنوان HTML از دامنه‌ی استوریج سرو نشود.
            contentType: receiptFile.type?.startsWith("image/") ? receiptFile.type : "image/jpeg",
            upsert: false,
          });
        setUploading(false);
        if (upErr) throw new Error("خطا در آپلود رسید: " + upErr.message);
        path = signed.path;
      }

      await submit({
        data: {
          first_name: firstName,
          last_name: lastName,
          username: usernameField,
          password,
          plan,
          payment_confirmed: paid,
          receipt_url: path,
          receipt_note: note,
          phone: phone.trim() || undefined,
          website: honeypot,
          form_started_at: formStartedAt.current,
          turnstile_token: turnstileToken || undefined,
        },
      });
      markPendingOnboarding(usernameField);
      setSuccess(true);
    } catch (e: unknown) {
      setTurnstileToken("");
      setTurnstileReset((n) => n + 1);
      const raw = errorMessage(e);
      setError(
        /failed to fetch|network|load failed|timeout/i.test(raw)
          ? "ارتباط با سرور برقرار نشد. لطفاً اتصال را چک کنید و دوباره تلاش کنید."
          : raw || "خطا در ارسال درخواست.",
      );
    }
    setLoading(false);
  };

  const selectedCfg = plansCfg[plan];
  const selectedOriginal = selectedCfg?.price ?? 0;
  const selectedPrice = selectedCfg ? effectivePrice(selectedCfg, now) : 0;
  const selectedDiscounted = selectedCfg ? isDiscountActive(selectedCfg, now) : false;
  const recommendedPlan: SubscriptionPlan | null =
    visiblePlans.length === 0
      ? null
      : visiblePlans.reduce(
          (best, p) => {
            const bd = isDiscountActive(plansCfg[best], now) ? plansCfg[best].discount_percent : 0;
            const pd = isDiscountActive(plansCfg[p], now) ? plansCfg[p].discount_percent : 0;
            return pd > bd ? p : best;
          },
          visiblePlans.includes("3month") ? ("3month" as SubscriptionPlan) : visiblePlans[0],
        );
  const cardTheme = resolveCardTheme({
    bankName: card.bank_name,
    cardNumber: card.card_number,
  });
  const passOk = password.length >= 8 && /[a-zA-Z؀-ۿ]/.test(password) && /\d/.test(password);
  const passMatch = password2.length > 0 && password === password2;
  const cardDisplay = formatCardNumberDisplay(card.card_number) || "—";

  if (success) {
    return (
      <div className="register-page">
        <span className="rg-orb rg-orb--a" aria-hidden="true" />
        <span className="rg-orb rg-orb--b" aria-hidden="true" />
        <RegisterNav />
        <div className="rg-panel rg-success">
          <div className="rg-success-mark">
            <Check className="h-7 w-7" />
          </div>
          <h1>ثبت‌نام شما انجام شد</h1>
          <p>
            حساب شما با یوزرنیم{" "}
            <strong dir="ltr" className="inline-block text-foreground">
              {usernameField.toLowerCase()}
            </strong>{" "}
            ساخته شد و در انتظار تایید مدیر است.
          </p>
          <div className="mt-3 text-right">
            <CredentialsHint>
              یوزرنیم و رمز عبور را در گوشی ذخیره کنید. بعد از تایید، با همین مشخصات وارد می‌شوید.
            </CredentialsHint>
          </div>
          <Link to="/login" className="rg-success-go">
            رفتن به صفحه ورود
            <ArrowRight className="h-4 w-4 rotate-180" />
          </Link>
          <div className="mt-6 rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-primary/5 p-4 shadow-elegant">
            <p className="mb-2 text-base font-extrabold text-foreground leading-7">
              اکنون اپلیکیشن اندروید را دانلود و نصب کنید
            </p>
            <p className="mb-3 text-[11px] leading-6 text-muted-foreground">
              نسخه اندروید سریع‌تر، آفلاین و همیشه در دسترس شماست. راهنمای تصویری نصب در پایین آمده
              است.
            </p>
            <ApkDownloadButton className="w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="register-page">
      <span className="rg-orb rg-orb--a" aria-hidden="true" />
      <span className="rg-orb rg-orb--b" aria-hidden="true" />
      <RegisterNav />

      <div className="rg-layout">
        <aside className="rg-aside">
          <span className="rg-aside-fold" aria-hidden="true" />
          <div className="rg-chips">
            <span className="rg-chip">۳ گام ساده</span>
            <span className="rg-chip">فعال‌سازی پس از تایید</span>
          </div>
          <h1>مغازه‌ات را از روی گوشی جمع‌وجور کن</h1>
          <p className="rg-aside-lead">
            ثبت‌نام کوتاه است: مشخصات، یک طرح، واریز کارت‌به‌کارت. بعد از تایید مدیر، فاکتور با صدا،
            انبار و بارکد روی موبایل آماده‌اند.
          </p>
          <div className="rg-perks">
            <div className="rg-perk">
              <i>
                <Mic className="h-3.5 w-3.5" />
              </i>
              فاکتور را با صدا بگو
            </div>
            <div className="rg-perk">
              <i>
                <ScanLine className="h-3.5 w-3.5" />
              </i>
              اسکن بارکد با دوربین
            </div>
            <div className="rg-perk">
              <i>
                <Package className="h-3.5 w-3.5" />
              </i>
              انبار و موجودی دمِ دست
            </div>
            <div className="rg-perk">
              <i>
                <BarChart3 className="h-3.5 w-3.5" />
              </i>
              گزارش فروش و سود
            </div>
          </div>
          {selectedCfg && (
            <div className="rg-aside-pick">
              <span>طرح انتخابی شما</span>
              <strong>
                {PLAN_LABEL[plan]} · {PLAN_DURATION_LABEL[plan]}
              </strong>
              <b>
                {formatToman(selectedPrice)}
                {selectedDiscounted && <s>{formatToman(selectedOriginal)}</s>}
              </b>
            </div>
          )}
        </aside>

        <div className="relative rg-panel">
          <div className="rg-banner">
            <Smartphone className="h-4 w-4" />
            پس از ثبت‌نام، لینک دانلود برنامه برای شما ارسال می‌شود.
          </div>

          <section className="rg-section">
            <div className="rg-section-head">
              <span className="rg-step">۱</span>
              <div>
                <h2>حساب شما</h2>
                <p>نام، یوزرنیم و رمز — همین‌ها برای ورود بعدی کافی است</p>
              </div>
            </div>
            <div className="rg-fields">
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="نام"
                  value={firstName}
                  onChange={setFirstName}
                  placeholder="مثال: علی"
                  autoComplete="given-name"
                />
                <Field
                  label="نام خانوادگی"
                  value={lastName}
                  onChange={setLastName}
                  placeholder="مثال: محمدی"
                  autoComplete="family-name"
                />
              </div>
              <Field
                label="یوزرنیم (انگلیسی)"
                value={usernameField}
                onChange={setUsernameField}
                placeholder="مثلاً: ali123 یا ali.rezaei"
                dir="ltr"
                autoComplete="username"
              />
              <Field
                label="شماره موبایل"
                value={phone}
                onChange={setPhone}
                placeholder="09xxxxxxxxx"
                dir="ltr"
                autoComplete="tel"
                inputMode="tel"
              />

              {/* تله برای ربات — از دید کاربر پنهان است؛ پر شدنش یعنی ارسال‌کننده انسان نیست */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  کد نمایندگی
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    name="company_fax_code"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </label>
              </div>

              {/* انتخاب رمز عبور همان ابتدا — پس از تایید مدیر، ورود فوری */}
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <div>
                  <label className="rg-label" htmlFor="rg-pass">
                    رمز عبور
                  </label>
                  <div className="rg-pass">
                    <input
                      id="rg-pass"
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      dir="ltr"
                      autoComplete="new-password"
                      className="rg-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="rg-eye"
                      tabIndex={-1}
                      aria-label={showPass ? "پنهان کردن رمز" : "نمایش رمز"}
                    >
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="rg-label" htmlFor="rg-pass2">
                    تکرار رمز
                  </label>
                  <div className="rg-pass">
                    <input
                      id="rg-pass2"
                      type={showPass2 ? "text" : "password"}
                      value={password2}
                      onChange={(e) => setPassword2(e.target.value)}
                      dir="ltr"
                      autoComplete="new-password"
                      className="rg-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass2((v) => !v)}
                      className="rg-eye"
                      tabIndex={-1}
                      aria-label={showPass2 ? "پنهان کردن تکرار رمز" : "نمایش تکرار رمز"}
                    >
                      {showPass2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
              {(password.length > 0 || password2.length > 0) && (
                <div className="rg-pass-meta" aria-live="polite">
                  {passOk ? (
                    <em>رمز مناسب است</em>
                  ) : password.length > 0 ? (
                    <span>حداقل ۸ کاراکتر، حرف و عدد</span>
                  ) : null}
                  {password2.length > 0 &&
                    (passMatch ? <em>تکرار رمز درست است</em> : <b>تکرار رمز یکی نیست</b>)}
                </div>
              )}
              <CredentialsHint>
                یوزرنیم و رمز را جای امنی ذخیره کنید؛ بعد از تایید مدیر با همین‌ها وارد می‌شوید.
              </CredentialsHint>
            </div>
          </section>

          <section className="rg-section">
            <div className="rg-section-head">
              <span className="rg-step">۲</span>
              <div>
                <h2>طرح اشتراک</h2>
                <p>هر طرح همان امکانات کامل را دارد — مدت اعتبار فرق می‌کند</p>
              </div>
            </div>
            <div className="rg-plans">
              {visiblePlans.map((p) => {
                const cfg = plansCfg[p];
                const original = cfg.price;
                const final = effectivePrice(cfg, now);
                const discounted = isDiscountActive(cfg, now);
                const remainingMs = cfg.discount_until
                  ? new Date(cfg.discount_until).getTime() - now
                  : Infinity;
                const months = PLAN_MONTHS[p];
                const save = planSavings(p, plansCfg, now);
                const isOn = plan === p;
                const isBest = p === recommendedPlan;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlan(p)}
                    className={`rg-plan ${isOn ? "is-on" : ""} ${isBest ? "is-best" : ""}`}
                  >
                    {discounted && <span className="rg-plan-save">{cfg.discount_percent}%</span>}
                    {isBest && !discounted && <span className="rg-plan-stamp">پیشنهاد</span>}
                    <span className="rg-plan-name">{PLAN_LABEL[p]}</span>
                    <span className="rg-plan-dur">{PLAN_DURATION_LABEL[p]}</span>
                    {discounted ? (
                      <span className="rg-plan-price">
                        <s>{formatToman(original)}</s>
                        <b>{formatToman(final)}</b>
                        {isFinite(remainingMs) && remainingMs > 0 && (
                          <span dir="ltr" className="mt-0.5 block text-[9px] text-rose-600/80">
                            ⏳ {formatRemaining(remainingMs)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="rg-plan-price">{formatToman(original)}</span>
                    )}
                    {months > 1 && (
                      <span className="rg-plan-month">
                        ماهی {formatToman(Math.round(final / months))}
                      </span>
                    )}
                    {save > 0 && !discounted && (
                      <span className="rg-plan-month">صرفه‌جویی {formatToman(save)}</span>
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
          </section>

          <section className="rg-section">
            <div className="rg-section-head">
              <span className="rg-step">۳</span>
              <div>
                <h2>واریز و رسید</h2>
                <p>شماره کارت را کپی کنید، واریز بزنید، عکس رسید را بگذارید</p>
              </div>
            </div>

            <div
              className="rg-bank"
              style={{
                background: `linear-gradient(135deg, ${cardTheme.from} 0%, ${cardTheme.mid} 48%, ${cardTheme.to} 100%)`,
                color: cardTheme.darkText ? "#1a2744" : "#fff",
              }}
            >
              <div className="rg-bank-top">
                <span>{card.bank_name || "کارت واریز"}</span>
                <span className="rg-chip-card" aria-hidden="true" />
              </div>
              <div dir="ltr" className="rg-bank-no">
                {cardDisplay}
              </div>
              <div className="rg-bank-meta">
                <div>
                  {card.card_holder && <div>به نام {card.card_holder}</div>}
                  <div className="opacity-80">شماره کارت جهت واریز</div>
                </div>
                <button
                  type="button"
                  onClick={copyCard}
                  className={`rg-copy ${copied ? "is-ok" : ""}`}
                  title="کپی"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "کپی شد" : "کپی کارت"}
                </button>
              </div>
            </div>

            <div className="mt-3">
              <label className="rg-label">
                عکس رسید پرداخت{" "}
                {!receiptNote(receiptRef, receiptDate, receiptTime) && (
                  <span className="text-destructive">*</span>
                )}
              </label>
              {receiptPreview ? (
                <div className="relative rounded-xl border border-border bg-background p-2">
                  <img
                    src={receiptPreview}
                    alt="رسید"
                    className="mx-auto max-h-48 rounded-lg object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptFile(null);
                      setReceiptPreview(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-background/90 text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : receiptFile ? (
                // فایل انتخاب شده ولی مرورگر نتوانست پیش‌نمایش تصویری بسازد (مثلاً بعضی فرمت‌ها) — همچنان قابل ارسال است
                <div className="relative flex items-center justify-between gap-2 rounded-xl border border-border bg-background p-3 text-xs">
                  <span className="truncate text-muted-foreground">
                    ✅ فایل انتخاب شد: {receiptFile.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptFile(null);
                      setReceiptPreview(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="receipt-pick flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 text-xs hover:border-primary hover:text-primary"
                >
                  <span className="receipt-pick-shine" aria-hidden="true" />
                  <span className="receipt-pick-icon" aria-hidden="true">
                    <span className="receipt-pick-ring" />
                    <span className="receipt-pick-ring receipt-pick-ring--2" />
                    <Upload className="h-5 w-5" />
                  </span>
                  <span className="receipt-pick-label">برای انتخاب عکس رسید کلیک کنید</span>
                  <span className="text-[10px] opacity-70">عکس به‌صورت خودکار فشرده می‌شود</span>
                </button>
              )}
              {/* عمداً accept محدود نشده — بعضی گوشی‌ها (HEIC آیفون) یا رسید PDF بانک‌ها
                  در حالت accept="image/*" اصلاً در انتخابگر فایل دیده نمی‌شوند. کنترل
                  حجم با فشرده‌سازی و سقف ۳ مگابایت انجام می‌شود، نه با فیلتر فرمت. */}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
              />
            </div>

            {/* جایگزین متنی رسید — اگر کاربر عکس ندارد یا آپلود برایش سخت است */}
            {!receiptFile && (
              <details className="rg-alt">
                <summary>عکس رسید ندارید؟ کد پیگیری را بنویسید</summary>
                <div className="rg-alt-body">
                  <p className="text-[11px] leading-6 text-muted-foreground">
                    به‌جای عکس، <strong>کد پیگیری تراکنش</strong> و <strong>تاریخ واریز</strong> و{" "}
                    <strong>ساعت و دقیقه‌ی دقیق واریز</strong> را بنویسید تا مدیر بتواند تراکنش شما
                    را دقیق تطبیق دهد و تایید کند.
                  </p>
                  <Field
                    label="کد پیگیری/ارجاع تراکنش"
                    value={receiptRef}
                    onChange={setReceiptRef}
                    placeholder="مثلاً: 123456789"
                    dir="ltr"
                  />
                  <div>
                    <label className="rg-label">تاریخ واریز</label>
                    <JalaliDateSelect value={receiptDate} onChange={setReceiptDate} />
                  </div>
                  <div>
                    <label className="rg-label">ساعت و دقیقه واریز (الزامی)</label>
                    <TimeSelect value={receiptTime} onChange={setReceiptTime} />
                  </div>
                </div>
              </details>
            )}

            <label className={`rg-confirm ${paid ? "is-on" : ""}`}>
              <input
                type="checkbox"
                checked={paid}
                onChange={(e) => setPaid(e.target.checked)}
                className="sr-only"
              />
              <span className="rg-confirm-box" aria-hidden="true">
                {paid ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <span>
                <strong>پرداخت را انجام دادم ✅</strong>
                <small>بعد از واریز، این گزینه را بزنید تا درخواست ثبت شود</small>
              </span>
            </label>
          </section>

          {error && <div className="rg-error">{error}</div>}

          <div className="mt-4 flex justify-center">
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
              resetSignal={turnstileReset}
              onStatus={setTurnstileStatus}
            />
          </div>

          <button type="button" onClick={handleSubmit} disabled={loading} className="rg-cta">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {uploading ? (
              <b>در حال آپلود رسید...</b>
            ) : (
              <>
                <b className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" />
                  ثبت درخواست
                </b>
                {selectedCfg && (
                  <small>
                    {PLAN_LABEL[plan]} · {formatToman(selectedPrice)}
                  </small>
                )}
              </>
            )}
          </button>

          <div className="rg-links">
            <p>
              حساب دارید؟ <Link to="/login">وارد شوید</Link>
            </p>
            <p>
              رمز عبور را فراموش کرده‌اید؟{" "}
              <Link to="/forgot-password">درخواست بازیابی رمز عبور</Link>
            </p>
            <p className="mt-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold opacity-80">
              <ShieldCheck className="h-3 w-3 text-primary" />
              اطلاعات فقط برای ساخت حساب شما استفاده می‌شود
            </p>
          </div>
        </div>
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
  autoComplete,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  dir?: string;
  autoComplete?: string;
  inputMode?: "tel" | "numeric" | "text";
}) {
  return (
    <div className="rg-field">
      <label className="rg-label">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        dir={dir}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className="rg-input"
      />
    </div>
  );
}

function RegisterNav() {
  return (
    <nav className="rg-nav">
      <Link to="/" className="rg-nav-brand">
        <RegisterMark />
        <span className="rg-nav-name">
          <strong>KAMIX</strong>
          <small>حسابداری فروشگاهی</small>
        </span>
      </Link>
      <Link to="/login" className="rg-nav-login">
        ورود به حساب
      </Link>
    </nav>
  );
}

function RegisterMark() {
  const uid = `rg${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 48 48" className="rg-nav-mark" aria-hidden="true">
      <defs>
        <linearGradient
          id={`${uid}-bg`}
          x1="10"
          y1="4"
          x2="40"
          y2="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#9ec4ff" />
          <stop offset="38%" stopColor="#4f8cff" />
          <stop offset="72%" stopColor="#5a5bff" />
          <stop offset="100%" stopColor="#7a4dff" />
        </linearGradient>
      </defs>
      <rect x="8.5" y="5.5" width="32" height="37" rx="11.5" fill={`url(#${uid}-bg)`} />
      <path
        d="M19.1 14.1h3.7v6.35L31.15 14.1h4.35L25.2 23.05 35.85 33.7h-4.55L22.8 25.05v8.65h-3.7Z"
        fill="#ffffff"
      />
    </svg>
  );
}
