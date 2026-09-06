import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientIp, enforceRateLimit, requireActiveSubscription } from "@/lib/rate-limit.server";

/**
 * تبدیل متن به صدای زن فارسی.
 *
 * چرا سرور و فایل MP3؟ Web Speech Synthesis (`speechSynthesis`) در سایت و
 * WebView اندروید کامیکس عملاً ساکت است: صدای fa-IR روی خیلی از دستگاه‌ها
 * نصب نیست، utterance قبل از پخش GC می‌شود، و WebView اصلاً موتور خواندن
 * ندارد. پخش یک فایل صوتی با تگ Audio هم در مرورگر و هم در اپ کار می‌کند.
 *
 * همان کلید Lovable/OpenAI که رونویسی صدا از آن استفاده می‌کند.
 */

const InputSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

export type SynthesizeResult =
  | { ok: true; audioBase64: string; mime: string }
  | { ok: false; error: string };

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

const FEMALE_INSTRUCTIONS =
  "Speak in Persian (Farsi) only, as a warm adult woman. Clear, natural, unhurried. Do not add words that are not in the text.";

function splitForGoogle(text: string, max = 180): string[] {
  const t = text.trim();
  if (t.length <= max) return [t];
  const parts: string[] = [];
  let rest = t;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < 40) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** صدای زن فارسی گوگل — فقط اگر مسیر رسمی TTS در دسترس نباشد. */
async function fromGoogleTranslateFa(
  text: string,
): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; detail: string }> {
  const parts: Uint8Array[] = [];
  for (const chunk of splitForGoogle(text)) {
    const url =
      "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=fa&q=" +
      encodeURIComponent(chunk);
    const res = await fetch(url, {
      headers: {
        accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        referer: "https://translate.google.com/",
      },
    });
    if (!res.ok) return { ok: false, detail: `google-tts ${res.status}` };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 256) return { ok: false, detail: "google-tts empty" };
    parts.push(buf);
  }
  if (parts.length === 0) return { ok: false, detail: "google-tts empty" };
  return { ok: true, bytes: concatBytes(parts), mime: "audio/mpeg" };
}

async function requestSpeech(opts: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
}): Promise<
  { ok: true; bytes: Uint8Array; mime: string } | { ok: false; status: number; detail: string }
> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts.body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, status: res.status, detail: txt.slice(0, 240) };
  }
  const mime =
    (res.headers.get("content-type") || "audio/mpeg").split(";")[0]!.trim() || "audio/mpeg";
  if (mime.includes("json")) {
    const txt = await res.text().catch(() => "");
    return { ok: false, status: res.status, detail: txt.slice(0, 240) };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 256) {
    return { ok: false, status: res.status, detail: "فایل صوتی خالی برگشت." };
  }
  return { ok: true, bytes: buf, mime: mime.startsWith("audio/") ? mime : "audio/mpeg" };
}

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<SynthesizeResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireActiveSubscription(context.supabase, context.userId);
    await enforceRateLimit(supabaseAdmin, "tts", context.userId, 40, 3600);
    await enforceRateLimit(supabaseAdmin, "tts-ip", clientIp(), 80, 3600);

    const text = data.text.trim();
    const lovableKey = process.env.LOVABLE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const useOpenAI = !lovableKey && !!openaiKey;
    const apiKey = lovableKey || openaiKey;

    let lastDetail = "";
    try {
      if (apiKey) {
        const endpoint = useOpenAI
          ? "https://api.openai.com/v1/audio/speech"
          : "https://ai.gateway.lovable.dev/v1/audio/speech";
        const prefix = useOpenAI ? "" : "openai/";
        const attempts: Record<string, unknown>[] = [
          {
            model: `${prefix}gpt-4o-mini-tts`,
            voice: "nova",
            input: text,
            instructions: FEMALE_INSTRUCTIONS,
            response_format: "mp3",
          },
          {
            model: `${prefix}tts-1`,
            voice: "nova",
            input: text,
            response_format: "mp3",
          },
        ];
        for (const body of attempts) {
          const result = await requestSpeech({ url: endpoint, apiKey, body });
          if (result.ok) {
            return { ok: true, audioBase64: bytesToBase64(result.bytes), mime: result.mime };
          }
          lastDetail = `خطای خواندن صدا (${result.status}): ${result.detail}`;
          if (result.status === 401 || result.status === 403) break;
        }
      }

      const google = await fromGoogleTranslateFa(text);
      if (google.ok) {
        return { ok: true, audioBase64: bytesToBase64(google.bytes), mime: google.mime };
      }
      lastDetail = lastDetail || google.detail;

      return {
        ok: false,
        error: lastDetail || "سرویس خواندن صدا پاسخ نداد.",
      };
    } catch (e) {
      return {
        ok: false,
        error: `ارتباط با سرویس خواندن صدا برقرار نشد: ${String((e as Error)?.message ?? e)}`,
      };
    }
  });
