/**
 * جداسازی اکانت و ورود ادمین.
 * اجرا: node --experimental-strip-types scripts/test-account-isolation.mjs
 */
import assert from "node:assert/strict";
import {
  canFlushCloudPush,
  keepLiveAdminRole,
  shouldAbortHydrate,
  shouldShowAdminLogin,
} from "../src/lib/account-isolation.ts";
import { shouldSyncOnAuthEvent } from "../src/lib/auth-session.ts";

assert.equal(canFlushCloudPush({ cloudUserId: "a", cloudHydrated: true, storageScope: "a" }), true);
assert.equal(canFlushCloudPush({ cloudUserId: "a", cloudHydrated: true, storageScope: "b" }), false);
assert.equal(canFlushCloudPush({ cloudUserId: "a", cloudHydrated: true, storageScope: "anon" }), false);
assert.equal(canFlushCloudPush({ cloudUserId: null, cloudHydrated: true, storageScope: "a" }), false);
assert.equal(canFlushCloudPush({ cloudUserId: "a", cloudHydrated: false, storageScope: "a" }), false);

assert.equal(
  shouldAbortHydrate({
    requestedUserId: "a",
    cloudUserId: "a",
    storageScope: "a",
    epoch: 1,
    currentEpoch: 1,
  }),
  false,
);
assert.equal(
  shouldAbortHydrate({
    requestedUserId: "a",
    cloudUserId: "b",
    storageScope: "b",
    epoch: 1,
    currentEpoch: 2,
  }),
  true,
);
assert.equal(
  shouldAbortHydrate({
    requestedUserId: "a",
    cloudUserId: "a",
    storageScope: "b",
    epoch: 1,
    currentEpoch: 1,
  }),
  true,
);

assert.equal(shouldSyncOnAuthEvent("SIGNED_IN", "authenticated"), false);
assert.equal(shouldSyncOnAuthEvent("SIGNED_IN", "authenticated", "user-a", "user-a"), false);
assert.equal(shouldSyncOnAuthEvent("SIGNED_IN", "authenticated", "user-a", "user-b"), true);
assert.equal(shouldSyncOnAuthEvent("SIGNED_IN", "offline-cached", "user-a", "user-b"), true);
assert.equal(shouldSyncOnAuthEvent("TOKEN_REFRESHED", "authenticated", "user-a", "user-a"), false);

assert.equal(shouldShowAdminLogin({ adminOnly: true, status: "offline-cached", isAdmin: false }), true);
assert.equal(shouldShowAdminLogin({ adminOnly: true, status: "authenticated", isAdmin: false }), true);
assert.equal(shouldShowAdminLogin({ adminOnly: true, status: "authenticated", isAdmin: true }), false);
assert.equal(shouldShowAdminLogin({ adminOnly: true, status: "loading", isAdmin: false }), false);
assert.equal(shouldShowAdminLogin({ adminOnly: false, status: "authenticated", isAdmin: false }), false);

assert.equal(
  keepLiveAdminRole({
    sameUser: true,
    previousIsAdmin: true,
    roleQuerySucceeded: false,
    liveIsAdmin: false,
  }),
  true,
  "قطع شبکه نقش ادمین را نگیرد",
);
assert.equal(
  keepLiveAdminRole({
    sameUser: false,
    previousIsAdmin: true,
    roleQuerySucceeded: true,
    liveIsAdmin: false,
  }),
  false,
  "کاربر عادی نقش ادمین نگیرد",
);
assert.equal(
  keepLiveAdminRole({
    sameUser: false,
    previousIsAdmin: false,
    roleQuerySucceeded: true,
    liveIsAdmin: true,
  }),
  true,
  "ورود تازهٔ ادمین با نقش زنده",
);

console.log("account-isolation ok");
