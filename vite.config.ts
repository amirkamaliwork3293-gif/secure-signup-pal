// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import type { Plugin } from "vite";

// فهرست فایل‌هایی که اپ اندروید برای کار کامل بدون اینترنت لازم دارد (همهٔ
// صفحه‌ها، اسکنر، چاپ/PDF، فونت‌ها). سرویس‌ورکر اپ (public/capacitor-sw.js) بعد از
// باز شدن با اینترنت، همین فهرست را یک‌بار دانلود و نگه می‌دارد. سایت در مرورگر
// از این فایل استفاده نمی‌کند.
const OFFLINE_ASSET_MANIFEST = "kamix-offline-assets.json";
const OFFLINE_ASSET_RE = /\.(?:js|css|wasm|woff2?|svg)$/;

function offlineAssetManifest(): Plugin {
  return {
    name: "kamix-offline-asset-manifest",
    apply: "build",
    applyToEnvironment: (env) => env.name === "client",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f.startsWith("assets/") && OFFLINE_ASSET_RE.test(f))
        .map((f) => `/${f}`);
      try {
        for (const f of readdirSync("public/fonts")) {
          if (/\.woff2$/.test(f)) files.push(`/fonts/${f}`);
        }
      } catch {
        /* پوشهٔ فونت نیست */
      }
      files.sort();
      const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: OFFLINE_ASSET_MANIFEST,
        source: JSON.stringify({ version, files }),
      });
    },
  };
}

// Client build only: put every lucide-react icon into one stable chunk. Without this, each
// icon shared by lazy routes became its own tiny /assets/*.js file (one extra request each).
// Other libraries keep Vite's default splitting so heavy ones (xlsx, jspdf, ...) stay lazy.
function clientManualChunks(id: string): string | undefined {
  if (id.includes("/node_modules/lucide-react/")) return "vendor-icons";
  return undefined;
}

export default defineConfig({
  plugins: [offlineAssetManifest()],
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    environments: {
      client: {
        build: { rollupOptions: { output: { manualChunks: clientManualChunks } } },
      },
    },
  },
});
