// VYRN — Mood Picker
//
// Shown once, right after "Finish Workout" is confirmed and before the
// completion summary. The `mood` column on workout_sessions has existed
// in the schema since the original migration but nothing ever wrote to
// it or read it back — this is the one moment in the app where asking
// takes one tap and doesn't interrupt anything the user is trying to do.
//
// Deliberately optional: "Skip" completes the session with no mood at
// all, same as before this existed. Nothing downstream requires it —
// the Consistency Score only ever uses it as a descriptive note, never
// as part of the score itself, so skipping it can't hurt anyone's number.
import React from 'react';
import { View, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { COLORS, alpha } from '../../theme/colors';
import { RADIUS, SPACING } from '../../theme/spacing';
import Text from '../ui/Text';

export type MoodValue = 'great' | 'good' | 'okay' | 'bad';

const MOODS: { value: MoodValue; emoji: string; label: string }[] = [
  { value: 'great', emoji: '🔥', label: 'Great' },
  { value: 'good', emoji: '🙂', label: 'Good' },
  { value: 'okay', emoji: '😐', label: 'Okay' },
  { value: 'bad', emoji: '😩', label: 'Rough' },
];

interface Props {
  visible: boolean;
  onSelect: (mood: MoodValue) => void;
  onSkip: () => void;
}

function MoodPickerModal({ visible, onSelect, onSkip }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text variant="body" weight="bold" color={COLORS.text} align="center">
            How did that feel?
          </Text>
          <Text variant="caption" color={COLORS.textSecondary} align="center" style={styles.sub}>
            Totally optional — helps the coach notice patterns over time.
          </Text>
          <View style={styles.row}>
            {MOODS.map((m) => (
              <TouchableOpacity
                key={m.value}
                style={styles.moodBtn}
                onPress={() => onSelect(m.value)}
                activeOpacity={0.75}
              >
                <Text style={styles.emoji}>{m.emoji}</Text>
                <Text variant="caption" color={COLORS.textSecondary}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={onSkip} style={styles.skip}>
            <Text variant="caption" color={COLORS.textMuted}>Skip</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: SPACING.xl,
  },
  card: {
    width: '100%', maxWidth: 360,
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.borderLight,
    padding: SPACING.xl,
  },
  sub: { marginTop: 4, marginBottom: SPACING.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm },
  moodBtn: {
    flex: 1, alignItems: 'center', gap: 6,
    paddingVertical: SPACING.md, borderRadius: RADIUS.badge,
    backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  emoji: { fontSize: 26 },
  skip: { alignSelf: 'center', marginTop: SPACING.lg, padding: SPACING.xs },
});

export default React.memo(MoodPickerModal);
