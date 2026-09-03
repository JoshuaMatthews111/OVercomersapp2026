/**
 * Drive the OGN app on a real iOS Simulator, and report only what was seen.
 *
 * This is the lane the project never had. The Office Mac cannot hold Xcode —
 * six gigabytes free, and every external drive is ExFAT, which Xcode refuses
 * to run from — so every check until now happened in a browser. A browser
 * cannot show a safe area, a permission sheet, a native gesture, or how the
 * app looks on the screen a reviewer will actually hold.
 *
 * A GitHub macOS runner has Xcode and the Simulator already, and this repo is
 * public, so those runners cost nothing. The app is built there, installed on
 * an iPhone, driven, and photographed.
 *
 * Two rules carried over from Nexora, because they are what makes a report
 * worth reading:
 *   - Never claim a screen was checked that was not opened.
 *   - Find controls by their accessibility label, never by guessed pixels.
 *     A tap at a remembered coordinate silently hits the wrong thing the
 *     first time a layout changes, and the run still reports success.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

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
const idb = (args) => run("idb", [...args, "--udid", UDID], { maxBuffer: 64 * 1024 * 1024 });
const simctl = (args) => run("xcrun", ["simctl", ...args], { maxBuffer: 64 * 1024 * 1024 });

/** Everything the screen currently exposes to assistive technology. */
async function describe() {
  try {
    const { stdout } = await idb(["ui", "describe-all", "--json"]);
    return stdout
      .split("\n")
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    return { error: String(e.message ?? e).slice(0, 300) };
  }
}

const labelOf = (el) => `${el.AXLabel ?? ""} ${el.AXValue ?? ""}`.trim();

/** Find a control by what it SAYS, then tap its centre. Returns what it tapped. */
async function tapLabelled(pattern) {
  const tree = await describe();
  if (!Array.isArray(tree)) return { ok: false, why: `could not read the screen: ${tree.error}` };
  const hit = tree.find((el) => el.frame && pattern.test(labelOf(el)));
  if (!hit) return { ok: false, why: `nothing on screen says ${pattern}` };
  const x = Math.round(hit.frame.x + hit.frame.width / 2);
  const y = Math.round(hit.frame.y + hit.frame.height / 2);
  await idb(["ui", "tap", String(x), String(y)]);
  return { ok: true, tapped: labelOf(hit), at: [x, y] };
}

async function shot(name) {
  const path = join(OUT, `${name}.png`);
  await simctl(["io", UDID, "screenshot", path]);
  return path;
}

/** Text currently on screen, so a screen can be told apart from a blank one. */
async function visibleText() {
  const tree = await describe();
  if (!Array.isArray(tree)) return "";
  return tree.map(labelOf).filter(Boolean).join(" | ").slice(0, 1200);
}

const report = { startedAt: new Date().toISOString(), signedIn: false, steps: [], screens: [] };
const note = (step, detail) => {
  report.steps.push({ step, detail });
  console.log(`· ${step}: ${detail}`);
};

// ── Launch fresh ───────────────────────────────────────────────────────────
await simctl(["terminate", UDID, BUNDLE]).catch(() => undefined);
await simctl(["launch", UDID, BUNDLE]);
await sleep(9000);
report.screens.push({ route: "(launch)", shot: await shot("00-launch"), text: await visibleText() });
note("launch", "app opened");

// ── Sign in, if an account was supplied ────────────────────────────────────
if (EMAIL && PASSWORD) {
  // The form sits behind a welcome step, exactly as it does on the web.
  for (const door of [/get started/i, /^sign in$/i]) {
    const r = await tapLabelled(door);
    note("door", r.ok ? `pressed "${r.tapped}"` : r.why);
    await sleep(2500);
  }
  report.screens.push({ route: "(sign-in)", shot: await shot("01-sign-in"), text: await visibleText() });

  const email = await tapLabelled(/email|phone/i);
  note("email field", email.ok ? `focused "${email.tapped}"` : email.why);
  if (email.ok) {
    await idb(["ui", "text", EMAIL]);
    await sleep(600);
  }
  const pw = await tapLabelled(/password/i);
  note("password field", pw.ok ? `focused "${pw.tapped}"` : pw.why);
  if (pw.ok) {
    await idb(["ui", "text", PASSWORD]);
    await sleep(600);
  }
  const submit = await tapLabelled(/^sign in$/i);
  note("submit", submit.ok ? `pressed "${submit.tapped}"` : submit.why);
  await sleep(7000);

  const after = await visibleText();
  // Signed in is inferred from the app itself, never assumed from a tap.
  report.signedIn = /welcome to|global broadcast|recent stories/i.test(after);
  report.screens.push({ route: "(after sign-in)", shot: await shot("02-after-sign-in"), text: after });
  note("sign-in", report.signedIn ? "confirmed by what the home screen shows" : "NOT confirmed — everything behind it is unchecked");
} else {
  note("sign-in", "no account supplied, so only the signed-out screens were seen");
}

// ── Every screen the app declares ──────────────────────────────────────────
const ROUTES = ["/", "/messages", "/give", "/community", "/bible", "/profile", "/prayer", "/support", "/story-viewer"];
for (const route of ROUTES) {
  await simctl(["openurl", UDID, `${SCHEME}://${route}`]).catch(() => undefined);
  await sleep(3500);
  const name = route === "/" ? "home" : route.replace(/\//g, "");
  const text = await visibleText();
  report.screens.push({ route, shot: await shot(`10-${name}`), text });
  note("screen", `${route} — ${text ? `${text.length} characters of text` : "NOTHING readable on screen"}`);
}

// ── Blank-screen check, which is what an empty screen actually is ──────────
report.blankScreens = report.screens.filter((s) => !s.text || s.text.length < 20).map((s) => s.route);
report.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, "ios-drive-report.json"), JSON.stringify(report, null, 2));

console.log("\n=== iOS simulator run ===");
console.log(`signed in: ${report.signedIn}`);
console.log(`screens photographed: ${report.screens.length}`);
console.log(`screens with nothing readable: ${report.blankScreens.length ? report.blankScreens.join(", ") : "none"}`);
