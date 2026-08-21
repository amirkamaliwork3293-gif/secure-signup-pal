import { useMemo, useState } from "react";
import { Copy, Check, Share2, CreditCard, Landmark } from "lucide-react";
import type { Account } from "@/lib/store";
import { formatToman, formatNumber } from "@/lib/store";
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

/** پالت لوکس کارت — سرمه‌ای، طلایی، پوست‌آهو؛ الهام از کارت‌های تذهیب ایرانی */
const NAVY: Record<IranBank["hue"], string> = {
  turquoise: "#08243b",
  navy: "#071a33",
  crimson: "#2a1020",
  gold: "#1a1408",
  forest: "#0a241c",
  violet: "#1a1030",
};

function validThru(createdAt?: number): string {
  const d = new Date((createdAt || Date.now()) + 5 * 365.25 * 86_400_000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${yy}`;
}

function GoldStar({ uid }: { uid: string }) {
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9 shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`${uid}-star`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7e7ad" />
          <stop offset="45%" stopColor="#d4af37" />
          <stop offset="100%" stopColor="#8a6418" />
        </linearGradient>
      </defs>
      <g fill={`url(#${uid}-star)`} stroke="#f3e0a0" strokeWidth="0.6">
        <polygon points="24,2 29,17 45,17 32,27 37,43 24,33 11,43 16,27 3,17 19,17" />
        <polygon
          points="24,10 27,19 36,19 29,25 32,34 24,28 16,34 19,25 12,19 21,19"
          opacity="0.55"
        />
      </g>
      <circle cx="24" cy="24" r="4.2" fill="#0b1f36" stroke="#f3e0a0" strokeWidth="0.8" />
    </svg>
  );
}

function Chip() {
  return (
    <div
      className="relative h-[1.7rem] w-[2.35rem] overflow-hidden rounded-[5px] border border-[#c9a227]"
      style={{
        background: "linear-gradient(145deg,#f6e7ad 0%,#d4af37 42%,#b08d2a 70%,#7a5c14 100%)",
        boxShadow: "inset 0 1px 0 #fff4c4, 0 1px 2px rgba(0,0,0,.35)",
      }}
      aria-hidden
    >
      <div className="absolute inset-x-1 top-[30%] h-px bg-[#7a5c14]/55" />
      <div className="absolute inset-x-1 top-[55%] h-px bg-[#7a5c14]/45" />
      <div className="absolute inset-y-1 left-[32%] w-px bg-[#7a5c14]/50" />
      <div className="absolute inset-y-1 left-[62%] w-px bg-[#7a5c14]/50" />
    </div>
  );
}

function Contactless() {
  return (
    <svg width="22" height="18" viewBox="0 0 24 20" aria-hidden className="text-[#e8c76b]">
      <path
        fill="currentColor"
        d="M8 3.8c3.4 0 6.2 2.8 6.2 6.2S11.4 16.2 8 16.2H6.2V3.8H8zm8.2 1.1c1 1.5 1.6 3.2 1.6 5.1s-.6 3.6-1.6 5.1l-1.4-.85c.8-1.2 1.25-2.65 1.25-4.25S15.6 7.85 14.8 6.65l1.4-.75zM20.2 2.6c1.55 2.3 2.45 5 2.45 7.9s-.9 5.6-2.45 7.9l-1.45-.9c1.35-2 2.1-4.4 2.1-7s-.75-5-2.1-7l1.45-.9z"
        opacity="0.92"
      />
    </svg>
  );
}

function ShetabMark({ uid }: { uid: string }) {
  return (
    <div className="flex items-center gap-1.5" dir="rtl">
      <svg viewBox="0 0 36 36" className="h-8 w-8" aria-hidden>
        <defs>
          <linearGradient id={`${uid}-sh`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f6e7ad" />
            <stop offset="100%" stopColor="#b08d2a" />
          </linearGradient>
        </defs>
        <circle cx="18" cy="18" r="16" fill="none" stroke={`url(#${uid}-sh)`} strokeWidth="1.4" />
        <path
          d="M10 22c4-9 12-12 17-8"
          fill="none"
          stroke={`url(#${uid}-sh)`}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M9 16c5 8 14 9 19 2"
          fill="none"
          stroke={`url(#${uid}-sh)`}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <div className="leading-none">
        <div className="text-[11px] font-bold tracking-wide text-[#f1d48a]">شتاب</div>
        <div className="text-[7px] tracking-[0.18em] text-[#e8c76b]/80">SHETAB</div>
      </div>
    </div>
  );
}

/** نقوش تذهیب و اسلیمی روی زمینه سرمه‌ای + ترنج طلایی و پنل پوست‌آهو */
function CardOrnament({ uid, navy }: { uid: string; navy: string }) {
  return (
    <svg
      viewBox="0 0 162 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <pattern id={`${uid}-vine`} width="28" height="24" patternUnits="userSpaceOnUse">
          <path
            d="M2 12 C7 4, 14 4, 18 12 C14 20, 7 20, 2 12 M18 12 C22 7, 26 8, 27 12"
            fill="none"
            stroke="#3d6a94"
            strokeWidth="0.45"
            opacity="0.7"
          />
          <path d="M9 7 C11 5, 13 5, 14 8 C12 9, 10 9, 9 7" fill="#2a5680" opacity="0.5" />
          <circle cx="5" cy="6" r="0.55" fill="#c9a227" opacity="0.4" />
          <circle cx="22" cy="17" r="0.45" fill="#c9a227" opacity="0.35" />
        </pattern>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7e7ad" />
          <stop offset="50%" stopColor="#d4af37" />
          <stop offset="100%" stopColor="#8a6418" />
        </linearGradient>
        <linearGradient id={`${uid}-cream`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#efe3c4" />
          <stop offset="100%" stopColor="#f7efd8" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="68%" cy="42%" r="50%">
          <stop offset="0%" stopColor="#1a4a6e" stopOpacity="0.4" />
          <stop offset="100%" stopColor={navy} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="162" height="100" fill={navy} />
      <rect width="122" height="100" fill={`url(#${uid}-vine)`} />
      <rect width="162" height="100" fill={`url(#${uid}-glow)`} />

      <path
        d="M118 0 C126 16, 126 36, 120 50 C128 66, 138 82, 148 100 L162 100 L162 0 Z"
        fill={`url(#${uid}-cream)`}
      />
      <path
        d="M118 0 C126 16, 126 36, 120 50 C128 66, 138 82, 148 100"
        fill="none"
        stroke={`url(#${uid}-gold)`}
        strokeWidth="1.35"
      />
      <path
        d="M120.2 0 C128 16, 128 36, 122.2 50 C130 66, 140 82, 150 100"
        fill="none"
        stroke={`url(#${uid}-gold)`}
        strokeWidth="0.4"
        opacity="0.7"
      />

      <g transform="translate(118 50)" opacity="0.96">
        <ellipse
          cx="0"
          cy="0"
          rx="16"
          ry="24"
          fill="none"
          stroke={`url(#${uid}-gold)`}
          strokeWidth="1.15"
        />
        <ellipse
          cx="0"
          cy="0"
          rx="11.5"
          ry="18"
          fill="none"
          stroke={`url(#${uid}-gold)`}
          strokeWidth="0.55"
        />
        <circle cx="0" cy="0" r="3.8" fill={`url(#${uid}-gold)`} />
      </g>

      <path
        d="M6 7 C12 5, 14 13, 10 15 C16 17, 12 24, 6 20 C4 15, 4 9, 6 7"
        fill="none"
        stroke="#d4af37"
        strokeWidth="0.7"
        opacity="0.5"
      />
      <path
        d="M6 93 C12 95, 14 87, 10 85 C16 83, 12 76, 6 80 C4 85, 4 91, 6 93"
        fill="none"
        stroke="#d4af37"
        strokeWidth="0.7"
        opacity="0.5"
      />
    </svg>
  );
}

export function IranianBankCardFace({
  account,
  shopName,
}: {
  account: Account;
  shopName?: string;
  balance?: number;
}) {
  const card = digitsOnly(account.cardNumber);
  const iban = normalizeIban(account.iban);
  const bank = account.bankName || bankFromCardNumber(account.cardNumber) || "کارت بانکی ایران";
  const holder = account.holderName || account.name;
  const hue = bankHue(bank);
  const uid = `lux${account.id.replace(/[^a-zA-Z0-9]/g, "")}`;
  const navy = NAVY[hue];
  const grouped = card ? formatCardNumberDisplay(card, false) : "";

  return (
    <div
      className="relative aspect-[1.62/1] w-full overflow-hidden rounded-2xl"
      style={{
        boxShadow: "0 18px 40px -12px rgba(8,20,40,.55), inset 0 0 0 1px rgba(212,175,55,.35)",
      }}
      dir="ltr"
    >
      <CardOrnament uid={uid} navy={navy} />
      <svg
        viewBox="0 0 80 80"
        className="pointer-events-none absolute top-1/2 left-[70%] h-[58%] w-[28%] -translate-x-1/2 -translate-y-1/2"
        aria-hidden
      >
        <defs>
          <linearGradient id={`${uid}-med`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f7e7ad" />
            <stop offset="50%" stopColor="#d4af37" />
            <stop offset="100%" stopColor="#8a6418" />
          </linearGradient>
        </defs>
        {Array.from({ length: 10 }).map((_, i) => (
          <path
            key={i}
            d="M40 8 Q48 28 40 40 Q32 28 40 8"
            fill="#145a56"
            stroke={`url(#${uid}-med)`}
            strokeWidth="0.7"
            transform={`rotate(${i * 36} 40 40)`}
            opacity="0.9"
          />
        ))}
        <circle cx="40" cy="40" r="7" fill={`url(#${uid}-med)`} />
        <circle cx="40" cy="40" r="3.2" fill="#0b1f36" />
      </svg>
      <div className="pointer-events-none absolute inset-[6px] rounded-[14px] border border-[#d4af37]/35" />

      <div className="relative flex h-full flex-col justify-between p-3.5 sm:p-4">
        <div className="flex max-w-[68%] items-start gap-2">
          <GoldStar uid={uid} />
          <div className="min-w-0 pt-0.5">
            <div className="truncate text-[13px] font-bold leading-tight text-[#f6e7ad]">
              {bank}
            </div>
            <div className="text-[8px] tracking-[0.22em] text-[#e8c76b]/80">IRAN SHETAB CARD</div>
          </div>
        </div>

        <div className="mt-1 flex max-w-[68%] items-center gap-3">
          <Chip />
          <Contactless />
        </div>

        <div className="max-w-[70%]">
          {card ? (
            <div
              className="font-mono text-[15px] font-bold tracking-[0.22em] text-[#f3e0a0] sm:text-[18px]"
              style={{
                textShadow: "0 1px 0 #fff6c8, 0 2px 0 #9a7a28, 0 3px 6px rgba(0,0,0,.45)",
              }}
            >
              {grouped}
            </div>
          ) : (
            <div className="text-[11px] text-[#e8c76b]/80">شماره کارت ثبت نشده</div>
          )}
          <div className="mt-1 text-center text-[8px] tracking-[0.28em] text-[#e8c76b]">
            VALID THRU {validThru(account.createdAt)}
          </div>
          {iban && (
            <div className="mt-1 font-mono text-[8px] tracking-wider text-[#f1d48a]/85 sm:text-[9px]">
              {formatIbanDisplay(iban, false)}
            </div>
          )}
        </div>

        <div className="flex max-w-[72%] items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f6e7ad]">
              {holder}
            </div>
            {shopName && shopName !== holder && (
              <div className="truncate text-[8px] text-[#e8c76b]/75">{shopName}</div>
            )}
          </div>
          <ShetabMark uid={uid} />
        </div>
      </div>

      {/* خوشنویسی تزئینی روی پنل پوست‌آهو */}
      <div
        className="pointer-events-none absolute bottom-[14%] right-[3%] top-[12%] flex w-[18%] items-center justify-center"
        dir="rtl"
      >
        <div
          className="rotate-[-8deg] text-center font-serif text-[9px] leading-5 text-[#3a2a12]/80 sm:text-[10px]"
          style={{ fontFamily: "Vazirmatn, Tahoma, serif" }}
        >
          هنر نزد
          <br />
          ایرانیان
          <br />
          است و بس
        </div>
      </div>
    </div>
  );
}

export function IranianBankCard({
  account,
  shopName,
  balance,
}: {
  account: Account;
  shopName?: string;
  balance?: number;
}) {
  const [copied, setCopied] = useState<"card" | "iban" | "all" | null>(null);
  const [sharing, setSharing] = useState(false);

  const bank = account.bankName || bankFromCardNumber(account.cardNumber);
  const hasCard = digitsOnly(account.cardNumber).length >= 4;
  const hasIban = !!normalizeIban(account.iban);

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

  if (!hasCard && !hasIban) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Landmark className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{account.name}</div>
          <div className="text-[11px] text-muted-foreground">
            برای نمایش کارت زیبا، شماره کارت یا شبا را ثبت کنید
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
      <IranianBankCardFace account={account} shopName={shopName} />
      {typeof balance === "number" && (
        <div className="mt-1.5 flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">موجودی این کارت</span>
          <span className={`font-bold ${balance < 0 ? "text-destructive" : "text-foreground"}`}>
            {formatToman(balance)}
          </span>
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-1.5">
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
          ارسال برای مشتری
        </button>
      </div>
      {copied === "all" && (
        <div className="mt-1.5 text-center text-[10px] text-green-700">اطلاعات کارت کپی شد</div>
      )}
    </div>
  );
}

export function MiniBankChip({ account }: { account: Account }) {
  const card = digitsOnly(account.cardNumber);
  const bank = account.bankName || bankFromCardNumber(account.cardNumber);
  const hue = bankHue(bank);
  return (
    <div
      className="relative min-w-[9.4rem] overflow-hidden rounded-2xl p-3 text-[#f6e7ad] shadow-card"
      style={{
        background: `linear-gradient(145deg, ${NAVY[hue]} 0%, #0c3050 100%)`,
        boxShadow: "inset 0 0 0 1px rgba(212,175,55,.35)",
      }}
    >
      <div className="truncate text-[10px] text-[#e8c76b]">{bank || account.name}</div>
      <div className="mt-1 font-mono text-[11px] tracking-[0.18em]" dir="ltr">
        {card.length >= 4 ? `•••• ${formatNumber(card.slice(-4))}` : account.name}
      </div>
    </div>
  );
}
