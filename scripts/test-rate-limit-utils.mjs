/**
 * بررسی تشخیص خطای زیرساخت محدودیت نرخ و پیام‌های ثبت‌نام.
 * اجرا: node --experimental-strip-types scripts/test-rate-limit-utils.mjs
 */
import assert from "node:assert/strict";
import {
  isRateLimitInfraMissing,
  SIGNUP_RATE_MESSAGE,
  GENERIC_RATE_MESSAGE,
  signupRateCaps,
  trialRateCaps,
  passwordResetRateCaps,
} from "../src/lib/rate-limit-utils.ts";

assert.equal(isRateLimitInfraMissing({ code: "PGRST202", message: "Could not find the function" }), true);
assert.equal(isRateLimitInfraMissing({ code: "42883", message: "function check_rate_limit does not exist" }), true);
assert.equal(isRateLimitInfraMissing({ code: "42P01", message: "relation rate_limits does not exist" }), true);
assert.equal(isRateLimitInfraMissing({ message: "Could not find the function public.check_rate_limit in the schema cache" }), true);
assert.equal(isRateLimitInfraMissing({ code: "57014", message: "canceling statement due to statement timeout" }), false);
assert.equal(isRateLimitInfraMissing({ message: "over quota" }), false);
assert.equal(isRateLimitInfraMissing(null), false);
assert.equal(isRateLimitInfraMissing(undefined), false);
assert.equal(isRateLimitInfraMissing("boom"), false);

assert.ok(SIGNUP_RATE_MESSAGE.includes("ثبت‌نام"));
assert.ok(GENERIC_RATE_MESSAGE.includes("درخواست"));

const signupOn = signupRateCaps(true);
const signupOff = signupRateCaps(false);
assert.equal(signupOn.ipMax, 12);
assert.equal(signupOn.globalMax, 80);
assert.ok(signupOff.ipMax < signupOn.ipMax);
assert.ok(signupOff.globalMax < signupOn.globalMax);

const trialOn = trialRateCaps(true);
const trialOff = trialRateCaps(false);
assert.equal(trialOn.ipMax, 2);
assert.equal(trialOff.ipMax, 1);
assert.ok(trialOff.globalMax < trialOn.globalMax);

const resetOn = passwordResetRateCaps(true);
const resetOff = passwordResetRateCaps(false);
assert.equal(resetOn.ipMax, 3);
assert.ok(resetOff.ipMax <= resetOn.ipMax);

console.log("✓ rate-limit-utils: همه‌ی بررسی‌ها موفق");
