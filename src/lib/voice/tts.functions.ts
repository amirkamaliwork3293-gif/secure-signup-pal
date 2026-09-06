import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clientIp,
  enforceRateLimit,
  requireActiveSubscription,
} from "@/lib/rate-limit.server";

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

async function requestSpeech(opts: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
}): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; status: number; detail: string }> {
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
  const mime = (res.headers.get("content-type") || "audio/mpeg").split(";")[0]!.trim() || "audio/mpeg";
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

    const lovableKey = process.env.LOVABLE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const useOpenAI = !lovableKey && !!openaiKey;
    const apiKey = lovableKey || openaiKey;
    if (!apiKey) {
      return {
        ok: false,
        error:
          "سرویس خواندن صدا روی سرور تنظیم نشده است. کلید LOVABLE_API_KEY یا OPENAI_API_KEY لازم است.",
      };
    }

    const text = data.text.trim();
    const endpoint = useOpenAI
      ? "https://api.openai.com/v1/audio/speech"
      : "https://ai.gateway.lovable.dev/v1/audio/speech";

    const attempts: Record<string, unknown>[] = useOpenAI
      ? [
          {
            model: "gpt-4o-mini-tts",
            voice: "nova",
            input: text,
            instructions: FEMALE_INSTRUCTIONS,
            response_format: "mp3",
          },
          {
            model: "tts-1",
            voice: "nova",
            input: text,
            response_format: "mp3",
          },
        ]
      : [
          {
            model: "openai/gpt-4o-mini-tts",
            voice: "nova",
            input: text,
            instructions: FEMALE_INSTRUCTIONS,
            response_format: "mp3",
          },
          {
            model: "openai/tts-1",
            voice: "nova",
            input: text,
            response_format: "mp3",
          },
        ];

    let lastDetail = "";
    try {
      for (const body of attempts) {
        const result = await requestSpeech({ url: endpoint, apiKey, body });
        if (result.ok) {
          return { ok: true, audioBase64: bytesToBase64(result.bytes), mime: result.mime };
        }
        lastDetail = `خطای خواندن صدا (${result.status}): ${result.detail}`;
        if (result.status === 401 || result.status === 403) break;
      }
      return { ok: false, error: lastDetail || "سرویس خواندن صدا پاسخ نداد." };
    } catch (e) {
      return {
        ok: false,
        error: `ارتباط با سرویس خواندن صدا برقرار نشد: ${String((e as Error)?.message ?? e)}`,
      };
    }
  });
