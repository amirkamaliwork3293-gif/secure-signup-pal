/**
 * تطبیق نام گفته‌شده در ثبت صوتی فاکتور با مشتریان ذخیره‌شده.
 * از همان `scoreProduct` استفاده می‌شود تا رفتار fuzzy با بقیه‌ی برنامه یکی باشد.
 * این لایه چیزی در «مشتریان» نمی‌سازد — فقط اطلاعات پیش‌نویس فاکتور را پر می‌کند.
 */

import { customers, type Customer, type CustomerInfo } from "@/lib/store";
import { isClearPersonWinner, matchPersons, type PersonHit } from "@/lib/voice/person-match";

export type VoiceCustomerHit = PersonHit;

export function splitPersonName(name: string): { firstName: string; lastName?: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "" };
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function matchVoiceCustomers(phrase: string, list: Customer[]): VoiceCustomerHit[] {
  return matchPersons(phrase, list);
}

export function isClearCustomerWinner(hits: VoiceCustomerHit[]): boolean {
  return isClearPersonWinner(hits);
}

export function customerInfoFromVoice(
  name: string | undefined,
  phone: string | undefined,
  list: Customer[],
  previous?: CustomerInfo,
): { info: CustomerInfo; candidates: VoiceCustomerHit[]; clearWinner: boolean } {
  const hits = name ? matchVoiceCustomers(name, list) : [];
  const clearWinner = isClearCustomerWinner(hits);
  let info: CustomerInfo = { ...(previous ?? {}) };
  if (clearWinner) {
    const c = hits[0].customer;
    info = {
      firstName: c.firstName,
      lastName: c.lastName,
      phone: phone || c.phone,
    };
  } else if (name) {
    const split = splitPersonName(name);
    info = {
      ...info,
      firstName: split.firstName || info.firstName,
      lastName: split.lastName ?? info.lastName,
    };
  }
  if (phone) info.phone = phone;
  return { info, candidates: hits, clearWinner };
}

/** اگر مشتری موجود بدون تلفن است و شماره گفته شد، همان رکورد را تکمیل می‌کنیم. */
export function maybeFillCustomerPhone(matched: Customer | undefined, phone?: string) {
  if (!matched || !phone || matched.phone?.trim()) return;
  customers.update({ ...matched, phone });
}

export function customerHasInfo(c?: CustomerInfo | null): boolean {
  return !!(c?.firstName?.trim() || c?.lastName?.trim() || c?.phone?.trim());
}
