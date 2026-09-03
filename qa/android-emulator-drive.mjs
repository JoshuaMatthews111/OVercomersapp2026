/**
 * Drive the OGN app on a real Android emulator, and prove which controls work.
 *
 * Photographing screens shows what the app LOOKS like. It says nothing about
 * whether anything happens when a person presses something, and a button that
 * silently does nothing is the defect users actually report. So this does what
 * Nexora does on the web: press a control, then read the screen again, and
 * decide from the difference whether the press did anything at all.
 *
 * The trap in that method is ambient movement. A clock ticks, a spinner turns,
 * a list settles — so a screen never compares equal to itself, and every
 * control looks alive. Each screen is therefore measured first with no press
 * at all, and one that moves on its own is named as not judged.
 *
 * On what may be pressed, see qa/control-policy.mjs. The short version: a
 * tester that refuses to press "Sign out" leaves the single most common flow
 * in the app permanently unchecked, and never learns whether the app can be
 * signed back INTO — which is the worse defect of the two. Holding the
 * account's password is what makes pressing it safe, so this presses it, then
 * signs back in, and reports both halves. What it still refuses is anything
 * that deletes real data or reaches real people.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { mayPress } from "./control-policy.mjs";
import { toNexora } from "./nexora-observations.mjs";

const run = promisify(execFile);
const BUNDLE = process.env.APP_BUNDLE_ID ?? "com.overcomers.globalnetwork.app";
const SCHEME = process.env.APP_SCHEME ?? "ognapp";
const OUT = process.env.SHOT_DIR ?? "qa/android-shots";
const EMAIL = process.env.QA_EMAIL ?? "";
const PASSWORD = process.env.QA_PASSWORD ?? "";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (args) => run("adb", args, { maxBuffer: 128 * 1024 * 1024, encoding: "buffer" });
const adbText = async (args) => (await run("adb", args, { maxBuffer: 128 * 1024 * 1024 })).stdout;
const sh = (cmd) => adb(["shell", ...cmd]);

/**
 * Permissions for this run, stated as facts about the target rather than as a
 * setting somebody can flip because a run was boring.
 *
 * The account is a QA member made for exactly this, so its session may be
 * ended and restored. The backend is the OGN PRODUCTION Supabase project, so
 * it is not disposable no matter which account is signed in: a room deleted
 * here is a room the ministry loses. That stays off unless a throwaway
 * backend is explicitly named.
 */
const PERMISSIONS = {
  hasTestIdentity: Boolean(EMAIL && PASSWORD),
  backendIsDisposable: process.env.BACKEND_IS_DISPOSABLE === "true"
};

/** The screen as Android itself describes it: every node, with its box. */
async function tree() {
  try {
    await sh(["uiautomator", "dump", "/sdcard/ui.xml"]);
    const xml = await adbText(["exec-out", "cat", "/sdcard/ui.xml"]);
    const nodes = [];
    const re = /<node[^>]*?>/g;
    let m;
    while ((m = re.exec(xml))) {
      const tag = m[0];
      const attr = (n) => {
        const hit = tag.match(new RegExp(n + '="([^"]*)"'));
        return hit ? hit[1] : "";
      };
      const bounds = attr("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      nodes.push({
        text: attr("text"),
        desc: attr("content-desc"),
        clickable: attr("clickable") === "true",
        selected: attr("selected") === "true",
        checked: attr("checked") === "true",
        box: bounds ? bounds.slice(1).map(Number) : null
      });
    }
    return nodes;
  } catch {
    return [];
  }
}

const labelOf = (n) => (n.text + " " + n.desc).trim();

/** On the visible screen, not merely in the scroll view. See the iOS lane for why. */
let SCREEN = { width: 1080, height: 2400 };
const onScreen = (n) => {
  if (!n.box) return false;
  const cx = (n.box[0] + n.box[2]) / 2;
  const cy = (n.box[1] + n.box[3]) / 2;
  return cx > 0 && cy > 0 && cx < SCREEN.width && cy < SCREEN.height;
};

/**
 * What the screen looks like to a comparison, and why labels alone are not it.
 *
 * The iOS lane judged every Bible control dead — KJV, NLT, AMP — because it
 * compared labels only. Choosing NLT moves the highlight and reloads the
 * passage; it changes no label at all, so four working controls were reported
 * broken. Selection and layout are what actually move, so both are in here.
 */
const fingerprint = (nodes) =>
  nodes
    .filter((n) => n.box)
    .map((n) => [labelOf(n), n.selected ? "sel" : "", n.checked ? "chk" : "", n.box.join(",")].join("|"))
    .join(" ~ ");

async function shot(name) {
  const path = join(OUT, name + ".png");
  const { stdout } = await adb(["exec-out", "screencap", "-p"]);
  writeFileSync(path, stdout);
  return path;
}

async function tapBox(box) {
  const x = Math.round((box[0] + box[2]) / 2);
  const y = Math.round((box[1] + box[3]) / 2);
  await sh(["input", "tap", String(x), String(y)]);
}

async function tapLabelled(pattern) {
  const nodes = await tree();
  const hit = nodes.find((n) => n.box && pattern.test(labelOf(n)));
  if (!hit) return { ok: false, why: "nothing on screen says " + pattern };
  await tapBox(hit.box);
  return { ok: true, tapped: labelOf(hit) };
}

/**
 * What `input text` actually wants.
 *
 * Wrapping the text in shell quotes typed nothing at all — the after-sign-in
 * screenshot shows both boxes still empty. `input text` takes one argument
 * and understands %s for a space; everything else goes through as it is.
 */
const forInputText = (s) => s.replace(/ /g, "%s");

/** Signed in is read off the app, never assumed from a tap having landed. */
async function looksSignedIn() {
  return /welcome to|global broadcast|recent stories/i.test(fingerprint(await tree()));
}

const report = {
  startedAt: new Date().toISOString(),
  permissions: PERMISSIONS,
  signedIn: false,
  steps: [],
  screens: [],
  deadControls: [],
  liveControls: 0,
  notPressed: [],
  notJudged: [],
  notReached: [],
  sessionFlow: null
};
/**
 * Write everything down, whatever happened.
 *
 * A run that crashes halfway has still seen things worth keeping, and the
 * first Android run proved the cost of losing them: it failed, its logs were
 * held until the job finished, the job hung on emulator teardown, and the
 * whole run had to be cancelled — which threw away every screenshot it had
 * already taken. There was nothing left to diagnose from.
 *
 * So the report is written by one function, called on the happy path and from
 * the crash handlers alike, and a crash is recorded as a fact in the report
 * rather than as an absence of one.
 */
let finalized = false;
function finalize() {
  if (finalized) return;
  finalized = true;
  try {
    report.blankScreens = (report.screens ?? [])
      .filter((s) => !s.labels || s.labels.length < 3)
      .map((s) => s.route);
    report.finishedAt = new Date().toISOString();
    writeFileSync(join(OUT, "android-drive-report.json"), JSON.stringify(report, null, 2));
    const forNexora = toNexora(report, "android");
    writeFileSync(join(OUT, "nexora-observations.json"), JSON.stringify(forNexora, null, 2));
    console.log(
      "observations for Nexora: " + forNexora.observations.length +
      ", screens covered: " + forNexora.coverage.routesChecked +
      ", controls pressed: " + forNexora.coverage.controlsTested
    );
  } catch (e) {
    console.error("could not write the report: " + String(e));
  }
}

for (const signal of ["uncaughtException", "unhandledRejection"]) {
  process.on(signal, (e) => {
    report.crashed = String(e && e.stack ? e.stack : e).slice(0, 800);
    report.notAssessed = [
      ...(report.notAssessed ?? []),
      "Everything after the point this run crashed — " + String(e).slice(0, 160)
    ];
    console.error("RUN CRASHED: " + report.crashed);
    finalize();
    process.exit(1);
  });
}

const note = (step, detail) => {
  report.steps.push({ step, detail });
  console.log("· " + step + ": " + detail);
};

/**
 * Sign in from the stored account.
 *
 * Written once and called twice: for the first sign-in, and again to put the
 * session back after sign-out is deliberately pressed. Returns whether the
 * app itself shows a signed-in screen afterwards.
 */
async function signIn(tag) {
  if (!PERMISSIONS.hasTestIdentity) return false;

  // The form sits behind a welcome step, exactly as it does on the web.
  /**
   * Only the welcome step is a door. Treating "Sign in" as one pressed the
   * SUBMIT button on an empty form, raising a modal alert that then hid the
   * very fields the next step went looking for — so the run blamed the app
   * for a fault that was entirely in the order it pressed things.
   */
  const door = await tapLabelled(/get started/i);
  note(tag + " door", door.ok ? 'pressed "' + door.tapped + '"' : door.why);
  await sleep(2500);
  const leftover = await tapLabelled(/^(ok|dismiss|close)$/i);
  if (leftover.ok) {
    note(tag + " alert", 'dismissed "' + leftover.tapped + '" before reading the form');
    await sleep(1200);
  }

  const email = await tapLabelled(/email|phone/i);
  if (email.ok) {
    await sh(["input", "text", forInputText(EMAIL)]);
    await sleep(700);
  }
  note(tag + " email field", email.ok ? 'typed into "' + email.tapped + '"' : email.why);

  const pw = await tapLabelled(/password/i);
  if (pw.ok) {
    await sh(["input", "text", forInputText(PASSWORD)]);
    await sleep(700);
  }
  note(tag + " password field", pw.ok ? 'typed into "' + pw.tapped + '"' : pw.why);

  await sh(["input", "keyevent", "111"]).catch(() => undefined); // close the keyboard
  await sleep(500);
  const submit = await tapLabelled(/^sign in$/i);
  note(tag + " submit", submit.ok ? 'pressed "' + submit.tapped + '"' : submit.why);
  await sleep(9000);

  return await looksSignedIn();
}

try {
  const wm = await adbText(["shell", "wm", "size"]);
  const m = wm.match(/(\d+)x(\d+)/);
  if (m) SCREEN = { width: Number(m[1]), height: Number(m[2]) };
} catch {
  // The default is a Pixel 6, which is what the workflow boots.
}

// ── Launch ─────────────────────────────────────────────────────────────────
await sh(["am", "force-stop", BUNDLE]).catch(() => undefined);
await sh(["monkey", "-p", BUNDLE, "-c", "android.intent.category.LAUNCHER", "1"]).catch(() => undefined);
await sleep(11000);
report.screens.push({ route: "(launch)", shot: await shot("00-launch"), labels: fingerprint(await tree()).slice(0, 400) });
note("launch", "app opened");

// ── Sign in ────────────────────────────────────────────────────────────────
if (PERMISSIONS.hasTestIdentity) {
  await shot("01-sign-in");
  report.signedIn = await signIn("first");
  await shot("02-after-sign-in");
  note(
    "sign-in",
    report.signedIn ? "confirmed by what the home screen shows" : "NOT confirmed — everything behind it is unchecked"
  );
} else {
  note("sign-in", "no account supplied, so only the signed-out screens were seen");
}

/**
 * Does this screen move on its own?
 *
 * Measured with no press at all. If it does, a before/after comparison cannot
 * separate "the button worked" from "the clock ticked", so this screen is
 * named as not judged rather than filled with guesses.
 */
async function movesOnItsOwn() {
  const a = fingerprint(await tree());
  await sleep(2000);
  const b = fingerprint(await tree());
  return a !== b;
}

// ── Every screen, and the controls on it ───────────────────────────────────
// Sign out is left for last on purpose. Pressing it mid-run would end the
// session under every screen still to come and report them all as empty.
const ROUTES = ["/", "/messages", "/give", "/community", "/bible", "/profile"];
for (const route of ROUTES) {
  const openRoute = () =>
    sh(["am", "start", "-a", "android.intent.action.VIEW", "-d", SCHEME + "://" + route]).catch(() => undefined);

  await openRoute();
  await sleep(4000);

  const name = route === "/" ? "home" : route.replace(/\//g, "");
  const shotPath = await shot("10-" + name);
  const nodes = await tree();
  const labels = nodes.map(labelOf).filter(Boolean);
  const controlCount = nodes.filter((n) => n.clickable).length;
  report.screens.push({ route, shot: shotPath, labels: labels.slice(0, 40), controls: controlCount });
  note("screen", route + " — " + labels.length + " labels, " + controlCount + " controls");

  if (await movesOnItsOwn()) {
    report.notJudged.push({ route, why: "the screen changes on its own, so a press cannot be told from ambient movement" });
    note("not judged", route + " moves on its own — no dead-control verdict given here");
    continue;
  }

  const pressable = [];
  for (const n of nodes.filter((x) => x.clickable && x.box && labelOf(x))) {
    if (!onScreen(n)) {
      report.notReached.push({ route, control: labelOf(n), why: "below the fold — needs scrolling, which this run does not do yet" });
      continue;
    }
    const verdict = mayPress(labelOf(n), PERMISSIONS);
    // The session-ending ones are gathered for the end of the run, not skipped.
    if (verdict.allowed && verdict.cls === "recoverable") continue;
    if (verdict.allowed) pressable.push(n);
    else report.notPressed.push({ route, control: labelOf(n), kind: verdict.cls, why: verdict.why });
  }

  // Six per screen keeps a long list from eating the whole run.
  for (const control of pressable.slice(0, 6)) {
    const before = fingerprint(await tree());
    await tapBox(control.box);
    await sleep(2400);
    const after = fingerprint(await tree());
    if (before === after) {
      const proof = await shot("dead-" + name + "-" + report.deadControls.length).catch(() => null);
      report.deadControls.push({
        route,
        control: labelOf(control),
        shot: proof,
        evidence:
          "the screen read identically before and after the press — same controls, same selection, same layout — " +
          "on a screen measured not to move on its own"
      });
      note("DEAD", route + ' — "' + labelOf(control) + '" did nothing');
    } else {
      report.liveControls++;
    }
    // A press that answers with an alert has WORKED — but the alert stays up,
    // and on this app the next fourteen presses all landed on its OK button and
    // were reported dead. Clear anything modal before the next press.
    const modal = await tapLabelled(/^(ok|close|cancel|done|dismiss|got it)$/i);
    if (modal.ok) await sleep(800);
    await openRoute();
    await sleep(2600);
  }
}

// ── The sign-out flow, pressed on purpose and then undone ──────────────────
//
// This is the part a "never press anything scary" tester can never do, and it
// is the part that finds the worst defect there is: an app you can leave and
// cannot get back into. It runs last, and only with a stored account.
if (report.signedIn) {
  await sh(["am", "start", "-a", "android.intent.action.VIEW", "-d", SCHEME + "://profile"]).catch(() => undefined);
  await sleep(4000);

  let signOut = null;
  for (let hop = 0; hop < 4 && !signOut; hop++) {
    signOut = (await tree()).find((n) => n.clickable && onScreen(n) && mayPress(labelOf(n), PERMISSIONS).cls === "recoverable") ?? null;
    if (signOut) break;
    await sh(["input", "swipe", "540", "1900", "540", "600", "400"]).catch(() => undefined);
    await sleep(1200);
  }
  if (!signOut) {
    report.sessionFlow = { attempted: false, why: "no sign-out control was found on the profile screen" };
    note("sign-out", "not found on the profile screen");
  } else {
    note("sign-out", 'pressing "' + labelOf(signOut) + '" deliberately — the stored account can restore the session');
    await tapBox(signOut.box);
    await sleep(4000);
    // Some apps confirm first. Confirming a sign-out is still recoverable.
    const confirm = await tapLabelled(/^(sign ?out|log ?out|yes|confirm)$/i);
    if (confirm.ok) await sleep(4000);
    await shot("20-after-sign-out");

    const stillIn = await looksSignedIn();
    const signedOutOk = !stillIn;
    note("sign-out result", signedOutOk ? "the session ended, as it should" : "STILL SIGNED IN after pressing sign out");

    // Put it back. Whether this works is the finding that matters most.
    const recovered = await signIn("recovery");
    await shot("21-after-recovery");
    note("recovery", recovered ? "signed back in from the stored account" : "COULD NOT SIGN BACK IN after signing out");

    report.sessionFlow = {
      attempted: true,
      signedOut: signedOutOk,
      signedBackIn: recovered,
      verdict: signedOutOk && recovered
        ? "sign out works and the app can be signed back into"
        : !signedOutOk
          ? "pressing sign out did not end the session"
          : "the app signed out and then could NOT be signed back in"
    };
  }
} else if (PERMISSIONS.hasTestIdentity) {
  report.sessionFlow = { attempted: false, why: "never got signed in, so there was no session to end" };
}

finalize();

console.log("\n=== Android emulator run ===");
console.log("signed in: " + report.signedIn);
console.log("screens photographed: " + report.screens.length);
console.log("controls that did something: " + report.liveControls);
console.log("controls that did nothing: " + report.deadControls.length);
for (const d of report.deadControls) console.log('   dead — ' + d.route + ' "' + d.control + '"');
console.log("deliberately not pressed: " + report.notPressed.length);
for (const n of report.notPressed.slice(0, 8)) console.log('   left alone — "' + n.control + '" (' + n.kind + "): " + n.why);
console.log("screens not judged (they move on their own): " + report.notJudged.length);
console.log("sign-out flow: " + (report.sessionFlow ? (report.sessionFlow.verdict ?? report.sessionFlow.why) : "not reached"));
console.log("screens with nothing readable: " + (report.blankScreens.length ? report.blankScreens.join(", ") : "none"));
