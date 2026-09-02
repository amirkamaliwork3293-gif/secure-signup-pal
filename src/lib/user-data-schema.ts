/**
 * ستون‌های اختیاری user_data ممکن است روی سوپابیس زنده هنوز migrate نشده باشند.
 * PostgREST در آن حالت کل upsert را با schema cache رد می‌کند.
 */

const OPTIONAL_USER_DATA_COLUMNS = [
  "customers",
  "students",
  "purchases",
  "expenses",
  "reminders",
  "accounts",
  "account_txs",
  "production",
  "manual_ledger",
] as const;

export function missingUserDataColumnFromError(message: string | null | undefined): string | null {
  const msg = String(message ?? "");
  const m =
    msg.match(/could not find the ['"]?([a-z_]+)['"]? column of ['"]?user_data['"]?/i) ||
    msg.match(/column ['"]?user_data\.([a-z_]+)['"]? does not exist/i) ||
    msg.match(/Could not find the '([a-z_]+)' column/i);
  const col = m?.[1]?.toLowerCase() ?? "";
  if (!col) return null;
  if ((OPTIONAL_USER_DATA_COLUMNS as readonly string[]).includes(col)) return col;
  return null;
}

export function stripMissingUserDataColumn(
  payload: Record<string, unknown>,
  column: string,
): Record<string, unknown> {
  const next = { ...payload };
  delete next[column];
  return next;
}
