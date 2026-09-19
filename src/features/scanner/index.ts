/**
 * قرارداد عمومی اسکنر. بقیهٔ اپ فقط همین را می‌بیند:
 *
 *   <Scanner onDetected={(code, format?) => void} paused={boolean} />
 *
 * اسکنر هیچ عارضهٔ جانبی روی داده ندارد — نه دیتابیس، نه فاکتور، نه موجودی.
 * تنها خروجی‌اش صدا زدن `onDetected` با یک رشته است.
 *
 * تنها چیزی که می‌نویسد کلید `kamix_scanner_experimental` در `localStorage` است
 * (کلید حالت آزمایشی در پنل تشخیصی). نگاه کنید به `flags.ts` و `docs/SCANNER.md`.
 */
export { Scanner, type ScannerProps } from "./Scanner";
