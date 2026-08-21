import { useMemo, useState } from "react";
import { Copy, Check, Share2, CreditCard, Landmark, ChevronDown } from "lucide-react";
import type { Account } from "@/lib/store";
import { accounts as accountsStore, formatToman, formatNumber } from "@/lib/store";
import {
  bankFromCardNumber,
  bankHue,
  cardShareText,
  digitsOnly,
  formatCardNumberDisplay,
  formatIbanDisplay,
  normalizeIban,
  type IranBank,
} from "@/lib/iran-banks";
import { copyText, shareText } from "@/lib/openExternal";

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

function parseHex(hex: string): { r: number; g: number; b: number } | null {
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

export function defaultCardColorId(account?: {
  bankName?: string;
  cardNumber?: string;
}): string {
  return HUE_TO_SWATCH[bankHue(account.bankName || bankFromCardNumber(account.cardNumber))];
}

export function resolveCardTheme(account: Pick<Account, "cardColor" | "bankName" | "cardNumber">): CardSwatch {
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

function Chip({ dark }: { dark?: boolean }) {
  return (
    <div
      className="relative h-[1.35rem] w-[1.95rem] overflow-hidden rounded-[5px]"
      style={{
        background: dark
          ? "linear-gradient(135deg, #FDE68A 0%, #D97706 55%, #92400E 100%)"
          : "linear-gradient(135deg, rgba(255,255,255,.75) 0%, rgba(255,255,255,.28) 100%)",
        boxShadow: dark
          ? "inset 0 1px 0 rgba(255,255,255,.45), 0 1px 3px rgba(0,0,0,.2)"
          : "inset 0 1px 0 rgba(255,255,255,.8), 0 2px 6px rgba(0,0,0,.12)",
      }}
      aria-hidden
    >
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            "linear-gradient(90deg, transparent 32%, rgba(0,0,0,.18) 33%, rgba(0,0,0,.18) 35%, transparent 36%), linear-gradient(0deg, transparent 42%, rgba(0,0,0,.18) 43%, rgba(0,0,0,.18) 57%, transparent 58%)",
        }}
      />
    </div>
  );
}

function Contactless({ className }: { className?: string }) {
  return (
    <svg width="16" height="13" viewBox="0 0 24 20" aria-hidden className={className}>
      <path
        fill="currentColor"
        d="M8 4c3.2 0 5.8 2.6 5.8 5.8S11.2 15.6 8 15.6H6.4V4H8zm7.6 1.2c.9 1.4 1.4 3 1.4 4.8s-.5 3.4-1.4 4.8l-1.3-.8c.7-1.1 1.1-2.5 1.1-4s-.4-2.9-1.1-4l1.3-.8z"
      />
    </svg>
  );
}

function validThru(createdAt?: number): string {
  const d = new Date((createdAt || Date.now()) + 5 * 365.25 * 86_400_000);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
}

export function CardColorPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: string) => void;
}) {
  const customHex = value && parseHex(value) ? (value.startsWith("#") ? value : `#${value}`) : "#38BDF8";
  return (
    <div className="flex flex-wrap items-center gap-1.5" dir="rtl">
      <span className="ml-1 text-[10px] text-muted-foreground">رنگ کارت</span>
      {CARD_SWATCHES.map((s) => {
        const active = (value || "mint") === s.id;
        return (
          <button
            key={s.id}
            type="button"
            title={s.label}
            aria-label={s.label}
            aria-pressed={active}
            onClick={() => onChange(s.id)}
            className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              background: `linear-gradient(145deg, ${s.from}, ${s.to})`,
              borderColor: active ? "hsl(var(--foreground))" : "transparent",
              boxShadow: active ? "0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--foreground) / .25)" : undefined,
            }}
          />
        );
      })}
      <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-border" title="رنگ دلخواه">
        <span className="sr-only">رنگ دلخواه</span>
        <input
          type="color"
          value={customHex}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span
          className="block h-full w-full"
          style={{
            background:
              "conic-gradient(#fb7185, #fbbf24, #34d399, #38bdf8, #c084fc, #fb7185)",
          }}
        />
      </label>
    </div>
  );
}

export function IranianBankCardFace({
  account,
}: {
  account: Account;
  shopName?: string;
  balance?: number;
}) {
  const card = digitsOnly(account.cardNumber);
  const iban = normalizeIban(account.iban);
  const bank = account.bankName || bankFromCardNumber(account.cardNumber) || "کارت بانکی";
  const holder = account.holderName || account.name;
  const theme = resolveCardTheme(account);
  const grouped = card ? formatCardNumberDisplay(card, false) : "";
  const ink = theme.darkText ? "text-slate-800" : "text-white";
  const muted = theme.darkText ? "text-slate-500" : "text-white/70";

  return (
    <div className="mx-auto w-full max-w-[20rem] [perspective:1100px]">
      <div className="relative aspect-[1.586/1] w-full" style={{ transform: "rotateX(5deg)" }}>
        <div
          className="absolute inset-x-3 bottom-0 h-4 rounded-full blur-md"
          style={{ background: theme.to, opacity: 0.45 }}
        />
        <div
          className={`relative h-full overflow-hidden rounded-[1.15rem] ${ink}`}
          style={{
            background: `linear-gradient(152deg, ${theme.from} 0%, ${theme.mid} 46%, ${theme.to} 100%)`,
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,.42), inset 0 -10px 20px rgba(0,0,0,.1), 0 14px 28px -16px rgba(15,23,42,.45)",
          }}
          dir="ltr"
        >
          <div
            className="pointer-events-none absolute -left-8 -top-12 h-36 w-36 rounded-full"
            style={{ background: theme.darkText ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.28)" }}
          />
          <div
            className="pointer-events-none absolute -bottom-12 -right-6 h-32 w-32 rounded-full"
            style={{ background: theme.darkText ? "rgba(15,23,42,.08)" : "rgba(255,255,255,.14)" }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.18]"
            style={{
              background:
                "linear-gradient(115deg, transparent 28%, rgba(255,255,255,.9) 48%, transparent 62%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "radial-gradient(rgba(255,255,255,.9) 0.6px, transparent 0.7px)",
              backgroundSize: "7px 7px",
            }}
          />

          <div className="relative flex h-full flex-col justify-between px-4 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className={`truncate text-[11px] font-medium tracking-wide ${muted}`}>{bank}</div>
              <Contactless className={muted} />
            </div>

            <Chip dark={theme.darkText} />

            <div>
              {card ? (
                <div className="font-mono text-[15px] font-semibold tracking-[0.18em] sm:text-[16px]">
                  {grouped}
                </div>
              ) : (
                <div className={`text-[11px] ${muted}`}>شماره کارت ثبت نشده</div>
              )}
              {iban && (
                <div className={`mt-0.5 font-mono text-[9px] tracking-wider ${muted}`}>
                  {formatIbanDisplay(iban, false)}
                </div>
              )}
            </div>

            <div className="flex items-end justify-between gap-2 text-[11px] font-medium">
              <div className="min-w-0 truncate">{holder}</div>
              <div className={`shrink-0 font-mono ${muted}`}>{validThru(account.createdAt)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function IranianBankCard({
  account,
  shopName,
  balance,
  expanded,
  onExpandedChange,
}: {
  account: Account;
  shopName?: string;
  balance?: number;
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState<"card" | "iban" | "all" | null>(null);
  const [sharing, setSharing] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);

  const open = expanded ?? localOpen;
  const setOpen = (v: boolean) => {
    onExpandedChange?.(v);
    if (expanded === undefined) setLocalOpen(v);
  };

  const bank = account.bankName || bankFromCardNumber(account.cardNumber);
  const hasCard = digitsOnly(account.cardNumber).length >= 4;
  const hasIban = !!normalizeIban(account.iban);
  const theme = resolveCardTheme(account);
  const last4 = digitsOnly(account.cardNumber).slice(-4);

  const shareBody = useMemo(
    () =>
      cardShareText({
        shopName,
        holderName: account.holderName || account.name,
        bankName: bank,
        cardNumber: account.cardNumber,
        iban: account.iban,
      }),
    [account, bank, shopName],
  );

  const flash = (k: "card" | "iban" | "all") => {
    setCopied(k);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const copy = async (kind: "card" | "iban" | "all") => {
    const text =
      kind === "card"
        ? formatCardNumberDisplay(account.cardNumber, false).replace(/\s/g, "")
        : kind === "iban"
          ? normalizeIban(account.iban)
          : shareBody;
    if (!text) return;
    const ok = await copyText(text);
    if (ok) flash(kind);
    else alert("کپی پشتیبانی نشد. متن را دستی انتخاب کنید.");
  };

  const share = async () => {
    if (!hasCard && !hasIban) {
      alert("ابتدا شماره کارت یا شبا را در ویرایش حساب وارد کنید.");
      return;
    }
    setSharing(true);
    try {
      await shareText({ title: bank || "کارت بانکی", text: shareBody });
    } finally {
      setSharing(false);
    }
  };

  const saveColor = (id: string) => {
    accountsStore.update({ ...account, cardColor: id });
  };

  if (!hasCard && !hasIban) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Landmark className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{account.name}</div>
          <div className="text-[11px] text-muted-foreground">
            برای نمایش کارت، شماره کارت یا شبا را ثبت کنید
          </div>
          {typeof balance === "number" && (
            <div
              className={`mt-0.5 text-sm font-bold ${balance < 0 ? "text-destructive" : "text-success"}`}
            >
              {formatToman(balance)}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl px-1 py-1 text-right transition-colors hover:bg-accent/60"
      >
        <span
          className="relative h-9 w-[3.35rem] shrink-0 overflow-hidden rounded-lg"
          style={{
            background: `linear-gradient(145deg, ${theme.from}, ${theme.to})`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), 0 4px 8px -4px rgba(0,0,0,.25)",
          }}
          aria-hidden
        >
          <span className="absolute -left-2 -top-3 h-7 w-7 rounded-full bg-white/25" />
          <span
            className={`absolute bottom-1 left-1 font-mono text-[8px] tracking-wider ${
              theme.darkText ? "text-slate-700" : "text-white/90"
            }`}
            dir="ltr"
          >
            {last4 ? formatNumber(last4) : "IBAN"}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {account.name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" dir="ltr">
            {bank ? `${bank}  ` : ""}
            {last4 ? `•••• ${formatNumber(last4)}` : "شبا ثبت‌شده"}
          </span>
        </span>
        {typeof balance === "number" && (
          <span
            className={`shrink-0 text-[12px] font-bold ${balance < 0 ? "text-destructive" : "text-foreground"}`}
          >
            {formatToman(balance)}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <IranianBankCardFace account={account} shopName={shopName} />
          <CardColorPicker value={account.cardColor || defaultCardColorId(account)} onChange={saveColor} />
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => copy("card")}
              disabled={!hasCard}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-card py-2 text-[11px] font-medium disabled:opacity-40"
            >
              {copied === "card" ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              کپی کارت
            </button>
            <button
              type="button"
              onClick={() => copy("iban")}
              disabled={!hasIban}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-card py-2 text-[11px] font-medium disabled:opacity-40"
            >
              {copied === "iban" ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <CreditCard className="h-3.5 w-3.5" />
              )}
              کپی شبا
            </button>
            <button
              type="button"
              onClick={share}
              disabled={sharing}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-primary py-2 text-[11px] font-semibold text-primary-foreground"
            >
              <Share2 className="h-3.5 w-3.5" />
              ارسال
            </button>
          </div>
          {copied === "all" && (
            <div className="text-center text-[10px] text-green-700">اطلاعات کارت کپی شد</div>
          )}
        </div>
      )}
    </div>
  );
}

export function MiniBankChip({ account }: { account: Account }) {
  const card = digitsOnly(account.cardNumber);
  const bank = account.bankName || bankFromCardNumber(account.cardNumber);
  const theme = resolveCardTheme(account);
  const ink = theme.darkText ? "text-slate-800" : "text-white";
  const muted = theme.darkText ? "text-slate-500" : "text-white/80";
  return (
    <div
      className={`relative min-w-[8.6rem] overflow-hidden rounded-2xl p-2.5 ${ink}`}
      style={{
        background: `linear-gradient(145deg, ${theme.from}, ${theme.to})`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), 0 8px 16px -10px rgba(0,0,0,.25)",
      }}
    >
      <div className={`truncate text-[10px] ${muted}`}>{bank || account.name}</div>
      <div className={`mt-1 font-mono text-[11px] tracking-[0.16em] ${ink} opacity-90`} dir="ltr">
        {card.length >= 4 ? `•••• ${formatNumber(card.slice(-4))}` : account.name}
      </div>
    </div>
  );
}
