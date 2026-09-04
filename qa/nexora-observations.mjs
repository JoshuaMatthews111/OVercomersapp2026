/**
 * Turn what happened on a real phone into things Nexora can judge.
 *
 * The device lanes are Nexora's crawler, sent somewhere Nexora itself cannot
 * go: a Mac with Xcode, and a Linux box with an Android emulator. But a
 * crawler that invents its own report format is a second product with a second
 * set of opinions, and two tools that disagree about what "ready" means are
 * worse than one tool.
 *
 * So the crawler decides nothing. It records what it saw in Nexora's own
 * shape — an Observation carries a rule id, where it happened, what was
 * expected, what actually happened, and the steps to see it again — and hands
 * that back. Nexora applies the severity, the category, the knowledge packs,
 * the score, the memory of previous runs, and the dismissals. The division is
 * the same one Nexora already keeps with a coding agent: the crawler decides
 * what it saw, Nexora decides what it means.
 *
 * Coverage travels with it, because a run that pressed nothing must never read
 * as a clean one.
 */

/**
 * @param {object} drive The report a device lane produced.
 * @param {"ios"|"android"} platform
 * @returns {{observations: Array<object>, coverage: object, notAssessed: string[]}}
 */
export function toNexora(drive, platform) {
  const observations = [];
  const where = platform === "ios" ? "iPhone" : "Android phone";

  const repro = (step, action, expected, observed) => [{ step, action, expected, observed }];

  // ── Controls that did nothing ────────────────────────────────────────────
  for (const d of drive.deadControls ?? []) {
    observations.push({
      ruleId: "device.dead-control",
      route: d.route,
      controlText: d.control,
      title: `"${d.control}" does nothing on ${where}`,
      expected: "Pressing a control changes something a person can see.",
      actual:
        `${d.evidence} A control that looks pressable and answers with nothing is read as the app being broken, ` +
        "and it is the single most reported kind of defect.",
      reproSteps: repro(
        1,
        `Open ${d.route} on ${where} and press "${d.control}"`,
        "Something on screen changes",
        "the screen read identically before and after"
      ),
      evidence: [],
      data: d.shot ? { screenshots: [d.shot] } : undefined
    });
  }

  // ── Screens that came up with nothing on them ────────────────────────────
  for (const route of drive.blankScreens ?? []) {
    observations.push({
      ruleId: "device.blank-screen",
      route,
      title: `${route} comes up empty on ${where}`,
      expected: "Every screen shows either its content, or a message saying why it cannot.",
      actual:
        "Nothing readable was on this screen. A person cannot tell an empty screen from a broken one, " +
        "and neither can a store reviewer.",
      reproSteps: repro(1, `Open ${route} on ${where}`, "Content, or an explanation", "nothing readable"),
      evidence: []
    });
  }

  // ── Getting in ───────────────────────────────────────────────────────────
  if (drive.permissions?.hasTestIdentity && drive.canPressControls !== false && drive.signedIn === false) {
    observations.push({
      ruleId: "device.sign-in-failed",
      route: "/",
      title: `The stored account could not sign in on ${where}`,
      expected: "The stored account signs in, so everything behind the sign-in can be checked.",
      actual:
        "The sign-in did not complete, so every screen behind it went unchecked. " +
        "Nothing in this run says anything about the signed-in app.",
      reproSteps: repro(1, `Sign in on ${where} with the stored account`, "the home screen", "still signed out"),
      evidence: []
    });
  }

  // ── Leaving, and getting back in ─────────────────────────────────────────
  const flow = drive.sessionFlow;
  if (flow?.attempted) {
    if (flow.signedOut === false) {
      observations.push({
        ruleId: "device.signout-ineffective",
        route: "/profile",
        controlText: "Sign Out",
        title: `Pressing sign out did not end the session on ${where}`,
        expected: "Pressing sign out ends the session.",
        actual:
          "The app still showed signed-in screens for ninety seconds after the press, while the server had already " +
          "accepted the logout. On a shared or lost phone, somebody who was handed it stays signed in as the previous person.",
        reproSteps: repro(1, `Press sign out on ${where}`, "signed out", "still signed in"),
        evidence: [],
        // The two photographs that make this claim checkable: the button as
        // it was pressed, and the screen that came back.
        data: { screenshots: ["19-before-sign-out.png", "20-after-sign-out.png"].map((f) => `${drive.shotDir ?? ""}/${f}`) }
      });
    }
    if (flow.signedOut === true && /tab bar/i.test(String(drive.sessionLandedOn ?? ""))) {
      observations.push({
        ruleId: "device.signout-no-signin-screen",
        route: "/profile",
        controlText: "Sign Out",
        title: `After sign out the app shows the Home tab, not a sign-in screen, on ${where}`,
        expected: "Signing out returns to the welcome or sign-in screen, so the next person knows nobody is signed in.",
        actual: "The session ended, but the app stayed in the tab bar on Home, which draws for signed-out people too. Only the More tab shows that nobody is signed in. router.replace('/') resolves to the tabs' Home, not the welcome screen.",
        reproSteps: repro(1, `Press sign out on ${where}`, "the welcome or sign-in screen", "the Home tab"),
        evidence: [],
        data: { screenshots: ["20-after-sign-out.png", "21-after-recovery.png"].map((f) => `${drive.shotDir ?? ""}/${f}`) }
      });
    }
    if (flow.signedOut === true && typeof flow.signedOutAfterMs === "number" && flow.signedOutAfterMs > 10000) {
      observations.push({
        ruleId: "device.signout-slow",
        route: "/profile",
        controlText: "Sign Out",
        title: `Sign out takes ${Math.round(flow.signedOutAfterMs / 1000)} seconds to show on ${where}`,
        expected: "Pressing sign out shows the signed-out screen at once.",
        actual: `The server accepted the logout immediately; the app kept showing the signed-in screens for ${Math.round(flow.signedOutAfterMs / 1000)} seconds and then switched on its own — the look of a local session outliving the sign-out until its next refresh is refused.`,
        reproSteps: repro(1, `Press sign out on ${where}`, "the sign-in screen at once", `still signed in for ${Math.round(flow.signedOutAfterMs / 1000)} s`),
        evidence: []
      });
    }
    if (flow.signedOut === true && flow.signedBackIn === false) {
      observations.push({
        ruleId: "device.signout-no-return",
        route: "/",
        controlText: "Sign Out",
        title: `The app signs out and cannot be signed back into on ${where}`,
        expected: "Signing out and signing back in returns the person to their account.",
        actual:
          "The session ended and the same stored account could not get back in. " +
          "This is the worst state an app can be in — a person who signs out has lost the app — " +
          "and no tester that refuses to press sign out will ever find it.",
        reproSteps: [
          { step: 1, action: `Sign in on ${where}`, expected: "the home screen", observed: "signed in" },
          { step: 2, action: "Press sign out", expected: "signed out", observed: "signed out" },
          { step: 3, action: "Sign in again with the same account", expected: "the home screen", observed: "could not get back in" }
        ],
        evidence: []
      });
    }
  }

  // ── What the operating system was asked for ──────────────────────────────
  // Recorded, not judged here: whether "full access to your Photo Library" is
  // right for a profile-photo picker is Nexora's call, with its rules.
  for (const p of drive.permissionsRequested ?? []) {
    observations.push({
      ruleId: "device.permission-prompt",
      route: p.route,
      controlText: p.control,
      title: `Pressing "${p.control}" asks the system for: ${p.asked.slice(0, 80)}`,
      expected: "An app asks for the narrowest access that does the job, at the moment it is needed, and explains why.",
      actual: `${p.asked} This run answered "${p.answered}" so the denied path was exercised.`,
      reproSteps: repro(1, `Open ${p.route} on ${where} and press "${p.control}"`, "a permission request", p.asked.slice(0, 120)),
      evidence: []
    });
  }

  // ── Does the session survive a cold start? ───────────────────────────────
  if (drive.coldStart?.attempted && drive.coldStart.stillSignedIn === false) {
    observations.push({
      ruleId: "device.session-not-persisted",
      route: "/profile",
      title: `Closing and reopening the app signs you out on ${where}`,
      expected: "A signed-in person stays signed in after quitting and reopening the app.",
      actual: `After the app was quit and launched again, ${drive.coldStart.why}. The server had accepted the sign-in minutes earlier. Every person will meet this the next time they open the app.`,
      reproSteps: [
        { step: 1, action: `Sign in on ${where}`, expected: "the email on the More tab", observed: "signed in" },
        { step: 2, action: "Quit the app and open it again", expected: "still signed in", observed: drive.coldStart.why }
      ],
      evidence: [],
      data: { screenshots: [`${drive.shotDir ?? ""}/03-after-cold-start.png`] }
    });
  }

  // ── Leaving for another app and coming back ──────────────────────────────
  for (const r of drive.returnChecks ?? []) {
    if (r.signedInOnReturn === false) {
      observations.push({
        ruleId: "device.session-lost-on-return",
        route: r.route,
        controlText: r.control,
        title: `Coming back from ${r.left_for} finds the app signed out on ${where}`,
        expected: "Leaving for another app and coming back returns to the same signed-in state.",
        actual: `"${r.control}" opened ${r.left_for}; pressing Back returned to the app, and ${r.why}. A quit-and-reopen keeps the session, so this is about returning, not restarting.`,
        reproSteps: [
          { step: 1, action: `Sign in on ${where}`, expected: "the email on the More tab", observed: "signed in" },
          { step: 2, action: `Press "${r.control}" and come back with Back`, expected: "still signed in", observed: r.why }
        ],
        evidence: [],
        data: r.shot ? { screenshots: [r.shot] } : undefined
      });
    }
  }

  // ── Does the session survive leaving for another app? ────────────────────
  // "Neither the email nor a sign-in card" means the More tab never drew —
  // on iPhone it sat on the splash logo after the picker. That is a different
  // defect from a lost session and must not be filed as one.
  const cardShown = (r) => /sign in to ogn/i.test(String(r?.why ?? ""));
  if (drive.leaveAndReturn?.attempted && drive.leaveAndReturn.stillSignedIn === false && cardShown(drive.leaveAndReturn)) {
    observations.push({
      ruleId: "device.session-lost-on-return",
      route: "/profile",
      title: `Leaving for the browser and coming back signs you out on ${where}`,
      expected: "A signed-in person who taps a link and returns is still signed in.",
      actual: `After opening a web page and returning to the app, ${drive.leaveAndReturn.why}. Quitting and relaunching the app kept the session, so this is specific to the app going to the background behind another app.`,
      reproSteps: [
        { step: 1, action: `Sign in on ${where}`, expected: "the email on the More tab", observed: "signed in" },
        { step: 2, action: "Open a web link, wait a few seconds, return to the app", expected: "still signed in", observed: drive.leaveAndReturn.why }
      ],
      evidence: [],
      data: { screenshots: [`${drive.shotDir ?? ""}/04-after-leave-and-return.png`] }
    });
  }

  if (drive.pickerAndReturn?.attempted && drive.pickerAndReturn.stillSignedIn === false && !cardShown(drive.pickerAndReturn)) {
    observations.push({
      ruleId: "device.stuck-after-return",
      route: "/profile",
      controlText: "Upload profile photo",
      title: `The app does not draw after the photo picker on ${where}`,
      expected: "After the system picker closes, the app shows its screens again.",
      actual: `After "Upload profile photo" opened the system picker and the app was brought back, the More tab showed neither the account nor a sign-in card — ${drive.pickerAndReturn.why}. The app was not usable at that point.`,
      reproSteps: [
        { step: 1, action: `Sign in on ${where}, open More, press Upload profile photo`, expected: "the system picker", observed: "the system asked" },
        { step: 2, action: "Answer, then return to the app", expected: "the More tab", observed: drive.pickerAndReturn.why }
      ],
      evidence: [],
      data: { screenshots: [`${drive.shotDir ?? ""}/05-after-picker-and-return.png`] }
    });
  }
  if (drive.pickerAndReturn?.attempted && drive.pickerAndReturn.stillSignedIn === false && cardShown(drive.pickerAndReturn)) {
    observations.push({
      ruleId: "device.session-lost-on-return",
      route: "/profile",
      controlText: "Upload profile photo",
      title: `Opening the photo picker and coming back signs you out on ${where}`,
      expected: "Choosing a profile photo and returning leaves you signed in.",
      actual: `After "Upload profile photo" opened the system picker and the app came back, ${drive.pickerAndReturn.why}. A plain relaunch and a browser detour both kept the session; this path does not.`,
      reproSteps: [
        { step: 1, action: `Sign in on ${where}, open More`, expected: "the email on the More tab", observed: "signed in" },
        { step: 2, action: "Press Upload profile photo, answer the system, return", expected: "still signed in", observed: drive.pickerAndReturn.why }
      ],
      evidence: [],
      data: { screenshots: [`${drive.shotDir ?? ""}/05-after-picker-and-return.png`] }
    });
  }

  // ── The active choice that assistive technology cannot tell is active ─────
  for (const a of drive.activeNotSelected ?? []) {
    observations.push({
      ruleId: "device.active-not-selected",
      route: a.route,
      controlText: a.control,
      title: `"${a.control}" is the active choice but is not marked selected on ${where}`,
      expected: "The chosen tab or chip is exposed as selected, so a screen reader can say which one is active.",
      actual: `Pressing "${a.control}" while it was already chosen did nothing, as designed; after choosing "${a.neighbour}" it worked. Nothing in the accessibility tree says it was the active one.`,
      reproSteps: repro(1, `Open ${a.route} on ${where} with a screen reader and land on "${a.control}"`, "announced as selected", "announced as a plain button"),
      evidence: []
    });
  }

  // ── What this run did not look at ────────────────────────────────────────
  const notAssessed = [...(drive.notAssessed ?? [])];
  for (const n of drive.notJudged ?? []) {
    notAssessed.push(`Controls on ${n.route} — ${n.why}`);
  }
  for (const n of drive.notPressed ?? []) {
    notAssessed.push(`"${n.control}" on ${n.route} — ${n.why}`);
  }
  for (const n of drive.notReached ?? []) {
    notAssessed.push(`"${n.control}" on ${n.route} — ${n.why}`);
  }

  // Coverage is measured, never assumed. A screen counts only if it was opened
  // and something was readable on it; a control counts only if it was pressed.
  const screens = (drive.screens ?? []).filter((s) => s.route && !String(s.route).startsWith("("));
  const coverage = {
    routesChecked: screens.length,
    controlsTested: (drive.liveControls ?? 0) + (drive.deadControls?.length ?? 0),
    desktopChecked: false,
    controlsSkipped: (drive.notPressed?.length ?? 0) + (drive.notJudged?.length ?? 0),
    behindSignIn: drive.permissions?.hasTestIdentity
      ? drive.signedIn
        ? "reached"
        : "not-reached"
      : "not-attempted"
  };

  return { observations, coverage, notAssessed, platform, screens: screens.length };
}
