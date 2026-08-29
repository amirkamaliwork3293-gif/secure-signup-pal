import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clientIp,
  enforceRateLimit,
  requireActiveSubscription,
} from "@/lib/rate-limit.server";

/**
 * تبدیل گفتار به متن برای نسخه‌ی نیتیو (APK) — مشکل پلاگین
 * `@capacitor-community/SpeechRecognition` این بود که چند ثانیه‌ی اول صدا یا تک‌
 * کلمه‌های کوتاه را گم می‌کرد. برای رفع کامل، در WebView فایل صوتی کامل با
 * MediaRecorder ضبط و base64-شده برای رونویسی ارسال می‌شود (Lovable AI Gateway /
 * مدل openai/gpt-4o-mini-transcribe). نسخه‌ی وب همچنان از Web Speech API استفاده
 * می‌کند که سریع‌تر و آنلاین/آفلاین نیست؛ این فقط fallback نیتیو است.
 */

const InputSchema = z.object({
  /** صدا به‌صورت base64 خام (بدون پیشوند data:) — حداکثر ~۸ مگابایت base64 */
  audioBase64: z.string().min(100).max(11_000_000),
  /** فرمت کانتینر صوت: webm/m4a/mp4/mp3/wav (پیش‌فرض webm) */
  format: z.string().default("webm"),
  /** زبان ISO-639-1؛ اگر خالی باشد، مدل خودش تشخیص می‌دهد */
  language: z.string().optional(),
});

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const MIME_BY_EXT: Record<string, string> = {
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<TranscribeResult> => {
    // رونویسی صدا کلید پولی مصرف می‌کند: اشتراک فعال + سقف نرخ سخت‌گیرانه.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireActiveSubscription(context.supabase, context.userId);
    await enforceRateLimit(supabaseAdmin, "stt", context.userId, 100, 3600);
    await enforceRateLimit(supabaseAdmin, "stt-ip", clientIp(), 200, 3600);

    // روی هاست لاوابل، LOVABLE_API_KEY خودکار تزریق می‌شود. روی Vercel یا هر
    // هاست دیگری باید یکی از این دو متغیر محیطی تنظیم شود.
    const lovableKey = process.env.LOVABLE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const useOpenAI = !lovableKey && !!openaiKey;
    const apiKey = lovableKey || openaiKey;
    if (!apiKey) {
      return {
        ok: false,
        error:
          "سرویس تشخیص گفتار روی سرور تنظیم نشده است. در تنظیمات هاست (Vercel ← Environment Variables) یکی از کلیدهای LOVABLE_API_KEY یا OPENAI_API_KEY را اضافه کنید و پروژه را دوباره Deploy کنید.",
      };
    }

    const ext = (data.format || "webm").toLowerCase();
    if (!(ext in MIME_BY_EXT)) {
      return { ok: false, error: "فرمت فایل صوتی پشتیبانی نمی‌شود." };
    }
    const mime = MIME_BY_EXT[ext];
    const bytes = base64ToBytes(data.audioBase64);
    if (bytes.byteLength < 1024) return { ok: false, error: "صدایی ضبط نشد." };

    const fd = new FormData();
    fd.append("file", new Blob([bytes as BlobPart], { type: mime }), `recording.${ext}`);
    fd.append("model", useOpenAI ? "gpt-4o-mini-transcribe" : "openai/gpt-4o-mini-transcribe");
    // همیشه فارسی — کاربر فارسی صحبت می‌کند و نباید خروجی انگلیسی/فینگلیش شود.
    fd.append("language", data.language || "fa");
    fd.append(
      "prompt",
      "این یک گفتار فارسی برای ثبت فاکتور فروشگاهی است. خروجی باید کاملاً به الفبای فارسی نوشته شود؛ از حروف لاتین استفاده نکن. نمونه واژه‌ها: ماست، نان، پنیر، گوجه، کیلو، عدد، نیم، ربع.",
    );
    fd.append("response_format", "json");
    fd.append("temperature", "0");

    try {
      const endpoint = useOpenAI
        ? "https://api.openai.com/v1/audio/transcriptions"
        : "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { ok: false, error: `خطای رونویسی (${res.status}): ${txt.slice(0, 200)}` };
      }
      const json = (await res.json()) as { text?: string };
      const text = (json?.text ?? "").trim();
      if (!text) return { ok: false, error: "متنی تشخیص داده نشد." };
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: `ارتباط با سرویس رونویسی برقرار نشد: ${String((e as Error)?.message ?? e)}` };
    }
  });