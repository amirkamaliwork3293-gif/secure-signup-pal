import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * تبدیل گفتار به متن برای نسخه‌ی نیتیو (APK) — مشکل پلاگین
 * `@capacitor-community/SpeechRecognition` این بود که چند ثانیه‌ی اول صدا یا تک‌
 * کلمه‌های کوتاه را گم می‌کرد. برای رفع کامل، در WebView فایل صوتی کامل با
 * MediaRecorder ضبط و base64-شده برای رونویسی ارسال می‌شود (Lovable AI Gateway /
 * مدل openai/gpt-4o-mini-transcribe). نسخه‌ی وب همچنان از Web Speech API استفاده
 * می‌کند که سریع‌تر و آنلاین/آفلاین نیست؛ این فقط fallback نیتیو است.
 */

const InputSchema = z.object({
  /** صدا به‌صورت base64 خام (بدون پیشوند data:) */
  audioBase64: z.string().min(100),
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
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<TranscribeResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { ok: false, error: "سرویس تشخیص گفتار فعال نشده است." };

    const ext = (data.format || "webm").toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? "audio/webm";
    const bytes = base64ToBytes(data.audioBase64);
    if (bytes.byteLength < 1024) return { ok: false, error: "صدایی ضبط نشد." };

    const fd = new FormData();
    fd.append("file", new Blob([bytes as BlobPart], { type: mime }), `recording.${ext}`);
    fd.append("model", "openai/gpt-4o-mini-transcribe");
    if (data.language) fd.append("language", data.language);

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
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