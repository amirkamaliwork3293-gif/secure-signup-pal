/**
 * پیام‌های عمومی ثبت‌نام — جزئیات دیتابیس/GoTrue به مرورگر نرود.
 * رمز کاربر موجود هرگز از روی خطای «تکراری» بازنویسی نمی‌شود.
 */

export const SIGNUP_USERNAME_TAKEN = "این یوزرنیم قبلاً ثبت شده است.";
export const SIGNUP_RETRY_LATER = "ثبت‌نام الان ممکن نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.";

export function isAuthUserAlreadyRegistered(message: string | null | undefined): boolean {
  return /already been registered|user already registered|already exists|duplicate key|unique constraint/i.test(
    String(message ?? ""),
  );
}

/** خطای ساخت حساب جدید — بدون بازنویسی رمز حساب موجود */
export function publicSignupCreateUserError(message: string | null | undefined): string {
  if (isAuthUserAlreadyRegistered(message)) return SIGNUP_USERNAME_TAKEN;
  if (/rate|too many|429/i.test(String(message ?? ""))) {
    return "تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.";
  }
  return SIGNUP_RETRY_LATER;
}

export function publicSignupProfileError(message: string | null | undefined): string {
  if (isAuthUserAlreadyRegistered(message) || /duplicate|unique/i.test(String(message ?? ""))) {
    return SIGNUP_USERNAME_TAKEN;
  }
  return SIGNUP_RETRY_LATER;
}

export const SIGNUP_STRIPPABLE_COLUMNS = [
  "phone",
  "receipt_note",
  "client_ip",
  "receipt_url",
  "password_set",
  "payment_confirmed",
] as const;

export function missingSignupColumnFromError(message: string | null | undefined): string | null {
  const msg = String(message ?? "");
  const m =
    msg.match(/could not find the ['"]?([a-z_]+)['"]? column/i) ||
    msg.match(/column ['"]?(?:[\w]+\.)?([a-z_]+)['"]? does not exist/i);
  const col = m?.[1]?.toLowerCase() ?? "";
  if ((SIGNUP_STRIPPABLE_COLUMNS as readonly string[]).includes(col)) return col;
  return null;
}

export function stripSignupColumn(
  payload: Record<string, unknown>,
  column: string,
): Record<string, unknown> {
  const next = { ...payload };
  delete next[column];
  return next;
}

export function shouldRetrySignupWithoutOptionalColumns(message: string | null | undefined): boolean {
  if (missingSignupColumnFromError(message)) return true;
  return /schema cache|column .* does not exist|could not find the/i.test(String(message ?? ""));
}

/** حساب auth از تلاش ناقص قبلی مانده — رمز را عوض نکن، همان کاربر را ادامه بده. */
export function shouldReuseExistingAuthUser(
  createUserMessage: string | null | undefined,
  hasActiveProfile: boolean,
): boolean {
  if (hasActiveProfile) return false;
  return isAuthUserAlreadyRegistered(createUserMessage);
}
