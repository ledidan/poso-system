import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { createPlanDatabase } from "../server/subscriptions/PlanDatabase.js";

const offlineDatabase = (t) => {
  const app = initializeApp({
    databaseURL: "https://poso-offline-reference-test.firebaseio.com",
    credential: { getAccessToken: async () => ({ access_token: "offline-test-only", expires_in: 3600 }) }
  }, `reference-test-${randomUUID()}`);
  const raw = getDatabase(app);
  raw.goOffline();
  t.after(() => deleteApp(app));
  return { raw, wrapped: createPlanDatabase(raw) };
};

test("Firebase SDK root references work through the plan wrapper without an explicit path", (t) => {
  const { raw, wrapped } = offlineDatabase(t);
  assert.equal(wrapped.ref().toString(), raw.ref().toString());
  assert.equal(wrapped.ref(undefined).toString(), raw.ref(undefined).toString());
  assert.equal(wrapped.ref("/").toString(), raw.ref("/").toString());
});

test("the plan wrapper preserves Firebase SDK validation of explicit empty and invalid paths", (t) => {
  const { raw, wrapped } = offlineDatabase(t);
  for (const path of ["", "shops/invalid.key", "shops/invalid#key"]) {
    assert.throws(() => raw.ref(path));
    assert.throws(() => wrapped.ref(path));
  }
  assert.equal(wrapped.ref("shops/test-shop/license").toString(), raw.ref("shops/test-shop/license").toString());
});
