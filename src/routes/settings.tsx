import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { settings, storePublicUrl } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/AuthContext";
import {
  publishStoreProfile,
  uploadStoreLogo,
  uploadPortfolioImage,
  fetchStoreProfile,
  storeErrorMessage,
} from "@/lib/storeProfile";
import { openExternal } from "@/lib/openExternal";
import { ApkDownloadButton } from "@/components/ApkDownloadButton";
import {
  Settings,
  Save,
  Scale,
  Store,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  ImagePlus,
  Loader2,
  Check,
  X,
  Images,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "تنظیمات | KAMIX" }] }),
  component: SettingsPage,
});

function SettingsPageInner() {
  const { state: authState } = useAuth();
  const meId = authState.status === "authenticated" ? authState.session.user.id : null;
  const [appSettings, setSettings] = settings.useAll();
  const [shopName, setShopName] = useState(appSettings.shopName);
  const [invoiceFontSize, setInvoiceFontSize] = useState(appSettings.invoiceFontSize ?? 13);
  const [weightUnits, setWeightUnits] = useState(!!appSettings.weightUnits);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const nextName = shopName.trim() || "فروشگاه من";
    setSettings({
      ...appSettings,
      shopName: nextName,
      invoiceFontSize,
      weightUnits,
    });
    // همگام‌سازی نام فروشگاه با پروفایل عمومی + منوی کافه (بدون دست‌زدن به سایر فیلدها)
    if (meId && nextName !== (appSettings.shopName || "").trim()) {
      try {
        const current = await fetchStoreProfile(meId).catch(() => null);
        await publishStoreProfile(meId, {
          shopName: nextName,
          address: current?.address,
          phones: current?.phones ?? [],
          hours: current?.hours,
          socials: current?.socials ?? {},
          description: current?.description,
          logoUrl: current?.logoUrl,
          portfolioImages: current?.portfolioImages ?? [],
        });
      } catch (e) {
        console.warn("[settings] sync shop name to public profile failed", e);
      }
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center gap-2">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold">تنظیمات</h1>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        {/* نام فروشگاه */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            نام فروشگاه
          </label>
          <input
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="فروشگاه من"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            این نام در هدر سیستم و فاکتورها نمایش داده می‌شود.
          </p>
        </div>

        {/* سایز فونت فاکتور */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            سایز فونت فاکتور — {invoiceFontSize}px
          </label>
          <input
            type="range"
            min={10}
            max={18}
            step={1}
            value={invoiceFontSize}
            onChange={(e) => setInvoiceFontSize(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>کوچک (۱۰)</span>
            <span>پیش‌فرض (۱۳)</span>
            <span>بزرگ (۱۸)</span>
          </div>
          {/* Preview */}
          <div
            className="mt-2 rounded-xl border border-dashed border-border bg-background p-3 text-center text-muted-foreground"
            style={{ fontSize: invoiceFontSize }}
          >
            نمونه متن فاکتور — ۱۲۵,۰۰۰ تومان
          </div>
        </div>

        {/* فروش وزنی — قابلیت پیشرفته اختیاری؛ برای فروشگاه‌های عادی مخفی می‌ماند */}
        <div className="rounded-xl border border-border bg-background p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Scale className="h-4 w-4 text-primary" />
              فروش وزنی (کیلوگرم / گرم)
            </span>
            <input
              type="checkbox"
              checked={weightUnits}
              onChange={(e) => setWeightUnits(e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </label>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            مخصوص فروشگاه‌های عمده و وزنی. با فعال‌شدن، در فرم محصول واحد فروش (عدد/کیلوگرم/گرم)
            اضافه می‌شود و در فاکتور می‌توانید مقدار اعشاری (مثلاً ۲٫۵ کیلوگرم) وارد کنید. در حالت
            غیرفعال هیچ چیز اضافه‌ای نمایش داده نمی‌شود.
          </p>
        </div>

        <button
          onClick={save}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Save className="h-4 w-4" />
          {saved ? "ذخیره شد ✓" : "ذخیره تنظیمات"}
        </button>
      </div>

      {/* تغییر رمز عبور */}
      <ChangePasswordSection />

      {/* پروفایل عمومی فروشگاه */}
      <StoreProfileSection shopName={shopName} />

      {/* دانلود نسخه اندروید — همیشه در دسترس */}
      <div className="mt-4 text-center">
        <ApkDownloadButton className="w-full" />
      </div>
    </Layout>
  );
}

const profileInputCls =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

function ChangePasswordSection() {
  const { state } = useAuth();
  const username =
    state.status === "authenticated" || state.status === "expired" ? state.profile.username : "";

  const [open, setOpen] = useState(false);
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const submit = async () => {
    setMsg(null);
    if (!currentPass) {
      setMsg({ type: "err", text: "رمز عبور فعلی را وارد کنید." });
      return;
    }
    if (newPass.length < 6) {
      setMsg({ type: "err", text: "رمز عبور جدید باید حداقل ۶ کاراکتر باشد." });
      return;
    }
    if (newPass !== confirmPass) {
      setMsg({ type: "err", text: "تکرار رمز عبور جدید مطابقت ندارد." });
      return;
    }
    if (!username) {
      setMsg({ type: "err", text: "کاربر شناسایی نشد. دوباره وارد شوید." });
      return;
    }
    setLoading(true);
    try {
      // پیش از تغییر، رمز فعلی را با ورود مجدد تایید می‌کنیم تا کسی جز خود
      // کاربر (که رمز فعلی را می‌داند) نتواند رمز را عوض کند.
      const email = `${username.trim().toLowerCase()}@kamali.local`;
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPass,
      });
      if (reauthErr) {
        setMsg({ type: "err", text: "رمز عبور فعلی صحیح نیست." });
        setLoading(false);
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) throw error;
      setMsg({ type: "ok", text: "رمز عبور با موفقیت تغییر کرد." });
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "تغییر رمز عبور ناموفق بود." });
    }
    setLoading(false);
  };

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2 text-sm font-bold">
          <KeyRound className="h-4 w-4 text-primary" />
          تغییر رمز عبور
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="relative">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">رمز عبور فعلی</label>
            <input
              type={show ? "text" : "password"}
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              dir="ltr"
              className={profileInputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">رمز عبور جدید</label>
            <input
              type={show ? "text" : "password"}
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              dir="ltr"
              className={profileInputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">تکرار رمز عبور جدید</label>
            <input
              type={show ? "text" : "password"}
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              dir="ltr"
              className={profileInputCls}
            />
          </div>

          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {show ? "پنهان کردن رمزها" : "نمایش رمزها"}
          </button>

          {msg && (
            <div
              className={`rounded-xl px-3 py-2.5 text-xs ${
                msg.type === "ok"
                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {msg.text}
            </div>
          )}

          <button
            onClick={submit}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            تغییر رمز عبور
          </button>
        </div>
      )}
    </div>
  );
}

function StoreProfileSection({ shopName }: { shopName: string }) {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.session.user.id : null;
  const [appSettings, setSettings] = settings.useAll();

  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(appSettings.storeAddress ?? "");
  const [phones, setPhones] = useState((appSettings.storePhones ?? []).join("\n"));
  const [hours, setHours] = useState(appSettings.businessHours ?? "");
  const [instagram, setInstagram] = useState(appSettings.instagram ?? "");
  const [telegram, setTelegram] = useState(appSettings.telegram ?? "");
  const [whatsapp, setWhatsapp] = useState(appSettings.whatsapp ?? "");
  const [rubika, setRubika] = useState(appSettings.rubika ?? "");
  const [eitaa, setEitaa] = useState(appSettings.eitaa ?? "");
  const [bale, setBale] = useState(appSettings.bale ?? "");
  const [description, setDescription] = useState(appSettings.storeDescription ?? "");
  const [logoUrl, setLogoUrl] = useState(appSettings.logoUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const [portfolioLoaded, setPortfolioLoaded] = useState(false);
  const [portfolioUploading, setPortfolioUploading] = useState(false);

  // در اولین باز شدن بخش، نمونه‌کارهای فعلی را از سرور بخوان
  useEffect(() => {
    if (!open || portfolioLoaded || !userId) return;
    setPortfolioLoaded(true);
    void fetchStoreProfile(userId)
      .then((p) => {
        if (p?.portfolioImages?.length) setPortfolio(p.portfolioImages);
      })
      .catch(() => {});
  }, [open, portfolioLoaded, userId]);

  const onPickPortfolio = async (files: FileList | null) => {
    if (!userId || !files || files.length === 0) return;
    setPortfolioUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        const url = await uploadPortfolioImage(userId, f);
        urls.push(url);
      }
      setPortfolio((prev) => [...prev, ...urls]);
    } catch (e) {
      console.error("[settings] portfolio upload failed:", e);
      alert(storeErrorMessage(e));
    } finally {
      setPortfolioUploading(false);
    }
  };

  const removePortfolioAt = (i: number) =>
    setPortfolio((prev) => prev.filter((_, idx) => idx !== i));

  const movePortfolio = (i: number, dir: -1 | 1) => {
    setPortfolio((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const publicUrl = userId ? storePublicUrl(userId) : "";

  const phoneList = () =>
    phones
      .split(/\n|,|،/)
      .map((p) => p.trim())
      .filter(Boolean);

  const onPickLogo = async (file: File) => {
    if (!userId) return;
    setUploading(true);
    try {
      const url = await uploadStoreLogo(userId, file);
      setLogoUrl(url);
    } catch (e) {
      console.error("[settings] logo upload failed:", e);
      alert(storeErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async () => {
    if (!userId) return;
    const profile = {
      shopName: shopName.trim() || "فروشگاه من",
      address,
      phones: phoneList(),
      hours,
      socials: {
        instagram: instagram.trim(),
        telegram: telegram.trim(),
        whatsapp: whatsapp.trim(),
        rubika: rubika.trim(),
        eitaa: eitaa.trim(),
        bale: bale.trim(),
      },
      description,
      logoUrl,
      portfolioImages: portfolio,
    };
    // ذخیره‌ی محلی (به‌صورت اختیاری روی AppSettings)
    setSettings({
      ...appSettings,
      storeAddress: address.trim() || undefined,
      storePhones: phoneList(),
      businessHours: hours.trim() || undefined,
      instagram: instagram.trim() || undefined,
      telegram: telegram.trim() || undefined,
      whatsapp: whatsapp.trim() || undefined,
      rubika: rubika.trim() || undefined,
      eitaa: eitaa.trim() || undefined,
      bale: bale.trim() || undefined,
      storeDescription: description.trim() || undefined,
      logoUrl: logoUrl.trim() || undefined,
    });
    setBusy(true);
    setDone(false);
    try {
      await publishStoreProfile(userId, profile);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch (e) {
      console.error("[settings] publish store profile failed:", e);
      alert(storeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 p-4 text-right"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Store className="h-4 w-4 text-primary" />
          پروفایل عمومی فروشگاه
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-4">
          <p className="text-xs leading-5 text-muted-foreground">
            این اطلاعات در یک صفحه‌ی عمومی نمایش داده می‌شود که می‌توانید لینک آن را برای مشتریان
            بفرستید. فقط فیلدهای پرشده نمایش داده می‌شوند.
          </p>

          {/* لوگو */}
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="لوگو"
                className="h-14 w-14 rounded-xl border border-border object-cover"
              />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-xl border border-dashed border-border text-muted-foreground">
                <Store className="h-6 w-6" />
              </div>
            )}
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs hover:bg-accent">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {logoUrl ? "تغییر لوگو" : "آپلود لوگو"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickLogo(f);
                }}
              />
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">آدرس</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className={`${profileInputCls} resize-none`}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              شماره تماس (هر شماره در یک خط)
            </label>
            <textarea
              value={phones}
              onChange={(e) => setPhones(e.target.value)}
              rows={2}
              dir="ltr"
              className={`${profileInputCls} resize-none`}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ساعات کاری
            </label>
            <input
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="مثلاً: ۹ تا ۲۱"
              className={profileInputCls}
            />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <input
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="آیدی یا لینک اینستاگرام"
              dir="ltr"
              className={profileInputCls}
            />
            <input
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="آیدی یا لینک تلگرام"
              dir="ltr"
              className={profileInputCls}
            />
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="شماره واتساپ"
              dir="ltr"
              className={profileInputCls}
            />
            <input
              value={rubika}
              onChange={(e) => setRubika(e.target.value)}
              placeholder="آیدی روبیکا (مثلاً my_shop) — نه شماره تلفن"
              dir="ltr"
              className={profileInputCls}
            />
            {rubika.trim() && /^[+\d۰-۹٠-٩]/.test(rubika.trim()) && (
              <p className="-mt-2 text-[11px] text-amber-600">
                این مقدار شبیه شماره تلفن است؛ روبیکا فقط با آیدی صفحه باز می‌شود، نه شماره.
              </p>
            )}
            <input
              value={eitaa}
              onChange={(e) => setEitaa(e.target.value)}
              placeholder="آیدی ایتا (مثلاً my_shop) — نه شماره تلفن"
              dir="ltr"
              className={profileInputCls}
            />
            {eitaa.trim() && /^[+\d۰-۹٠-٩]/.test(eitaa.trim()) && (
              <p className="-mt-2 text-[11px] text-amber-600">
                این مقدار شبیه شماره تلفن است؛ ایتا فقط با آیدی صفحه باز می‌شود، نه شماره.
              </p>
            )}
            <input
              value={bale}
              onChange={(e) => setBale(e.target.value)}
              placeholder="آیدی بله (مثلاً my_shop) — نه شماره تلفن"
              dir="ltr"
              className={profileInputCls}
            />
            {bale.trim() && /^[+\d۰-۹٠-٩]/.test(bale.trim()) && (
              <p className="-mt-2 text-[11px] text-amber-600">
                این مقدار شبیه شماره تلفن است؛ بله فقط با آیدی صفحه باز می‌شود، نه شماره.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              توضیح کوتاه
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={`${profileInputCls} resize-none`}
            />
          </div>

          {/* نمونه کار */}
          <div className="rounded-xl border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <Images className="h-4 w-4 text-primary" />
                نمونه کار ({portfolio.length})
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] hover:bg-accent">
                {portfolioUploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" />
                )}
                افزودن عکس
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void onPickPortfolio(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {portfolio.length === 0 ? (
              <p className="text-[11px] leading-5 text-muted-foreground">
                می‌توانید چند عکس از نمونه‌کارها، محصولات یا فضای کسب‌وکار اضافه کنید تا در یک گالری
                زیبا در صفحه‌ی عمومی نمایش داده شوند. اگر چیزی اضافه نکنید، این بخش در صفحه‌ی عمومی
                نمایش داده نمی‌شود.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {portfolio.map((url, i) => (
                  <div
                    key={url + i}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-border"
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePortfolioAt(i)}
                      aria-label="حذف"
                      className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-90"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <div className="absolute bottom-1 left-1 flex gap-1">
                      <button
                        type="button"
                        onClick={() => movePortfolio(i, -1)}
                        className="rounded-full bg-black/60 px-1.5 text-[10px] text-white"
                      >
                        ›
                      </button>
                      <button
                        type="button"
                        onClick={() => movePortfolio(i, 1)}
                        className="rounded-full bg-black/60 px-1.5 text-[10px] text-white"
                      >
                        ‹
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={saveProfile}
            disabled={busy || !userId}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {done ? "ذخیره و منتشر شد ✓" : "ذخیره و انتشار صفحه"}
          </button>

          {/* لینک صفحه */}
          {publicUrl && (
            <div className="rounded-xl border border-border bg-background p-3">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                لینک عمومی صفحه‌ی فروشگاه
              </div>
              <div dir="ltr" className="mb-2 truncate text-xs text-primary">
                {publicUrl}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyLink}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "کپی شد" : "کپی لینک"}
                </button>
                <button
                  onClick={() => openExternal(publicUrl)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  مشاهده
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsPage() {
  return (
    <AuthGuard>
      <SettingsPageInner />
    </AuthGuard>
  );
}
