/**
 * زمان‌بندی پنجرهٔ یادآوری پشتیبان‌گیری.
 * روزانه یا هفتگی؛ جدا از دادهٔ کسب‌وکار ذخیره می‌شود.
 */

export const BACKUP_REMINDER_KEY_PREFIX = "kamix.backupReminder.v1:";

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

export type BackupReminderFreq = "daily" | "weekly";

export type BackupReminderPref = {
  nextAt: number;
  freq: BackupReminderFreq;
};

export function backupReminderStorageKey(userId: string): string {
  return `${BACKUP_REMINDER_KEY_PREFIX}${userId}`;
}

export function backupReminderDue(pref: BackupReminderPref | null, now = Date.now()): boolean {
  if (!pref || !Number.isFinite(pref.nextAt)) return true;
  return now >= pref.nextAt;
}

export function snoozeBackupReminder(
  freq: BackupReminderFreq,
  now = Date.now(),
): BackupReminderPref {
  const wait = freq === "weekly" ? WEEK_MS : DAY_MS;
  return { nextAt: now + wait, freq };
}

export function readBackupReminderPref(userId: string): BackupReminderPref | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = localStorage.getItem(backupReminderStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BackupReminderPref;
    if (!parsed || typeof parsed.nextAt !== "number") return null;
    if (parsed.freq !== "daily" && parsed.freq !== "weekly") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBackupReminderPref(userId: string, pref: BackupReminderPref): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    localStorage.setItem(backupReminderStorageKey(userId), JSON.stringify(pref));
  } catch {
    /* ظرفیت پر یا حالت خصوصی — یادآوری دفعهٔ بعد دوباره نشان داده می‌شود */
  }
}
