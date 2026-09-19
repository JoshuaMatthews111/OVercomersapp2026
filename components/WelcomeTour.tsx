import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccessProfile } from '../lib/accessControl';
import { createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';
import { useWelcomeTourSeen } from '../lib/tourPreference';

/* ---------------------------------------------------------------------------
 * The walkthrough a person gets once, the first time they reach the tabs.
 *
 * The owner asked for it in one sentence: "we need a small tutorial walk
 * through of the app when logging in for different roles." His congregation
 * is not a room full of people who are comfortable with apps, and the people
 * who will lean on this hardest are ordinary members who have never opened it
 * before.
 *
 * Two rules decide everything below.
 *
 * 1. IT TEACHES ONLY THE APP THIS PERSON HAS.
 *    Showing a member a Reach tab or an Admin screen they do not have is
 *    worse than showing them nothing: they go looking for a thing that is not
 *    there and conclude the app is broken, or that they are. So the cards are
 *    built from lib/accessControl.ts — the same single answer the tab bar
 *    itself reads (app/(tabs)/_layout.tsx) — and from nothing else.
 *
 * 2. IT NEVER GUESSES.
 *    Until there is a settled answer about a signed-in person, nothing is
 *    drawn at all. A tour that appeared with five cards and then quietly grew
 *    a sixth when the roles landed would be worse than a slow one. This is
 *    the same fail-closed rule DO-NOT-BREAK item 1 puts on the Reach tab, for
 *    the same reason, and the card list is frozen the moment it is shown so a
 *    background role re-read cannot rearrange it under someone's thumb.
 *
 * Nothing here is keyed on anything that moves when a sign-in refreshes in
 * the background. `access.userId` is the account's id and only changes when a
 * different person signs in — which is exactly when a different walkthrough is
 * the right answer.
 * ------------------------------------------------------------------------- */

export type TourCard = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

export type TourAudience = {
  /**
   * The seventh tab, "Reach". DO-NOT-BREAK item 1 says `canUseEvangelism` and
   * nothing else decides this, so nothing else decides the card either.
   */
  seesReachTab: boolean;
  /**
   * Whether to teach where Admin lives.
   *
   * `canOpenAdmin` is who the database will let INTO the Admin screen. It is
   * not, today, who can SEE a way in: every door that exists — More > Admin
   * Dashboard (app/(tabs)/profile.tsx:587), the Manage shortcut on Home
   * (app/(tabs)/index.tsx:471), the card in Media (app/(tabs)/messages.tsx:590)
   * and Send in Chat's Notices (app/(tabs)/community.tsx:223) — is drawn only
   * for `canManageContent`. An `outreach`, `outreach_worker`, `moderator` or
   * `media_admin` account has `canOpenAdmin` true and no door on any screen.
   *
   * Telling those four "Admin is in More" would be telling them to go and look
   * at a row that is not there. So this card needs BOTH, and the missing door
   * is written up as a separate defect rather than papered over here.
   */
  seesAdmin: boolean;
};

/**
 * Five cards for a member, six for an outreach leader, seven for an admin, and
 * never any other number: every role the database lets into Admin
 * (`is_staff_or_above`) is also inside `is_outreach_or_above`, so the admin
 * card can never turn up without the Reach card in front of it.
 *
 * Plain words, the way you would explain it to somebody at the back of church,
 * not the way a manual would. Every sentence below is a claim about the app as
 * it stands today, and each one is checked against the screen it describes.
 */
export function buildTourCards(audience: TourAudience): TourCard[] {
  const cards: TourCard[] = [
    {
      key: 'welcome',
      icon: 'sparkles-outline',
      title: 'Welcome in',
      body: 'Here is a quick look at where everything is. It takes about a minute, and you can skip it whenever you like.',
    },
    {
      key: 'home',
      icon: 'home-outline',
      title: 'Home, and the stories',
      body: 'Home is where you land. The stories along the top come from the family around the world, and they stay up for a day. Tap Share to put yours there — a photo, a short video, or a few words.',
    },
    {
      key: 'media-give',
      icon: 'play-circle-outline',
      title: 'Media, and Give',
      // Deliberately does not promise that everything keeps playing in the
      // background. A sermon FILE does; a YouTube or Vimeo link cannot, and
      // its bar reads "Paused — tap to watch again" (lib/nowPlaying.tsx:246).
      // What is true for both is that the small player stays with you.
      body: 'Media is where the sermons are. Start one and a small player stays at the bottom while you move around the app. Give is where you partner with the mission.',
    },
    {
      key: 'chat-bible',
      icon: 'chatbox-ellipses-outline',
      title: 'Chat, and the Bible',
      body: 'Chat holds your messages, the groups, the prayer rooms and the notices from leadership. Bible remembers where you stopped, and opens back there.',
    },
  ];

  if (audience.seesReachTab) {
    cards.push({
      key: 'reach',
      icon: 'map-outline',
      title: 'Reach is yours',
      body: 'Reach is your outreach tab, and the members do not have it. It lists the regions your team is working in, and it opens the map. A region only changes colour once somebody has actually filed something for it.',
    });
  }

  if (audience.seesAdmin) {
    cards.push({
      key: 'admin',
      icon: 'shield-checkmark-outline',
      title: 'Admin, and Needs your look',
      body: 'Admin is in More, as Admin Dashboard, and there is a Manage shortcut on Home. Its first row is Needs your look. That is not only tidying up chat — it is where you see that somebody may be struggling and needs a person to reach out.',
    });
  }

  cards.push({
    key: 'more',
    icon: 'ellipsis-horizontal-circle-outline',
    title: 'More, and you are set',
    body: 'More is the last tab: your photo and name, dark or light, notifications, your prayer history, and Support if something is not right. That is the whole app.',
  });

  return cards;
}

export function WelcomeTour() {
  const { access, loadingAccess } = useAccessProfile();
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();

  /**
   * "Settled" means the roles are back AND they belong to somebody signed in.
   * `loadingAccess` alone is not enough: lib/accessControl.ts hands back the
   * signed-out member default whenever a read fails, and that is "we do not
   * know", not "this is a member".
   */
  const answerIsSettled = !loadingAccess && access.isSignedIn && Boolean(access.userId);

  /**
   * Whose walkthrough this is. Taken from the first settled, signed-in answer
   * and then HELD.
   *
   * It must not be read live off `access.userId`, because that goes back to
   * undefined the moment a role read fails — and lib/accessControl.ts re-reads
   * the roles quietly every five minutes. Read live, one dropped packet
   * halfway through would have taken the walkthrough off the screen mid-card
   * AND left `markSeen()` with nobody to write against, so the same five cards
   * would have come back at the next launch. Held, a failed re-read changes
   * nothing anybody can see. Only a DIFFERENT person signing in replaces it,
   * which is exactly when a different walkthrough is the right answer.
   */
  const [owner, setOwner] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (answerIsSettled && access.userId && access.userId !== owner) setOwner(access.userId);
  }, [answerIsSettled, access.userId, owner]);

  const { seen, markSeen } = useWelcomeTourSeen(owner);

  const seesReachTab = access.canUseEvangelism;
  const seesAdmin = access.canOpenAdmin && access.canManageContent;
  const cards = useMemo(
    () => buildTourCards({ seesReachTab, seesAdmin }),
    [seesReachTab, seesAdmin]
  );

  /**
   * The cards actually on screen. Held in state, not read straight from
   * `cards`, so that once the walkthrough is open its length cannot change:
   * lib/accessControl.ts re-reads the roles quietly after five minutes, and
   * "Step 3 of 5" must not turn into "Step 3 of 6" while it is being read.
   * Null means nothing is open, and nothing is rendered.
   */
  const [shown, setShown] = useState<TourCard[] | null>(null);
  const [step, setStep] = useState(0);
  /**
   * Three-valued on purpose. `null` is "the phone has not answered yet", and
   * unknown counts as reduce — starting at `false` let one animation slip past
   * on the very first card while the answer was still in the air, which is the
   * one card a person asking for less movement is guaranteed to see.
   */
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const moves = reduceMotion === false;

  /**
   * Opening is the guarded moment. Closing is not.
   *
   * It opens only on a settled answer about a signed-in person who has never
   * seen it, and the list it opens with is the list it keeps. Once it is open,
   * the only things that take it away are the person finishing or skipping it
   * and a different person signing in — both of which arrive here as `seen` no
   * longer being false. A role read that fails while somebody is reading card
   * three no longer pulls the card out from under them.
   */
  useEffect(() => {
    if (shown) {
      if (seen !== false) setShown(null);
      return;
    }
    if (answerIsSettled && seen === false) {
      setShown(cards);
      setStep(0);
    }
  }, [shown, seen, answerIsSettled, cards]);

  // Somebody who has asked the phone to calm movement down gets no movement.
  useEffect(() => {
    let mounted = true;
    async function readMotionSetting() {
      try {
        const reduced = await AccessibilityInfo.isReduceMotionEnabled();
        if (mounted) setReduceMotion(reduced);
      } catch {
        // Could not ask. Take the quieter of the two answers.
        if (mounted) setReduceMotion(true);
      }
    }
    void readMotionSetting();
    return () => { mounted = false; };
  }, []);

  const enter = useRef(new Animated.Value(1)).current;

  // A card arrives with a short lift and fade. React Native's own Animated —
  // no package was added for this — and it is skipped entirely when the phone
  // has been asked to reduce motion.
  useEffect(() => {
    if (!shown) return;
    if (!moves) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [shown, step, moves, enter]);

  const total = shown?.length ?? 0;
  const card = shown?.[step];
  const stepLabel = `Step ${step + 1} of ${total}`;
  const onLastCard = total > 0 && step === total - 1;

  /**
   * VoiceOver and TalkBack are told the new card; without this the focus stays
   * on the button that was pressed and the reader says the same word again
   * while the screen has moved on.
   *
   * This is now the ONLY thing that speaks. The card also carried
   * accessibilityLiveRegion="polite", and on Android that made TalkBack read
   * the whole card — Back, Skip and Next included — and then read this on top
   * of it. The short wait is for the other end: VoiceOver drops anything said
   * while a sheet is still presenting, so the first card was being announced
   * to nobody at all.
   */
  useEffect(() => {
    if (!card) return;
    const timer = setTimeout(() => {
      AccessibilityInfo.announceForAccessibility(`${stepLabel}. ${card.title}. ${card.body}`);
    }, 350);
    return () => clearTimeout(timer);
  }, [card, stepLabel]);

  const finish = useCallback(() => {
    setShown(null);
    void markSeen();
  }, [markSeen]);

  const goBack = useCallback(() => {
    // The Android back gesture lands here too. On the first card there is
    // nowhere back to, and the honest reading of "back" there is "let me out".
    if (step === 0) finish();
    else setStep((value) => Math.max(0, value - 1));
  }, [step, finish]);

  const goNext = useCallback(() => {
    if (onLastCard) finish();
    else setStep((value) => Math.min(total - 1, value + 1));
  }, [onLastCard, finish, total]);

  if (!shown || !card) return null;

  return (
    <Modal
      visible
      transparent
      // The sheet's own fade is movement too, and the Animated block below does
      // not cover it. A phone asked to reduce motion now gets neither.
      animationType={moves ? 'fade' : 'none'}
      statusBarTranslucent
      onRequestClose={goBack}
    >
      <View style={styles.backdrop}>
        <View
          accessibilityViewIsModal
          style={[styles.card, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
        >
          <Animated.View
            style={[
              styles.cardBody,
              {
                opacity: enter,
                transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
              },
            ]}
          >
            {/* The indicator is deliberately left on. At a large text size the
                words really can run past the bottom of the card, and the bar is
                the only thing that says there is more underneath. */}
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
              <View style={styles.iconChip}>
                <Ionicons name={card.icon} size={26} color={theme.colors.accent} />
              </View>
              <Text style={styles.title}>{card.title}</Text>
              <Text style={styles.body}>{card.body}</Text>
            </ScrollView>
          </Animated.View>

          {/* Never colour alone: the words say which step this is, the dots
              only echo it, and the row is one element to a screen reader. */}
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={stepLabel}
            accessibilityValue={{ min: 1, max: total, now: step + 1 }}
            style={styles.progressRow}
          >
            <View style={styles.dots}>
              {shown.map((entry, index) => (
                <View
                  key={entry.key}
                  style={[styles.dot, index === step ? styles.dotCurrent : styles.dotWaiting]}
                />
              ))}
            </View>
            <Text style={styles.stepText}>{stepLabel}</Text>
          </View>

          <View style={styles.buttonRow}>
            {step > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back to the card before this one"
                onPress={goBack}
                style={styles.ghostButton}
              >
                <Text style={styles.ghostText}>Back</Text>
              </Pressable>
            ) : null}
            {/* Skip is here from the very first card and carries the same
                weight as Next — same height, same share of the row. Nobody is
                held in a walkthrough they did not ask for. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip the walkthrough and start using the app"
              onPress={finish}
              style={styles.ghostButton}
            >
              <Text style={styles.ghostText}>Skip</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={onLastCard ? 'Finish the walkthrough and start using the app' : `Next card, ${step + 2} of ${total}`}
              onPress={goNext}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryText}>{onLastCard ? 'Finish' : 'Next'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 * Colour comes only from lib/theme.ts; there is not one colour typed into this
 * file. Every pair below was CALCULATED with the WCAG 2.x relative-luminance
 * formula (the same arithmetic qa/standards/check-static.mjs runs), with
 * translucent tokens composited over the real ground underneath them.
 *
 * The card is painted `page` rather than `surface` on purpose: in dark mode
 * `surface` is rgba(255,255,255,0.06), and over a MODAL backdrop there is no
 * knowing what it is sitting on, so no ratio could be promised. `page` is
 * opaque in both themes, so every number here is exact.
 *
 *   ground: page              light #FFFCF5      dark #061334
 *
 *   title       textPrimary       15.80:1   18.25:1   (20pt/800 — AA needs 3)
 *   body        textSecondary      7.38:1   11.25:1   (15pt — AA needs 4.5)
 *   stepText    textMuted          5.82:1    7.43:1   (12pt — AA needs 4.5)
 *   Skip/Back   textPrimary       15.80:1   18.25:1   (17pt/800 — needs 3)
 *   Next label  textOnAccent on accentSolid  8.76:1 both  (17pt/900 — needs 3)
 *   card icon   accent on accentMuted over page
 *                                  5.55:1    6.67:1   (a glyph — needs 3)
 *
 * Non-text edges and marks, WCAG 1.4.11, all need 3:1:
 *   card edge   cardBorder         3.52:1    3.95:1
 *   dot, now    accent             5.78:1    8.68:1
 *   dot, later  borderStrong       3.66:1    3.95:1
 *   Skip/Back edge borderStrong    3.66:1    3.95:1
 *   Next edge   accentBorder       3.71:1    3.95:1
 *
 * That last one is why the Next button carries a rim. `accentSolid` (#D4AF37)
 * against the light card measures 2.05:1 — below threshold — so on a light
 * phone the gold fill alone would have left the button with no readable edge.
 * The same reasoning is already written down in lib/theme.ts for progressTrack.
 * ------------------------------------------------------------------------- */

const useStyles = createThemedStyles((t) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: t.colors.overlay,
    justifyContent: 'flex-end',
  },
  card: {
    // maxHeight, never height: the card has words in it, and a phone set to
    // large text must be able to make it taller. Past 88% it stops growing and
    // the words scroll instead — see `flexShrink` on cardBody below, which is
    // the half that actually keeps the buttons on screen. A maximum on its own
    // only clips.
    maxHeight: '88%',
    backgroundColor: t.colors.page,
    borderColor: t.colors.cardBorder,
    borderWidth: 1,
    borderTopLeftRadius: t.radius.xl,
    borderTopRightRadius: t.radius.xl,
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.xl,
    gap: t.spacing.lg,
    ...t.elevation.high,
  },
  cardBody: {
    // Short cards and long cards keep roughly one shape, so the buttons do not
    // jump up and down under a thumb between steps.
    minHeight: 168,
    /**
     * This one line is what keeps a person from being trapped.
     *
     * React Native defaults flexShrink to 0, not to 1 the way the web does. So
     * this block did not give way: the words pushed the progress row and the
     * whole button row down past the bottom edge of a card that is already
     * pinned to the bottom of the screen. On a 320pt phone at the largest text
     * size that put Skip, Back and Next off-screen, and on iOS — no hardware
     * back — the only way out of the walkthrough was to force-quit the app,
     * which then re-opened it, because nothing had been marked as seen. Now the
     * words give way and scroll instead. `maxHeight: '88%'` on the card above
     * could never have done this on its own; a maximum only clips.
     */
    flexShrink: 1,
  },
  scroll: {
    // The same thing one level down: a ScrollView has to be allowed to become
    // shorter than its content before it will scroll any of it.
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollBody: {
    gap: t.spacing.md,
  },
  iconChip: {
    width: 52,
    minHeight: 52,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accentMuted,
    borderColor: t.colors.accentBorder,
    borderWidth: 1,
  },
  title: {
    color: t.colors.textPrimary,
    fontSize: t.type.sectionTitle,
    fontWeight: '800',
  },
  body: {
    color: t.colors.textSecondary,
    fontSize: t.type.body,
    lineHeight: 22,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    height: 8,
    borderRadius: t.radius.pill,
  },
  // The card you are on is a wider bar, not only a different colour, so the
  // difference survives a phone whose owner cannot separate the two shades.
  dotCurrent: {
    width: 22,
    backgroundColor: t.colors.accent,
  },
  dotWaiting: {
    width: 8,
    backgroundColor: t.colors.borderStrong,
  },
  stepText: {
    flex: 1,
    textAlign: 'right',
    color: t.colors.textMuted,
    fontSize: t.type.overline,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: t.spacing.md,
  },
  ghostButton: {
    flex: 1,
    minHeight: 48,   // 44 for iOS, 48 for Android; take the larger
    minWidth: 48,
    borderRadius: t.radius.md,
    borderColor: t.colors.borderStrong,
    borderWidth: 1,
    paddingHorizontal: t.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: {
    color: t.colors.textPrimary,
    fontSize: t.type.cardTitle,
    fontWeight: '800',
  },
  primaryButton: {
    flex: 1,
    minHeight: 48,   // 44 for iOS, 48 for Android; take the larger
    minWidth: 48,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.accentSolid,
    borderColor: t.colors.accentBorder,
    borderWidth: 1,
    paddingHorizontal: t.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: t.colors.textOnAccent,
    fontSize: t.type.cardTitle,
    fontWeight: '900',
  },
}));
