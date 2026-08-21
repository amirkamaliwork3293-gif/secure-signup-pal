import { useMemo, useRef, useState } from "react";
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

const HUE_BG: Record<IranBank["hue"], string> = {
  turquoise: "linear-gradient(145deg, #0b3a42 0%, #146b6a 42%, #0e4d5c 78%, #16324a 100%)",
  navy: "linear-gradient(145deg, #0b1f3a 0%, #163a6b 45%, #0f2a4a 100%)",
  crimson: "linear-gradient(145deg, #4a1218 0%, #7a1f2b 40%, #3d1016 100%)",
  gold: "linear-gradient(145deg, #3d2a0c 0%, #6b4a16 42%, #2c1c08 100%)",
  forest: "linear-gradient(145deg, #0e2e1c 0%, #1a5a38 45%, #0c2418 100%)",
  violet: "linear-gradient(145deg, #2a1540 0%, #4a2670 45%, #1c0e2e 100%)",
};

function GirihPattern({ id }: { id: string }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]" aria-hidden>
      <defs>
        <pattern id={id} width="56" height="48" patternUnits="userSpaceOnUse">
          <path
            d="M28 2 L42 10 L42 26 L28 34 L14 26 L14 10 Z M28 14 L36 18 L36 26 L28 30 L20 26 L20 18 Z"
            fill="none"
            stroke="#e8c872"
            strokeWidth="0.7"
          />
          <circle cx="28" cy="2" r="1.2" fill="#e8c872" />
          <circle cx="42" cy="10" r="1.2" fill="#e8c872" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

function Shamsa({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      <g fill="none" stroke="#e8c872" strokeWidth="1.2" opacity="0.55">
        {Array.from({ length: 16 }).map((_, i) => (
          <path key={i} d="M60 60 L60 8" transform={`rotate(${i * 22.5} 60 60)`} />
        ))}
        <circle cx="60" cy="60" r="18" />
        <circle cx="60" cy="60" r="28" />
        <circle cx="60" cy="60" r="8" fill="#e8c872" stroke="none" opacity="0.35" />
      </g>
    </svg>
  );
}

function Chip() {
  return (
    <div className="relative h-8 w-11 overflow-hidden rounded-[6px] border border-[#c9a227]/80 bg-gradient-to-br from-[#f3e0a0] via-[#d4af37] to-[#8a6a1a] shadow-sm">
      <div className="absolute inset-x-1 top-1/3 h-px bg-[#8a6a1a]/50" />
      <div className="absolute inset-y-1 left-1/3 w-px bg-[#8a6a1a]/50" />
      <div className="absolute inset-y-1 left-2/3 w-px bg-[#8a6a1a]/50" />
    </div>
  );
}

export function IranianBankCardFace({
  account,
  shopName,
  balance,
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
  const patternId = `girih-${account.id}`;

  return (
    <div
      className="relative aspect-[1.62/1] w-full overflow-hidden rounded-2xl text-white shadow-[0_18px_40px_-12px_rgba(20,40,50,0.55)]"
      style={{ background: HUE_BG[hue] }}
      dir="rtl"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(120% 80% at 100% 0%, rgba(232,200,114,0.25), transparent 55%), radial-gradient(90% 70% at 0% 100%, rgba(90,200,190,0.18), transparent 50%)",
        }}
      />
      <GirihPattern id={patternId} />
      <Shamsa className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2" />

      <div className="pointer-events-none absolute inset-[7px] rounded-xl border border-[#e8c872]/45" />
      <div className="pointer-events-none absolute inset-[11px] rounded-[10px] border border-[#e8c872]/20" />

      <div className="relative flex h-full flex-col justify-between p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] tracking-widest text-[#e8c872]/80">کارت شتاب</div>
            <div className="mt-0.5 truncate text-sm font-bold leading-snug">{bank}</div>
          </div>
          <div className="flex items-center gap-2">
            <Chip />
            <svg width="22" height="18" viewBox="0 0 24 20" aria-hidden className="text-[#e8c872]">
              <path
                fill="currentColor"
                d="M8 4c3.3 0 6 2.7 6 6s-2.7 6-6 6H6V4h2zm8.5 1.2c.9 1.4 1.5 3.1 1.5 4.8s-.6 3.4-1.5 4.8l-1.3-.8c.7-1.2 1.2-2.5 1.2-4s-.5-2.8-1.2-4l1.3-.8zM20 3c1.5 2.2 2.4 4.8 2.4 7.5S21.5 15.8 20 18l-1.4-.9c1.3-1.9 2-4.2 2-6.6s-.7-4.7-2-6.6L20 3z"
                opacity="0.85"
              />
            </svg>
          </div>
        </div>

        <div>
          {card ? (
            <div
              className="font-mono text-[17px] font-semibold tracking-[0.18em] text-[#f6edd0] sm:text-[19px]"
              dir="ltr"
              style={{ textShadow: "0 1px 0 rgba(0,0,0,.35)" }}
            >
              {formatCardNumberDisplay(card)}
            </div>
          ) : (
            <div className="text-xs text-white/70">شماره کارت ثبت نشده</div>
          )}
          {iban && (
            <div
              className="mt-1.5 rounded-md border border-[#e8c872]/30 bg-black/15 px-2 py-1"
              dir="ltr"
            >
              <div className="text-[8px] tracking-widest text-[#e8c872]/80">IBAN / شبا</div>
              <div className="font-mono text-[11px] tracking-wide text-[#f6edd0] sm:text-xs">
                {formatIbanDisplay(iban)}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[9px] text-[#e8c872]/75">صاحب حساب</div>
            <div className="truncate text-sm font-semibold">{holder}</div>
            {shopName && shopName !== holder && (
              <div className="truncate text-[10px] text-white/70">{shopName}</div>
            )}
          </div>
          {typeof balance === "number" && (
            <div className="shrink-0 text-left" dir="rtl">
              <div className="text-[9px] text-[#e8c872]/75">موجودی</div>
              <div
                className={`text-xs font-bold ${balance < 0 ? "text-red-200" : "text-[#f6edd0]"}`}
              >
                {formatToman(balance)}
              </div>
            </div>
          )}
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
  const faceRef = useRef<HTMLDivElement>(null);

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
      <div ref={faceRef}>
        <IranianBankCardFace account={account} shopName={shopName} balance={balance} />
      </div>
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
      className="relative min-w-[9.2rem] overflow-hidden rounded-2xl p-3 text-white shadow-card"
      style={{ background: HUE_BG[hue] }}
    >
      <div className="truncate text-[10px] text-[#e8c872]/90">{bank || account.name}</div>
      <div className="mt-1 font-mono text-[11px] tracking-wider text-[#f6edd0]" dir="ltr">
        {card.length >= 4 ? `•••• ${formatNumber(card.slice(-4))}` : account.name}
      </div>
    </div>
  );
}
