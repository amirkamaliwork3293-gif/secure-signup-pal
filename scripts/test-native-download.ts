/**
 * تست saveOrShareFile: مسیر مرورگر + مسیر نیتیو با پل Capacitor ساختگی.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-native-download.ts
 *
 * مسیر واقعی Filesystem/Share فقط روی APK قابل مشاهده است؛ اینجا فقط منطق شاخه‌بندی
 * و اینکه محتوای یونیکد خراب نمی‌شود بررسی می‌شود.
 */
import { saveOrShareFile, utf8ToBase64 } from "../src/lib/nativeDownload.ts";

const clicks: { href: string; download: string; rel: string }[] = [];
const createdUrls: string[] = [];
const revoked: string[] = [];

(globalThis as { window: unknown }).window = globalThis;
(globalThis as { document: unknown }).document = {
  createElement(tag: string) {
    if (tag !== "a") throw new Error(`unexpected tag ${tag}`);
    const a = {
      href: "",
      download: "",
      rel: "",
      click() {
        clicks.push({ href: a.href, download: a.download, rel: a.rel });
      },
    };
    return a;
  },
};

(globalThis as { URL: typeof URL }).URL.createObjectURL = ((blob: Blob) => {
  const id = `blob:test-${createdUrls.length}`;
  createdUrls.push(id);
  void blob.size;
  return id;
}) as typeof URL.createObjectURL;

const origRevoke = URL.revokeObjectURL.bind(URL);
(globalThis as { URL: typeof URL }).URL.revokeObjectURL = ((u: string) => {
  revoked.push(u);
  try {
    origRevoke(u);
  } catch {
    /* ignore */
  }
}) as typeof URL.revokeObjectURL;

const json = JSON.stringify({ نام: "کامیکس", version: 1 }, null, 2);
const base64 = utf8ToBase64(json);
const decoded = Buffer.from(base64, "base64").toString("utf8");
if (decoded !== json) {
  throw new Error("utf8ToBase64 roundtrip failed for Persian JSON");
}

await saveOrShareFile({
  filename: "kamix-backup-test.json",
  mimeType: "application/json",
  base64Data: base64,
});

if (clicks.length !== 1) throw new Error(`expected 1 click, got ${clicks.length}`);
if (clicks[0].download !== "kamix-backup-test.json") {
  throw new Error(`bad filename ${clicks[0].download}`);
}
if (!clicks[0].href.startsWith("blob:")) throw new Error(`href is not blob: ${clicks[0].href}`);

await new Promise((r) => setTimeout(r, 2100));
if (!revoked.includes(clicks[0].href)) {
  throw new Error("object URL was not revoked");
}

console.log("ok: browser saveOrShareFile + Persian JSON base64");

const writes: { path: string; data: string; directory: string }[] = [];
const shares: { title?: string; url?: string; files?: string[]; dialogTitle?: string }[] = [];

(
  globalThis as {
    Capacitor?: {
      isNativePlatform: () => boolean;
      Plugins: {
        Filesystem: {
          writeFile: (opts: {
            path: string;
            data: string;
            directory: string;
          }) => Promise<{ uri: string }>;
        };
        Share: {
          share: (opts: {
            title?: string;
            url?: string;
            files?: string[];
            dialogTitle?: string;
          }) => Promise<void>;
        };
      };
    };
  }
).Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    Filesystem: {
      async writeFile(opts) {
        writes.push(opts);
        return { uri: `file:///cache/${opts.path}` };
      },
    },
    Share: {
      async share(opts) {
        shares.push(opts);
      },
    },
  },
};

const beforeClicks = clicks.length;
await saveOrShareFile({
  filename: "kamix-backup-native.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  base64Data: "UEsDBBQAAAAI",
});

if (clicks.length !== beforeClicks) {
  throw new Error("native path must not trigger <a download>");
}
if (writes.length !== 1) throw new Error(`expected 1 write, got ${writes.length}`);
if (writes[0].directory !== "CACHE") throw new Error(`expected CACHE, got ${writes[0].directory}`);
if (writes[0].path !== "kamix-backup-native.xlsx") throw new Error("wrong write path");
if (writes[0].data !== "UEsDBBQAAAAI") throw new Error("base64 payload was altered");
if (shares.length !== 1) throw new Error(`expected 1 share, got ${shares.length}`);
if (shares[0].url !== "file:///cache/kamix-backup-native.xlsx") {
  throw new Error(`share url ${shares[0].url}`);
}
if (!shares[0].files?.includes("file:///cache/kamix-backup-native.xlsx")) {
  throw new Error("share files missing cache uri");
}

console.log("ok: native Cache write + Share sheet (mocked Capacitor)");
