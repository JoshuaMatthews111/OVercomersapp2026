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
  shotDir: OUT,
  canPressControls: canTap,
  signedIn: false,
  steps: [],
  screens: [],
  deadControls: [],
  liveControls: 0,
  notPressed: [],
  notJudged: [],
  notAssessed: [],
  /** Controls that exist but sit off screen. Not pressed, not judged, named. */
  notReached: [],
  /** What the operating system asked for, and what this run answered. */
  permissionsRequested: [],
  /** Controls that were the active choice and work otherwise, but are not marked selected. */
  activeNotSelected: [],
  /** Whether the session survived quitting and relaunching the app. */
  coldStart: null,
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

/**
 * Is the control actually on the screen a person can see?
 *
 * The accessibility tree lists everything in a scroll view, including rows
 * far below the fold. Tapping the centre of an off-screen row lands on
 * whatever is visible at that spot — usually nothing — and the row is then
 * reported dead. Five profile rows were, on a run where all five work. A
 * control that needs scrolling is named as not reached, never as broken.
 */
const SCREEN = { width: 402, height: 874 };
/**
 * The WHOLE control must be on screen, not just its centre. A row whose
 * bottom half sits under the tab bar has a centre "on screen" and a tap that
 * lands on the tab bar; "Open OGN Member profile" was reported dead from a
 * card cut off at the bottom of Chat for exactly that reason.
 */
const TAB_BAR = 84;
const onScreen = (el) =>
  !!el.frame &&
  el.frame.y >= 0 &&
  el.frame.y + el.frame.height <= SCREEN.height - TAB_BAR + 2 &&
  el.frame.x >= 0 &&
  el.frame.x + el.frame.width <= SCREEN.width + 1;

/**
 * Which app is on screen. idb's tree starts with an AXApplication node whose
 * label is the app's name, so a press that opened Mail or Safari shows up as
 * a different name at the root — the control worked, it just left the app.
 */
async function appInFront() {
  const root = (await tree()).find((n) => n.role === "AXApplication" || n.type === "Application");
  return root ? String(root.AXLabel ?? "") : "";
}
const OUR_APP = /overcomers/i;
async function bringAppBack(why) {
  note("left the app", why + " — bringing it back");
  await simctl(["launch", UDID, BUNDLE]).catch(() => undefined);
  await sleep(3000);
}

const isSelected = (el) => Array.isArray(el.traits) && el.traits.some((t) => /^Selected$/i.test(String(t)));

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
/**
 * Two questions, two rulers.
 *
 * "Did this press change anything?" needs the fine ruler: selection and
 * layout, which is what the fingerprint below carries. "Is this still the
 * screen I meant to test?" needs a coarse one — a list that lazy-loads a row
 * or a spinner that settles moves frames by a few points, and with the fine
 * ruler every route read as "could not be restored" and was skipped whole.
 * The structure — what controls exist, in what order — is the identity of a
 * screen; where exactly they sit is not.
 */
const structure = (nodes) =>
  nodes
    .filter((n) => n.frame && (isControl(n) || n.role === "AXStaticText"))
    .map((n) => (n.role ?? "") + ":" + labelOf(n).slice(0, 40))
    .join("~");
const sameScreen = (a, b) => {
  if (a === b) return true;
  const A = new Set(a.split("~")), B = new Set(b.split("~"));
  let shared = 0;
  for (const k of A) if (B.has(k)) shared++;
  return shared / Math.max(A.size, B.size, 1) >= 0.75;
};

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
  /**
   * Signed out means a sign-in form is on screen: a text box to type into, or
   * the welcome door. Judging by the HOME screen's words was wrong the moment
   * the app was anywhere else — after "sign out" it sat in a chat room, still
   * signed in, and the run reported the session ended and a critical finding
   * that the app could not be signed back into. Neither was true.
   */
  const nodes = await tree();
  const words = fingerprint(nodes);
  const signInFormShowing =
    nodes.some((n) => isTextField(n)) ||
    /get started|welcome back|create account/i.test(words);
  return nodes.length > 0 && !signInFormShowing;
}


/**
 * A system permission sheet is not part of the app, and it is not nothing.
 *
 * Pressing "Upload profile photo" raised iOS's Photo Library sheet. That IS
 * the control working — and the sheet then sat over the next four rows, which
 * were all reported dead. So after every press: if the operating system is
 * asking for something, record what it asked for, answer no (the app's
 * denied path is the one that is never tested by hand), and carry on.
 */
const PERMISSION_WORDS = /would like (full )?access|would like to (send|use|access)|allow .* to access|access to your|photo library|camera|microphone|location|notifications|contacts/i;
/**
 * Only the operating system offers these answers. An app's own alert offers
 * "OK", and the Android run filed the app's "Notifications" message as a
 * permission request because "notifications" was in the text. The words in
 * a dialog say what it is about; the buttons say who is asking.
 */
const PERMISSION_ANSWERS = /^(don.?t allow|deny|not now|limit access|only while using|while using the app|allow once|allow full access|allow)$/i;
async function handlePermissionSheet(route, control) {
  const nodes = await tree();
  const words = nodes.map(labelOf).filter(Boolean).join(" | ");
  const answer = nodes.find((n) => n.frame && /^(don.?t allow|deny|not now)$/i.test(labelOf(n)))
    ?? nodes.find((n) => n.frame && PERMISSION_ANSWERS.test(labelOf(n)));
  // No system answer button, no permission sheet — whatever the words say.
  if (!answer) return false;
  const what = (words.match(/[^|]*(?:would like|access to|allow)[^|]*/i) ?? [words.slice(0, 160)])[0].trim();
  report.permissionsRequested.push({ route, control, asked: what.slice(0, 200), answered: labelOf(answer) });
  note("permission", route + ' — pressing "' + control + '" made the system ask: "' + what.slice(0, 90) + '" — answered "' + labelOf(answer) + '"');
  await tapFrame(answer.frame);
  await sleep(1200);
  return true;
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
  /**
   * Press the door and make sure it opened. One run pressed "Get started"
   * before the screen took input, saw no form, and gave up — the screenshot
   * still shows the welcome screen with the button on it.
   */
  let door = { ok: false, why: "not pressed" };
  for (let attempt = 0; attempt < 3; attempt++) {
    door = await tapLabelled(/get started/i);
    await sleep(2500);
    const opened = (await tree()).some(isTextField);
    if (opened || !door.ok) break;
    note(tag + " door", 'pressed "' + door.tapped + '" but no form appeared — pressing again');
  }
  note(tag + " door", door.ok ? 'pressed "' + door.tapped + '"' : door.why);

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
  // React Native does not always expose a password box as AXSecureTextField:
  // on this app it is a plain AXTextField whose traits or label say "password".
  // Ask the role first, then the traits, then the words, then fall back to
  // "the other text field" — a sign-in form has exactly two.
  const saysPassword = (f) =>
    f.role === "AXSecureTextField" ||
    (Array.isArray(f.traits) && f.traits.some((t) => /secure/i.test(String(t)))) ||
    /password/i.test(labelOf(f)) ||
    /password/i.test(String(f.AXPlaceholderValue ?? f.placeholder ?? ""));
  const passwordField = fields.find(saysPassword) ?? (fields.length >= 2 ? fields[1] : null);
  const emailField = fields.find((f) => f !== passwordField) ?? null;

  /**
   * Type, then read it back.
   *
   * idb drops characters from a long string: "fableqa@overcomersglobalnetwork.com"
   * arrived as "fableqarsglobalnetwork.com", the sign-in failed, and the run
   * blamed the app. Typing in short chunks avoids most of it; reading the box
   * back afterwards catches the rest. A password box cannot be read back, so
   * it is judged by length only.
   */
  const typeInto = async (fieldIn, text, label, secret) => {
    let field = fieldIn;
    if (!field) return { ok: false, why: "no " + label + " box on this screen" };
    for (let attempt = 0; attempt < 2; attempt++) {
      await tapFrame(field.frame);
      await sleep(500);
      if (attempt > 0) {
        // Backspacing did not reliably empty the box, so a retry starts from
        // a fresh form instead: relaunch, walk the door again, find the box.
        await simctl(["terminate", UDID, BUNDLE]).catch(() => undefined);
        await simctl(["launch", UDID, BUNDLE]).catch(() => undefined);
        await sleep(7000);
        await tapLabelled(/get started/i);
        await sleep(2500);
        const again = (await tree()).filter(isTextField);
        const fresh = again.find((f) => Math.abs(f.frame.y - field.frame.y) < 40) ?? again[0];
        if (!fresh) return { ok: false, why: "no " + label + " box after relaunching" };
        field = fresh;
        await tapFrame(field.frame);
        await sleep(500);
      }
      // Even five at a time idb dropped letters. One at a time is slow —
      // about five seconds for an email — and has not dropped one yet.
      for (const ch of text) {
        await idbRun(["ui", "text", ch]);
        await sleep(90);
      }
      await sleep(600);
      const now = (await tree()).find((n) => isTextField(n) && Math.abs(n.frame.y - field.frame.y) < 4);
      const value = String(now?.AXValue ?? "");
      const ok = secret ? value.length === text.length : value === text;
      if (ok) return { ok: true, why: attempt ? "read back correctly on the second try" : "read back correctly" };
      if (attempt === 1) return { ok: false, why: "box reads " + JSON.stringify(secret ? value.length + " chars" : value) + " after two tries" };
    }
    return { ok: false, why: "unreachable" };
  };

  const e = await typeInto(emailField, EMAIL, "email", false);
  note(tag + " email field", e.why);
  const pw = await typeInto(passwordField, PASSWORD, "password", true);
  note(tag + " password field", pw.why);

  const submit = await tapLabelled(/^sign in$/i);
  note(tag + " submit", submit.ok ? 'pressed "' + submit.tapped + '"' : submit.why);
  await sleep(9000);
  signedInProof = await proveSignedIn();

  // A rejected sign-in raises a modal alert. Left open, it swallows every
  // tap for the rest of the run and every control reads as dead — sixteen of
  // them did, on a run where nothing was wrong with the app. Record what it
  // said, then clear it.
  const alertText = fingerprint(await tree());
  const alert = await tapLabelled(/^(ok|dismiss|close|try again)$/i);
  if (alert.ok) {
    const said = (alertText.match(/[^|~]*(?:needed|invalid|incorrect|failed|wrong|error)[^|~]*/i) ?? [""])[0].trim();
    note(tag + " alert", 'the app answered with an alert' + (said ? ': "' + said.slice(0, 120) + '"' : "") + " — dismissed");
    await sleep(1200);
  }

  return signedInProof.ok;
}

/**
 * Proof of sign-in, not a hint of it.
 *
 * Home draws for signed-out people too, so "the home screen shows" proved
 * nothing: on Android the app said signed in while its More tab showed
 * "Sign in to OGN" and its Chat tab showed demo rooms with invented member
 * counts. The one thing only a signed-in member sees is their own email on
 * the More tab. That is what is checked, and its absence is the finding.
 */
let signedInProof = { ok: false, why: "not checked yet" };
async function proveSignedIn() {
  await simctl(["openurl", UDID, SCHEME + "://profile"]).catch(() => undefined);
  await sleep(1500);
  await tapLabelled(/^open$/i);
  await sleep(3000);
  const words = (await tree()).map(labelOf).filter(Boolean).join(" | ");
  const emailShown = words.toLowerCase().includes(EMAIL.toLowerCase());
  const askedToSignIn = /sign in to ogn|require an account/i.test(words);
  if (emailShown) return { ok: true, why: "the More tab shows the account's email" };
  if (askedToSignIn) return { ok: false, why: 'the More tab says "Sign in to OGN" — the app does not hold the session' };
  return { ok: false, why: "the More tab shows neither the email nor a sign-in card" };
}

/**
 * Does the session survive a cold start?
 *
 * Both phones signed in, and both later showed the More tab's "Sign in to
 * OGN" card after the crawler had closed and reopened the app. That is the
 * defect a person meets every morning: open the app, sign in again. So it is
 * tested on purpose, once, right after sign-in is proven: quit the app,
 * launch it, and look for the email on the More tab again.
 */
async function checkColdStart() {
  await simctl(["terminate", UDID, BUNDLE]).catch(() => undefined);
  await sleep(1500);
  await simctl(["launch", UDID, BUNDLE]).catch(() => undefined);
  await sleep(9000);
  const proof = await proveSignedIn();
  report.coldStart = { attempted: true, stillSignedIn: proof.ok, why: proof.why };
  await shot("03-after-cold-start");
  note("cold start", proof.ok ? "the session survived closing and reopening the app" : "SESSION LOST after closing and reopening the app — " + proof.why);
  if (!proof.ok) {
    // Sign back in so the rest of the run is still a signed-in run.
    await signIn("re-entry");
  }
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
  report.signedInProof = signedInProof.why;
  note("sign-in", (report.signedIn ? "confirmed: " : "NOT confirmed: ") + signedInProof.why);
  if (report.signedIn) await checkColdStart();
} else if (!PERMISSIONS.hasTestIdentity) {
  note("sign-in", "no account supplied, so only the signed-out screens were seen");
}


/**
 * Subtract what moves on its own, instead of refusing to judge the screen.
 *
 * Signed in, every screen has something alive on it — a story carousel, a
 * "Live" pill, a clock — and "does this screen move on its own?" was true for
 * all eight. The run then pressed nothing at all, honestly, and learned
 * nothing. Nexora's web lane does better: it measures the ambient movement
 * first and subtracts it. So each screen is read twice with no press; every
 * node that differed between the two reads is noise, and is left out of every
 * before/after comparison on that screen. What remains is what a press moved.
 */
const nodeKey = (n) => (n.role ?? "") + ":" + labelOf(n).slice(0, 60);
const nodeState = (n) => {
  const f = n.frame ?? { x: 0, y: 0, width: 0, height: 0 };
  const traits = Array.isArray(n.traits) ? n.traits.join(",") : "";
  return traits + "|" + [f.x, f.y, f.width, f.height].map((v) => Math.round(v)).join(",");
};
const stateMap = (nodes) => {
  const m = new Map();
  for (const n of nodes.filter((x) => x.frame)) m.set(nodeKey(n), (m.get(nodeKey(n)) ?? "") + ";" + nodeState(n));
  return m;
};
async function measureNoise() {
  const a = stateMap(await tree());
  await sleep(2000);
  const b = stateMap(await tree());
  const noisy = new Set();
  for (const [k, v] of a) if (b.get(k) !== v) noisy.add(k);
  for (const k of b.keys()) if (!a.has(k)) noisy.add(k);
  return noisy;
}
const quietPrint = (nodes, noisy) =>
  [...stateMap(nodes)].filter(([k]) => !noisy.has(k)).map(([k, v]) => k + "=" + v).join(" ~ ");

/** Kept for the record; no longer used to skip a screen. */
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

  const noisy = await measureNoise();
  if (noisy.size > 0) note("noise", route + " — " + noisy.size + " element(s) move on their own and are left out of the comparison");
  if (noisy.size > 40) {
    report.notJudged.push({ route, why: "almost everything on this screen moves on its own, so a press cannot be told from ambient movement" });
    note("not judged", route + " — too much moves on its own");
    continue;
  }

  const pressable = [];
  for (const n of nodes.filter((x) => isControl(x) && labelOf(x))) {
    if (!onScreen(n)) {
      report.notReached.push({ route, control: labelOf(n), why: "below the fold — needs scrolling, which this run does not do yet" });
      continue;
    }
    // Pressing the tab you are on, or the pill already chosen, does nothing
    // BY DESIGN. "Home, tab, 1 of 6" on Home and "Select KJV" with KJV lit
    // were reported dead on three runs. Not a control to judge.
    if (isSelected(n)) {
      report.notPressed.push({ route, control: labelOf(n), kind: "already-selected", why: "already the active choice; pressing it is meant to do nothing" });
      continue;
    }
    // A text box is judged by typing into it, not by tapping it: a tap only
    // raises the keyboard, which lives outside the app's tree.
    if (isTextField(n)) {
      report.notPressed.push({ route, control: labelOf(n), kind: "text-box", why: "a text box — judged by typing, not by a tap" });
      continue;
    }
    const verdict = mayPress(labelOf(n), PERMISSIONS);
    // Session-ending controls are saved for the end of the run, not skipped.
    if (verdict.allowed && verdict.cls === "recoverable") continue;
    if (verdict.allowed) pressable.push(n);
    else report.notPressed.push({ route, control: labelOf(n), kind: verdict.cls, why: verdict.why });
  }

  /**
   * Put the screen back before every press, and prove it.
   *
   * A press that opens something leaves the app THERE. On one run the first
   * press opened the Global Prayer Room, and every later "control" on /community
   * was pressed inside that room; on /prayer a tab press hid the very chips
   * the next presses were aimed at. Each of those was reported dead. Reopening
   * the route is not enough — a deep link to the tab you are on keeps the
   * nested screen — so the screen is compared with how it looked when the
   * route was first opened, backed out of if it differs, and relaunched if it
   * still differs. A press is only judged on the screen it was meant for.
   */
  // The chat screen never matched its own baseline: the live room card and
  // the message list are exactly the elements measured as noise. Leave them
  // out of the identity too, and accept three-quarters overlap.
  const quietStructure = (ns) => structure(ns.filter((n) => !noisy.has(nodeKey(n))));
  const baseline = quietStructure(nodes);
  const restore = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt === 1) await tapLabelled(/^(back|go back|close|cancel|done)\b/i);
      if (attempt === 2) {
        await simctl(["terminate", UDID, BUNDLE]).catch(() => undefined);
        await simctl(["launch", UDID, BUNDLE]).catch(() => undefined);
        await sleep(6000);
      }
      await openRoute();
      await sleep(2000);
      if (sameScreen(quietStructure(await tree()), baseline)) return true;
    }
    return false;
  };

  for (const control of pressable.slice(0, 6)) {
    if (!sameScreen(quietStructure(await tree()), baseline) && !(await restore())) {
      report.notJudged.push({ route, why: "the screen could not be put back to how it was, so the remaining controls here were not judged" });
      note("not judged", route + " — could not restore the screen; stopping here");
      break;
    }
    const before = quietPrint(await tree(), noisy);
    // Prove the control is still where the tree said, then press it.
    const live = (await tree()).find((n) => labelOf(n) === labelOf(control) && isControl(n) && onScreen(n));
    if (!live) {
      report.notReached.push({ route, control: labelOf(control), why: "no longer on screen when its turn came" });
      continue;
    }
    control.frame = live.frame;
    await tapFrame(control.frame);
    await sleep(2400);
    // The operating system answering counts as the control having worked.
    const asked = await handlePermissionSheet(route, labelOf(control));
    // So does leaving for another app: "Email Support" opening Mail is the
    // control doing its job, not the screen staying the same.
    const front = await appInFront();
    const left = front && !OUR_APP.test(front);
    if (left) await bringAppBack('"' + labelOf(control) + '" opened ' + front);
    /**
     * Patience before a verdict. A settings row that opens a sheet took longer
     * than the fixed wait on a shared runner, and four working rows were
     * called dead. Read again at intervals; only "unchanged every time" is
     * dead.
     */
    let after = asked ? before + " +permission-sheet" : left ? before + " +left-for-" + front : quietPrint(await tree(), noisy);
    for (let extra = 0; extra < 2 && before === after; extra++) {
      await sleep(2000);
      after = quietPrint(await tree(), noisy);
    }
    // A second opinion before a verdict: restore the screen and press once
    // more. A press lost to a scroll settling or a slow emulator is not a
    // dead control; "dead twice, on a restored screen" is a claim worth making.
    if (before === after && (await restore())) {
      const again = (await tree()).find((n) => labelOf(n) === labelOf(control) && isControl(n) && onScreen(n));
      if (again) {
        const b2 = quietPrint(await tree(), noisy);
        await tapFrame(again.frame);
        await sleep(3000);
        const a2 = quietPrint(await tree(), noisy);
        if (b2 !== a2) {
          note("second opinion", route + ' — "' + labelOf(control) + '" worked on the second press; not dead');
          report.liveControls++;
          await tapLabelled(/^(ok|close|cancel|done|dismiss|got it)\b/i);
          continue;
        }
      }
    }
    /**
     * The chip that is already chosen.
     *
     * "Sermons" on Media and "Private Messages" on Chat came back dead twice,
     * and the screenshots show why: they are the active choice, drawn gold,
     * and pressing the active choice does nothing by design. Android does not
     * mark them selected, so the earlier rule could not tell. The test that
     * settles it: press a neighbour in the same row, then press the original.
     * If the original now moves the screen, it works — and the real finding
     * is that the active choice is not exposed as selected to assistive tech.
     */
    if (before === after) {
      const row = (await tree()).filter((n) => isControl(n) && onScreen(n) && labelOf(n) && labelOf(n) !== labelOf(control) && Math.abs(n.frame.y - control.frame.y) < 6 && mayPress(labelOf(n), PERMISSIONS).allowed);
      const neighbour = row[0];
      if (neighbour) {
        await tapFrame(neighbour.frame);
        await sleep(2500);
        const mid = quietPrint(await tree(), noisy);
        const orig = (await tree()).find((n) => labelOf(n) === labelOf(control) && isControl(n) && onScreen(n));
        if (orig && mid !== before) {
          await tapFrame(orig.frame);
          await sleep(2500);
          const back = quietPrint(await tree(), noisy);
          if (back !== mid) {
            report.activeNotSelected.push({ route, control: labelOf(control), neighbour: labelOf(neighbour) });
            note("active choice", route + ' — "' + labelOf(control) + '" was the active choice; it works once "' + labelOf(neighbour) + '" is chosen, but is not marked selected');
            report.liveControls++;
            await restore();
            continue;
          }
        }
        await restore();
      }
    }
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
    await tapLabelled(/^(ok|close|cancel|done|dismiss|got it)\b/i);
    await sleep(800);
  }
}

// ── The sign-out flow, pressed on purpose and then undone ──────────────────
if (canTap && report.signedIn) {
  // A relaunch during the crawl may have cost the session (see cold start).
  // Sign back in first, or the profile shows a sign-in card and no Sign Out.
  if (!(await proveSignedIn()).ok) {
    note("sign-out", "the session was gone before the sign-out check — signing in again first");
    await signIn("before-sign-out");
  }
  await simctl(["openurl", UDID, SCHEME + "://profile"]).catch(() => undefined);
  await sleep(1500);
  await tapLabelled(/^open$/i);
  await sleep(3000);

  // Sign out sits at the very bottom of the profile. Scroll for it, up to
  // four screens, reading the tree after each swipe.
  let signOut = null;
  for (let hop = 0; hop < 4 && !signOut; hop++) {
    signOut = (await tree()).find((n) => isControl(n) && onScreen(n) && /^(sign ?out|log ?out|logout)$/i.test(labelOf(n)) && mayPress(labelOf(n), PERMISSIONS).allowed) ?? null;
    if (signOut) break;
    await idbRun(["ui", "swipe", "200", "700", "200", "200", "--duration", "0.4"]).catch(() => undefined);
    await sleep(1500);
    const seen = (await tree()).map(labelOf).filter(Boolean);
    note("sign-out hunt", "hop " + (hop + 1) + " — " + seen.length + " labels, last: " + seen.slice(-3).join(" / "));
    await shot("18-scroll-" + (hop + 1));
  }
  if (!signOut) {
    report.sessionFlow = { attempted: false, why: "no sign-out control was found on the profile screen" };
    note("sign-out", "not found on the profile screen");
  } else {
    // Let the scroll settle until two reads agree on where Sign Out is. A
    // press on stale coordinates landed on the Theme row and turned Home light.
    for (let i = 0; i < 4; i++) {
      await sleep(900);
      const a = (await tree()).find((n) => labelOf(n) === labelOf(signOut) && isControl(n) && onScreen(n));
      await sleep(600);
      const b = (await tree()).find((n) => labelOf(n) === labelOf(signOut) && isControl(n) && onScreen(n));
      if (a && b && Math.round(a.frame.y) === Math.round(b.frame.y)) { signOut.frame = b.frame; break; }
    }
    await shot("19-before-sign-out");
    note("sign-out", 'pressing "' + labelOf(signOut) + '" deliberately — the stored account can restore the session');
    await tapFrame(signOut.frame);
    await sleep(4000);
    const confirm = await tapLabelled(/^(sign ?out|log ?out|yes|confirm)$/i);
    if (confirm.ok) await sleep(2000);
    // Signing out is slow on a shared runner: Android showed Home four
    // seconds after the press and the sign-in card a minute later. Wait for
    // the signed-out state for up to twenty seconds before judging.
    let signedOutOk = false;
    for (let waited = 0; waited < 20000; waited += 2000) {
      await sleep(2000);
      if (!(await looksSignedIn())) { signedOutOk = true; break; }
    }
    await shot("20-after-sign-out");
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
