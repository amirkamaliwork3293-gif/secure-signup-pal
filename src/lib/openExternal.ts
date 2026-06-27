import { shortenUrlServer } from "@/lib/shorten.functions";

/**
 * باز کردن لینک‌های بیرونی به‌شکلی که هم در مرورگر و هم داخل WebView اپ (Capacitor)
 * درست کار کند. لینک‌هایی مثل `sms:`، `https://wa.me/...` و صفحه عمومی فروشگاه
 * باید داخل اپ اندروید هم باز شوند، نه فقط در مرورگر.
 *
 * در Capacitor، `window.open(url, "_system")` لینک را با مرورگر/اپ پیش‌فرض سیستم
 * باز می‌کند (به‌جای تلاش برای بارگذاری داخل WebView که برای schemeهایی مثل
 * `sms:` شکست می‌خورد). در مرورگر معمولی از یک anchor موقت استفاده می‌کنیم.
 */
function isCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap && (typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : true);
}

type NativeSharePlugin = {
  share?: (opts: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Promise<unknown>;
};

function nativeSharePlugin(): NativeSharePlugin | null {
  if (typeof window === "undefined") return null;
  const plugin = (window as unknown as { Capacitor?: { Plugins?: { Share?: NativeSharePlugin } } })
    .Capacitor?.Plugins?.Share;
  return plugin && typeof plugin.share === "function" ? plugin : null;
}

async function copyTextSafe(text: string): Promise<boolean> {
  if (typeof window === "undefined" || !text) return false;
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      Object.assign(ta.style, {
        position: "fixed",
        top: "-1000px",
        opacity: "0",
      });
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function openExternal(url: string): void {
  if (typeof window === "undefined") return;

  // داخل اپ اندروید: باز کردن با اپ پیش‌فرض سیستم (پیامک/واتساپ/مرورگر)
  if (isCapacitor()) {
    try {
      window.open(url, "_system");
      return;
    } catch {
      // اگر باز نشد، به مسیر معمول می‌افتیم
    }
  }

  // مرورگر معمولی: برای schemeهای اپ (sms:/tel:/whatsapp:) از location استفاده
  // می‌کنیم تا کاربر به اپ مربوطه هدایت شود؛ برای http(s) یک تب جدید باز می‌کنیم.
  const isAppScheme = /^(sms|tel|mailto|whatsapp|geo):/i.test(url);
  if (isAppScheme) {
    window.location.href = url;
    return;
  }

  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * نرمال‌سازی شماره موبایل ایران به فرمت بین‌المللی برای لینک واتساپ (wa.me).
 * مثال: «۰۹۱۲۱۲۳۴۵۶۷» یا «09121234567» → «989121234567».
 */
export function toIntlPhone(phone: string): string {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let digits = "";
  for (const ch of String(phone)) {
    const fi = fa.indexOf(ch);
    const ai = ar.indexOf(ch);
    if (fi >= 0) digits += String(fi);
    else if (ai >= 0) digits += String(ai);
    else if (ch >= "0" && ch <= "9") digits += ch;
  }
  if (digits.startsWith("0098")) digits = digits.slice(4);
  else if (digits.startsWith("98") && digits.length === 12) {
    /* already intl */
  } else if (digits.startsWith("0")) digits = "98" + digits.slice(1);
  else if (digits.length === 10 && digits.startsWith("9")) digits = "98" + digits;
  return digits;
}

/**
 * کوتاه‌سازی URL بلند (مثل لینک عمومی فروشگاه با UUID) برای جلوگیری از
 * شکستن پیامک به چند بخش و خرابی ارسال در اپراتورهای ایرانی. از سرویس عمومی
 * is.gd استفاده می‌شود (HTTPS، با CORS). اگر سرویس در دسترس نبود، همان لینک
 * اصلی برمی‌گردد تا چیزی خراب نشود.
 */
export async function shortenUrl(url: string): Promise<string> {
  if (!url || url.length < 50) return url;
  // ابتدا سمت سرور تلاش می‌کنیم — داخل WebView اپ اندروید، fetch به دامنه‌های
  // شخص ثالث (is.gd) ممکن است به‌خاطر CSP/شبکه شکست بخورد و لینک بلند باقی
  // بماند → پیامک به چند بخش می‌شکند و در اپراتورهای ایرانی نمی‌رسد.
  try {
    const r = await shortenUrlServer({ data: { url } });
    if (r?.short && /^https?:\/\//i.test(r.short) && r.short.length < url.length) return r.short;
  } catch {
    /* fall through to client-side */
  }
  try {
    const res = await fetch(
      `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
      { method: "GET" },
    );
    if (!res.ok) return url;
    const text = (await res.text()).trim();
    if (/^https?:\/\//i.test(text) && text.length < url.length) return text;
    return url;
  } catch {
    return url;
  }
}

/**
 * اشتراک‌گذاری متن/لینک از طریق منوی اشتراک‌گذاری سیستم اندروید (Web Share API).
 * در اپ نیتیو و مرورگرهای موبایل، پنجره‌ی انتخاب اپلیکیشن باز می‌شود و کاربر می‌تواند
 * بین واتساپ، روبیکا، ایتا، بله، تلگرام و... یکی را انتخاب کند. اگر Web Share
 * در دسترس نبود، به sms: برمی‌گردیم.
 */
export async function shareText(opts: {
  text: string;
  url?: string;
  title?: string;
  fallbackPhones?: string[];
}): Promise<"shared" | "sms" | "copied"> {
  const combined = opts.url ? `${opts.text}\n${opts.url}` : opts.text;
  // برای روبیکا/بله/ایتا بعضی نسخه‌ها متن را از Share Sheet دریافت نمی‌کنند؛
  // قبل از باز کردن پنجره اشتراک، متن را هم کپی می‌کنیم تا کاربر بتواند Paste کند.
  let copied = false;

  const nativeShare = nativeSharePlugin();
  if (nativeShare?.share) {
    try {
      copied = await copyTextSafe(combined);
      await nativeShare.share({
        title: opts.title,
        text: combined,
        dialogTitle: "ارسال در روبیکا، بله، ایتا و...",
      });
      return "shared";
    } catch {
      /* user canceled or bridge unavailable — fall through */
    }
  }
  // اگر پنجره اشتراک باز نشد، حالا در همان کلیک متن را کپی می‌کنیم.
  copied = await copyTextSafe(combined);

  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : null;
  if (nav?.share) {
    try {
      await nav.share({ title: opts.title, text: combined });
      return "shared";
    } catch {
      /* user canceled or unsupported — fall through */
    }
  }
  // fallback: sms
  if (opts.fallbackPhones?.length) {
    const to = opts.fallbackPhones.join(",");
    const url = `sms:${to}?body=${encodeURIComponent(combined)}`;
    if (typeof window !== "undefined") window.location.href = url;
    return "sms";
  }
  if (!copied) await copyTextSafe(combined);
  return "copied";
}
