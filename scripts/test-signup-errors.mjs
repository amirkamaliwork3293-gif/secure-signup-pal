/**
 * ثبت‌نام نباید رمز حساب موجود را عوض کند و خطای داخلی را لو ندهد.
 * اجرا: node scripts/test-signup-errors.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SIGNUP_RETRY_LATER,
  SIGNUP_USERNAME_TAKEN,
  isAuthUserAlreadyRegistered,
  publicSignupCreateUserError,
  publicSignupProfileError,
  shouldRetrySignupWithoutOptionalColumns,
} from "../src/lib/signup-errors.ts";

assert.equal(isAuthUserAlreadyRegistered("User already registered"), true);
assert.equal(publicSignupCreateUserError("User already registered"), SIGNUP_USERNAME_TAKEN);
assert.equal(publicSignupCreateUserError("duplicate key value"), SIGNUP_USERNAME_TAKEN);
assert.equal(publicSignupCreateUserError("JWT expired in schema xyz"), SIGNUP_RETRY_LATER);
assert.ok(!publicSignupCreateUserError("column profiles.secret does not exist").includes("column"));
assert.equal(publicSignupProfileError("duplicate key"), SIGNUP_USERNAME_TAKEN);
assert.equal(shouldRetrySignupWithoutOptionalColumns("Could not find the 'phone' column"), true);
assert.equal(shouldRetrySignupWithoutOptionalColumns("over quota"), false);

const authSrc = readFileSync(new URL("../src/lib/auth.functions.ts", import.meta.url), "utf8");

const signupHandler = authSrc.slice(
  authSrc.indexOf("export const submitSignupRequest"),
  authSrc.indexOf("export const checkRequestStatus"),
);
assert.equal(
  signupHandler.includes("updateUserById"),
  false,
  "ثبت‌نام نباید رمز کاربر موجود را با updateUserById عوض کند",
);

const pwUpdates = [...authSrc.matchAll(/updateUserById/g)];
assert.equal(
  pwUpdates.length,
  2,
  `فقط ورود ادمین (رمز تصادفی نشست) و ریست دستی ادمین باید رمز را عوض کنند، got ${pwUpdates.length}`,
);
assert.match(authSrc, /adminResetUserPassword/);
assert.match(authSrc, /sessionPass/);

console.log("signup-errors + password mutation audit ok");
