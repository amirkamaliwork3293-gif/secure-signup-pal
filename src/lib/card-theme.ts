import type { Account } from "@/lib/store";
import { bankFromCardNumber, bankHue, type IranBank } from "@/lib/iran-banks";

export type CardSwatch = {
  id: string;
  label: string;
  from: string;
  mid: string;
  to: string;
  /** اگر true باشد متن روی کارت تیره است (پس‌زمینه روشن) */
  darkText: boolean;
};

export const CARD_SWATCHES: CardSwatch[] = [
  { id: "mint", label: "نعنایی", from: "#5EEAD4", mid: "#2DD4BF", to: "#0F766E", darkText: false },
  { id: "sky", label: "آسمانی", from: "#7DD3FC", mid: "#38BDF8", to: "#2563EB", darkText: false },
  { id: "coral", label: "مرجانی", from: "#FDA4AF", mid: "#FB7185", to: "#E11D48", darkText: false },
  { id: "sun", label: "آفتابی", from: "#FDE68A", mid: "#FBBF24", to: "#D97706", darkText: false },
  { id: "lime", label: "سبز", from: "#BEF264", mid: "#84CC16", to: "#15803D", darkText: false },
  { id: "grape", label: "بنفش", from: "#D8B4FE", mid: "#C084FC", to: "#7C3AED", darkText: false },
  { id: "ink", label: "ذغالی", from: "#64748B", mid: "#334155", to: "#0F172A", darkText: false },
  { id: "ice", label: "یخی", from: "#F8FAFC", mid: "#E2E8F0", to: "#94A3B8", darkText: true },
];

const HUE_TO_SWATCH: Record<IranBank["hue"], string> = {
  turquoise: "mint",
  navy: "sky",
  crimson: "coral",
  gold: "sun",
  forest: "lime",
  violet: "grape",
};

function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b].map((x) => clampByte(x).toString(16).padStart(2, "0")).join("")}`;
}

function mix(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function luminance({ r, g, b }: { r: number; g: number; b: number }) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function defaultCardColorId(account?: { bankName?: string; cardNumber?: string }): string {
  return HUE_TO_SWATCH[bankHue(account?.bankName || bankFromCardNumber(account?.cardNumber))];
}

export function resolveCardTheme(
  account: Pick<Account, "cardColor" | "bankName" | "cardNumber">,
): CardSwatch {
  const raw = account.cardColor?.trim();
  if (raw) {
    const named = CARD_SWATCHES.find((s) => s.id === raw);
    if (named) return named;
    const rgb = parseHex(raw);
    if (rgb) {
      const from = toHex(mix(rgb, { r: 255, g: 255, b: 255 }, 0.28));
      const mid = toHex(rgb);
      const to = toHex(mix(rgb, { r: 15, g: 23, b: 42 }, 0.38));
      return {
        id: raw.startsWith("#") ? raw : `#${raw.replace("#", "")}`,
        label: "دلخواه",
        from,
        mid,
        to,
        darkText: luminance(rgb) > 0.62,
      };
    }
  }
  return CARD_SWATCHES.find((s) => s.id === defaultCardColorId(account)) ?? CARD_SWATCHES[0]!;
}
