/**
 * The rules about what may be pressed, pinned.
 *
 * Every case here is a real control from the OGN app. If a future edit to the
 * patterns makes "Send" pressable or "Sign out" untouchable, this fails before
 * a run ever reaches a person's data.
 *
 *   node --test qa/control-policy.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyControl, mayPress } from "./control-policy.mjs";

const TEST_ACCOUNT_LIVE_BACKEND = { hasTestIdentity: true, backendIsDisposable: false };
const TEST_ACCOUNT_TEST_BACKEND = { hasTestIdentity: true, backendIsDisposable: true };
const NO_ACCOUNT = { hasTestIdentity: false, backendIsDisposable: false };

test("ending the session is pressable, because the vault can undo it", () => {
  for (const label of ["Sign Out", "sign out", "Log out", "Leave", "Unfollow"]) {
    const v = mayPress(label, TEST_ACCOUNT_LIVE_BACKEND);
    assert.equal(v.cls, "recoverable", label);
    assert.equal(v.allowed, true, label);
  }
});

test("without a stored account, ending the session is not pressable", () => {
  const v = mayPress("Sign Out", NO_ACCOUNT);
  assert.equal(v.allowed, false);
  assert.match(v.why, /no stored account/);
});

test("a test account does NOT make deletion safe against a live database", () => {
  for (const label of ["Delete Account", "Remove message", "Delete", "Cancel subscription"]) {
    const v = mayPress(label, TEST_ACCOUNT_LIVE_BACKEND);
    assert.equal(v.cls, "destroys-data", label);
    assert.equal(v.allowed, false, label);
    assert.match(v.why, /live database/, label);
  }
});

test("deletion is pressable only when the account AND the database are disposable", () => {
  assert.equal(mayPress("Delete", TEST_ACCOUNT_TEST_BACKEND).allowed, true);
  assert.equal(mayPress("Delete", { hasTestIdentity: false, backendIsDisposable: true }).allowed, false);
});

test("anything landing on a real person is never pressable, whatever is permitted", () => {
  for (const label of ["Send", "Publish", "Approve", "Report", "Block", "Give $50", "Invite"]) {
    for (const perms of [TEST_ACCOUNT_LIVE_BACKEND, TEST_ACCOUNT_TEST_BACKEND, NO_ACCOUNT]) {
      const v = mayPress(label, perms);
      assert.equal(v.cls, "reaches-people", label);
      assert.equal(v.allowed, false, label + " must never be pressed");
    }
  }
});

test("the worst consequence decides, not the first word matched", () => {
  // Reads as a delete, but the notify is what a third party actually feels.
  assert.equal(classifyControl("Delete and notify everyone"), "reaches-people");
  assert.equal(classifyControl("Sign out and delete my data"), "destroys-data");
});

test("ordinary controls stay ordinary", () => {
  for (const label of ["Watch Live", "View All", "Sermons", "Open", "Enter", "KJV"]) {
    assert.equal(classifyControl(label), "ordinary", label);
    assert.equal(mayPress(label, NO_ACCOUNT).allowed, true, label);
  }
});
