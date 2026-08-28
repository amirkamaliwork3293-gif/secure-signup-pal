/**
 * بررسی قوانین دامنه و توکن Turnstile — بدون شبکه.
 * اجرا: node --experimental-strip-types scripts/test-turnstile.mjs
 */
import assert from "node:assert/strict";
import {
  isTurnstileHostnameAllowed,
  normalizeTurnstileToken,
} from "../src/lib/turnstile.ts";

assert.equal(isTurnstileHostnameAllowed("kamixapp.ir"), true);
assert.equal(isTurnstileHostnameAllowed("www.kamixapp.ir"), true);
assert.equal(isTurnstileHostnameAllowed("KAMIXAPP.IR"), true);
assert.equal(isTurnstileHostnameAllowed("localhost"), true);
assert.equal(isTurnstileHostnameAllowed("secure-signup-pal.vercel.app"), true);
assert.equal(isTurnstileHostnameAllowed(""), true);
assert.equal(isTurnstileHostnameAllowed("evil.example"), false);
assert.equal(isTurnstileHostnameAllowed("challenges.cloudflare.com"), false);

assert.equal(normalizeTurnstileToken("  abc  "), "abc");
assert.equal(normalizeTurnstileToken(null), "");
assert.equal(normalizeTurnstileToken(undefined), "");
assert.ok(normalizeTurnstileToken("x".repeat(5000)).length === 2048);

console.log("ok: turnstile hostname + token helpers");
