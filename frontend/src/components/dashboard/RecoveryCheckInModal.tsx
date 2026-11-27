import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { RADIUS, SPACING } from '../../theme/spacing';
import { FONTS } from '../../theme/typography';
import Text from '../ui/Text';
import PressableScale from '../ui/PressableScale';

export interface RecoveryCheckInValues {
  sleep_hours?: number;
  soreness_level?: number;
  energy_level?: number;
  notes?: string;
}

interface ExistingCheckIn {
  sleep_hours?: number | null;
  soreness_level?: number | null;
  energy_level?: number | null;
  notes?: string | null;
}

interface Props {
  visible: boolean;
  existing?: ExistingCheckIn | null;
  saving: boolean;
  onSave: (values: RecoveryCheckInValues) => void;
  onClose: () => void;
}

const SORENESS = [
  { value: 1, label: 'None' },
  { value: 2, label: 'Mild' },
  { value: 3, label: 'Moderate' },
  { value: 4, label: 'High' },
  { value: 5, label: 'Severe' },
];
const ENERGY = [
  { value: 1, label: 'Low' },
  { value: 2, label: 'Below' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'High' },
];

function RecoveryCheckInModal({ visible, existing, saving, onSave, onClose }: Props) {
  const [sleep, setSleep] = useState('');
  const [soreness, setSoreness] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!visible) return;
    setSleep(existing?.sleep_hours != null ? String(existing.sleep_hours) : '');
    setSoreness(existing?.soreness_level ?? null);
    setEnergy(existing?.energy_level ?? null);
    setNotes(existing?.notes || '');
  }, [visible, existing]);

  const sleepNumber = sleep.trim() ? Number(sleep) : null;
  const sleepValid = sleepNumber === null
    || (Number.isFinite(sleepNumber) && sleepNumber >= 0 && sleepNumber <= 24);
  const hasInput = sleep.trim().length > 0 || soreness !== null || energy !== null || notes.trim().length > 0;
  const canSave = hasInput && sleepValid && !saving;

  const submit = () => {
    if (!canSave) return;
    onSave({
      ...(sleepNumber !== null ? { sleep_hours: sleepNumber } : {}),
      ...(soreness !== null ? { soreness_level: soreness } : {}),
      ...(energy !== null ? { energy_level: energy } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="moon-outline" size={19} color={COLORS.primaryGreen} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>DAILY RECOVERY</Text>
              <Text style={styles.title}>How are you feeling today?</Text>
              <Text style={styles.subtitle}>Your dated self-report is one input to readiness, not a medical measurement.</Text>
            </View>
            <PressableScale onPress={onClose} style={styles.close} accessibilityLabel="Close recovery check-in">
              <Ionicons name="close" size={19} color={COLORS.textSecondary} />
            </PressableScale>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
              <Text style={styles.label}>Last night's sleep</Text>
              <View style={styles.sleepRow}>
                <TextInput
                  value={sleep}
                  onChangeText={setSleep}
                  style={[styles.sleepInput, !sleepValid && styles.invalid]}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 7.5"
                  placeholderTextColor={COLORS.textDim}
                  maxLength={4}
                  accessibilityLabel="Hours of sleep last night"
                />
                <Text style={styles.unit}>hours</Text>
              </View>
              {!sleepValid && <Text style={styles.error}>Enter a value between 0 and 24 hours.</Text>}
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>Muscle soreness</Text>
              <View style={styles.optionsRow}>
                {SORENESS.map((item) => (
                  <PressableScale key={item.value} onPress={() => setSoreness(item.value)}
                    style={[styles.option, soreness === item.value && styles.selected]}
                    accessibilityRole="button" accessibilityLabel={item.label}>
                    <Text style={[styles.optionNumber, soreness === item.value && styles.selectedText]}>{item.value}</Text>
                    <Text style={[styles.optionLabel, soreness === item.value && styles.selectedText]}>{item.label}</Text>
                  </PressableScale>
                ))}
              </View>
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>Energy level</Text>
              <View style={styles.optionsRow}>
                {ENERGY.map((item) => (
                  <PressableScale key={item.value} onPress={() => setEnergy(item.value)}
                    style={[styles.option, energy === item.value && styles.selected]}
                    accessibilityRole="button" accessibilityLabel={item.label}>
                    <Text style={[styles.optionNumber, energy === item.value && styles.selectedText]}>{item.value}</Text>
                    <Text style={[styles.optionLabel, energy === item.value && styles.selectedText]}>{item.label}</Text>
                  </PressableScale>
                ))}
              </View>
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>Anything else? <Text style={styles.optional}>Optional</Text></Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                style={[styles.sleepInput, styles.notes]}
                placeholder="Sleep quality, fatigue or context for your coach"
                placeholderTextColor={COLORS.textDim}
                multiline maxLength={500}
                accessibilityLabel="Recovery check-in notes"
              />
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <PressableScale onPress={onClose} style={styles.cancel} disabled={saving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </PressableScale>
            <PressableScale onPress={submit} style={[styles.save, !canSave && styles.disabled]} disabled={!canSave}>
              {saving ? <ActivityIndicator size="small" color={COLORS.background} />
                : <Ionicons name="checkmark-circle-outline" size={17} color={COLORS.background} />}
              <Text style={styles.saveText}>{saving ? 'SAVING…' : 'SAVE CHECK-IN'}</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', alignItems: 'center', justifyContent: 'center', padding: SPACING.md },
  sheet: { width: '100%', maxWidth: 460, maxHeight: '92%', backgroundColor: COLORS.background, borderRadius: 24, borderWidth: 1, borderColor: COLORS.borderLight, padding: SPACING.lg, gap: SPACING.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  headerIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: alpha(COLORS.primaryGreen, 0.12), alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.2 },
  title: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 21, lineHeight: 27, marginTop: 4 },
  subtitle: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 16, marginTop: 4 },
  close: { padding: 8, borderRadius: RADIUS.button, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  body: { flexGrow: 0 },
  bodyContent: { gap: SPACING.md, paddingBottom: 4 },
  section: { gap: 7 },
  label: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 11 },
  optional: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 9 },
  sleepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sleepInput: { flex: 1, minHeight: 42, borderRadius: RADIUS.button, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 9, color: COLORS.text, backgroundColor: COLORS.card, fontFamily: FONTS.medium, fontSize: 12 },
  invalid: { borderColor: COLORS.recoveryLow },
  unit: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 11 },
  error: { color: COLORS.recoveryLow, fontFamily: FONTS.medium, fontSize: 9 },
  optionsRow: { flexDirection: 'row', gap: 5 },
  option: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card },
  selected: { borderColor: COLORS.primaryGreen, backgroundColor: alpha(COLORS.primaryGreen, 0.1) },
  optionNumber: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 12 },
  optionLabel: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 7 },
  selectedText: { color: COLORS.primaryGreen },
  notes: { minHeight: 58, textAlignVertical: 'top' },
  footer: { flexDirection: 'row', gap: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.md },
  cancel: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.button },
  cancelText: { color: COLORS.textSecondary, fontFamily: FONTS.semibold, fontSize: 11 },
  save: { flex: 1.5, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.button, backgroundColor: COLORS.primaryGreen },
  saveText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.5 },
  disabled: { opacity: 0.4 },
});

export default React.memo(RecoveryCheckInModal);
