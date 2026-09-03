/**
 * What a tester is allowed to press, and what it must recover afterwards.
 *
 * "Never press anything dangerous" is the safe rule and it is also the lazy
 * one. It leaves the sign-out button — one of the few flows every single user
 * takes — permanently untested, and it treats a button that only ends a test
 * session the same as one that emails a congregation.
 *
 * They are not the same. The question is never "is this word scary", it is
 * "who pays if this press works, and can the tester put it back". That gives
 * three classes, and they need two different permissions, because the account
 * being disposable and the DATA being disposable are separate facts.
 *
 *   recoverable   Costs only this test session. Sign out, leave a room,
 *                 unfollow. A tester holding the account's password can put it
 *                 back, so pressing it is not damage — it is the only way to
 *                 learn whether signing out works at all, and whether the app
 *                 can be signed back into afterwards.
 *                 Needs: a test identity.
 *
 *   destroys-data Deletes something someone will miss. Delete message, remove
 *                 member, delete account, cancel a subscription. No password
 *                 puts that back. A test ACCOUNT does not make this safe when
 *                 the account is pointed at the real database — the OGN app is
 *                 wired to live Supabase, so a deleted room is a deleted room.
 *                 Needs: a test identity AND a test backend. Both.
 *
 *   reaches-people Sends, publishes, approves, reports, blocks, notifies. The
 *                 harm lands on somebody who never agreed to be in a test, and
 *                 no permission the owner can give covers a third party.
 *                 Needs: nothing will do. Never pressed, always reported.
 *
 * This mirrors what Nexora already refuses to do, and extends it: rule 5 (the
 * destructive-word guard) and rule 16 (a message to real people is never sent)
 * stay exactly as strict, while the recoverable class stops being collateral.
 */

/** Ends this session or this membership. Undone by signing back in. */
const RECOVERABLE = /^(sign ?out|log ?out|logout|leave( (the )?(group|room|chat))?|unfollow|unsubscribe from|switch account)$/i;

/** Removes something. No password brings it back. */
const DESTROYS_DATA = /\b(delete|remove|erase|wipe|clear (all|history)|deactivate|close account|cancel (subscription|plan|membership))\b/i;

/** Lands on somebody who never agreed to be in a test. */
const REACHES_PEOPLE = /\b(send|post|publish|broadcast|approve|reject|report|block|invite|notify|announce|share to|give|donate|pay|checkout)\b/i;

/**
 * @param {string} label What the control says on screen.
 * @returns {"recoverable"|"destroys-data"|"reaches-people"|"ordinary"}
 */
export function classifyControl(label) {
  const text = (label ?? "").trim();
  if (!text) return "ordinary";
  // Order matters. "Delete and notify everyone" reaches people first: the
  // worst consequence decides, never the first word matched.
  if (REACHES_PEOPLE.test(text)) return "reaches-people";
  if (DESTROYS_DATA.test(text)) return "destroys-data";
  if (RECOVERABLE.test(text)) return "recoverable";
  return "ordinary";
}

/**
 * Decide whether this control may be pressed, and say why in a sentence a
 * non-engineer can read — the report carries the reason either way, so a gap
 * in coverage is never silent.
 *
 * @param {string} label
 * @param {{ hasTestIdentity: boolean, backendIsDisposable: boolean }} permissions
 */
export function mayPress(label, permissions) {
  const cls = classifyControl(label);
  const identity = permissions?.hasTestIdentity === true;
  const backend = permissions?.backendIsDisposable === true;

  if (cls === "ordinary") return { allowed: true, cls, why: "" };

  if (cls === "reaches-people") {
    return {
      allowed: false,
      cls,
      why: "it would reach real people, who never agreed to be part of a test"
    };
  }

  if (cls === "destroys-data") {
    if (identity && backend) {
      return { allowed: true, cls, why: "the account and the database behind it are both disposable" };
    }
    return {
      allowed: false,
      cls,
      why: backend
        ? "no test account was supplied, so this would delete something under a real one"
        : "this app is pointed at the live database, so what it deletes is really gone"
    };
  }

  // recoverable
  if (identity) {
    return { allowed: true, cls, why: "it only ends the test session, which the stored account can restore" };
  }
  return {
    allowed: false,
    cls,
    why: "it would end the session and there is no stored account to sign back in with"
  };
}

/**
 * A control in the recoverable class is only worth pressing if the tester
 * genuinely puts the session back — and whether it CAN is itself the finding.
 * An app that signs out but cannot sign back in is broken in the worst way,
 * and that defect is invisible to any tester that refuses to press sign out.
 */
export const RECOVERY_REQUIRED = new Set(["recoverable"]);
