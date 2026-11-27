import React, { useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { RADIUS, SPACING } from '../../theme/spacing';
import { FONTS, BODY, EYEBROW } from '../../theme/typography';
import Text from '../ui/Text';
import PressableScale from '../ui/PressableScale';

export type MoodValue = 'great' | 'good' | 'okay' | 'bad';
export type PainStatus = 'none' | 'mild' | 'sharp' | 'worsening';

export interface WorkoutFeedback {
  mood?: MoodValue;
  session_effort?: number;
  energy_level?: number;
  pain_status?: PainStatus;
  pain_notes?: string;
  session_notes?: string;
}

const MOODS: { value: MoodValue; emoji: string; label: string }[] = [
  { value: 'great', emoji: '🔥', label: 'Great' },
  { value: 'good', emoji: '🙂', label: 'Good' },
  { value: 'okay', emoji: '😐', label: 'Okay' },
  { value: 'bad', emoji: '😩', label: 'Rough' },
];

const PAIN_OPTIONS: { value: PainStatus; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No pain' },
  { value: 'mild', label: 'Mild', description: 'Manageable discomfort' },
  { value: 'sharp', label: 'Sharp', description: 'Stop the painful movement' },
  { value: 'worsening', label: 'Worsening', description: 'Pain got worse during training' },
];

interface Props {
  visible: boolean;
  onSelect: (feedback: WorkoutFeedback) => void;
  onSkip: () => void;
}

function WorkoutFeedbackModal({ visible, onSelect, onSkip }: Props) {
  const [mood, setMood] = useState<MoodValue | undefined>();
  const [effort, setEffort] = useState<number | undefined>();
  const [energy, setEnergy] = useState<number | undefined>();
  const [pain, setPain] = useState<PainStatus>('none');
  const [painNotes, setPainNotes] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');

  const submit = () => onSelect({
    ...(mood ? { mood } : {}),
    ...(effort ? { session_effort: effort } : {}),
    ...(energy ? { energy_level: energy } : {}),
    pain_status: pain,
    ...(painNotes.trim() ? { pain_notes: painNotes.trim() } : {}),
    ...(sessionNotes.trim() ? { session_notes: sessionNotes.trim() } : {}),
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="clipboard-outline" size={19} color={COLORS.primaryGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>SESSION CHECK-IN</Text>
              <Text style={styles.title}>How did training feel?</Text>
              <Text style={styles.subtitle}>A few optional details help the next recommendation reflect your actual session.</Text>
            </View>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>Overall feeling</Text>
            <View style={styles.moodRow}>
              {MOODS.map((item) => {
                const selected = mood === item.value;
                return (
                  <PressableScale
                    key={item.value}
                    onPress={() => setMood(item.value)}
                    style={[styles.moodButton, selected && styles.selected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.emoji}>{item.emoji}</Text>
                    <Text style={[styles.moodLabel, selected && styles.selectedText]}>{item.label}</Text>
                  </PressableScale>
                );
              })}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>Session effort</Text>
                <Text style={styles.optional}>{effort ? `${effort}/10` : 'Optional'}</Text>
              </View>
              <Text style={styles.helper}>How hard did the whole workout feel?</Text>
              <View style={styles.numberRow}>
                {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                  <PressableScale
                    key={value}
                    onPress={() => setEffort(value)}
                    style={[styles.numberChip, effort === value && styles.numberChipSelected]}
                    accessibilityLabel={`Session effort ${value} out of 10`}
                    accessibilityState={{ selected: effort === value }}
                  >
                    <Text style={[styles.numberText, effort === value && styles.selectedText]}>{value}</Text>
                  </PressableScale>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>Energy after training</Text>
                <Text style={styles.optional}>{energy ? `${energy}/5` : 'Optional'}</Text>
              </View>
              <View style={styles.energyRow}>
                {[
                  { value: 1, label: 'Drained' },
                  { value: 2, label: 'Low' },
                  { value: 3, label: 'Okay' },
                  { value: 4, label: 'Good' },
                  { value: 5, label: 'High' },
                ].map((item) => (
                  <PressableScale
                    key={item.value}
                    onPress={() => setEnergy(item.value)}
                    style={[styles.energyChip, energy === item.value && styles.numberChipSelected]}
                    accessibilityState={{ selected: energy === item.value }}
                  >
                    <Text style={[styles.numberText, energy === item.value && styles.selectedText]}>{item.value}</Text>
                    <Text style={[styles.energyLabel, energy === item.value && styles.selectedText]}>{item.label}</Text>
                  </PressableScale>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Any pain or discomfort?</Text>
              <View style={styles.painGrid}>
                {PAIN_OPTIONS.map((item) => {
                  const selected = pain === item.value;
                  const warning = item.value === 'sharp' || item.value === 'worsening';
                  return (
                    <PressableScale
                      key={item.value}
                      onPress={() => setPain(item.value)}
                      style={[
                        styles.painOption,
                        selected && (warning ? styles.painSelectedWarning : styles.selected),
                      ]}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.painLabel, selected && (warning ? styles.warningText : styles.selectedText)]}>{item.label}</Text>
                      <Text style={styles.painDescription}>{item.description}</Text>
                    </PressableScale>
                  );
                })}
              </View>
              {pain !== 'none' && (
                <TextInput
                  value={painNotes}
                  onChangeText={setPainNotes}
                  style={styles.notesInput}
                  placeholder="Where did you feel it? Which movement?"
                  placeholderTextColor={COLORS.textDim}
                  multiline
                  maxLength={500}
                  accessibilityLabel="Pain location and movement notes"
                />
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Anything else?</Text>
              <TextInput
                value={sessionNotes}
                onChangeText={setSessionNotes}
                style={styles.notesInput}
                placeholder="Optional notes for your coach"
                placeholderTextColor={COLORS.textDim}
                multiline
                maxLength={1000}
                accessibilityLabel="Workout notes"
              />
            </View>

            <Text style={styles.disclaimer}>
              Pain feedback is used to guide safer training choices. VYRN does not diagnose injuries. Stop movements that cause sharp or worsening pain and seek appropriate clinical guidance.
            </Text>
          </ScrollView>

          <View style={styles.footer}>
            <PressableScale onPress={onSkip} style={styles.skipButton}>
              <Text style={styles.skipText}>Skip check-in</Text>
            </PressableScale>
            <PressableScale onPress={submit} style={styles.submitButton} accessibilityRole="button">
              <Ionicons name="checkmark" size={17} color={COLORS.background} />
              <Text style={styles.submitText}>SAVE & FINISH</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', alignItems: 'center', justifyContent: 'center', padding: SPACING.md },
  card: { width: '100%', maxWidth: 460, maxHeight: '92%', backgroundColor: COLORS.background, borderRadius: 24, borderWidth: 1, borderColor: COLORS.borderLight, padding: SPACING.lg },
  header: { flexDirection: 'row', gap: SPACING.md, alignItems: 'flex-start', marginBottom: SPACING.md },
  headerIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: alpha(COLORS.primaryGreen, 0.12), alignItems: 'center', justifyContent: 'center' },
  eyebrow: { ...EYEBROW, color: COLORS.primaryGreen, fontSize: 8, letterSpacing: 1.2 },
  title: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 21, lineHeight: 27, marginTop: 4 },
  subtitle: { ...BODY, color: COLORS.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 4 },
  scroll: { flexShrink: 1 },
  content: { paddingBottom: SPACING.sm, gap: SPACING.sm },
  section: { marginTop: SPACING.md, gap: SPACING.sm },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 12 },
  optional: { color: COLORS.textDim, fontFamily: FONTS.medium, fontSize: 10 },
  helper: { ...BODY, color: COLORS.textMuted, fontSize: 10 },
  moodRow: { flexDirection: 'row', gap: 7, marginTop: SPACING.sm },
  moodButton: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 10, borderRadius: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  selected: { borderColor: COLORS.primaryGreen, backgroundColor: alpha(COLORS.primaryGreen, 0.1) },
  emoji: { fontSize: 20 },
  moodLabel: { color: COLORS.textSecondary, fontFamily: FONTS.medium, fontSize: 9 },
  selectedText: { color: COLORS.primaryGreen },
  numberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 5 },
  numberChip: { width: 29, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  numberChipSelected: { backgroundColor: alpha(COLORS.primaryGreen, 0.12), borderColor: COLORS.primaryGreen },
  numberText: { color: COLORS.textSecondary, fontFamily: FONTS.numericBold, fontSize: 11 },
  energyRow: { flexDirection: 'row', gap: 5, marginTop: 5 },
  energyChip: { flex: 1, minHeight: 43, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 9, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  energyLabel: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 8 },
  painGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  painOption: { width: '48%', minHeight: 48, padding: 9, borderRadius: 10, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  painSelectedWarning: { backgroundColor: alpha(COLORS.recoveryLow, 0.1), borderColor: COLORS.recoveryLow },
  painLabel: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 11 },
  warningText: { color: COLORS.recoveryLow },
  painDescription: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 9, marginTop: 3 },
  notesInput: { minHeight: 58, padding: 10, borderRadius: 11, color: COLORS.text, fontFamily: FONTS.regular, fontSize: 11, textAlignVertical: 'top', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  disclaimer: { ...BODY, color: COLORS.textDim, fontSize: 9, lineHeight: 14, marginTop: SPACING.sm },
  footer: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: SPACING.sm },
  skipButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.button, borderWidth: 1, borderColor: COLORS.border },
  skipText: { color: COLORS.textMuted, fontFamily: FONTS.semibold, fontSize: 10 },
  submitButton: { flex: 1.4, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: RADIUS.button, backgroundColor: COLORS.primaryGreen },
  submitText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.5 },
});

export default React.memo(WorkoutFeedbackModal);
