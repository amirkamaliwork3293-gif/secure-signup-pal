/** وضعیت پنجره‌ی خوش‌آمد و پیشنهاد ویدیوی آموزشی — per-user در localStorage */
export type OnboardingChoice = "visited" | "dismissed";

const KEY = (userId: string) => `kamix_onboarding:${userId}`;

export function getOnboardingChoice(userId: string): OnboardingChoice | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const v = localStorage.getItem(KEY(userId));
    return v === "visited" || v === "dismissed" ? v : null;
  } catch {
    return null;
  }
}

export function shouldShowWelcomeTutorial(userId: string): boolean {
  return getOnboardingChoice(userId) === null;
}

export function saveOnboardingChoice(userId: string, choice: OnboardingChoice): void {
  try {
    localStorage.setItem(KEY(userId), choice);
  } catch {
    /* ignore quota errors */
  }
}
