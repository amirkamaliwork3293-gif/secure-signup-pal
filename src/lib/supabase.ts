// Re-export the integration-managed Supabase client so existing imports
// (`@/lib/supabase`) keep working with Lovable Cloud.
export { supabase } from "@/integrations/supabase/client";

// ─── App-level types ─────────────────────────────────────────────────────────

export type SubscriptionPlan = "trial" | "1month" | "3month" | "6month" | "12month";

export type RequestStatus = "pending" | "approved" | "rejected";

export type ProfileStatus = "pending" | "active" | "expired" | "rejected";

export type UserProfile = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  plan: SubscriptionPlan | null;
  status: ProfileStatus;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export type SignupRequest = {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  plan: SubscriptionPlan;
  payment_confirmed: boolean;
  status: RequestStatus;
  password_set: boolean;
  created_at: string;
  reviewed_at: string | null;
};

// Duration in milliseconds — trial is 1 hour, others map to days
export const PLAN_DURATION_MS: Record<SubscriptionPlan, number> = {
  trial: 60 * 60 * 1000,
  "1month": 30 * 24 * 60 * 60 * 1000,
  "3month": 90 * 24 * 60 * 60 * 1000,
  "6month": 180 * 24 * 60 * 60 * 1000,
  "12month": 365 * 24 * 60 * 60 * 1000,
};

// kept for backward-compat with any caller; trial = 0 days
export const PLAN_DAYS: Record<SubscriptionPlan, number> = {
  trial: 0,
  "1month": 30,
  "3month": 90,
  "6month": 180,
  "12month": 365,
};

export const PLAN_LABEL: Record<SubscriptionPlan, string> = {
  trial: "نسخه تست (۱ ساعت)",
  "1month": "یک ماهه",
  "3month": "سه ماهه",
  "6month": "شش ماهه",
  "12month": "یک ساله",
};

export const PLAN_DURATION_LABEL: Record<SubscriptionPlan, string> = {
  trial: "۱ ساعت",
  "1month": "۳۰ روز",
  "3month": "۹۰ روز",
  "6month": "۱۸۰ روز",
  "12month": "۳۶۵ روز",
};

