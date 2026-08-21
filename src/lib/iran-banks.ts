/**
 * بانک‌های ایران، تشخیص از روی BIN کارت، قالب شماره کارت / شبا / شناسه صیادی.
 * فهرست BIN بر اساس پیش‌شماره‌های رایج شبکه شتاب است.
 */

export type IranBank = {
  name: string;
  /** رنگ غالب کارت — برای تم سنتی هر بانک */
  hue: "turquoise" | "navy" | "crimson" | "gold" | "forest" | "violet";
};

export const IRAN_BANKS: { name: string; bins: string[] }[] = [
  { name: "بانک ملی ایران", bins: ["603799", "170019"] },
  { name: "بانک سپه", bins: ["589210"] },
  { name: "بانک ملت", bins: ["610433", "991975"] },
  { name: "بانک صادرات ایران", bins: ["603769"] },
  { name: "بانک تجارت", bins: ["627353", "585983"] },
  { name: "بانک رفاه کارگران", bins: ["589463"] },
  { name: "بانک مسکن", bins: ["628023"] },
  { name: "بانک کشاورزی", bins: ["603770", "639217"] },
  { name: "پست بانک ایران", bins: ["627760"] },
  { name: "بانک توسعه تعاون", bins: ["502908"] },
  { name: "بانک صنعت و معدن", bins: ["627961"] },
  { name: "بانک توسعه صادرات", bins: ["627648"] },
  { name: "بانک اقتصاد نوین", bins: ["627412"] },
  { name: "بانک پارسیان", bins: ["622106", "627884", "639194"] },
  { name: "بانک پاسارگاد", bins: ["502229", "639347"] },
  { name: "بانک سامان", bins: ["621986"] },
  { name: "بانک سینا", bins: ["639346"] },
  { name: "بانک سرمایه", bins: ["639607"] },
  { name: "بانک آینده", bins: ["636214"] },
  { name: "بانک شهر", bins: ["502806", "504706"] },
  { name: "بانک دی", bins: ["502938"] },
  { name: "بانک گردشگری", bins: ["505416"] },
  { name: "بانک ایران زمین", bins: ["505785"] },
  { name: "بانک خاورمیانه", bins: ["585947"] },
  { name: "بانک کارآفرین", bins: ["627488"] },
  { name: "بانک قرض‌الحسنه مهر ایران", bins: ["606373"] },
  { name: "بانک قرض‌الحسنه رسالت", bins: ["504172"] },
  { name: "موسسه اعتباری ملل", bins: ["606256"] },
  { name: "موسسه اعتباری کوثر", bins: ["505801"] },
  { name: "بانک مرکزی", bins: ["636795"] },
];

/** نام بانک‌ها برای انتخاب در فرم چک (بدون تکرار، مرتب) */
export const IRAN_BANK_NAMES: string[] = Array.from(new Set(IRAN_BANKS.map((b) => b.name))).sort(
  (a, b) => a.localeCompare(b, "fa"),
);

const BIN_TO_BANK: Record<string, string> = {};
for (const b of IRAN_BANKS) {
  for (const bin of b.bins) BIN_TO_BANK[bin] = b.name;
}

export function digitsOnly(s: string | undefined | null): string {
  if (!s) return "";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let out = "";
  for (const ch of String(s)) {
    const fi = fa.indexOf(ch);
    const ai = ar.indexOf(ch);
    if (fi >= 0) out += String(fi);
    else if (ai >= 0) out += String(ai);
    else if (ch >= "0" && ch <= "9") out += ch;
  }
  return out;
}

/** تشخیص نام بانک از ۶ رقم اول کارت */
export function bankFromCardNumber(cardNumber?: string): string | undefined {
  const d = digitsOnly(cardNumber);
  if (d.length < 6) return undefined;
  return BIN_TO_BANK[d.slice(0, 6)] ?? BIN_TO_BANK[d.slice(0, 8)];
}

export function bankHue(bankName?: string): IranBank["hue"] {
  if (!bankName) return "turquoise";
  if (/ملی|ملت|شهر|دی/.test(bankName)) return "crimson";
  if (/صادرات|سامان|گردشگری/.test(bankName)) return "navy";
  if (/کشاورزی|مهر|رسالت/.test(bankName)) return "forest";
  if (/پارسیان|آینده|پاسارگاد/.test(bankName)) return "gold";
  if (/سینا|سرمایه|ملل/.test(bankName)) return "violet";
  return "turquoise";
}

/** شماره کارت ۱۶ رقمی با فاصله چهارتایی — ارقام فارسی برای نمایش */
export function formatCardNumberDisplay(cardNumber?: string, persian = true): string {
  const d = digitsOnly(cardNumber);
  const grouped = (d.match(/.{1,4}/g) ?? []).join(" ");
  if (!persian) return grouped;
  return grouped.replace(/\d/g, (x) => "۰۱۲۳۴۵۶۷۸۹"[Number(x)]!);
}

/** شبا: IR + ۲۴ رقم. ورودی می‌تواند با یا بدون IR باشد. */
export function normalizeIban(iban?: string): string {
  const raw = String(iban ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s/g, "");
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let body = "";
  for (const ch of raw) {
    const fi = fa.indexOf(ch);
    const ai = ar.indexOf(ch);
    if (fi >= 0) body += String(fi);
    else if (ai >= 0) body += String(ai);
    else if ((ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "Z")) body += ch;
  }
  if (body.startsWith("IR")) body = body.slice(2);
  const digits = body.replace(/\D/g, "").slice(0, 24);
  return digits ? `IR${digits}` : "";
}

export function formatIbanDisplay(iban?: string, persian = true): string {
  const n = normalizeIban(iban);
  if (!n) return "";
  const grouped = n.replace(/(.{4})/g, "$1 ").trim();
  if (!persian) return grouped;
  return grouped.replace(/\d/g, (x) => "۰۱۲۳۴۵۶۷۸۹"[Number(x)]!);
}

export function isValidCardNumber(cardNumber?: string): boolean {
  const d = digitsOnly(cardNumber);
  return d.length === 16;
}

export function isValidIban(iban?: string): boolean {
  const n = normalizeIban(iban);
  return n.length === 26;
}

/** شناسه صیادی چک ایران — ۱۶ رقم */
export function formatSayadiDisplay(sayadi?: string, persian = true): string {
  const d = digitsOnly(sayadi).slice(0, 16);
  const grouped = (d.match(/.{1,4}/g) ?? []).join(" ");
  if (!persian) return grouped;
  return grouped.replace(/\d/g, (x) => "۰۱۲۳۴۵۶۷۸۹"[Number(x)]!);
}

export function isValidSayadi(sayadi?: string): boolean {
  return digitsOnly(sayadi).length === 16;
}

export function cardShareText(opts: {
  shopName?: string;
  holderName?: string;
  bankName?: string;
  cardNumber?: string;
  iban?: string;
}): string {
  const lines = [
    "💳 اطلاعات کارت برای واریز",
    opts.shopName ? `فروشگاه: ${opts.shopName}` : "",
    opts.holderName ? `به نام: ${opts.holderName}` : "",
    opts.bankName ? `بانک: ${opts.bankName}` : "",
    opts.cardNumber ? `شماره کارت:\n${formatCardNumberDisplay(opts.cardNumber, false)}` : "",
    opts.iban ? `شماره شبا:\n${formatIbanDisplay(opts.iban, false)}` : "",
    "",
    "با تشکر",
  ].filter((x) => x !== "");
  return lines.join("\n");
}
