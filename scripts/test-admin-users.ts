/**
 * ادغام فهرست ادمین: پروفایل + یتیم auth + داده بدون حساب + ردپای حذف.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-admin-users.ts
 */
import assert from "node:assert/strict";
import {
  dataOnlyStubUser,
  mergeAdminUsers,
  persianSearchVariants,
  postgrestQuotedIlike,
  sanitizeAdminSearch,
  syntheticProfileFromAuth,
  traceMatchesQuery,
  usernameCandidates,
  usernameFromAuthUser,
  upsertListedUser,
} from "../src/lib/admin-users.ts";
import { filterAndRankSearch, identitySearchFields } from "../src/lib/search.ts";

const older = {
  id: "p-old",
  username: "m.soleimani",
  first_name: "مصطفی",
  last_name: "سلیمانی",
  plan: "1month",
  status: "active",
  start_date: "2024-01-01T00:00:00.000Z",
  end_date: "2026-01-01T00:00:00.000Z",
  created_at: "2024-06-01T00:00:00.000Z",
};
const newer = {
  id: "p-new",
  username: "newuser",
  first_name: "علی",
  last_name: "رضایی",
  plan: "1month",
  status: "active",
  start_date: "2026-01-01T00:00:00.000Z",
  end_date: "2026-02-01T00:00:00.000Z",
  created_at: "2026-09-01T00:00:00.000Z",
};

const merged = mergeAdminUsers([newer, older], [], []);
assert.equal(merged.users.length, 2);
assert.equal(merged.users[0].username, "newuser", "newer users first");
assert.equal(merged.users[1].username, "m.soleimani");

const orphanAuth = {
  id: "auth-only",
  email: "m.soleimani@kamali.local",
  created_at: "2025-01-01T00:00:00.000Z",
  user_metadata: {
    username: "m.soleimani",
    first_name: "مصطفی",
    last_name: "سلیمانی",
    phone: "09121234567",
  },
};
const withOrphan = mergeAdminUsers([newer], [orphanAuth], []);
assert.equal(withOrphan.users.length, 2);
const orphan = withOrphan.users.find((u) => u.id === "auth-only");
assert.ok(orphan);
assert.equal(orphan?.missing_profile, true);
assert.equal(orphan?.username, "m.soleimani");
assert.equal(orphan?.first_name, "مصطفی");
assert.equal(withOrphan.phones["m.soleimani"], "09121234567");

const namedFromEmail = usernameFromAuthUser({
  id: "x",
  email: "m.soleimani@kamali.local",
  user_metadata: {},
});
assert.equal(namedFromEmail, "m.soleimani");

const syn = syntheticProfileFromAuth(orphanAuth);
assert.equal(syn.missing_profile, true);
assert.equal(syn.status, "pending");

const withData = mergeAdminUsers([newer], [], ["data-user-aaaaaaaa"]);
assert.equal(withData.users.some((u) => u.id === "data-user-aaaaaaaa"), true);
assert.equal(dataOnlyStubUser("abc").missing_profile, true);

const filled = mergeAdminUsers(
  [{
    ...newer,
    first_name: null,
    last_name: null,
  }],
  [{
    id: newer.id,
    email: "newuser@kamali.local",
    user_metadata: { username: "newuser", first_name: "علی", last_name: "رضایی", phone: "09330000000" },
  }],
);
assert.equal(filled.users[0].first_name, "علی");
assert.equal(filled.users[0].missing_profile, false);
assert.equal(filled.phones.newuser, "09330000000");

const looked = upsertListedUser(merged, syn, "09120000000");
assert.equal(looked.users[0].username, "m.soleimani");
assert.equal(looked.phones["m.soleimani"], "09120000000");

const allForSearch = mergeAdminUsers(
  Array.from({ length: 1000 }, (_, i) => ({
    id: `p-${i}`,
    username: `user${i}`,
    first_name: "کاربر",
    last_name: `${i}`,
    plan: "1month",
    status: "active",
    start_date: null,
    end_date: null,
    created_at: new Date(Date.now() - i * 1000).toISOString(),
  })).concat([older]),
  [],
);
const hits = filterAndRankSearch(allForSearch.users, "m.soleimani", (u) =>
  identitySearchFields({ username: u.username, first_name: u.first_name, last_name: u.last_name }),
);
assert.equal(hits[0]?.username, "m.soleimani");
const byName = filterAndRankSearch(allForSearch.users, "مصطفی سلیمانی", (u) =>
  identitySearchFields({ username: u.username, first_name: u.first_name, last_name: u.last_name }),
);
assert.equal(byName[0]?.username, "m.soleimani");

assert.equal(postgrestQuotedIlike("username", "m.soleimani"), 'username.ilike."%m.soleimani%"');
assert.equal(sanitizeAdminSearch("foo%bar_baz"), "foo bar baz");
assert.ok(usernameCandidates("m.soleimani").includes("m.soleimani"));
assert.ok(usernameCandidates("m.soleimani").includes("msoleimani"));
assert.ok(persianSearchVariants("مصطفی").includes("مصطفي") || persianSearchVariants("مصطفی").some((v) => v.includes("ي") || v.includes("ی")));
assert.equal(traceMatchesQuery("m.soleimani", ["m.soleimani", "مصطفی سلیمانی"]), true);
assert.equal(traceMatchesQuery("مصطفی سلیمانی", ["مصطفی", "سلیمانی"]), true);
assert.equal(traceMatchesQuery("سلیمانی", ["علی رضایی"]), false);

console.log("admin-users tests passed");
