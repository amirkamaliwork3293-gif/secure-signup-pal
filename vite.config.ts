// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Client build only: put every lucide-react icon into one stable chunk. Without this, each
// icon shared by lazy routes became its own tiny /assets/*.js file (one extra request each).
// Other libraries keep Vite's default splitting so heavy ones (xlsx, jspdf, ...) stay lazy.
function clientManualChunks(id: string): string | undefined {
  if (id.includes("/node_modules/lucide-react/")) return "vendor-icons";
  return undefined;
}

export default defineConfig({
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
