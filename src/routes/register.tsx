import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase, PLAN_LABEL, PLAN_DURATION_LABEL, type SubscriptionPlan } from "@/lib/supabase";
import { submitSignupRequest, getPublicSettings } from "@/lib/auth.functions";
import { createReceiptUploadUrl, receiptNote } from "@/lib/receipts.functions";
import { effectivePrice, isDiscountActive, DEFAULT_PLANS, type PlansConfig } from "@/lib/plans";
import { ApkDownloadButton } from "@/components/ApkDownloadButton";
import { JalaliDateSelect, TimeSelect } from "@/components/JalaliPickers";
import { toJalaliInputDate, toJalaliInputTime } from "@/lib/store";
import { markPendingOnboarding } from "@/lib/onboarding";
import { Receipt, Loader2, Copy, Check, CreditCard, ArrowRight, Upload, X, Eye, EyeOff } from "lucide-react";

const REGISTER_URL = "https://kamixapp.ir/register";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "ثبت‌نام KAMIX (کامیکس) — حسابداری فروشگاهی رایگان" },
      { name: "description", content: "در KAMIX (کامیکس) ثبت‌نام کنید: حسابداری فروشگاهی، صدور فاکتور، انبار و اسکن بارکد روی موبایل. پس از ثبت‌نام، APK اندروید را دریافت کنید." },
      { name: "keywords", content: "ثبت‌نام کامیکس, حسابداری کامیکس, اپلیکیشن حسابداری اندروید, فاکتور موبایل" },
      { property: "og:url", content: REGISTER_URL },
      { property: "og:title", content: "ثبت‌نام KAMIX (کامیکس) — حسابداری فروشگاهی رایگان" },
      { property: "og:description", content: "در KAMIX (کامیکس) ثبت‌نام کنید: حسابداری فروشگاهی، صدور فاکتور، انبار و اسکن بارکد روی موبایل." },
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
    } catch (e: any) {
      setReceiptFile(null);
      setReceiptPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      setError(
        (e?.message || "این فایل قابل استفاده نیست.") +
          " می‌توانید به‌جای عکس، کد پیگیری و تاریخ واریز را در کادر پایین بنویسید.",
      );
    }
  };

  const handleSubmit = async () => {
    setError("");
    if (!firstName.trim() || !lastName.trim()) { setError("نام و نام خانوادگی الزامی است."); return; }
    if (!usernameField.trim()) { setError("یوزرنیم الزامی است."); return; }
    if (!isValidIranPhone(phone)) { setError("شماره موبایل معتبر وارد کنید (مثل 09xxxxxxxxx)."); return; }
    if (password.length < 8 || !/[a-zA-Z؀-ۿ]/.test(password) || !/\d/.test(password)) {
      setError("رمز عبور باید حداقل ۸ کاراکتر باشد و هم حرف و هم عدد داشته باشد.");
      return;
    }
    if (password !== password2) { setError("تکرار رمز عبور مطابقت ندارد."); return; }
    const note = receiptNote(receiptRef, receiptDate, receiptTime);
    if (!receiptFile && !note) {
      setError("لطفاً عکس رسید پرداخت را آپلود کنید یا کد پیگیری، تاریخ و ساعت دقیق واریز را بنویسید.");
      return;
    }
    if (!paid) { setError("لطفاً تایید کنید که پرداخت انجام شده است."); return; }
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
        const rawExt = (receiptFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
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
            contentType: receiptFile.type?.startsWith("image/")
              ? receiptFile.type
              : "image/jpeg",
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
        },
      });
      markPendingOnboarding(usernameField);
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
          <div className="mt-6 rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-primary/5 p-4 shadow-elegant">
            <p className="mb-2 text-base font-extrabold text-foreground leading-7">
              اکنون اپلیکیشن اندروید را دانلود و نصب کنید
            </p>
            <p className="mb-3 text-[11px] leading-6 text-muted-foreground">
              نسخه اندروید سریع‌تر، آفلاین و همیشه در دسترس شماست. راهنمای تصویری نصب در پایین آمده است.
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
          <div className="text-lg font-bold kamali-brand">ثبت‌نام در KAMIX</div>
          <div className="text-xs text-muted-foreground">فرم زیر را تکمیل و واریز را انجام دهید</div>
        </div>
      </div>

      <div className="relative w-full max-w-md space-y-3 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3 text-center text-xs font-semibold leading-6 text-primary">
          📱 پس از ثبت‌نام، لینک دانلود برنامه برای شما ارسال می‌شود.
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="نام" value={firstName} onChange={setFirstName} placeholder="مثال: علی" />
          <Field label="نام خانوادگی" value={lastName} onChange={setLastName} placeholder="مثال: محمدی" />
        </div>

        <Field
          label="یوزرنیم (انگلیسی)"
          value={usernameField}
          onChange={setUsernameField}
          placeholder="مثلاً: ali123 یا ali.rezaei"
          dir="ltr"
        />

        <Field
          label="شماره موبایل"
          value={phone}
          onChange={setPhone}
          placeholder="09xxxxxxxxx"
          dir="ltr"
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">رمز عبور</label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                dir="ltr"
                autoComplete="new-password"
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 pl-9 text-sm outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                tabIndex={-1}
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">تکرار رمز</label>
            <div className="relative">
              <input
                type={showPass2 ? "text" : "password"}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                dir="ltr"
                autoComplete="new-password"
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 pl-9 text-sm outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setShowPass2((v) => !v)}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                tabIndex={-1}
              >
                {showPass2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">پلن اشتراک</label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {visiblePlans.map((p) => {
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
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {discounted && (
                    <span className="absolute -top-2 -right-2 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                      {cfg.discount_percent}%
                    </span>
                  )}
                  <span className="font-semibold">{PLAN_LABEL[p]}</span>
                  <span className="text-[10px] opacity-80">{PLAN_DURATION_LABEL[p]}</span>
                  {discounted ? (
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
            عکس رسید پرداخت {!receiptNote(receiptRef, receiptDate, receiptTime) && <span className="text-destructive">*</span>}
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
          ) : receiptFile ? (
            // فایل انتخاب شده ولی مرورگر نتوانست پیش‌نمایش تصویری بسازد (مثلاً بعضی فرمت‌ها) — همچنان قابل ارسال است
            <div className="relative flex items-center justify-between gap-2 rounded-xl border border-border bg-background p-3 text-xs">
              <span className="truncate text-muted-foreground">✅ فایل انتخاب شد: {receiptFile.name}</span>
              <button
                type="button"
                onClick={() => { setReceiptFile(null); setReceiptPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
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
          <div className="space-y-2 rounded-xl border border-dashed border-border bg-muted/30 p-3">
            <div className="text-[11px] leading-6 text-muted-foreground">
              عکس رسید ندارید؟ به‌جای آن <strong>کد پیگیری تراکنش</strong> و{" "}
              <strong>تاریخ واریز</strong> و <strong>ساعت و دقیقه‌ی دقیق واریز</strong> را
              بنویسید تا مدیر بتواند تراکنش شما را دقیق تطبیق دهد و تایید کند.
            </div>
            <div className="space-y-2">
              <Field
                label="کد پیگیری/ارجاع تراکنش"
                value={receiptRef}
                onChange={setReceiptRef}
                placeholder="مثلاً: 123456789"
                dir="ltr"
              />
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">تاریخ واریز</label>
                <JalaliDateSelect value={receiptDate} onChange={setReceiptDate} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  ساعت و دقیقه واریز (الزامی)
                </label>
                <TimeSelect value={receiptTime} onChange={setReceiptTime} />
              </div>
            </div>
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            checked={paid}
            onChange={(e) => setPaid(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span>پرداخت را انجام دادم ✅</span>
        </label>

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {uploading ? "در حال آپلود رسید..." : "ثبت درخواست"}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          حساب دارید؟{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            وارد شوید
          </Link>
        </p>
        <p className="text-center text-xs text-muted-foreground">
          رمز عبور را فراموش کرده‌اید؟{" "}
          <Link to="/forgot-password" className="font-semibold text-primary hover:underline">
            درخواست بازیابی رمز عبور
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
