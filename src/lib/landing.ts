/**
 * محتوای صفحه‌ی معرفی (Landing) — قابل‌مدیریت از پنل ادمین.
 * خواندن با کلاینت anon (خواندنِ عمومی)، ذخیره با کلاینت احرازشده‌ی ادمین.
 * اگر جدول هنوز ساخته نشده باشد، از محتوای پیش‌فرض استفاده می‌شود تا
 * صفحه همیشه زیبا و پر نمایش داده شود.
 */
import { supabase } from "@/lib/supabase";

export type LandingMedia = {
  type: "video" | "image";
  url: string;
  caption?: string;
};

export type LandingFeature = {
  title: string;
  description: string;
};

export type LandingContact = {
  phone?: string;
  whatsapp?: string;
  telegram?: string;
  instagram?: string;
  email?: string;
};

export type LandingStory = {
  image_url: string;
  caption?: string;
};

export type LandingContent = {
  brand_name: string;
  headline: string;
  subheadline: string;
  description: string;
  media: LandingMedia[];
  features: LandingFeature[];
  contact: LandingContact;
  stories: LandingStory[];
};

export const DEFAULT_LANDING: LandingContent = {
  brand_name: "KAMIX",
  headline: "KAMIX",
  subheadline: "حسابداری موبایل، ساده و سریع",
  description:
    "با KAMIX کل حسابداری فروشگاه‌تان را از روی گوشی مدیریت کنید: فاکتور سریع، اسکن بارکد با دوربین، انبار، مشتریان و گزارش سود — همه در یک برنامه ساده فارسی.",
  media: [],
  features: [
    { title: "فاکتور فوری", description: "صدور فاکتور فروش تنها در چند ثانیه با اسکن بارکد یا جستجوی کالا." },
    { title: "اسکن با دوربین", description: "بارکد و QR کالاها را مستقیم با دوربین موبایل بخوانید." },
    { title: "انبار و مشتریان", description: "موجودی کالا، بدهکاران و حساب مشتریان همیشه دقیق و به‌روز." },
    { title: "گزارش سود", description: "درآمد، سود و عملکرد فروشگاه را لحظه‌ای ببینید." },
  ],
  contact: {},
  stories: [],
};

function normalize(row: Partial<LandingContent> | null | undefined): LandingContent {
  if (!row) return DEFAULT_LANDING;
  return {
    brand_name: row.brand_name?.trim() || DEFAULT_LANDING.brand_name,
    headline: row.headline?.trim() || DEFAULT_LANDING.headline,
    subheadline: row.subheadline?.trim() || DEFAULT_LANDING.subheadline,
    description: row.description?.trim() || DEFAULT_LANDING.description,
    media: Array.isArray(row.media) ? row.media.filter((m) => m && m.url) : [],
    features: Array.isArray(row.features) && row.features.length > 0
      ? row.features.filter((f) => f && (f.title || f.description))
      : DEFAULT_LANDING.features,
    contact: (row.contact && typeof row.contact === "object" ? row.contact : {}) as LandingContact,
    stories: Array.isArray((row as any).stories)
      ? ((row as any).stories as LandingStory[]).filter((s) => s && s.image_url)
      : [],
  };
}

// Loosely typed table access — the generated Database type doesn't include this table.
const table = () => (supabase as any).from("landing_content");

export async function loadLandingContent(): Promise<LandingContent> {
  try {
    const { data, error } = await table().select("*").eq("id", 1).maybeSingle();
    if (error) return DEFAULT_LANDING;
    return normalize(data);
  } catch {
    return DEFAULT_LANDING;
  }
}

export async function saveLandingContent(content: LandingContent): Promise<void> {
  const payload = {
    id: 1,
    brand_name: content.brand_name.trim() || "KAMIX",
    headline: content.headline.trim() || "KAMIX",
    subheadline: content.subheadline.trim(),
    description: content.description.trim(),
    media: content.media,
    features: content.features,
    contact: content.contact || {},
    stories: content.stories || [],
    updated_at: new Date().toISOString(),
  };
  const { error } = await table().upsert(payload, { onConflict: "id" });
  if (error) {
    // Fallback for older DBs missing the newer `contact` or `stories` columns.
    const msg = error.message || "";
    if (/contact|stories/i.test(msg)) {
      const { contact: _c, stories: _s, ...rest } = payload;
      const { error: err2 } = await table().upsert(rest, { onConflict: "id" });
      if (err2) throw new Error(err2.message);
      return;
    }
    throw new Error(error.message);
  }
}

export async function uploadLandingMedia(file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `media/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("landing-media")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("landing-media").getPublicUrl(path);
  return data.publicUrl;
}
