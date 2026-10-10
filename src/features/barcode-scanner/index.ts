/**
 * اسکنر بارکد/QR. بقیهٔ اپ فقط همین را می‌بیند:
 *
 *   <Scanner onDetected={(code, format?) => void} paused={boolean} />
 *
 * اسکنر هیچ عارضهٔ جانبی روی داده ندارد — نه دیتابیس، نه فاکتور، نه موجودی.
 * تنها خروجی‌اش صدا زدن `onDetected` با یک رشته است. معماری: `docs/SCANNER.md`.
 */
export { Scanner, type ScannerProps } from "./Scanner";
