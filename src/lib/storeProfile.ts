import { supabase } from "@/integrations/supabase/client";

/** خطای اختصاصی برای پلن منقضی‌شده‌ی صاحب فروشگاه. */
export class StoreSubscriptionExpiredError extends Error {
  constructor() { super("SUBSCRIPTION_EXPIRED"); this.name = "StoreSubscriptionExpiredError"; }
}

async function ownerActive(userId: string): Promise<boolean> {
  try {
    const { data, error } = await (supabase as any).rpc("is_subscription_active", { _user_id: userId });
    if (error) return true;
    return data === true;
  } catch { return true; }
}

/**
 * انتشار و خواندن «پروفایل عمومی فروشگاه» در جدول store_profiles.
 *
 * این جدول جدا از user_data (که خصوصی است) نگه‌داری می‌شود و عمومی خواندنی است،
 * تا صفحه‌ی /store/[id] بدون نیاز به ورود قابل مشاهده باشد. فقط فیلدهای معرفی
 * فروشگاه اینجا قرار می‌گیرد. جدول هنوز در types.ts تولیدشده نیست؛ بنابراین از
 * یک کلاینت با تایپ سست استفاده می‌کنیم تا کامپایل نشکند.
 */

/** شکل خطای Supabase/PostgREST (برای تشخیص علت واقعی خطا) */
type SbError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  name?: string;
} | null;

const sb = supabase as unknown as {
  from: (table: string) => {
    upsert: (row: unknown, opts?: { onConflict?: string }) => Promise<{ error: SbError }>;
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => { maybeSingle: () => Promise<{ data: StoreProfileRow | null; error: SbError }> };
    };
  };
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        opts?: { upsert?: boolean; contentType?: string },
      ) => Promise<{ error: SbError }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data: { signedUrl: string } | null; error: SbError }>;
    };
  };
};

export type StoreSocials = {
  instagram?: string;
  telegram?: string;
  whatsapp?: string;
  /** آیدی یا شماره روبیکا */
  rubika?: string;
  /** آیدی یا شماره ایتا */
  eitaa?: string;
  /** آیدی یا شماره بله */
  bale?: string;
};

export type PublicStoreProfile = {
  shopName?: string;
  address?: string;
  phones?: string[];
  hours?: string;
  socials?: StoreSocials;
  description?: string;
  logoUrl?: string;
  /** آدرس عمومی تصاویر نمونه‌کار (به ترتیب نمایش) */
  portfolioImages?: string[];
};

type StoreProfileRow = {
  user_id: string;
  shop_name: string | null;
  address: string | null;
  phones: string[] | null;
  hours: string | null;
  socials: StoreSocials | null;
  description: string | null;
  logo_url: string | null;
  portfolio_images: string[] | null;
};

/**
 * تبدیل خطای خام به پیام فارسی دقیق + تشخیص علت واقعی.
 * به‌جای پیام عمومی «اینترنت را بررسی کنید»، علت واقعی را برمی‌گرداند:
 *  - نبودِ جدول روی سرور (مهاجرت اعمال نشده)
 *  - نبودِ دسترسی (RLS / ورود)
 *  - نبودِ باکت ذخیره‌سازی لوگو
 *  - خطای واقعی شبکه (فقط در این حالت پیام اینترنت)
 */
export function storeErrorMessage(e: unknown): string {
  const err = (e ?? {}) as SbError & { error_description?: string };
  const code = (err?.code ?? "").toString();
  const text = `${err?.message ?? ""} ${err?.details ?? ""} ${err?.hint ?? ""}`.trim();

  // خطای واقعی شبکه (fetch ناموفق) — تنها جایی که پیام اینترنت درست است
  if (
    err?.name === "TypeError" ||
    /failed to fetch|networkerror|network request failed|load failed/i.test(text)
  ) {
    return "اتصال به اینترنت برقرار نشد. لطفاً اینترنت را بررسی کنید.";
  }
  // جدول/باکت هنوز روی سرور ساخته نشده (مهاجرت اعمال نشده)
  if (
    code === "PGRST205" ||
    code === "42P01" ||
    /store_profiles|store-assets|does not exist|schema cache|bucket not found|not found/i.test(text)
  ) {
    return "صفحه‌ی عمومی فروشگاه هنوز روی سرور فعال نشده است (جدول/باکت ساخته نشده). مهاجرت پایگاه‌داده باید اعمال شود.";
  }
  // مشکل دسترسی (RLS) — معمولاً نیاز به ورود مجدد
  if (
    code === "42501" ||
    err?.status === 401 ||
    err?.status === 403 ||
    /permission|policy|row-level|jwt|unauthorized/i.test(text)
  ) {
    return "اجازه‌ی ذخیره وجود ندارد. لطفاً دوباره وارد حساب شوید و تلاش کنید.";
  }
  // در غیر این صورت، خود پیام خطا را نشان بده تا علت واقعی مشخص باشد
  return text ? `ذخیره ناموفق بود: ${text}` : "ذخیره ناموفق بود. دوباره تلاش کنید.";
}

/** انتشار/به‌روزرسانی پروفایل عمومی فروشگاه برای کاربر جاری. */
export async function publishStoreProfile(userId: string, p: PublicStoreProfile): Promise<void> {
  // فیلتر آدرس‌های نامعتبر (blob:/data:/خالی) — این‌ها فقط روی مرورگر آپلودکننده کار می‌کنند
  // و برای مشتری‌ها قابل بارگذاری نیستند. فقط URLهای واقعی http(s) ذخیره می‌شوند.
  const isPublicUrl = (u?: string | null) =>
    !!u && /^https?:\/\//i.test(u.trim());
  const safeLogo = isPublicUrl(p.logoUrl) ? p.logoUrl!.trim() : null;
  const safePortfolio = (p.portfolioImages ?? [])
    .map((x) => x.trim())
    .filter((x) => isPublicUrl(x));
  const row = {
    user_id: userId,
    shop_name: p.shopName?.trim() || null,
    address: p.address?.trim() || null,
    phones: (p.phones ?? []).map((x) => x.trim()).filter(Boolean),
    hours: p.hours?.trim() || null,
    socials: p.socials ?? {},
    description: p.description?.trim() || null,
    logo_url: safeLogo,
    portfolio_images: safePortfolio,
    updated_at: new Date().toISOString(),
  };
  let res: { error: SbError };
  try {
    res = await sb.from("store_profiles").upsert(row, { onConflict: "user_id" });
  } catch (e) {
    // خطای سطح شبکه/کلاینت (قبل از رسیدن به سرور)
    console.error("[storeProfile] publish network/client error:", e);
    throw e;
  }
  if (res.error) {
    // خطای سطح سرور (PostgREST/Postgres) — جزئیات کامل برای رفع اشکال
    console.error("[storeProfile] publish server error:", {
      code: res.error.code,
      message: res.error.message,
      details: res.error.details,
      hint: res.error.hint,
      userId,
    });
    throw res.error;
  }
}

/** خواندن پروفایل عمومی یک فروشگاه با شناسه‌ی کاربر (بدون نیاز به ورود). */
export async function fetchStoreProfile(userId: string): Promise<PublicStoreProfile | null> {
  if (!(await ownerActive(userId))) {
    throw new StoreSubscriptionExpiredError();
  }
  const { data, error } = await sb
    .from("store_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[storeProfile] fetch error:", {
      code: error.code,
      message: error.message,
      details: error.details,
      userId,
    });
    throw error;
  }
  if (!data) return null;
  const isPublic = (u?: string | null) => !!u && /^https?:\/\//i.test(u);
  return {
    shopName: data.shop_name ?? undefined,
    address: data.address ?? undefined,
    phones: data.phones ?? [],
    hours: data.hours ?? undefined,
    socials: data.socials ?? {},
    description: data.description ?? undefined,
    // آدرس‌های blob:/data: فقط روی مرورگر آپلودکننده کار می‌کنند؛ برای بقیه‌ی کاربران نادیده گرفته می‌شوند.
    logoUrl: isPublic(data.logo_url) ? data.logo_url! : undefined,
    portfolioImages: Array.isArray(data.portfolio_images)
      ? data.portfolio_images.filter((x) => isPublic(x))
      : [],
  };
}

/** آپلود لوگوی فروشگاه در باکت عمومی و بازگرداندن URL عمومی. */
export async function uploadStoreLogo(userId: string, file: File): Promise<string> {
  const ext =
    (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${userId}/logo.${ext}`;
  let res: { error: SbError };
  try {
    res = await sb.storage.from("store-assets").upload(path, file, {
      upsert: true,
      contentType: file.type || "image/png",
    });
  } catch (e) {
    console.error("[storeProfile] logo upload network/client error:", e);
    throw e;
  }
  if (res.error) {
    console.error("[storeProfile] logo upload server error:", {
      code: res.error.code,
      message: res.error.message,
      path,
    });
    throw res.error;
  }
  // باکت خصوصی است؛ از URL امضاشده با اعتبار طولانی استفاده می‌کنیم (۱۰ سال)
  const signed = await sb.storage.from("store-assets").createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signed.error || !signed.data) {
    console.error("[storeProfile] sign url error:", signed.error);
    throw signed.error ?? new Error("امکان ساخت لینک تصویر فراهم نشد.");
  }
  return `${signed.data.signedUrl}&v=${Date.now()}`;
}

/** آپلود یک تصویر نمونه‌کار در باکت `store-assets` و بازگرداندن URL امضاشده‌ی طولانی‌مدت. */
export async function uploadPortfolioImage(userId: string, file: File): Promise<string> {
  const ext =
    (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/portfolio/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  let res: { error: SbError };
  try {
    res = await sb.storage.from("store-assets").upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
  } catch (e) {
    console.error("[storeProfile] portfolio upload network/client error:", e);
    throw e;
  }
  if (res.error) {
    console.error("[storeProfile] portfolio upload server error:", {
      code: res.error.code,
      message: res.error.message,
      path,
    });
    throw res.error;
  }
  const signed = await sb.storage
    .from("store-assets")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signed.error || !signed.data) {
    console.error("[storeProfile] portfolio sign url error:", signed.error);
    throw signed.error ?? new Error("امکان ساخت لینک تصویر فراهم نشد.");
  }
  return signed.data.signedUrl;
}
