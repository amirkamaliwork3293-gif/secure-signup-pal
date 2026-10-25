/**
 * kamixapp.ir/sb/… → سوپابیس (مسیر جایگزین؛ کلاینت در fallback-fetch.ts فقط وقتی
 * از آن استفاده می‌کند که مستقیم به supabase.co نرسد).
 *
 * فقط به پروژهٔ خودمان و فقط APIهای عمومی سوپابیس فرستاده می‌شود. هیچ کلید
 * سروری اضافه نمی‌شود؛ apikey و Authorization همان چیزی است که کاربر فرستاده،
 * پس دسترسی کسی بیشتر از اتصال مستقیم نمی‌شود.
 */
import { SUPABASE_PROXY_PATH } from "./fallback-fetch";

const ALLOWED_PATH = /^\/(?:auth|rest|storage|functions)\/v1\//;

const DROP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "content-length",
  "accept-encoding",
  "cookie",
  "origin",
  "referer",
  "forwarded",
  "x-real-ip",
]);

const DROP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  // fetch بدنه را از حالت فشرده باز کرده؛ این دو دیگر درست نیستند
  "content-encoding",
  "content-length",
  "set-cookie",
  "alt-svc",
]);

function dropRequestHeader(name: string): boolean {
  return (
    DROP_REQUEST_HEADERS.has(name) ||
    name.startsWith("x-forwarded-") ||
    name.startsWith("x-vercel-") ||
    name.startsWith("cf-")
  );
}

export function isSupabaseProxyPath(pathname: string): boolean {
  return pathname.startsWith(SUPABASE_PROXY_PATH + "/");
}

export async function proxySupabaseRequest(
  request: Request,
  supabaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const rest = url.pathname.slice(SUPABASE_PROXY_PATH.length);
  if (!supabaseUrl || !ALLOWED_PATH.test(rest)) {
    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const target = supabaseUrl.replace(/\/+$/, "") + rest + url.search;
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (!dropRequestHeader(name.toLowerCase())) headers.set(name, value);
  });

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
    });
  } catch (error) {
    console.error("[sb-proxy] upstream failed", error);
    return new Response(JSON.stringify({ message: "upstream unavailable" }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const out = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROP_RESPONSE_HEADERS.has(name.toLowerCase())) out.set(name, value);
  });
  // دادهٔ کاربر هرگز در کش مشترک (CDN) نماند
  out.set("cache-control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}
