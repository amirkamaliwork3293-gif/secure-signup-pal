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

const THEME: Record<IranBank["hue"], { from: string; to: string; mid: string }> = {
  turquoise: { from: "#2DD4BF", mid: "#22D3EE", to: "#0EA5A4" },
  navy: { from: "#60A5FA", mid: "#818CF8", to: "#6366F1" },
  crimson: { from: "#FB7185", mid: "#F97316", to: "#F43F5E" },
  gold: { from: "#FBBF24", mid: "#FB923C", to: "#F59E0B" },
  forest: { from: "#34D399", mid: "#A3E635", to: "#10B981" },
  violet: { from: "#C084FC", mid: "#F472B6", to: "#8B5CF6" },
};

function Chip() {
  return (
    <div
      className="h-6 w-9 rounded-md"
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,.22) 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.7), 0 2px 6px rgba(0,0,0,.12)",
      }}
      aria-hidden
    />
  );
}

function Contactless() {
  return (
    <svg width="18" height="14" viewBox="0 0 24 20" aria-hidden className="text-white/80">
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
  const theme = THEME[bankHue(bank)];
  const grouped = card ? formatCardNumberDisplay(card, false) : "";

  return (
    <div className="[perspective:900px] pb-2">
      <div className="relative aspect-[1.586/1] w-full" style={{ transform: "rotateX(7deg)" }}>
        {/* ضخامت سه‌بعدی */}
        <div
          className="absolute inset-0 translate-y-2 rounded-[1.4rem]"
          style={{ background: theme.to, opacity: 0.35, filter: "blur(12px)" }}
        />

        <div
          className="relative h-full overflow-hidden rounded-[1.4rem] text-white"
          style={{
            background: `linear-gradient(145deg, ${theme.from} 0%, ${theme.mid} 48%, ${theme.to} 100%)`,
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,.45), inset 0 -12px 24px rgba(0,0,0,.12), 0 20px 40px -18px rgba(0,0,0,.35)",
          }}
          dir="ltr"
        >
          <div
            className="pointer-events-none absolute -left-10 -top-16 h-44 w-44 rounded-full"
            style={{ background: "rgba(255,255,255,.28)", filter: "blur(2px)" }}
          />
          <div
            className="pointer-events-none absolute -bottom-10 -right-8 h-36 w-36 rounded-full"
            style={{ background: "rgba(255,255,255,.18)" }}
          />

          <div className="relative flex h-full flex-col justify-between p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-[12px] font-medium text-white/90">{bank}</div>
              <Contactless />
            </div>

            <Chip />

            <div>
              {card ? (
                <div className="font-mono text-[17px] font-semibold tracking-[0.2em] sm:text-[19px]">
                  {grouped}
                </div>
              ) : (
                <div className="text-[11px] text-white/70">شماره کارت ثبت نشده</div>
              )}
              {iban && (
                <div className="mt-1 font-mono text-[10px] tracking-wide text-white/70">
                  {formatIbanDisplay(iban, false)}
                </div>
              )}
            </div>

            <div className="flex items-end justify-between gap-2 text-[12px] font-medium">
              <div className="min-w-0 truncate">{holder}</div>
              <div className="shrink-0 font-mono text-white/80">{validThru(account.createdAt)}</div>
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
      <IranianBankCardFace account={account} shopName={shopName} />
      {typeof balance === "number" && (
        <div className="mt-3 flex items-center justify-between text-[11px]">
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
  const theme = THEME[bankHue(bank)];
  return (
    <div
      className="relative min-w-[9.4rem] overflow-hidden rounded-2xl p-3 text-white"
      style={{
        background: `linear-gradient(145deg, ${theme.from}, ${theme.to})`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), 0 8px 16px -10px rgba(0,0,0,.25)",
      }}
    >
      <div className="truncate text-[10px] text-white/80">{bank || account.name}</div>
      <div className="mt-1 font-mono text-[11px] tracking-[0.16em] text-white/90" dir="ltr">
        {card.length >= 4 ? `•••• ${formatNumber(card.slice(-4))}` : account.name}
      </div>
    </div>
  );
}
