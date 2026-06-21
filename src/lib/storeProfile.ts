import { supabase } from "@/integrations/supabase/client";

/**
 * انتشار و خواندن «پروفایل عمومی فروشگاه» در جدول store_profiles.
 *
 * این جدول جدا از user_data (که خصوصی است) نگه‌داری می‌شود و عمومی خواندنی است،
 * تا صفحه‌ی /store/[id] بدون نیاز به ورود قابل مشاهده باشد. فقط فیلدهای معرفی
 * فروشگاه اینجا قرار می‌گیرد. جدول هنوز در types.ts تولیدشده نیست؛ بنابراین از
 * یک کلاینت با تایپ سست استفاده می‌کنیم تا کامپایل نشکند.
 */

const sb = supabase as unknown as {
  from: (table: string) => {
    upsert: (row: unknown, opts?: { onConflict?: string }) => Promise<{ error: unknown }>;
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => { maybeSingle: () => Promise<{ data: StoreProfileRow | null; error: unknown }> };
    };
  };
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        opts?: { upsert?: boolean; contentType?: string },
      ) => Promise<{ error: unknown }>;
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
  const { error } = await sb.from("store_profiles").upsert(row, { onConflict: "user_id" });
  if (error) throw error;
}

/** خواندن پروفایل عمومی یک فروشگاه با شناسه‌ی کاربر (بدون نیاز به ورود). */
export async function fetchStoreProfile(userId: string): Promise<PublicStoreProfile | null> {
  const { data } = await sb.from("store_profiles").select("*").eq("user_id", userId).maybeSingle();
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
  const { error } = await sb.storage.from("store-assets").upload(path, file, {
    upsert: true,
    contentType: file.type || "image/png",
  });
  if (error) throw error;
  const { data } = sb.storage.from("store-assets").getPublicUrl(path);
  // افزودن پارامتر زمان برای جلوگیری از کش قدیمی پس از تعویض لوگو
  return `${data.publicUrl}?v=${Date.now()}`;
}
