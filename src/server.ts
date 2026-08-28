import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { resolveSupabaseUrl } from "./integrations/supabase/public-config";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * سرآیندهای امنیتی — روی **همه‌ی** پاسخ‌ها اعمال می‌شوند.
 *
 * دو دسته‌اند:
 *  ۱. مواردی که هیچ ریسکی برای خراب‌شدن اپ ندارند → همین حالا اجباری‌اند.
 *  ۲. سیاست کامل CSP برای script/style → فعلاً فقط Report-Only، چون اپ از
 *     اسکریپت inline (تشخیص اپ اندروید در __root.tsx)، استایل inline و
 *     iframe آپارات/یوتیوب/ویمئو استفاده می‌کند. پس از بررسی گزارش‌ها،
 *     همین رشته را به هدر بدون پسوند «-Report-Only» منتقل کنید.
 *
 * frame-ancestors در حالت اجباری است: جلوی clickjacking روی پنل ادمین را
 * می‌گیرد و چون اپ خودش هیچ‌جا در iframe جاسازی نمی‌شود، چیزی نمی‌شکند.
 */
const SUPABASE_ORIGIN = resolveSupabaseUrl();

function cspReportOnly(): string {
  return [
    "default-src 'self'",
    // 'unsafe-inline' لازم است تا اسکریپت تشخیص اپ و استایل‌های inline کار کنند.
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    `connect-src 'self' ${SUPABASE_ORIGIN} https://api.anthropic.com https://challenges.cloudflare.com`.trim(),
    "frame-src https://www.aparat.com https://www.youtube.com https://player.vimeo.com https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  // ─── اجباری (بدون ریسک شکستن) ──────────────────────────────────────────
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // دوربین (اسکن بارکد) و میکروفون (ثبت صوتی) فقط برای خود اپ؛ بقیه بسته.
  headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()");
  // این سه دستور CSP هیچ‌کدام روی اپ فعلی اثر منفی ندارند و اجباری‌اند.
  headers.set("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");

  // ─── سیاست کامل، فعلاً فقط گزارشی ──────────────────────────────────────
  headers.set("Content-Security-Policy-Report-Only", cspReportOnly());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
