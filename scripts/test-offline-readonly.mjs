/**
 * آفلاین فقط‌خواندنی اپ Capacitor: تشخیص وضعیت، کش per-user، و سیاست SW.
 * اجرا: node --experimental-strip-types scripts/test-offline-readonly.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideOnlineKind,
  shouldBlockCapacitorWrites,
  probeReachability,
  healthCheckUrl,
  HEALTH_CHECK_PARAM,
  HEALTH_TIMEOUT_MS,
  OFFLINE_WRITE_MESSAGE,
} from "../src/lib/online-status-core.ts";
import {
  listUserDisplayCacheKeys,
  rememberCloudRead,
  readCloudReadAt,
  clearUserOfflineCache,
  offlineMetaKey,
  SENSITIVE_STORAGE_KEY_RE,
} from "../src/lib/offline-cache.ts";
function shouldRegisterCapacitorShellWorker(native) {
  return native === true;
}

{
  assert.equal(decideOnlineKind({ navigatorOnLine: false, probeOk: null }), "offline");
  assert.equal(decideOnlineKind({ navigatorOnLine: false, probeOk: true }), "offline");
  assert.equal(decideOnlineKind({ navigatorOnLine: true, probeOk: false }), "offline");
  assert.equal(decideOnlineKind({ navigatorOnLine: true, probeOk: true }), "online");
  assert.equal(decideOnlineKind({ navigatorOnLine: true, probeOk: null }), "checking");
  assert.equal(decideOnlineKind({ navigatorOnLine: undefined, probeOk: null }), "checking");
}

{
  assert.equal(shouldBlockCapacitorWrites({ isCapacitor: false, kind: "offline" }), false);
  assert.equal(shouldBlockCapacitorWrites({ isCapacitor: true, kind: "online" }), false);
  assert.equal(shouldBlockCapacitorWrites({ isCapacitor: true, kind: "checking" }), false);
  assert.equal(shouldBlockCapacitorWrites({ isCapacitor: true, kind: "offline" }), true);
}

{
  assert.equal(shouldRegisterCapacitorShellWorker(false), false);
  assert.equal(shouldRegisterCapacitorShellWorker(true), true);
}

{
  const url = healthCheckUrl("https://kamixapp.ir");
  assert.match(url, new RegExp(`${HEALTH_CHECK_PARAM}=1`));
  assert.ok(HEALTH_TIMEOUT_MS <= 3000);
  assert.ok(HEALTH_TIMEOUT_MS >= 2000);
}

{
  let aborted = false;
  const ok = await probeReachability({
    timeoutMs: 30,
    href: "https://example.test/health",
    fetchImpl: (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  });
  assert.equal(ok, false);
  assert.equal(aborted, true);
}

{
  const ok = await probeReachability({
    href: "/favicon.ico?kamix-health=1",
    fetchImpl: async () => new Response("x", { status: 404 }),
  });
  assert.equal(ok, true, "HTTP 404 یعنی شبکه هست");
}

{
  const ok = await probeReachability({
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert.equal(ok, false);
}

{
  const store = new Map();
  const memory = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    get length() {
      return store.size;
    },
    key(i) {
      return [...store.keys()][i] ?? null;
    },
  };
  rememberCloudRead("user-a", 1_700_000_000_000, memory);
  assert.equal(readCloudReadAt("user-a", memory), 1_700_000_000_000);
  assert.equal(readCloudReadAt("user-b", memory), null);
}

{
  const keys = [
    "acc.products.v1:user-a",
    "acc.invoices.v1:user-a",
    "auth_profile:user-a",
    offlineMetaKey("user-a"),
    "acc.products.v1:user-b",
    "sb-xxxx-auth-token",
    "sb-xxxx-auth-token:user-a",
    "jwt-secret:user-a",
    "service_role_key",
  ];
  const kept = listUserDisplayCacheKeys("user-a", keys);
  assert.deepEqual(
    kept.sort(),
    [
      "acc.invoices.v1:user-a",
      "acc.products.v1:user-a",
      "auth_profile:user-a",
      offlineMetaKey("user-a"),
    ].sort(),
  );
  assert.ok(SENSITIVE_STORAGE_KEY_RE.test("sb-abc-auth-token"));
  assert.ok(!kept.includes("sb-xxxx-auth-token:user-a"));
}

{
  const store = new Map([
    ["acc.products.v1:user-a", "[]"],
    ["auth_profile:user-a", "{}"],
    [offlineMetaKey("user-a"), "{}"],
    ["kamali.auth.lastScope.v1", "user-a"],
    ["sb-proj-auth-token", '{"access_token":"secret"}'],
    ["acc.products.v1:user-b", "[1]"],
  ]);
  const memory = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    get length() {
      return store.size;
    },
    key(i) {
      return [...store.keys()][i] ?? null;
    },
  };
  const removed = clearUserOfflineCache("user-a", memory);
  assert.ok(removed.includes("acc.products.v1:user-a"));
  assert.equal(store.has("acc.products.v1:user-a"), false);
  assert.equal(store.has("sb-proj-auth-token"), true, "توکن auth پاک نشود");
  assert.equal(store.get("acc.products.v1:user-b"), "[1]");
  assert.equal(store.has("kamali.auth.lastScope.v1"), false);
}

{
  assert.equal(OFFLINE_WRITE_MESSAGE, "برای این کار باید آنلاین باشید");
}

{
  const root = dirname(fileURLToPath(import.meta.url));
  const sw = readFileSync(join(root, "../public/capacitor-sw.js"), "utf8");
  assert.match(sw, /Network First/);
  assert.match(sw, /kamix-capacitor-shell-/);
  assert.match(sw, /SHELL_CACHE_VERSION/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /kamix-health/);
  assert.match(sw, /async function networkFirst/);
  assert.match(sw, /fetch\([\s\S]*?caches\.open/);
  assert.doesNotMatch(sw, /supabase/i);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.match(sw, /Cache First نیست/);

  const oldSw = readFileSync(join(root, "../public/sw.js"), "utf8");
  assert.match(oldSw, /Self-destructing/);

  const register = readFileSync(join(root, "../src/registerSW.ts"), "utf8");
  assert.match(register, /isCapacitor/);
  assert.match(register, /updateViaCache/);
  assert.match(register, /capacitor-sw\.js/);

  const server = readFileSync(join(root, "../src/server.ts"), "utf8");
  assert.match(server, /Content-Security-Policy/);
  assert.doesNotMatch(
    readFileSync(join(root, "../src/lib/online-status.ts"), "utf8"),
    /Content-Security-Policy|turnstile|rate-limit/i,
  );
}

{
  const storeSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/lib/store.ts"),
    "utf8",
  );
  assert.match(storeSrc, /isCapacitorOfflineReadOnly/);
  assert.match(storeSrc, /rememberCloudRead/);
  assert.match(storeSrc, /notifyOfflineWriteBlocked/);
}

console.log("offline-readonly ok");
