/**
 * Drive the OGN app on a real Android emulator, and prove which controls work.
 *
 * Photographing screens shows what the app LOOKS like. It says nothing about
 * whether anything happens when a person presses something, and a button that
 * silently does nothing is the defect users actually report. So this does what
 * Nexora does on the web: press a control, then read the screen again, and
 * decide from the difference whether the press did anything at all.
 *
 * The trap in that method is ambient noise. A clock ticks, a spinner turns, a
 * list settles — so a screen never compares equal to itself, and every control
 * looks alive. The fix is to measure the noise first, with no press at all,
 * and treat a screen that moves on its own as one where this cannot be judged.
 *
 * Two rules kept from Nexora, because they are what makes the report worth
 * trusting:
 *   - Controls are found by what they SAY. A tap at a remembered coordinate
 *     hits the wrong thing the moment a layout changes, silently.
 *   - Nothing destructive is pressed. Sign out, delete, remove and report are
 *     read and reported, never activated.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

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
 * Never press these, whatever else the run is doing.
 *
 * Pressing "Sign out" costs the session, and every screen after it would be
 * reported empty — a false result that looks like a broken app. Pressing
 * "Report" or "Block" lands on real people in a real database.
 */
const NEVER_PRESS = /sign out|log ?out|delete|remove|block|report|unfollow|leave|send|publish|approve/i;

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
        box: bounds ? bounds.slice(1).map(Number) : null
      });
    }
    return nodes;
  } catch {
    return [];
  }
}

const labelOf = (n) => (n.text + " " + n.desc).trim();
/** A stable fingerprint of what is on screen: labels only, order kept. */
const fingerprint = (nodes) => nodes.map(labelOf).filter(Boolean).join(" ");

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

/** adb's shell splits on spaces, so typed text arrives as one word without this. */
const shellQuote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";

const report = {
  startedAt: new Date().toISOString(),
  signedIn: false,
  steps: [],
  screens: [],
  deadControls: [],
  liveControls: 0,
  notPressed: [],
  notJudged: []
};
const note = (step, detail) => {
  report.steps.push({ step, detail });
  console.log("· " + step + ": " + detail);
};

// ── Launch ─────────────────────────────────────────────────────────────────
await sh(["am", "force-stop", BUNDLE]).catch(() => undefined);
await sh(["monkey", "-p", BUNDLE, "-c", "android.intent.category.LAUNCHER", "1"]).catch(() => undefined);
await sleep(11000);
report.screens.push({ route: "(launch)", shot: await shot("00-launch"), labels: fingerprint(await tree()).slice(0, 400) });
note("launch", "app opened");

// ── Sign in ────────────────────────────────────────────────────────────────
if (EMAIL && PASSWORD) {
  for (const door of [/get started/i, /^sign in$/i]) {
    const r = await tapLabelled(door);
    note("door", r.ok ? 'pressed "' + r.tapped + '"' : r.why);
    await sleep(2500);
  }
  await shot("01-sign-in");

  const email = await tapLabelled(/email|phone/i);
  if (email.ok) {
    await sh(["input", "text", shellQuote(EMAIL)]);
    await sleep(700);
  }
  note("email field", email.ok ? 'typed into "' + email.tapped + '"' : email.why);

  const pw = await tapLabelled(/password/i);
  if (pw.ok) {
    await sh(["input", "text", shellQuote(PASSWORD)]);
    await sleep(700);
  }
  note("password field", pw.ok ? 'typed into "' + pw.tapped + '"' : pw.why);

  await sh(["input", "keyevent", "111"]).catch(() => undefined); // close the keyboard
  await sleep(500);
  const submit = await tapLabelled(/^sign in$/i);
  note("submit", submit.ok ? 'pressed "' + submit.tapped + '"' : submit.why);
  await sleep(9000);

  const after = fingerprint(await tree());
  // Read back off the app itself, never assumed from the tap having landed.
  report.signedIn = /welcome to|global broadcast|recent stories/i.test(after);
  await shot("02-after-sign-in");
  note(
    "sign-in",
    report.signedIn
      ? "confirmed by what the home screen shows"
      : "NOT confirmed — everything behind it is unchecked"
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

  for (const n of nodes.filter((x) => x.clickable && NEVER_PRESS.test(labelOf(x)))) {
    report.notPressed.push({ route, control: labelOf(n), why: "destructive, or it reaches real people" });
  }

  // Six per screen keeps a long list from eating the whole run.
  const pressable = nodes
    .filter((n) => n.clickable && n.box && labelOf(n) && !NEVER_PRESS.test(labelOf(n)))
    .slice(0, 6);

  for (const control of pressable) {
    const before = fingerprint(await tree());
    await tapBox(control.box);
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

report.blankScreens = report.screens.filter((s) => (s.labels?.length ?? 0) < 3).map((s) => s.route);
report.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, "android-drive-report.json"), JSON.stringify(report, null, 2));

console.log("\n=== Android emulator run ===");
console.log("signed in: " + report.signedIn);
console.log("screens photographed: " + report.screens.length);
console.log("controls that did something: " + report.liveControls);
console.log("controls that did nothing: " + report.deadControls.length);
for (const d of report.deadControls) console.log('   dead — ' + d.route + ' "' + d.control + '"');
console.log("deliberately not pressed: " + report.notPressed.length);
console.log("screens not judged (they move on their own): " + report.notJudged.length);
console.log("screens with nothing readable: " + (report.blankScreens.length ? report.blankScreens.join(", ") : "none"));
