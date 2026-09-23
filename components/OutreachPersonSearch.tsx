// Picking a person by typing their name — no Search button.
//
// The owner's words, TestFlight 36: "searching while typing home cells — the
// name drops down when adding a home cell leader; we should really have to hit
// the search button? a list should show with their profile pic as we type
// their name."
//
// Used everywhere the outreach lane picks a PERSON: the home cell's leader
// (app/home-cells.tsx), a region's team (app/maps.native.tsx, app/maps.tsx) and
// handing a follow-up to someone (app/follow-ups.tsx).
//
// The rules about waiting, throwing away a stale answer and aborting the
// request live in lib/peopleSearch.ts, with no React in them, so they are
// tested on their own. This file is what that looks like on a phone.
//
// NOT used for the ADDRESS search. Nominatim allows one request a second, so
// that keeps its Find button and says so on screen (lib/homeCells.ts).
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { friendlyError } from '../lib/errorMessages';
import { initialsFor, type Person } from '../lib/evangelismService';
import { createPersonSearch, type PersonSearchState, personSearchNote, PERSON_SEARCH_MIN_CHARS } from '../lib/peopleSearch';
import { type AppTheme, createThemedStyles } from '../lib/theme';

export function OutreachPersonSearch({
  theme,
  search,
  onPick,
  label,
  placeholder,
  nobodyNoun = 'Nobody',
  pickLabel = 'Choose',
  isAlreadyChosen,
  alreadyChosenNote = 'Already added',
  autoFocus,
}: {
  theme: AppTheme;
  /** The lookup. `signal` stops it when the name changes under it. */
  search: (term: string, signal?: AbortSignal) => Promise<Person[]>;
  onPick: (person: Person) => void;
  /** The visible label above the box. */
  label: string;
  placeholder: string;
  /** "Nobody", "Nobody on the outreach team" — how the empty answer reads. */
  nobodyNoun?: string;
  /** The verb a screen reader says on a row: "Choose Ana", "Add Ana". */
  pickLabel?: string;
  isAlreadyChosen?: (person: Person) => boolean;
  alreadyChosenNote?: string;
  autoFocus?: boolean;
}) {
  const styles = useStyles(theme);
  const [state, setState] = useState<PersonSearchState<Person>>({ term: '', status: 'idle', results: [] });

  // One controller for the life of this field. The search function is read
  // through a ref so a parent that rebuilds its callback on every render does
  // not throw away a search that is already in flight.
  const searchRef = useRef(search);
  searchRef.current = search;
  const controller = useMemo(
    () =>
      createPersonSearch<Person>({
        search: (term, signal) => searchRef.current(term, signal),
        onState: setState,
        describeError: (error) => friendlyError(error, 'Those names could not load just now.'),
      }),
    []
  );
  useEffect(() => () => controller.dispose(), [controller]);

  const note = personSearchNote(state, { noun: nobodyNoun });
  const busy = state.status === 'searching';

  return (
    <View style={styles.wrap}>
      <Text style={styles.label} nativeID="person-search-label">{label}</Text>
      <View style={styles.field}>
        <Ionicons name="search" size={18} color={theme.colors.textMuted} style={styles.fieldIcon} />
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={`The list fills in as you type, after ${PERSON_SEARCH_MIN_CHARS} letters.`}
          value={state.term}
          onChangeText={controller.type}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          autoFocus={autoFocus}
        />
        {busy ? (
          <ActivityIndicator color={theme.colors.textSecondary} style={styles.fieldBusy} />
        ) : state.term ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear this name" onPress={controller.clear} hitSlop={12} style={styles.fieldClear}>
            <Ionicons name="close-circle" size={20} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {state.status === 'failed' ? (
        <View style={styles.failedRow}>
          <Text style={[styles.note, styles.noteWarn]}>{note}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Try that search again" onPress={controller.retry} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : note ? (
        <Text style={styles.note}>{note}</Text>
      ) : null}

      {state.results.map((person) => {
        const already = Boolean(isAlreadyChosen?.(person));
        return (
          <Pressable
            key={person.id}
            accessibilityRole="button"
            accessibilityLabel={already ? `${person.displayName} — ${alreadyChosenNote}` : `${pickLabel} ${person.displayName}${person.hint ? `, ${person.hint}` : ''}`}
            accessibilityState={{ disabled: already }}
            disabled={already}
            onPress={() => onPick(person)}
            style={[styles.row, already && styles.rowOff]}
          >
            <PersonAvatar theme={theme} person={person} />
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{person.displayName}</Text>
              {person.hint ? <Text style={styles.rowHint}>{person.hint}</Text> : null}
            </View>
            {already ? (
              <Text style={styles.rowAlready}>{alreadyChosenNote}</Text>
            ) : (
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Their photo, or their initials when they have not added one. */
export function PersonAvatar({ theme, person, size = 40 }: { theme: AppTheme; person: Person; size?: number }) {
  const styles = useStyles(theme);
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (person.avatarUrl) {
    return (
      <Image
        source={{ uri: person.avatarUrl }}
        style={[styles.avatarImage, round]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }
  return (
    <View style={[styles.avatar, round]} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={styles.avatarText}>{initialsFor(person.displayName)}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  wrap: { gap: t.spacing.sm },
  label: { color: t.colors.textSecondary, fontSize: t.type.meta, fontWeight: '800' },

  field: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: 12 },
  fieldIcon: { marginRight: 8 },
  fieldBusy: { marginLeft: 8 },
  fieldClear: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 48, color: t.colors.textPrimary, fontSize: t.type.body, paddingVertical: 8 },

  note: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 20 },
  noteWarn: { color: t.colors.danger, flex: 1 },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  retry: { minHeight: 48, minWidth: 96, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  retryText: { color: t.colors.accent, fontSize: t.type.meta, fontWeight: '800' },

  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', minWidth: 240, gap: t.spacing.md, minHeight: 56, paddingVertical: 8, paddingHorizontal: 10, borderRadius: t.radius.md, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.cardBorder },
  rowOff: { opacity: 0.6 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { color: t.colors.textPrimary, fontSize: t.type.body, fontWeight: '800' },
  rowHint: { color: t.colors.textSecondary, fontSize: t.type.overline, fontWeight: '700', marginTop: 2 },
  rowAlready: { color: t.colors.textMuted, fontSize: t.type.overline, fontWeight: '700' },

  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentMuted },
  avatarImage: { backgroundColor: t.colors.surfaceSunken },
  avatarText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.meta },
}));
