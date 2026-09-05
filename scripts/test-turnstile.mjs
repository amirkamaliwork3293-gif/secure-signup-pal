/**
 * بررسی قوانین دامنه و توکن Turnstile — بدون شبکه.
 * اجرا: node --experimental-strip-types scripts/test-turnstile.mjs
 */
import assert from "node:assert/strict";
import {
  TURNSTILE_REQUIRED_ERROR,
  TURNSTILE_WIDGET_BLOCKED_ERROR,
  isRestrictedBrowserForTurnstile,
  isTurnstileHostnameAllowed,
  normalizeTurnstileToken,
  turnstileMissingTokenError,
  turnstileScriptTimedOut,
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

assert.equal(isRestrictedBrowserForTurnstile("Mozilla/5.0 Instagram 192.168.2.2.68"), true);
assert.equal(isRestrictedBrowserForTurnstile("Mozilla/5.0 Telegram"), true);
assert.equal(
  isRestrictedBrowserForTurnstile(
    "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
  ),
  true,
);
assert.equal(
  isRestrictedBrowserForTurnstile(
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  ),
  false,
);

assert.equal(turnstileMissingTokenError("blocked"), TURNSTILE_WIDGET_BLOCKED_ERROR);
assert.equal(turnstileMissingTokenError("ready"), TURNSTILE_REQUIRED_ERROR);
assert.match(turnstileMissingTokenError("loading"), /آماده نشده/);

assert.equal(turnstileScriptTimedOut(0, 11_999, false), false);
assert.equal(turnstileScriptTimedOut(0, 12_000, false), true);
assert.equal(turnstileScriptTimedOut(0, 20_000, true), false);

console.log("ok: turnstile hostname + token helpers");
