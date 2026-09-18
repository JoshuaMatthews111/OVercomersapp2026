# The release gate

A checker that reads the app's own code and tells you, in plain words, whether
today's build is fit to put in front of the congregation — and, just as
importantly, tells you what it did **not** check.

It is meant to be able to stop a release. That is the point of it.

---

## Running it

From the project folder:

```bash
node qa/standards/check-static.mjs --baseline qa/standards/baseline.json
```

That is the everyday command. Some others:

| What you want | Command |
| --- | --- |
| The full report, nothing hidden | `node qa/standards/check-static.mjs` |
| Only what is failing | add `--quiet` |
| Apple's rules only | add `--platform ios` |
| Google's rules only | add `--platform android` |
| Output for another program to read | add `--json` |
| Allow more colours per file before complaining | add `--color-max 12` |

It finishes with an **exit code**: `0` means nothing is stopping the release,
`1` means something is. That is the number a build server or a release script
looks at. Nothing but a *blocker* ever makes it `1` — ninety smaller findings
will not hold a release up, and one blocker will.

---

## What it checks

100 rules. Ninety-four came from four specialist reviews of this app — Apple's
Human Interface Guidelines, App Store Review, Android Material and Google Play
policy, and accessibility — plus your own walkthrough on your phone. Six were
added when the gate was built, for the things a release gate must never miss.

They are grouped the way the report prints them:

- **Nothing clipped, nothing off-centre.** Crest or wordmark cropped by the
  wrong image fit; a screen taller than the phone with no way to scroll to the
  bottom; a badge pushed outside a rounded corner that clips it; a screen that
  ignores the bottom of the phone so its last row sits under the home bar.
- **Everything big enough to press.** Apple wants 44 points, Google wants 48.
  The gate works out how big each control really is, including its padding and
  its hit slop, and says which ones fall short.
- **Text that grows when the phone says so.** Boxes locked to a fixed height
  with words inside; text under 12 points; text locked out of the phone's own
  font-size setting.
- **Usable with VoiceOver and TalkBack.** A button whose only child is an icon,
  with no name; a picture with no description that was never marked decorative;
  a tab that looks selected but never says so; a field with no label.
- **Nothing fake, nothing unfinished.** Demo, placeholder or sample content a
  real person could see; an invented statistic presented as fact; a "LIVE NOW"
  badge that is always on; a control that looks tappable and does nothing;
  developer words like Supabase or an environment variable shown to a member;
  a TODO left in the code.
- **Fast, or honestly showing its work.** An upload with no progress bar; a
  network call with no time limit, which on a weak signal hangs forever; an
  empty `catch` where something failed and the person was told nothing; a list
  that never reloads, so what you just posted never appears.
- **Dark and light, everywhere.** A screen that never reads which theme was
  chosen; text too faint to read against what is behind it; colours typed into
  a screen instead of coming from `lib/theme.ts`.
- **Your own list.** Stories, chat, the map, media and sermons — the defects
  from the device run, each one its own rule with its own id.
- **Store rules.** Permissions declared and never used; account deletion that
  hands you off to an email app; the old storage permissions Google Play no
  longer accepts; the Android target version.
- **Release configuration and secrets.** The bundle id and EAS project id from
  `DO-NOT-BREAK.md` item 13; the icon, the splash and the app link; versions
  agreeing across `app.json`, `package.json` and `store.config.json`; and any
  password, key or token typed into the code.

### About secrets

If the gate finds a credential in the code it tells you the **file**, the
**line**, the **variable name**, and how long the value was — and never a single
character of the value itself, not even truncated. A report gets pasted into
chats and pull requests, so it has to be safe to paste. There is a test that
plants a real-looking key and proves it never appears in either the report or
the JSON.

---

## Reading the report

```
    ✗ BLOCKER NO-DEAD-CONTROLS         A control that looks live and answers with nothing
        7 places
        · app/(tabs)/messages.tsx:320 — "View all" is written on screen but nothing happens when it is pressed.
```

- `✗` failing, `✓` clean, `·` not checked.
- `BLOCKER` stops the release. `HIGH`, `MEDIUM` and `LOW` do not — they are
  real work, listed so you can decide, not so the gate can decide for you.
- `NO-DEAD-CONTROLS` is the rule's id. It never changes, so you can use it in a
  commit message or when talking to somebody about it.
- Then the file, the line, and what is wrong in a sentence.

### The part at the bottom matters most

```
  100 rules apply to this release.
  91 were checked by reading the code.
      23 are clean.
      68 are clean ONLY because the baseline forgave what was already there.
      0 are failing, in 0 places.
  9 could NOT be checked here and were NOT counted as passing:
      OGN-IOS-012 — The privacy policy and terms links must still open
      ...
```

Nine of the hundred rules cannot be settled by reading files. They need a real
phone, a live database, a built bundle, or the internet. The gate **names every
one of them** rather than quietly leaving them out. A rule nobody checked is
never printed as a pass.

Four more rules are only half-answerable from the code — the gate checks the
half it can and prints what is still owed on a phone.

---

## The baseline

The app had 795 known problems on the day this gate was switched on. If the gate
had simply failed on all of them it would have been turned off within the hour,
and it would have protected nothing.

So there is a baseline: an agreed list of what was already broken, at
`qa/standards/baseline.json`. Run the gate with `--baseline` and those are set
aside, and the gate turns green on everything else — which means **from today
it catches anything new**.

It forgives by count, per rule, per file. If a file had six pictures with no
description, six are forgiven; add a seventh and the gate speaks up. Nothing is
forgiven in a file that is not named.

Every line in that file is work still to do. **The file should only ever get
smaller.** To see the real state of things, run without `--baseline`.

To agree a new baseline after a round of fixes:

```bash
node qa/standards/check-static.mjs --write-baseline qa/standards/baseline.json
```

Only do that deliberately, and only after fixing things — writing a new baseline
forgives everything that is broken at that moment, which is exactly the move
that turns a gate into decoration.

---

## Adding a rule

Rules live in `rules.mjs` as plain data, separate from the code that checks
them. Add one like this:

```js
{
  id: 'OGN-STORY-99',                 // never changes once used
  platform: 'both',                   // 'ios' | 'android' | 'both'
  severity: 'high',                   // 'blocker' stops the release
  kind: 'static',                     // 'static' = the gate checks it
                                      // 'device' = needs a phone; never a pass
  theme: 'stories',                   // which heading it prints under
  source: 'release-blockers',
  title: 'One plain line, written for a person',
  why: 'What goes wrong for somebody using the app if this is broken.',
  rule: 'The rule itself, precisely.',
  check: 'How it is tested.',
  auditViolations: 0,
},
```

If it is a `device` rule you are finished — it will appear in the report under
"could NOT be checked here", which is the honest outcome.

If it is `static`, add a detector in `check-static.mjs`:

```js
D['OGN-STORY-99'] = (ctx, rule, out) => {
  eachScreen(ctx, (f) => {
    if (somethingIsWrong(f)) out(rule, f, lineNumber, 'What is wrong, in a sentence.');
  });
};
```

`ctx` gives you every file already read three ways: `f.src` (the real text),
`f.masked` (the same text with the inside of every string and comment blanked,
so a search for code cannot match a word in a sentence), `f.styles` (the
StyleSheet parsed into name → properties) and `f.elements` (every JSX element
with its parent and its children). There are helpers for the common questions:
`is.pressable`, `hasTextInside`, `resolveStyle`, `touchSize`, `contrastRatio`,
`imageSize`.

Then **write two tests** in `check-static.test.mjs` — one snippet that is really
broken and must be caught, and one that is really fine and must not be. A
detector that has only ever been shown broken code is a regex nobody has tested.

```bash
node --test qa/standards/check-static.test.mjs
```

---

## Files here

| File | What it is |
| --- | --- |
| `rules.mjs` | The 100 rules, as data. Read this to see what "ready" means. |
| `check-static.mjs` | The checker. No dependencies at all, only what Node ships with, so it cannot break when a package updates on release morning. |
| `check-static.test.mjs` | 49 tests that keep the checker honest. |
| `baseline.json` | What was already broken when the gate went on. Shrink it. |

## What this gate is not

It reads code. It cannot see the app. It cannot tell you whether the story ring
looks right, whether the dark theme is beautiful, or whether an upload really
finishes in four seconds instead of five minutes. Those are device questions,
and the nine rules marked `device` say so by name rather than pretending.

Run this gate **and** a device run. Neither one on its own is a release.
