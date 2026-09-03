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
/**
 * Write everything down, whatever happened.
 *
 * A run that crashes halfway has still seen things worth keeping, and the
 * first Android run proved the cost of losing them: it failed, its logs were
 * held until the job finished, the job then hung on emulator teardown, and
 * cancelling it threw away every screenshot already taken. Nothing was left
 * to diagnose from.
 *
 * So one function writes the report, called on the happy path and from the
 * crash handlers alike, and a crash is recorded as a fact in the report
 * rather than as an absence of one.
 */
let finalized = false;
function finalize() {
  if (finalized) return;
  finalized = true;
  try {
    report.finishedAt = new Date().toISOString();
    writeFileSync(join(OUT, "ios-drive-report.json"), JSON.stringify(report, null, 2));
    // Hand the run back in Nexora's own shape. The crawler decides what it
    // saw; Nexora decides what it means.
    const forNexora = toNexora(report, "ios");
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

/**
 * Is this thing a control, or is it just words on the screen?
 *
 * The first run that could tap pressed every node with a box on it and then
 * reported the app's own title, its tagline and "John 3:16" as dead controls.
 * They are not broken buttons; they were never buttons. A report full of
 * findings like that is worse than no report, because the real ones drown.
 *
 * iOS says what each node is — the accessibility role — so this asks instead
 * of guessing. React Native surfaces a Pressable as AXButton, so the roles
 * below are what an app of this kind actually exposes.
 */
const CONTROL_ROLES = new Set([
  "AXButton",
  "AXLink",
  "AXTextField",
  "AXSecureTextField",
  "AXSearchField",
  "AXSwitch",
  "AXSlider",
  "AXCell",
  "AXTabGroup",
  "AXRadioButton",
  "AXCheckBox",
  "AXPopUpButton",
  "AXSegmentedControl"
]);

const isControl = (el) => {
  if (!el || !el.frame || el.enabled === false) return false;
  if (CONTROL_ROLES.has(el.role)) return true;
  // Some controls describe themselves only through their traits.
  const traits = Array.isArray(el.traits) ? el.traits : [];
  return traits.some((t) => /^(Button|Link|SearchField|Selected|Adjustable)$/i.test(String(t)));
};

const isTextField = (el) =>
  el?.role === "AXTextField" || el?.role === "AXSecureTextField" || el?.role === "AXSearchField";

const labelOf = (el) => ((el.AXLabel ?? "") + " " + (el.AXValue ?? "")).trim();

/**
 * What the screen looks like to a comparison, and why labels alone are not it.
 *
 * The first honest run judged every Bible control dead — KJV, NLT, AMP, the
 * book picker — because it compared labels only. Choosing NLT does change the
 * screen: the highlighted pill moves and the passage reloads. It does not
 * change one single label, so the two reads were identical and four working
 * controls were reported broken.
 *
 * Selection lives in the traits, and layout changes live in the frames, so
 * both are in the fingerprint now. Frames are rounded to whole points because
 * sub-pixel drift is not a change anybody can see, and the ambient-movement
 * check still runs first — a screen that will not sit still is not judged at
 * all rather than judged with a more sensitive ruler.
 */
const fingerprint = (nodes) =>
  nodes
    .filter((n) => n.frame)
    .map((n) => {
      const traits = Array.isArray(n.traits) ? n.traits.join(",") : "";
      const f = n.frame;
      const box = [f.x, f.y, f.width, f.height].map((v) => Math.round(v)).join(",");
      return [n.role ?? "", labelOf(n), traits, box].join("|");
    })
    .join(" ~ ");

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

  /**
   * The form sits behind a welcome step. Only that step is a door.
   *
   * Treating "Sign in" as a door too pressed the SUBMIT button on an empty
   * form, which raised "Details needed — enter your email and password
   * first". That alert is modal, so the very fields the next step went looking
   * for were not reachable, and the run reported the sign-in as broken when
   * the only thing broken was the order it pressed things in.
   */
  const door = await tapLabelled(/get started/i);
  note(tag + " door", door.ok ? 'pressed "' + door.tapped + '"' : door.why);
  await sleep(2500);

  // Clear anything modal left over before reading the form.
  const leftover = await tapLabelled(/^(ok|dismiss|close)$/i);
  if (leftover.ok) {
    note(tag + " alert", 'dismissed "' + leftover.tapped + '" before reading the form');
    await sleep(1200);
  }

  /**
   * Find the boxes by what they ARE, not by words near them.
   *
   * Matching on /email|phone/ typed the account into a validation message that
   * happened to say "Enter your email and password first." — the sign-in then
   * failed, and the run reported everything behind it as unchecked, correctly
   * but for entirely the wrong reason. A secure text field is a password box
   * whatever the label above it says.
   */
  const fields = (await tree()).filter(isTextField);
  const secure = fields.filter((f) => f.role === "AXSecureTextField");
  const plain = fields.filter((f) => f.role !== "AXSecureTextField");
  const emailField = plain[0] ?? null;
  const passwordField = secure[0] ?? null;

  if (emailField) {
    await tapFrame(emailField.frame);
    await sleep(500);
    await idbRun(["ui", "text", EMAIL]);
    await sleep(700);
  }
  note(tag + " email field", emailField ? "typed into the text field" : "no plain text field on this screen");

  if (passwordField) {
    await tapFrame(passwordField.frame);
    await sleep(500);
    await idbRun(["ui", "text", PASSWORD]);
    await sleep(700);
  }
  note(tag + " password field", passwordField ? "typed into the secure field" : "no secure text field on this screen");

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
  report.screens.push({ route, shot: shotPath, labels: labels.slice(0, 40), controls: nodes.filter(isControl).length });
  note("screen", route + " — " + (canTap ? labels.length + " labels" : "photographed only"));

  if (!canTap) continue;

  if (await movesOnItsOwn()) {
    report.notJudged.push({ route, why: "the screen changes on its own, so a press cannot be told from ambient movement" });
    note("not judged", route + " moves on its own — no dead-control verdict given here");
    continue;
  }

  const pressable = [];
  for (const n of nodes.filter((x) => isControl(x) && labelOf(x))) {
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
      // Proof, not just an assertion. A dead-control finding that cannot be
      // looked at is one nobody acts on.
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
    // A press can open a picker or a sheet, and leaving it open makes the NEXT
    // screen read as this one — /profile came back full of Bible-picker
    // controls for exactly this reason. Close it before moving on.
    await tapLabelled(/^(close|cancel|done|dismiss)$/i);
    await sleep(800);
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

finalize();

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
