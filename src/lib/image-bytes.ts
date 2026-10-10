/** تشخیص تصویر از روی بایت‌های ابتدایی — JPEG/PNG/GIF/WEBP/HEIC */
export function isImageBytes(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const gif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
  const ascii = (i: number) => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
  const webp = ascii(0) === "RIFF" && ascii(8) === "WEBP";
  // ftyp به‌تنهایی MP4/MOV را هم شامل می‌شود؛ فقط برندهای تصویر را بپذیر.
  const brand = ascii(8).toLowerCase();
  const heic =
    ascii(4) === "ftyp" && ["heic", "heix", "heif", "hevc", "mif1", "msf1", "avif"].includes(brand);
  return jpeg || png || gif || webp || heic;
}
