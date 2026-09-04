/**
 * نشست معتبر نباید به‌خاطر خطای پروفایل به unauthenticated تبدیل شود.
 * نقش ادمین از کش نمی‌آید. اجرا: node scripts/test-auth-session.mjs
 */
import assert from "node:assert/strict";
import {
  classifyUserAccess,
  pickProfileForSession,
  shouldKeepExistingSession,
  shouldSyncOnAuthEvent,
  synthesizeProfileFromSession,
} from "../src/lib/auth-session.ts";

const session = {
  id: "u1",
  email: "ali@kamali.local",
  user_metadata: { username: "ali", first_name: "علی", last_name: "کمالی" },
};

const active = {
  id: "u1",
  username: "ali",
  first_name: "علی",
  last_name: "کمالی",
  plan: "1month",
  status: "active",
  start_date: "2026-01-01",
  end_date: "2027-01-01",
  created_at: "2026-01-01",
};

{
  const live = pickProfileForSession({
    session,
    live: active,
    liveIsAdmin: true,
    cached: { profile: active, isAdmin: true },
  });
  assert.equal(live.source, "live");
  assert.equal(live.isAdmin, true);
}

{
  const cached = pickProfileForSession({
    session,
    live: null,
    liveIsAdmin: true,
    cached: { profile: active, isAdmin: true },
  });
  assert.equal(cached.source, "cache");
  assert.equal(cached.isAdmin, false, "نقش ادمین از کش نیاید");
  assert.equal(classifyUserAccess(cached.profile, cached.isAdmin), "authenticated");
}

{
  const fallback = pickProfileForSession({
    session,
    live: null,
    liveIsAdmin: false,
    cached: null,
  });
  assert.equal(fallback.source, "session");
  assert.equal(fallback.isAdmin, false);
  assert.equal(fallback.profile.username, "ali");
  assert.equal(classifyUserAccess(fallback.profile, false), "pending");
}

{
  const syn = synthesizeProfileFromSession(session);
  assert.equal(syn.id, "u1");
  assert.equal(syn.status, "pending");
}

assert.equal(shouldSyncOnAuthEvent("SIGNED_OUT", "authenticated"), true);
assert.equal(shouldSyncOnAuthEvent("SIGNED_IN", "authenticated"), false);
assert.equal(shouldSyncOnAuthEvent("SIGNED_IN", "expired"), false);
assert.equal(shouldSyncOnAuthEvent("SIGNED_IN", "unauthenticated"), true);
assert.equal(shouldSyncOnAuthEvent("SIGNED_IN", "offline-cached"), true);
assert.equal(shouldSyncOnAuthEvent("INITIAL_SESSION", "unauthenticated"), true);
assert.equal(shouldSyncOnAuthEvent("INITIAL_SESSION", "authenticated"), false);
assert.equal(shouldSyncOnAuthEvent("USER_UPDATED", "authenticated"), false);
assert.equal(shouldSyncOnAuthEvent("TOKEN_REFRESHED", "authenticated"), false);

assert.equal(shouldKeepExistingSession("unauthenticated", "authenticated", true), true);
assert.equal(shouldKeepExistingSession("unauthenticated", "loading", true), false);
assert.equal(shouldKeepExistingSession("unauthenticated", "authenticated", false), false);
assert.equal(shouldKeepExistingSession("expired", "authenticated", true), false);

const expiredProfile = { ...active, status: "expired", end_date: "2020-01-01" };
assert.equal(classifyUserAccess(expiredProfile, false, Date.parse("2026-09-02")), "expired");
assert.equal(classifyUserAccess(expiredProfile, true, Date.parse("2026-09-02")), "authenticated");

console.log("auth-session ok");
