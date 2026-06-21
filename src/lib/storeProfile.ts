import { supabase } from "@/integrations/supabase/client";

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
    };
  };
};

export type StoreSocials = {
  instagram?: string;
  telegram?: string;
  whatsapp?: string;
};

export type PublicStoreProfile = {
  shopName?: string;
  address?: string;
  phones?: string[];
  hours?: string;
  socials?: StoreSocials;
  description?: string;
  logoUrl?: string;
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
  const row = {
    user_id: userId,
    shop_name: p.shopName?.trim() || null,
    address: p.address?.trim() || null,
    phones: (p.phones ?? []).map((x) => x.trim()).filter(Boolean),
    hours: p.hours?.trim() || null,
    socials: p.socials ?? {},
    description: p.description?.trim() || null,
    logo_url: p.logoUrl?.trim() || null,
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
  return {
    shopName: data.shop_name ?? undefined,
    address: data.address ?? undefined,
    phones: data.phones ?? [],
    hours: data.hours ?? undefined,
    socials: data.socials ?? {},
    description: data.description ?? undefined,
    logoUrl: data.logo_url ?? undefined,
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
  const { data } = sb.storage.from("store-assets").getPublicUrl(path);
  // افزودن پارامتر زمان برای جلوگیری از کش قدیمی پس از تعویض لوگو
  return `${data.publicUrl}?v=${Date.now()}`;
}
