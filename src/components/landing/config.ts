/**
 * Landing page trust facts and editable placeholders.
 *
 * Everything shown on the landing page that is a *claim* (numbers, guarantees,
 * testimonials) lives here so it can be checked and edited in one place.
 * Rule: only real, verifiable data. Anything left empty/null is simply not
 * rendered — the page never shows invented proof.
 */

export type LandingTestimonial = {
  /** Customer's name as they agreed to be shown, e.g. "رضا م." */
  name: string;
  /** Business type / city, e.g. "پوشاک — مشهد" */
  business: string;
  /** Their own words (with written permission). */
  quote: string;
};

export type LandingGuarantee = {
  title: string;
  body: string;
};

export const LANDING_TRUST = {
  /**
   * Active paying businesses. Provided by the owner (~2,000 active paying users,
   * Oct 2026). Set to 0 to hide every place this number appears.
   */
  activeBusinesses: 2000,

  /**
   * PLACEHOLDER — real customer testimonials. Empty = the section is hidden.
   * Add only quotes you have permission to publish.
   */
  testimonials: [] as LandingTestimonial[],

  /**
   * PLACEHOLDER — refund / satisfaction guarantee. null = hidden.
   * No refund policy exists in the codebase today, so nothing is shown.
   * Example shape: { title: "۷ روز ضمانت بازگشت وجه", body: "..." }
   */
  guarantee: null as LandingGuarantee | null,

  /**
   * PLACEHOLDER — support hours shown next to the contact channels.
   * The channels themselves (phone, WhatsApp, Telegram, Instagram, email)
   * come from the admin panel (landing_content.contact). Empty = hidden.
   */
  supportHours: "",
} as const;
