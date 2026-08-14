/**
 * محتوای صفحه‌ی معرفی (Landing) — قابل‌مدیریت از پنل ادمین.
 * خواندن با کلاینت anon (خواندنِ عمومی)، ذخیره با کلاینت احرازشده‌ی ادمین.
 * اگر جدول هنوز ساخته نشده باشد، از محتوای پیش‌فرض استفاده می‌شود تا
 * صفحه همیشه زیبا و پر نمایش داده شود.
 *
 * ⚠️ محدودیت‌های پهنای‌باند (این‌ها را بدون خواندن مستند برنگردانید):
 *  - ویدیو فقط با «لینک» (آپارات/یوتیوب/ویمئو) اضافه می‌شود، نه آپلود فایل.
 *    یک ویدیوی چندمگابایتی در باکت landing-media با یک پست وایرال اینستاگرام
 *    ده‌ها گیگابایت Cached Egress می‌سازد و باعث قطع سرویس Supabase می‌شود.
 *  - عکس‌ها قبل از آپلود فشرده می‌شوند (lib/imageCompress) و با cacheControl
 *    یک‌ساله آپلود می‌شوند؛ مسیر فایل یکتاست پس کش طولانی هیچ‌وقت بیات نمی‌شود.
 * جزئیات کامل: docs/STORAGE_AND_BANDWIDTH.md
 */
import { supabase } from "@/lib/supabase";
import { CACHE_ONE_YEAR } from "@/lib/imageCompress";

export type LandingMedia = {
  type: "video" | "image";
  url: string;
  caption?: string;
  /** تصویر کاور — فقط برای ویدیوها؛ قبل از پخش نمایش داده می‌شود تا کاربر بداند محتوای ویدیو چیست */
  coverUrl?: string;
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

/**
 * تشخیص لینک‌های سرویس‌های اشتراک ویدیو (آپارات، یوتیوب، ...).
 * این لینک‌ها فایل ویدیو نیستند و با تگ <video> پخش نمی‌شوند؛
 * باید داخل iframe (پخش‌کننده‌ی خود سرویس) نمایش داده شوند.
 * خروجی: آدرس embed یا null اگر لینک، فایل مستقیم ویدیو باشد.
 */
export function videoEmbedUrl(rawUrl: string): string | null {
  const url = (rawUrl || "").trim();
  if (!url) return null;

  // آپارات: https://www.aparat.com/v/XXXXX  یا  /video/video/embed/videohash/XXXX/vt/frame
  const aparat = url.match(/aparat\.com\/(?:v|video\/video\/embed\/videohash)\/([A-Za-z0-9_-]+)/i);
  if (aparat) {
    return `https://www.aparat.com/video/video/embed/videohash/${aparat[1]}/vt/frame`;
  }

  // یوتیوب
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;

  // ویمئو
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;

  return null;
}

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
  headline: "کامیکس (KAMIX)",
  subheadline: "حسابداری کامیکس — حسابداری موبایل، ساده و سریع",
  description:
    "با اپلیکیشن حسابداری کامیکس (KAMIX) کل حسابداری فروشگاه‌تان را از روی گوشی مدیریت کنید: فاکتور سریع، اسکن بارکد با دوربین، انبار، مشتریان و گزارش سود — همه در یک برنامه ساده فارسی.",
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

/**
 * آپلود عکس صفحه‌ی معرفی (استوری/رسانه) در باکت عمومی `landing-media`.
 * فقط تصویر پذیرفته می‌شود — ویدیو باید با لینک آپارات/یوتیوب اضافه شود.
 */
export async function uploadLandingMedia(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error(
      "فقط عکس قابل آپلود است. برای ویدیو، لینک آپارات یا یوتیوب را وارد کنید (آپلود مستقیم ویدیو غیرفعال شده است).",
    );
  }
  const { prepareImageUpload } = await import("@/lib/imageCompress");
  const compressed = await prepareImageUpload(file, "content");
  const ext = (compressed.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `media/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("landing-media")
    // مسیر یکتاست، پس کش یک‌ساله امن است و بازدیدکننده‌های تکراری/CDN دیگر از
    // مبدأ Supabase فایل نمی‌گیرند (کلید کاهش Cached Egress در روزهای وایرال).
    .upload(path, compressed, {
      cacheControl: `${CACHE_ONE_YEAR}`,
      upsert: false,
      contentType: compressed.type || "image/jpeg",
    });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("landing-media").getPublicUrl(path);
  return data.publicUrl;
}
