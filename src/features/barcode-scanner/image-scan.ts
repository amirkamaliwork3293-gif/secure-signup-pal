/**
 * image-scan.ts — خواندن بارکد از یک عکس (گالری یا دوربین سیستم).
 *
 * راه نجات وقتی دوربین زنده در دسترس نیست (مجوز رد شده، دوربین مشغول) یا
 * بارکد روی صفحهٔ دستگاه دیگری است. با import پویا بارگذاری می‌شود.
 *
 * عکس گوشی معمولاً ۱۲ مگاپیکسل است؛ دیکود مستقیم آن کند است و بارکدهای بزرگ را
 * هم بدتر می‌خواند. پس در چند مقیاس امتحان می‌شود: اول متوسط (سریع، بیشتر
 * موارد)، بعد کوچک (بارکد بزرگ/نزدیک)، بعد بزرگ (بارکد ریز در عکس شلوغ)،
 * و در آخر لیبل معکوس و عکس تار.
 */
import { formatInfo, type CanonicalFormat } from "./formats";
import type { NativeEngine } from "./engines/native";
import { outputSize, type DecodeMode } from "./geometry";

const ATTEMPTS: ReadonlyArray<{ maxSide: number; mode: DecodeMode }> = [
  { maxSide: 1600, mode: { deep: true } },
  { maxSide: 900, mode: { deep: true } },
  { maxSide: 2600, mode: { deep: true } },
  { maxSide: 1600, mode: { deep: true, invert: true } },
  { maxSide: 1600, mode: { deep: true, lenient: true } },
];

export type ImageHit = { text: string; format: CanonicalFormat };

export async function decodeImageFile(
  file: Blob,
  native: NativeEngine | null,
): Promise<ImageHit | null> {
  const bitmap = await createImageBitmap(file);
  try {
    if (native?.alive) {
      const hit = await native.detectOnce(bitmap);
      if (hit) return { text: hit.text, format: hit.format };
    }

    const [{ decodePixels }, { loadZxing }] = await Promise.all([
      import("./engines/zxing-core"),
      import("./engines/zxing-setup"),
    ]);
    await loadZxing();

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const tried = new Set<string>();
    for (const { maxSide, mode } of ATTEMPTS) {
      const size = outputSize({ width: bitmap.width, height: bitmap.height }, maxSide, 1);
      const key = `${size.width}x${size.height}:${JSON.stringify(mode)}`;
      if (tried.has(key)) continue;
      tried.add(key);
      canvas.width = size.width;
      canvas.height = size.height;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      const img = ctx.getImageData(0, 0, size.width, size.height);
      const hit = await decodePixels(
        { data: img.data, width: img.width, height: img.height },
        mode,
      );
      // خوانش تک‌خطی فقط برای فرمت‌هایی که رقم کنترلی دارند؛ عکس تأیید دوم ندارد.
      const weak = formatInfo(hit?.format ?? "unknown")?.strength !== "strong";
      if (hit && !(mode.lenient && weak)) return { text: hit.text, format: hit.format };
      // اجازه به UI برای نفس کشیدن بین تلاش‌ها.
      await new Promise((r) => setTimeout(r, 0));
    }
    canvas.width = 0;
    canvas.height = 0;
    return null;
  } finally {
    bitmap.close();
  }
}
