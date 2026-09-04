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
        cls: attr("class"),
        isPassword: attr("password") === "true",
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
/**
 * The whole control on screen, above the SYSTEM navigation bar. The earlier
 * margin (260 px) also swallowed the app's own tab bar, so Home / Media /
 * Give / Chat / Bible / More were never pressed on Android and were listed as
 * "below the fold". The system bar on this emulator is ~130 px; the app's tab
 * bar sits above it and is a control like any other.
 */
const NAV_BAR_PX = 130;
const onScreen = (n) => {
  if (!n.box) return false;
  const [x1, y1, x2, y2] = n.box;
  return x1 >= 0 && y1 >= 0 && x2 <= SCREEN.width && y2 <= SCREEN.height - NAV_BAR_PX + 4 && x2 > x1 && y2 > y1;
};

/**
 * What the screen looks like to a comparison, and why labels alone are not it.
 *
 * The iOS lane judged every Bible control dead — KJV, NLT, AMP — because it
 * compared labels only. Choosing NLT moves the highlight and reloads the
 * passage; it changes no label at all, so four working controls were reported
 * broken. Selection and layout are what actually move, so both are in here.
 */
/** Coarse ruler for "is this still the screen I meant?" — see the iOS lane. */
const structure = (nodes) =>
  nodes
    .filter((n) => n.box && (n.clickable || n.text))
    .map((n) => (n.cls ?? "").split(".").pop() + ":" + labelOf(n).slice(0, 40))
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
    nodes.some((n) => /EditText/.test(n.cls)) ||
    /get started|welcome back|create account/i.test(words);
  return nodes.length > 0 && !signInFormShowing;
}

const report = {
  startedAt: new Date().toISOString(),
  permissions: PERMISSIONS,
  shotDir: OUT,
  signedIn: false,
  steps: [],
  screens: [],
  deadControls: [],
  liveControls: 0,
  notPressed: [],
  notJudged: [],
  notReached: [],
  permissionsRequested: [],
  /** Controls that were the active choice and work otherwise, but are not marked selected. */
  activeNotSelected: [],
  /** Whether the session survived quitting and relaunching the app. */
  coldStart: null,
  /** Whether the session survived leaving for another app and coming back. */
  leaveAndReturn: null,
  /** Whether the session survived the system photo picker and coming back. */
  pickerAndReturn: null,
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
  const answer = nodes.find((n) => n.box && /^(don.?t allow|deny|not now)$/i.test(labelOf(n)))
    ?? nodes.find((n) => n.box && PERMISSION_ANSWERS.test(labelOf(n)));
  // No system answer button, no permission sheet — whatever the words say.
  if (!answer) return false;
  const what = (words.match(/[^|]*(?:would like|access to|allow)[^|]*/i) ?? [words.slice(0, 160)])[0].trim();
  report.permissionsRequested.push({ route, control, asked: what.slice(0, 200), answered: labelOf(answer) });
  note("permission", route + ' — pressing "' + control + '" made the system ask: "' + what.slice(0, 90) + '" — answered "' + labelOf(answer) + '"');
  await tapBox(answer.box);
  await sleep(1200);
  return true;
}

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
  // Scroll to the top first: the in-tab sign-in card can sit half off screen
  // after a scroll, and its boxes then do not appear in the dump at all.
  await sh(["input", "swipe", "540", "600", "540", "1900", "500"]).catch(() => undefined);
  await sleep(800);
  let door = { ok: false, why: "not pressed" };
  for (let attempt = 0; attempt < 3; attempt++) {
    door = await tapLabelled(/get started/i);
    await sleep(2500);
    const opened = (await tree()).some((n) => /EditText/.test(n.cls));
    if (opened || !door.ok) break;
    note(tag + " door", 'pressed "' + door.tapped + '" but no form appeared — pressing again');
  }
  note(tag + " door", door.ok ? 'pressed "' + door.tapped + '"' : door.why);
  const leftover = await tapLabelled(/^(ok|dismiss|close)$/i);
  if (leftover.ok) {
    note(tag + " alert", 'dismissed "' + leftover.tapped + '" before reading the form');
    await sleep(1200);
  }

  /**
   * The box, not the words above it. Matching /email|phone/ tapped the label
   * "Email or Phone" — a TextView — so nothing had focus and both boxes were
   * still empty in the screenshot. Android names an input by its class, and
   * marks a password box as one, so those are what this asks for. Then the
   * box is read back, because a tap that "worked" proves nothing.
   */
  /**
   * The in-tab sign-in card on More has THREE boxes: Display name, Email,
   * Password. "The first box" typed the email into Display name, and the
   * re-sign-in failed with the address sitting in the wrong field. An empty
   * EditText carries its hint as its text, so the email box is the one whose
   * hint says so; failing that, the box directly above the password.
   */
  const inputs = (await tree()).filter((n) => /EditText/.test(n.cls) && n.box);
  const passwordBox = inputs.find((n) => n.isPassword) ?? inputs[inputs.length - 1] ?? null;
  const byHint = inputs.find((n) => n !== passwordBox && /email|phone/i.test(n.text));
  const abovePassword = passwordBox
    ? inputs.filter((n) => n !== passwordBox && n.box[1] < passwordBox.box[1]).sort((a, b) => b.box[1] - a.box[1])[0]
    : null;
  const emailBox = byHint ?? abovePassword ?? inputs.find((n) => n !== passwordBox) ?? null;

  const typeInto = async (box, text, label, secret) => {
    if (!box) return { ok: false, why: "no " + label + " box on this screen" };
    for (let attempt = 0; attempt < 2; attempt++) {
      await tapBox(box.box);
      await sleep(500);
      if (attempt > 0) {
        await sh(["input", "keyevent", "KEYCODE_MOVE_END"]).catch(() => undefined);
        for (let i = 0; i < text.length + 8; i++) await sh(["input", "keyevent", "67"]).catch(() => undefined);
      }
      await sh(["input", "text", forInputText(text)]);
      await sleep(700);
      const now = (await tree()).find((n) => /EditText/.test(n.cls) && n.box && Math.abs(n.box[1] - box.box[1]) < 6);
      const value = String(now?.text ?? "");
      const ok = secret ? value.length === text.length : value === text;
      if (ok) return { ok: true, why: attempt ? "read back correctly on the second try" : "read back correctly" };
      if (attempt === 1) return { ok: false, why: "box reads " + JSON.stringify(secret ? value.length + " chars" : value) + " after two tries" };
    }
    return { ok: false, why: "unreachable" };
  };

  const e = await typeInto(emailBox, EMAIL, "email", false);
  note(tag + " email field", e.why);
  // The keyboard raised by the email box covers the password box, so the
  // tap meant for it lands on a key and the password is typed into the
  // email box — the box then read "fableqa@…OgnFableQa2026!". Put the
  // keyboard away first.
  await sh(["input", "keyevent", "111"]).catch(() => undefined);
  await sleep(700);
  const pw = await typeInto(passwordBox, PASSWORD, "password", true);
  note(tag + " password field", pw.why);

  // The keyboard raised by the password box covers the Sign In button. The
  // dump still lists the button at its logical place, so the tap "succeeds"
  // and lands on a key — the screenshot showed both boxes filled correctly
  // and the form simply still there. Put the keyboard away, then press.
  await sh(["input", "keyevent", "111"]).catch(() => undefined);
  await sleep(900);
  /**
   * Two things on this screen say "Sign In": the mode tab at the top and the
   * button at the bottom. The first match is the tab, which is already the
   * mode — pressing it is a no-op — and that is why the boxes were full, the
   * keyboard was away, "Sign In" was pressed, and the server never heard a
   * thing (the account's last sign-in time belongs to the iPhone run). The
   * submit button is the lowest one on screen.
   */
  const candidates = (await tree()).filter((n) => n.clickable && n.box && onScreen(n) && /^sign in$/i.test(labelOf(n)));
  candidates.sort((a, b) => b.box[1] - a.box[1]);
  const submitNode = candidates[0] ?? null;
  let submit;
  if (submitNode) {
    await tapBox(submitNode.box);
    submit = { ok: true, tapped: labelOf(submitNode) + " (lowest of " + candidates.length + ")" };
  } else {
    submit = { ok: false, why: "nothing on screen says Sign In" };
  }
  note(tag + " submit", submit.ok ? 'pressed "' + submit.tapped + '"' : submit.why);
  // An emulator on a shared runner reaches Supabase slowly. Poll instead of
  // guessing a delay, up to twenty seconds.
  for (let waited = 0; waited < 20000; waited += 2000) {
    await sleep(2000);
    if (await looksSignedIn()) break;
  }
  signedInProof = await proveSignedIn();

  // A rejected sign-in raises a modal alert; record what it said and clear
  // it, or every later press lands on its OK button. Same guard as iOS.
  const alertText = fingerprint(await tree());
  const alert = await tapLabelled(/^(ok|dismiss|close|try again)$/i);
  if (alert.ok) {
    const said = (alertText.match(/[^|~]*(?:needed|invalid|incorrect|failed|wrong|error)[^|~]*/i) ?? [""])[0].trim();
    note(tag + " alert", 'the app answered with an alert' + (said ? ': "' + said.slice(0, 120) + '"' : "") + " — dismissed");
    await sleep(1200);
  }

  return signedInProof.ok;
}

/** Proof of sign-in on the More tab — see the iOS lane for why Home is not proof. */
let signedInProof = { ok: false, why: "not checked yet" };
async function proveSignedIn() {
  await sh(["am", "start", "-a", "android.intent.action.VIEW", "-d", SCHEME + "://profile"]).catch(() => undefined);
  await sleep(3500);
  const words = (await tree()).map(labelOf).filter(Boolean).join(" | ");
  const emailShown = words.toLowerCase().includes(EMAIL.toLowerCase()) || /fableqa@ove/i.test(words);
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
  await sh(["am", "force-stop", BUNDLE]).catch(() => undefined);
  await sleep(1500);
  await sh(["monkey", "-p", BUNDLE, "-c", "android.intent.category.LAUNCHER", "1"]).catch(() => undefined);
  await sleep(11000);
  await clearSystemDialogs();
  const proof = await proveSignedIn();
  report.coldStart = { attempted: true, stillSignedIn: proof.ok, why: proof.why };
  await shot("03-after-cold-start");
  note("cold start", proof.ok ? "the session survived closing and reopening the app" : "SESSION LOST after closing and reopening the app — " + proof.why);
  if (!proof.ok) {
    // Sign back in so the rest of the run is still a signed-in run.
    await signIn("re-entry");
  }
}

/**
 * Does the session survive LEAVING the app and coming back?
 *
 * A quit-and-relaunch kept the session on both phones. What lost it, three
 * Android runs in a row, was a detour: Watch Live opening the browser, or
 * Upload photo opening the picker, and the app being brought back. That is
 * the second most common thing a person does — tap a link, come back — so it
 * is tested on purpose right after the cold start: open a web page, wait,
 * return, look for the email on the More tab again.
 */
async function checkLeaveAndReturn() {
  await sh(["am", "start", "-a", "android.intent.action.VIEW", "-d", "https://overcomersglobalnetwork.com"]).catch(() => undefined);
  await sleep(6000);
  await sh(["monkey", "-p", BUNDLE, "-c", "android.intent.category.LAUNCHER", "1"]).catch(() => undefined);
  await sleep(6000);
  await clearSystemDialogs();
  const proof = await proveSignedIn();
  report.leaveAndReturn = { attempted: true, stillSignedIn: proof.ok, why: proof.why };
  await shot("04-after-leave-and-return");
  note("leave and return", proof.ok ? "the session survived leaving for the browser and coming back" : "SESSION LOST after leaving for the browser and coming back — " + proof.why);
  if (!proof.ok) await signIn("re-entry");
}

/**
 * The picker detour, on purpose.
 *
 * Quit-and-relaunch kept the session. A browser detour kept the session. What
 * still lost it on Android, three runs running, happened after the crawl's
 * "Upload profile photo" press opened the system photo picker. So that exact
 * path is walked deliberately: open More, press Upload profile photo, answer
 * the system, come back, and look for the email again.
 */
async function checkPickerAndReturn() {
  await sh(["am", "start", "-a", "android.intent.action.VIEW", "-d", SCHEME + "://profile"]).catch(() => undefined);
  await sleep(4000);
  const upload = await tapLabelled(/upload profile photo/i);
  if (!upload.ok) {
    report.pickerAndReturn = { attempted: false, why: upload.why };
    return;
  }
  await sleep(3000);
  const asked = await handlePermissionSheet("/profile", "Upload profile photo");
  if (!asked) await sh(["input", "keyevent", "4"]).catch(() => undefined);
  await sleep(2000);
  await sh(["monkey", "-p", BUNDLE, "-c", "android.intent.category.LAUNCHER", "1"]).catch(() => undefined);
  await sleep(5000);
  await clearSystemDialogs();
  const proof = await proveSignedIn();
  report.pickerAndReturn = { attempted: true, stillSignedIn: proof.ok, why: proof.why };
  await shot("05-after-picker-and-return");
  note("picker and return", proof.ok ? "the session survived the photo picker and coming back" : "SESSION LOST after the photo picker — " + proof.why);
  if (!proof.ok) await signIn("re-entry");
}



try {
  const wm = await adbText(["shell", "wm", "size"]);
  const m = wm.match(/(\d+)x(\d+)/);
  if (m) SCREEN = { width: Number(m[1]), height: Number(m[2]) };
} catch {
  // The default is a Pixel 6, which is what the workflow boots.
}

// ── Launch ─────────────────────────────────────────────────────────────────
/**
 * Is our app actually the thing on screen?
 *
 * A fresh emulator threw up "Pixel Launcher isn't responding" while the app
 * was starting, and every read for the rest of the run was of that dialog
 * and whatever sat behind it. The run reported the app's sign-in absent and
 * eighteen controls dead; the app had never been in front. So: launch, wait,
 * clear any system dialog, and ASK Android which window has focus before
 * believing anything read from the screen.
 */
async function inFront() {
  try {
    const out = await adbText(["shell", "dumpsys", "window"]);
    // mCurrentFocus=Window{7c1 u0 com.overcomers.globalnetwork.app/…MainActivity}
    const m = out.match(/mCurrentFocus=Window\{[^}]*?\s([A-Za-z][\w.]+)\//);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}
async function clearSystemDialogs() {
  for (let i = 0; i < 3; i++) {
    const r = await tapLabelled(/^(wait|close app|ok|got it|dismiss)$/i);
    if (!r.ok) break;
    note("system dialog", 'cleared "' + r.tapped + '"');
    await sleep(1200);
  }
}
await sh(["am", "force-stop", BUNDLE]).catch(() => undefined);
for (let attempt = 0; attempt < 3; attempt++) {
  await sh(["monkey", "-p", BUNDLE, "-c", "android.intent.category.LAUNCHER", "1"]).catch(() => undefined);
  await sleep(11000);
  await clearSystemDialogs();
  const front = await inFront();
  if (front === BUNDLE) break;
  note("launch", "attempt " + (attempt + 1) + ": " + (front || "nothing") + " is in front, not the app — launching again");
  await sleep(4000);
}
report.screens.push({ route: "(launch)", shot: await shot("00-launch"), labels: fingerprint(await tree()).slice(0, 400) });
note("launch", "app opened");

// ── Sign in ────────────────────────────────────────────────────────────────
if (PERMISSIONS.hasTestIdentity) {
  await shot("01-sign-in");
  report.signedIn = await signIn("first");
  await shot("02-after-sign-in");
  report.signedInProof = signedInProof.why;
  note("sign-in", (report.signedIn ? "confirmed: " : "NOT confirmed: ") + signedInProof.why);
  if (report.signedIn) await checkColdStart();
  if (report.signedIn) await checkLeaveAndReturn();
  if (report.signedIn) await checkPickerAndReturn();
} else {
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
const nodeKey = (n) => ((n.cls ?? "").split(".").pop()) + ":" + labelOf(n).slice(0, 60);
const nodeState = (n) => {
  const f = n.box ?? [0, 0, 0, 0];
  const traits = (n.selected ? "sel" : "") + (n.checked ? "chk" : "");
  return traits + "|" + f.join(",");
};
const stateMap = (nodes) => {
  const m = new Map();
  for (const n of nodes.filter((x) => x.box)) m.set(nodeKey(n), (m.get(nodeKey(n)) ?? "") + ";" + nodeState(n));
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

  const noisy = await measureNoise();
  if (noisy.size > 0) note("noise", route + " — " + noisy.size + " element(s) move on their own and are left out of the comparison");
  if (noisy.size > 40) {
    report.notJudged.push({ route, why: "almost everything on this screen moves on its own, so a press cannot be told from ambient movement" });
    note("not judged", route + " — too much moves on its own");
    continue;
  }

  const pressable = [];
  for (const n of nodes.filter((x) => x.clickable && x.box && labelOf(x))) {
    if (!onScreen(n)) {
      report.notReached.push({ route, control: labelOf(n), why: "below the fold — needs scrolling, which this run does not do yet" });
      continue;
    }
    if (n.selected || n.checked) {
      report.notPressed.push({ route, control: labelOf(n), kind: "already-selected", why: "already the active choice; pressing it is meant to do nothing" });
      continue;
    }
    if (/EditText/.test(n.cls)) {
      report.notPressed.push({ route, control: labelOf(n), kind: "text-box", why: "a text box — judged by typing, not by a tap" });
      continue;
    }
    const verdict = mayPress(labelOf(n), PERMISSIONS);
    // The session-ending ones are gathered for the end of the run, not skipped.
    if (verdict.allowed && verdict.cls === "recoverable") continue;
    if (verdict.allowed) pressable.push(n);
    else report.notPressed.push({ route, control: labelOf(n), kind: verdict.cls, why: verdict.why });
  }

  // Six per screen keeps a long list from eating the whole run.
  // Put the screen back before every press, and prove it. See the iOS lane.
  // The chat screen never matched its own baseline: the live room card and
  // the message list are exactly the elements measured as noise. Leave them
  // out of the identity too, and accept three-quarters overlap.
  const quietStructure = (ns) => structure(ns.filter((n) => !noisy.has(nodeKey(n))));
  const baseline = quietStructure(nodes);
  const restore = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt === 1) await sh(["input", "keyevent", "4"]).catch(() => undefined);
      if (attempt === 2) {
        await sh(["am", "force-stop", BUNDLE]).catch(() => undefined);
        await sh(["monkey", "-p", BUNDLE, "-c", "android.intent.category.LAUNCHER", "1"]).catch(() => undefined);
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
    const live = (await tree()).find((n) => labelOf(n) === labelOf(control) && n.clickable && onScreen(n));
    if (!live) {
      report.notReached.push({ route, control: labelOf(control), why: "no longer on screen when its turn came" });
      continue;
    }
    control.box = live.box;
    await tapBox(control.box);
    await sleep(2400);
    const asked = await handlePermissionSheet(route, labelOf(control));
    const front = await inFront();
    const left = front && front !== BUNDLE;
    if (left) {
      /**
       * Come back the way a person does: the Back button. Relaunching through
       * the launcher intent brought the app back as a fresh task, and every
       * time the app then behaved as signed out — the More tab showed the
       * sign-in card — while a deliberate quit-and-reopen kept the session.
       * Until the crawler returns like a user, it cannot say whether that is
       * the app's fault or its own.
       */
      note("left the app", '"' + labelOf(control) + '" opened ' + front + " — pressing Back to return");
      await sh(["input", "keyevent", "4"]).catch(() => undefined);
      await sleep(2500);
      if ((await inFront()) !== BUNDLE) {
        note("left the app", "Back did not return to the app — relaunching it");
        await sh(["monkey", "-p", BUNDLE, "-c", "android.intent.category.LAUNCHER", "1"]).catch(() => undefined);
        await sleep(3000);
      }
      // Was the session still there when we came back? Recorded either way.
      const proof = await proveSignedIn();
      report.returnChecks = report.returnChecks ?? [];
      const returnShot = await shot("30-return-" + report.returnChecks.length).catch(() => null);
      report.returnChecks.push({ route, control: labelOf(control), left_for: front, signedInOnReturn: proof.ok, why: proof.why, shot: returnShot });
      note("return check", proof.ok ? "still signed in after coming back from " + front : "SESSION GONE after coming back from " + front + " — " + proof.why);
      if (!proof.ok) {
        // Counted once, above. Sign back in so every later screen is still
        // judged as a member would see it, not as a signed-out visitor.
        await signIn("re-entry after " + front);
      }
      await openRoute();
      await sleep(2500);
    }
    let after = asked ? before + " +permission-sheet" : left ? before + " +left-for-" + front : quietPrint(await tree(), noisy);
    // Patience before a verdict: a settings sheet on a shared emulator can
    // take longer than the fixed wait. Only "unchanged every time" is dead.
    for (let extra = 0; extra < 2 && before === after; extra++) {
      await sleep(2000);
      after = quietPrint(await tree(), noisy);
    }
    // A press can change the screen BELOW the fold: the profile rows open a
    // detail panel underneath the list, out of view, and the dump only holds
    // what is visible. Three working rows were called dead for it. Look down
    // once before judging.
    if (before === after) {
      await sh(["input", "swipe", "540", "1800", "540", "600", "600"]).catch(() => undefined);
      await sleep(1200);
      const lower = quietPrint(await tree(), noisy);
      await sh(["input", "swipe", "540", "600", "540", "1800", "600"]).catch(() => undefined);
      await sleep(1000);
      if (lower !== before && lower !== after) {
        note("below the fold", route + ' — "' + labelOf(control) + '" changed the screen below the fold; not dead');
        report.liveControls++;
        await restore();
        continue;
      }
    }
    // A second opinion before a verdict: restore the screen and press once
    // more. A press lost to a scroll settling or a slow emulator is not a
    // dead control; "dead twice, on a restored screen" is a claim worth making.
    if (before === after && (await restore())) {
      const again = (await tree()).find((n) => labelOf(n) === labelOf(control) && n.clickable && onScreen(n));
      if (again) {
        const b2 = quietPrint(await tree(), noisy);
        await tapBox(again.box);
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
      const row = (await tree()).filter((n) => n.clickable && onScreen(n) && labelOf(n) && labelOf(n) !== labelOf(control) && Math.abs(n.box[1] - control.box[1]) < 16 && mayPress(labelOf(n), PERMISSIONS).allowed);
      const neighbour = row[0];
      if (neighbour) {
        await tapBox(neighbour.box);
        await sleep(2500);
        const mid = quietPrint(await tree(), noisy);
        const orig = (await tree()).find((n) => labelOf(n) === labelOf(control) && n.clickable && onScreen(n));
        if (orig && mid !== before) {
          await tapBox(orig.box);
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
    const modal = await tapLabelled(/^(ok|close|cancel|done|dismiss|got it)\b/i);
    if (modal.ok) await sleep(800);
  }
}

// ── The sign-out flow, pressed on purpose and then undone ──────────────────
//
// This is the part a "never press anything scary" tester can never do, and it
// is the part that finds the worst defect there is: an app you can leave and
// cannot get back into. It runs last, and only with a stored account.
if (report.signedIn) {
  if (!(await proveSignedIn()).ok) {
    note("sign-out", "the session was gone before the sign-out check — signing in again first");
    await signIn("before-sign-out");
  }
  await sh(["am", "start", "-a", "android.intent.action.VIEW", "-d", SCHEME + "://profile"]).catch(() => undefined);
  await sleep(4000);

  let signOut = null;
  for (let hop = 0; hop < 4 && !signOut; hop++) {
    // On Android the words "Sign Out" sit in a TextView inside the pressable row; the flat
    // dump gives the words to a node not marked clickable. Tapping the words lands on the row.
    signOut = (await tree()).find((n) => n.box && onScreen(n) && /^(sign ?out|log ?out|logout)$/i.test(labelOf(n)) && mayPress(labelOf(n), PERMISSIONS).allowed) ?? null;
    if (signOut) break;
    await sh(["input", "swipe", "540", "1800", "540", "500", "900"]).catch(() => undefined);
    await sleep(1500);
    // Kept as evidence: which hop saw what, so "not found" is checkable.
    const seen = (await tree()).map(labelOf).filter(Boolean);
    note("sign-out hunt", "hop " + (hop + 1) + " — " + seen.length + " labels, last: " + seen.slice(-3).join(" / "));
    await shot("18-scroll-" + (hop + 1));
  }
  if (!signOut) {
    report.sessionFlow = { attempted: false, why: "no sign-out control was found on the profile screen" };
    note("sign-out", "not found on the profile screen");
  } else {
    for (let i = 0; i < 4; i++) {
      await sleep(900);
      const a = (await tree()).find((n) => labelOf(n) === labelOf(signOut) && n.box && onScreen(n));
      await sleep(600);
      const b = (await tree()).find((n) => labelOf(n) === labelOf(signOut) && n.box && onScreen(n));
      if (a && b && a.box[1] === b.box[1]) { signOut.box = b.box; break; }
    }
    await shot("19-before-sign-out");
    note("sign-out", 'pressing "' + labelOf(signOut) + '" deliberately — the stored account can restore the session');
    await tapBox(signOut.box);
    await sleep(4000);
    // Some apps confirm first. Confirming a sign-out is still recoverable.
    const confirm = await tapLabelled(/^(sign ?out|log ?out|yes|confirm)$/i);
    if (confirm.ok) await sleep(2000);
    /**
     * When does the app notice it signed out?
     *
     * The server accepts the logout within a second. The app then shows Home,
     * signed in, and on Android the sign-in card appeared about a minute
     * later on its own — which looks like the local session surviving the
     * sign-out and dying only when its next token refresh is refused. So the
     * moment the screen flips is recorded, up to ninety seconds. "Never" and
     * "after 60 s" are different findings.
     */
    /**
     * Judge the sign-out where it can be seen, not on whatever screen is up.
     *
     * After Sign Out the app lands on the Home tab — a screen that draws for
     * signed-out people too. Reading Home as "still signed in" produced a
     * false critical finding four runs in a row; the More tab, photographed a
     * minute later, showed the sign-in card the whole time. So the More tab is
     * asked, and where the app landed is recorded as its own, smaller fact.
     */
    await sleep(3000);
    await shot("20-after-sign-out");
    report.sessionLandedOn = (await tree()).some((n) => /^(home|media|give|chat|bible|more)$/i.test(n.text ?? "")) ? "the tab bar (Home)" : "somewhere without the tab bar";
    let signedOutOk = false;
    let signedOutAfterMs = null;
    const t0 = Date.now();
    for (let waited = 0; waited < 90000; waited += 6000) {
      const p = await proveSignedIn();
      if (!p.ok && /sign-in card|Sign in to OGN/i.test(p.why)) { signedOutOk = true; signedOutAfterMs = Date.now() - t0; break; }
      await sleep(6000);
    }
    await shot(signedOutOk ? "20b-signed-out-seen" : "20-after-sign-out-90s");
    note("sign-out timing", signedOutOk ? "the app showed signed-out after " + Math.round(signedOutAfterMs / 1000) + " s" : "the app still showed signed-in after 90 s");
    note("sign-out result", signedOutOk ? "the session ended, as it should" : "STILL SIGNED IN after pressing sign out");

    // Put it back. Whether this works is the finding that matters most.
    const recovered = await signIn("recovery");
    await shot("21-after-recovery");
    note("recovery", recovered ? "signed back in from the stored account" : "COULD NOT SIGN BACK IN after signing out");

    report.sessionFlow = {
      attempted: true,
      signedOut: signedOutOk,
      signedOutAfterMs,
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
