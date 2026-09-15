/**
 * قرارداد عمومی اسکنر. بقیهٔ اپ فقط همین را می‌بیند:
 *
 *   <Scanner onDetected={(code, format?) => void} paused={boolean} />
 *
 * اسکنر هیچ عارضهٔ جانبی ندارد — نه دیتابیس، نه localStorage، نه رکورد کاربر.
 * تنها خروجی‌اش صدا زدن `onDetected` با یک رشته است.
 */
export { Scanner, type ScannerProps } from "./Scanner";
