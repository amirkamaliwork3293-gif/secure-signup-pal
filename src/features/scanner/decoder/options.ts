/**
 * options.ts — تنظیمات خوانندهٔ zxing. یک جا، مشترک بین Worker و ترد اصلی.
 */
import type { ReaderOptions } from "zxing-wasm/reader";
import { READER_FORMATS } from "../formats";

export const READER_OPTIONS: ReaderOptions = {
  formats: [...READER_FORMATS],

  /** متن خام. حالت پیش‌فرض `"HRI"` محتوای GS1 را قالب‌بندی می‌کند و کد ذخیره‌شده دیگر تطبیق نمی‌خورد. */
  textMode: "Plain",

  /** یک بارکد در هر فریم کافی است و جست‌وجو را کوتاه می‌کند. */
  maxNumberOfSymbols: 1,

  /**
   * این چهار گزینه جای هک‌های دستی نسخهٔ قبل را گرفته‌اند:
   * کراپ زوم‌شدهٔ فریم‌های فرد/زوج، پاس دستی invert، و دو باینریزر پشت سر هم.
   */
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,

  /**
   * روشن بودنش CODE-39 بدون رقم کنترلیِ اختیاری را رد می‌کرد (اندازه‌گیری‌شده).
   * دقت این فرمت‌ها با «دو خوانش یکسان» در `accept.ts` تأمین می‌شود.
   */
  validateOptionalChecksum: false,

  /** هر بارکد خطی باید در دو خط اسکن یکسان خوانده شود — سد اول برابر خوانش غلط. */
  minLineCount: 2,

  eanAddOnSymbol: "Ignore",
  binarizer: "LocalAverage",
  returnErrors: false,
};
