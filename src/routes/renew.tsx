import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/AuthContext";
import { supabase, PLAN_LABEL, PLAN_DURATION_LABEL, type SubscriptionPlan } from "@/lib/supabase";
import { submitRenewalRequest, getPublicSettings } from "@/lib/auth.functions";
import { effectivePrice, isDiscountActive, DEFAULT_PLANS, type PlansConfig } from "@/lib/plans";
import { Receipt, Loader2, Copy, Check, CreditCard, Upload, X, ArrowRight, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/renew")({
  head: () => ({ meta: [{ title: "تمدید اشتراک | کمالی" }] }),
  component: RenewPage,
});

const PAID: SubscriptionPlan[] = ["1month", "3month", "6month", "12month"];

function formatToman(n: number) {
  return new Intl.NumberFormat("fa-IR").format(n) + " تومان";
}

function RenewPage() {
  const { state, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const submit = useServerFn(submitRenewalRequest);
  const [plan, setPlan] = useState<SubscriptionPlan>("1month");
  const [paid, setPaid] = useState(false);
  const [card, setCard] = useState({ card_number: "", card_holder: "", bank_name: "" });
  const [plansCfg, setPlansCfg] = useState<PlansConfig>(DEFAULT_PLANS);
  const [copied, setCopied] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  if (state.status === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (state.status === "unauthenticated") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <p className="mb-4 text-sm text-muted-foreground">برای تمدید اشتراک ابتدا وارد شوید.</p>
        <Link to="/login" className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">ورود به حساب</Link>
      </div>
    );
  }
  // اگر کاربر فعال است نیازی به تمدید نیست
  if (state.status === "authenticated") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <p className="mb-4 text-sm text-muted-foreground">اشتراک شما فعال است. نیازی به تمدید نیست.</p>
        <Link to="/" className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">بازگشت به برنامه</Link>
      </div>
    );
  }

  const username = (state as any).username ?? "—";
  const visiblePlans = PAID.filter((p) => plansCfg[p]?.enabled);

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

  const handleSubmit = async () => {
    setError("");
    if (!visiblePlans.includes(plan)) { setError("لطفاً یکی از پلن‌های فعال را انتخاب کنید."); return; }
    if (!receiptFile) { setError("لطفاً عکس رسید پرداخت را آپلود کنید."); return; }
    if (!paid) { setError("لطفاً تایید کنید که پرداخت انجام شده است."); return; }

    setLoading(true);
    try {
      const ext = receiptFile.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${username}/renew-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("receipts").upload(path, receiptFile, {
        cacheControl: "3600", upsert: false, contentType: receiptFile.type,
      });
      if (upErr) throw new Error("خطا در آپلود رسید: " + upErr.message);

      await submit({ data: { plan, receipt_url: path, payment_confirmed: paid } });
      setDone(true);
    } catch (e: any) {
      setError(e?.message || "خطا در ارسال درخواست تمدید.");
    }
    setLoading(false);
  };

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-card">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-green-500/10">
            <Check className="h-7 w-7 text-green-600" />
          </div>
          <h1 className="text-lg font-bold">درخواست تمدید ثبت شد</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            پس از تایید مدیر، اشتراک شما با همین حساب فعال خواهد شد. تمام اطلاعات (محصولات، مشتری‌ها، فاکتورها و تنظیمات) شما حفظ شده است.
          </p>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => void refreshProfile()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              <RefreshCw className="h-4 w-4" />
              بررسی مجدد
            </button>
            <button onClick={signOut} className="rounded-xl border border-border px-4 py-2.5 text-sm">خروج</button>
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
          <div className="text-lg font-bold kamali-brand">تمدید طرح</div>
          <div className="text-xs text-muted-foreground">حساب فعلی شما — <span dir="ltr">{username}</span></div>
        </div>
      </div>

      <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3 text-xs leading-6 text-muted-foreground">
          ✅ نیازی به وارد کردن مجدد یوزرنیم یا رمز نیست. فقط پلن را انتخاب و رسید پرداخت را آپلود کنید — تمام داده‌های قبلی شما محفوظ است.
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">انتخاب پلن جدید</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {visiblePlans.map((p) => {
              const cfg = plansCfg[p];
              const orig = cfg.price;
              const final = effectivePrice(cfg, Date.now());
              const off = isDiscountActive(cfg, Date.now());
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlan(p)}
                  className={`relative flex flex-col items-center gap-1 rounded-xl border p-2.5 text-xs ${
                    plan === p ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent"
                  }`}
                >
                  <span className="font-semibold">{PLAN_LABEL[p]}</span>
                  <span className="text-[10px] opacity-80">{PLAN_DURATION_LABEL[p]}</span>
                  {off ? (
                    <span className="flex flex-col items-center leading-tight">
                      <span className="text-[10px] text-muted-foreground line-through">{formatToman(orig)}</span>
                      <span className="text-[10px] font-bold text-rose-600">{formatToman(final)}</span>
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-primary">{formatToman(orig)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
            <CreditCard className="h-4 w-4" />
            شماره کارت جهت واریز
          </div>
          <div className="flex items-center justify-between gap-2">
            <div dir="ltr" className="text-lg font-bold tracking-wider">{card.card_number || "—"}</div>
            <button type="button" onClick={copyCard} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-background hover:bg-accent">
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

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">عکس رسید پرداخت <span className="text-destructive">*</span></label>
          {receiptPreview ? (
            <div className="relative rounded-xl border border-border bg-background p-2">
              <img src={receiptPreview} alt="رسید" className="mx-auto max-h-48 rounded-lg object-contain" />
              <button type="button" onClick={() => { setReceiptFile(null); setReceiptPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-background/90 text-destructive">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-background py-6 text-xs text-muted-foreground hover:border-primary hover:text-primary">
              <Upload className="h-5 w-5" />
              <span>برای انتخاب عکس رسید کلیک کنید</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0] || null)} />
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4 accent-primary" />
          <span>پرداخت را انجام دادم ✅</span>
        </label>

        {error && <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</div>}

        <button type="button" onClick={handleSubmit} disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          ثبت درخواست تمدید
          <ArrowRight className="h-4 w-4 rotate-180" />
        </button>

        <button type="button" onClick={signOut} className="w-full text-center text-xs text-muted-foreground hover:underline">
          خروج از حساب
        </button>
      </div>
    </div>
  );
}