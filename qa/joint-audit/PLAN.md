# OGN 1.0.3 — joint audit, Mac mini + Alienware

Two AI teams, one app, no agent war.
Written 2026-09-19 by Claude (Mac mini) for Joshua Matthews and ASTRA (Alienware, Codex).
Nothing starts until Joshua says go.

## Why this document exists

Two teams editing one repository at the same time is how you lose a day.
The failure modes are known: both sides fix the same thing differently,
both sides edit the same file, one side "fixes" what the other side just
built, and nobody can tell whose version is live. Every rule below exists
to stop one of those.

## The three rules that prevent the war

**1. The gate is the referee, not either team.**
`node qa/standards/check-static.mjs --baseline qa/standards/baseline.json`
100 rules from Apple HIG + App Store Review, Google Play policy,
accessibility, and release honesty. Nobody argues taste. If a standard is
worth enforcing, it becomes a RULE with a test, and then the gate decides.
A finding without a rule is an opinion. A rule without a test is a wish.

**2. Split by capability, never by taste.**
Each team owns what its machine can actually prove. No file is owned by
both. If you need a file you do not own, you file a ledger entry and ask —
you never edit it.

**3. Evidence or it did not happen.**
A finding carries a file:line or a screenshot or a measured number. A fix
carries proof it was re-verified. "Looks better" is not evidence. Both
teams have already been burned by confident write-ups that were wrong.

## Who owns what

### ASTRA — Alienware, Codex, 6 agents
Has Android Studio and a real emulator. Owns everything that needs a
running Android device.

- Android behaviour: back button on every screen, keyboard never covering
  an input or a submit button, window insets, runtime permissions
  (POST_NOTIFICATIONS, READ_MEDIA_*), large-font and display-size scaling,
  dark theme on the system bars, TalkBack.
- Functional flows end to end on the emulator: sign in, post a story with
  1 photo / 2 photos / a video, send a chat message, send a photo, send a
  1-minute video, create a chat, Give, Bible version switch, the map, the
  new Reach tab, account deletion.
- Performance, with NUMBERS: cold start ms, time-to-first-paint per tab,
  scroll jank, memory, and the real wall-clock of each upload.
- The Android half of every owner defect in
  `qa/field-reports/2026-09-18-owner-device-run.md`.

Writes to: `qa/joint-audit/findings-astra.md` only, until Phase 4.

### CLAUDE — Mac mini
Has EAS, TestFlight, App Store Connect, the Supabase project, the gate.

- iOS behaviour via TestFlight and the cloud simulator lane.
- The release gate: new rules, keeping it honest, fixing its own bugs
  (four were found on 2026-09-18 and each one was blocking finished work).
- Database, RLS, edge functions, migrations.
- Store compliance both sides: Apple review guidelines, Play policy.
- UI and visual audit against the design standard.

Writes to: `qa/joint-audit/findings-claude.md` only, until Phase 4.

### Shared — needs BOTH to agree
- The merged ranked list, `qa/joint-audit/LEDGER.md`.
- Any change to `DO-NOT-BREAK.md`.
- Any new or changed gate rule.
- Anything Joshua has to decide.

## The phases

### Phase 0 — agree (today, 30 minutes)
Both teams read the same four documents and nothing else counts as context:
1. `DO-NOT-BREAK.md`
2. `qa/field-reports/2026-09-18-owner-device-run.md` — Joshua's own words
3. `qa/field-reports/2026-09-18-live-db-ground-truth.md`
4. `qa/standards/README.md`
Both teams confirm in the Mailbox that they have read them. Then, and only
then, Phase 1 starts.

### Phase 1 — audit apart, in parallel (no code changes at all)
Both teams audit hard and independently. NO edits to app code. The point of
auditing apart is that two independent looks find more than two coordinated
ones — do not peek at the other side's file until Phase 2.

Every finding uses this shape, or it is not a finding:

```
### <ID>  <one-line title>
severity:   blocker | high | medium | low
area:       stories | chat | home | media | maps | admin | theme | onboarding | perf | store
confidence: confirmed-in-code | measured-on-device | needs-device-check
evidence:   file:line, OR a measured number, OR a screenshot path
cause:      the actual mechanism, quoting the code
fix:        the concrete edit, files and functions named
risk:       what this could break, naming the DO-NOT-BREAK item
```

IDs: ASTRA uses `A-001`, `A-002`… Claude uses `C-001`, `C-002`…
Never renumber. Never edit the other team's entries.

### Phase 2 — reason together
1. Both files are merged into `LEDGER.md`, deduped by (area, cause).
2. Where the two teams disagree on a CAUSE, neither wins by authority. The
   one who can show the code or the measurement is right. If neither can,
   it is `needs-device-check` and it goes to whoever owns that device.
3. Where the two teams disagree on a FIX, write both, then pick on: does it
   regress a DO-NOT-BREAK item, does it need a migration, does it need a
   new native module, how many files does it touch. Fewest risks wins.
4. Output: one ranked list. Blockers first. Each item has ONE owner.

### Phase 3 — Joshua decides the taste questions
Batched, never one at a time, never an open question. Each decision is:
what it is, two options, a recommendation, what each risks.
Only these go to him: visual design, animation, wording a member reads, and
anything that changes what the app is FOR. Not technical choices.

### Phase 4 — build
- Branch `release/1.0.3-joint`. ASTRA works on `astra/<topic>`, Claude on
  `mac/<topic>`. Small branches, merged often.
- `qa/joint-audit/OWNERSHIP.md` lists every file being edited and by whom.
  You claim a file by adding a line and pushing BEFORE you edit it. If it is
  already claimed, you wait or you ask. This is the whole conflict
  prevention mechanism and it only works if both sides do it every time.
- After every merge: typecheck, tests, gate. All three green or it is
  reverted, not patched.

### Phase 5 — verify on real hardware
Nothing is "done" on a claim. Every fixed item is re-run:
- ASTRA on a real Android device or emulator.
- Claude on a real iPhone via TestFlight.
Both record the result next to the ledger entry. A fix with no verification
line stays open.

### Phase 6 — ship
Gate green, both device passes recorded, Joshua's sign-off, then build and
submit. Then `DO-NOT-BREAK.md` is updated with anything new that must not
regress, and the Second Brain copy is synced.

## The handoff protocol

Via `Second Brain/Mailbox/<machine>/inbox/<YYYY-MM-DD-HHMM>-<topic>.md`.
Every note states: the goal, the exact paths, what is already done, what
must not break, and what you want back. When a note is acted on it moves to
`done/` with a `## Result` section appended. No exceptions — a note without
a Result is work nobody can trust.

Code moves through git, never through the Mailbox. The Mailbox carries
intent and results only.

## Where the app actually is, right now

- Version 1.0.2. iOS build 31 was REJECTED by Apple: ITMS-90683, missing
  NSMotionUsageDescription, because MapLibre links CoreMotion. Fixed;
  build 32 is uploading. A gate rule (OGN-IOS-009B) now catches that class
  before a build is spent.
- Android .aab builds clean but **Google Play has the app SUSPENDED** —
  blocked a submit on 2026-09-04 and again on 2026-09-18. Only Joshua can
  clear it. Until then Android ships as a direct-install APK.
- The live content filter that had been holding scripture since 2026-09-04
  is fixed and applied.
- Gate: 91 of 91 checked rules pass, 0 blockers, 9 device-only rules
  honestly reported as NOT checked.
- Nothing in 1.0.2 has been verified on a real phone yet. That is Phase 5's
  first job, and it is the biggest open risk in the project.

## Open, and Joshua's alone

1. Google Play suspension — two weeks unresolved.
2. No crisis phone number anywhere in the app.
3. `EXPO_PUBLIC_BIBLE_API_KEY` ships inside the bundle and is extractable.
4. Seeded demo figures still read as real: 1,260,000 reached, 412,987 souls.
5. QA junk still live: story "Test", media "App Review PDF Smoke Test",
   6 test messages in the Global Prayer Room.
