/**
 * آدرس عمومی سوپابیس حتی بدون متغیر محیطی باید موجود باشد.
 * اجرا: node --experimental-strip-types scripts/test-supabase-public-config.mjs
 */
import assert from "node:assert/strict";
import {
  DEFAULT_SUPABASE_URL,
  resolveSupabasePublishableKey,
  resolveSupabaseUrl,
} from "../src/integrations/supabase/public-config.ts";

const savedUrl = process.env.SUPABASE_URL;
const savedViteUrl = process.env.VITE_SUPABASE_URL;
const savedKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const savedViteKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const savedAnon = process.env.SUPABASE_ANON_KEY;

delete process.env.SUPABASE_URL;
delete process.env.VITE_SUPABASE_URL;
delete process.env.SUPABASE_PUBLISHABLE_KEY;
delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
delete process.env.SUPABASE_ANON_KEY;

assert.equal(resolveSupabaseUrl(), DEFAULT_SUPABASE_URL);
assert.equal(DEFAULT_SUPABASE_URL, "https://rhyxwmeiayebfnmibuiv.supabase.co");
assert.equal(resolveSupabasePublishableKey(), "");

process.env.VITE_SUPABASE_URL = "https://example.supabase.co/";
assert.equal(resolveSupabaseUrl(), "https://example.supabase.co");

process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
assert.equal(resolveSupabasePublishableKey(), "sb_publishable_test");

if (savedUrl === undefined) delete process.env.SUPABASE_URL;
else process.env.SUPABASE_URL = savedUrl;
if (savedViteUrl === undefined) delete process.env.VITE_SUPABASE_URL;
else process.env.VITE_SUPABASE_URL = savedViteUrl;
if (savedKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
else process.env.SUPABASE_PUBLISHABLE_KEY = savedKey;
if (savedViteKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = savedViteKey;
if (savedAnon === undefined) delete process.env.SUPABASE_ANON_KEY;
else process.env.SUPABASE_ANON_KEY = savedAnon;

console.log("ok: supabase public URL fallback");
