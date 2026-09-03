/**
 * Drive the OGN app on a real iOS Simulator, and report only what was seen.
 *
 * This is the lane the project never had. The Office Mac cannot hold Xcode —
 * six gigabytes free, and every external drive is ExFAT, which Xcode refuses
 * to run from — so every check until now happened in a browser. A browser
 * cannot show a safe area, a permission sheet, a native gesture, an app icon,
 * or how a name is truncated under it on the home screen.
 *
 * A GitHub macOS runner has Xcode and the Simulator already, and this repo is
 * public, so those runners cost nothing.
 *
 * Two tools, and they are not equal. `simctl` ships with Xcode and can always
 * install, launch, open a deep link and photograph. Tapping needs `idb`, which
 * is a separate install and can fail. When it does, this does NOT quietly fall
 * back to a screenshots-only run that reads like a full one: it records that
 * no control was pressed, so a thin run can never be mistaken for a clean app.
 *
 * On what may be pressed, see qa/control-policy.mjs — the same rules the
 * Android lane uses, so a finding means the same thing on both.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { mayPress } from "./control-policy.mjs";
import { toNexora } from "./nexora-observations.mjs";

const run = promisify(execFile);
const UDID = process.env.SIM_UDID;
const BUNDLE = process.env.APP_BUNDLE_ID ?? "com.overcomers.globalnetwork.app";
const SCHEME = process.env.APP_SCHEME ?? "ognapp";
const OUT = process.env.SHOT_DIR ?? "qa/ios-shots";
const EMAIL = process.env.QA_EMAIL ?? "";
const PASSWORD = process.env.QA_PASSWORD ?? "";

if (!UDID) throw new Error("SIM_UDID is required.");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idbRun = (args) => run("idb", [...args, "--udid", UDID], { maxBuffer: 64 * 1024 * 1024 });
const simctl = (args) => run("xcrun", ["simctl", ...args], { maxBuffer: 64 * 1024 * 1024 });

/** See qa/control-policy.mjs. The backend is live Supabase, so deletion stays off. */
const PERMISSIONS = {
  hasTestIdentity: Boolean(EMAIL && PASSWORD),
  backendIsDisposable: process.env.BACKEND_IS_DISPOSABLE === "true"
};

/** Can this run press anything at all? Decided by asking, not by assuming. */
let canTap = false;
try {
  await run("idb", ["list-targets"], { maxBuffer: 8 * 1024 * 1024 });
  canTap = true;
} catch {
  canTap = false;
}

const report = {
  startedAt: new Date().toISOString(),
  permissions: PERMISSIONS,
  canPressControls: canTap,
  signedIn: false,
  steps: [],
  screens: [],
  deadControls: [],
  liveControls: 0,
  notPressed: [],
  notJudged: [],
  notAssessed: [],
  sessionFlow: null,
  /** The first raw reply from idb, so an empty screen can be told from a parse failure. */
  idbRawSample: null
};
const note = (step, detail) => {
  report.steps.push({ step, detail });
  console.log("· " + step + ": " + detail);
};

if (!canTap) {
  report.notAssessed.push("Every control on every screen — idb is not available on this runner, so nothing could be pressed");
  report.notAssessed.push("The sign-in, and therefore every screen behind it");
  note("idb", "NOT available — this run can photograph screens but cannot press anything");
}

/**
 * Everything the screen currently exposes to assistive technology.
 *
 * idb has printed this three different ways across versions — one JSON object
 * per line, a single array, and a nested tree — and a parser that understands
 * only one of them returns an empty screen while reporting success. That is
 * exactly what happened on the first cloud run: idb was installed, every call
 * worked, and every screen came back with zero controls, so the app looked
 * unreachable when it was fine. All three shapes are accepted, and the first
 * raw reply is kept in the report so the next surprise is diagnosable instead
 * of silent.
 */
let rawTreeSample = null;
async function tree() {
  if (!canTap) return [];
  try {
    const { stdout } = await idbRun(["ui", "describe-all", "--json"]);
    if (rawTreeSample === null) {
      rawTreeSample = stdout.slice(0, 600);
      report.idbRawSample = rawTreeSample;
    }

    /** describe-all sometimes nests; a control is a control at any depth. */
    const flatten = (node, into) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const n of node) flatten(n, into);
        return;
      }
      into.push(node);
      for (const key of ["children", "Children", "AXChildren"]) {
        if (Array.isArray(node[key])) flatten(node[key], into);
      }
    };

    const out = [];
    const whole = stdout.trim();
    if (whole.startsWith("[") || whole.startsWith("{")) {
      try {
        flatten(JSON.parse(whole), out);
        if (out.length > 0) return out;
      } catch {
        // Not one document — fall through to line by line.
      }
    }
    for (const line of whole.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        flatten(JSON.parse(t), out);
      } catch {
        // A partial line is not a control.
      }
    }
    return out;
  } catch {
    return [];
  }
}

const labelOf = (el) => ((el.AXLabel ?? "") + " " + (el.AXValue ?? "")).trim();
const fingerprint = (nodes) => nodes.map(labelOf).filter(Boolean).join(" ");

async function shot(name) {
  const path = join(OUT, name + ".png");
  await simctl(["io", UDID, "screenshot", path]);
  return path;
}

async function tapFrame(frame) {
  const x = Math.round(frame.x + frame.width / 2);
  const y = Math.round(frame.y + frame.height / 2);
  await idbRun(["ui", "tap", String(x), String(y)]);
}

/** Find a control by what it SAYS, then tap its centre. */
async function tapLabelled(pattern) {
  if (!canTap) return { ok: false, why: "nothing can be pressed on this run" };
  const nodes = await tree();
  const hit = nodes.find((el) => el.frame && pattern.test(labelOf(el)));
  if (!hit) return { ok: false, why: "nothing on screen says " + pattern };
  await tapFrame(hit.frame);
  return { ok: true, tapped: labelOf(hit) };
}

/** Signed in is read off the app, never assumed from a tap having landed. */
async function looksSignedIn() {
  return /welcome to|global broadcast|recent stories/i.test(fingerprint(await tree()));
}

/**
 * Sign in from the stored account. Written once, called twice: first to get
 * in, and again to restore the session after sign-out is pressed on purpose.
 */
async function signIn(tag) {
  if (!canTap || !PERMISSIONS.hasTestIdentity) return false;

  // The form sits behind a welcome step, exactly as it does on the web.
  for (const door of [/get started/i, /^sign in$/i]) {
    const r = await tapLabelled(door);
    note(tag + " door", r.ok ? 'pressed "' + r.tapped + '"' : r.why);
    await sleep(2500);
  }

  const email = await tapLabelled(/email|phone/i);
  if (email.ok) {
    await idbRun(["ui", "text", EMAIL]);
    await sleep(700);
  }
  note(tag + " email field", email.ok ? 'typed into "' + email.tapped + '"' : email.why);

  const pw = await tapLabelled(/password/i);
  if (pw.ok) {
    await idbRun(["ui", "text", PASSWORD]);
    await sleep(700);
  }
  note(tag + " password field", pw.ok ? 'typed into "' + pw.tapped + '"' : pw.why);

  const submit = await tapLabelled(/^sign in$/i);
  note(tag + " submit", submit.ok ? 'pressed "' + submit.tapped + '"' : submit.why);
  await sleep(9000);

  return await looksSignedIn();
}

// ── Launch fresh ───────────────────────────────────────────────────────────
await simctl(["terminate", UDID, BUNDLE]).catch(() => undefined);
await simctl(["launch", UDID, BUNDLE]);
await sleep(10000);
report.screens.push({ route: "(launch)", shot: await shot("00-launch"), labels: fingerprint(await tree()).slice(0, 400) });
note("launch", "app opened");

// ── Sign in ────────────────────────────────────────────────────────────────
if (canTap && PERMISSIONS.hasTestIdentity) {
  await shot("01-sign-in");
  report.signedIn = await signIn("first");
  await shot("02-after-sign-in");
  note(
    "sign-in",
    report.signedIn ? "confirmed by what the home screen shows" : "NOT confirmed — everything behind it is unchecked"
  );
} else if (!PERMISSIONS.hasTestIdentity) {
  note("sign-in", "no account supplied, so only the signed-out screens were seen");
}

/**
 * Does this screen move on its own? Measured with no press at all, so a
 * ticking clock is never mistaken for a button having worked.
 */
async function movesOnItsOwn() {
  const a = fingerprint(await tree());
  await sleep(2000);
  const b = fingerprint(await tree());
  return a !== b;
}

// ── Every screen the app declares ──────────────────────────────────────────
// Deep links need only simctl, so screens are photographed even when nothing
// can be pressed.
const ROUTES = ["/", "/messages", "/give", "/community", "/bible", "/profile", "/prayer", "/support"];
for (const route of ROUTES) {
  /**
   * Opening a custom-scheme link makes iOS ask "Open in ...?" first, and until
   * somebody answers it the app never moves. The first cloud run photographed
   * that dialog on all eight screens and reported eight identical onboarding
   * shots as eight different screens. Answering it is part of opening a route.
   */
  const openRoute = async () => {
    await simctl(["openurl", UDID, SCHEME + "://" + route]).catch(() => undefined);
    await sleep(1500);
    const consent = await tapLabelled(/^open$/i);
    if (consent.ok) await sleep(1200);
  };

  await openRoute();
  await sleep(3800);

  const name = route === "/" ? "home" : route.replace(/\//g, "");
  const shotPath = await shot("10-" + name);
  const nodes = await tree();
  const labels = nodes.map(labelOf).filter(Boolean);
  report.screens.push({ route, shot: shotPath, labels: labels.slice(0, 40), controls: nodes.filter((n) => n.frame).length });
  note("screen", route + " — " + (canTap ? labels.length + " labels" : "photographed only"));

  if (!canTap) continue;

  if (await movesOnItsOwn()) {
    report.notJudged.push({ route, why: "the screen changes on its own, so a press cannot be told from ambient movement" });
    note("not judged", route + " moves on its own — no dead-control verdict given here");
    continue;
  }

  const pressable = [];
  for (const n of nodes.filter((x) => x.frame && labelOf(x))) {
    const verdict = mayPress(labelOf(n), PERMISSIONS);
    // Session-ending controls are saved for the end of the run, not skipped.
    if (verdict.allowed && verdict.cls === "recoverable") continue;
    if (verdict.allowed) pressable.push(n);
    else report.notPressed.push({ route, control: labelOf(n), kind: verdict.cls, why: verdict.why });
  }

  for (const control of pressable.slice(0, 6)) {
    const before = fingerprint(await tree());
    await tapFrame(control.frame);
    await sleep(2400);
    const after = fingerprint(await tree());
    if (before === after) {
      report.deadControls.push({
        route,
        control: labelOf(control),
        evidence: "the screen read identically before and after the press, on a screen that does not move on its own"
      });
      note("DEAD", route + ' — "' + labelOf(control) + '" did nothing');
    } else {
      report.liveControls++;
    }
    await openRoute();
    await sleep(2600);
  }
}

// ── The sign-out flow, pressed on purpose and then undone ──────────────────
if (canTap && report.signedIn) {
  await simctl(["openurl", UDID, SCHEME + "://profile"]).catch(() => undefined);
  await sleep(1500);
  await tapLabelled(/^open$/i);
  await sleep(3000);

  const signOut = (await tree()).find((n) => n.frame && mayPress(labelOf(n), PERMISSIONS).cls === "recoverable");
  if (!signOut) {
    report.sessionFlow = { attempted: false, why: "no sign-out control was found on the profile screen" };
    note("sign-out", "not found on the profile screen");
  } else {
    note("sign-out", 'pressing "' + labelOf(signOut) + '" deliberately — the stored account can restore the session');
    await tapFrame(signOut.frame);
    await sleep(4000);
    const confirm = await tapLabelled(/^(sign ?out|log ?out|yes|confirm)$/i);
    if (confirm.ok) await sleep(4000);
    await shot("20-after-sign-out");

    const signedOutOk = !(await looksSignedIn());
    note("sign-out result", signedOutOk ? "the session ended, as it should" : "STILL SIGNED IN after pressing sign out");

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
}

report.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, "ios-drive-report.json"), JSON.stringify(report, null, 2));

// Hand the run back in Nexora's own shape. The crawler decides what it saw;
// Nexora decides what it means — severity, score, memory and dismissals all
// stay on its side, so a phone finding and a web finding mean the same thing.
const forNexora = toNexora(report, "ios");
writeFileSync(join(OUT, "nexora-observations.json"), JSON.stringify(forNexora, null, 2));
console.log("observations for Nexora: " + forNexora.observations.length + ", screens covered: " + forNexora.coverage.routesChecked + ", controls pressed: " + forNexora.coverage.controlsTested);

console.log("\n=== iOS simulator run ===");
console.log("controls could be pressed: " + report.canPressControls);
console.log("signed in: " + report.signedIn);
console.log("screens photographed: " + report.screens.length);
console.log("controls that did something: " + report.liveControls);
console.log("controls that did nothing: " + report.deadControls.length);
for (const d of report.deadControls) console.log('   dead — ' + d.route + ' "' + d.control + '"');
console.log("deliberately not pressed: " + report.notPressed.length);
console.log("sign-out flow: " + (report.sessionFlow ? (report.sessionFlow.verdict ?? report.sessionFlow.why) : "not reached"));
if (report.notAssessed.length) {
  console.log("NOT CHECKED AT ALL:");
  for (const n of report.notAssessed) console.log("   " + n);
}
