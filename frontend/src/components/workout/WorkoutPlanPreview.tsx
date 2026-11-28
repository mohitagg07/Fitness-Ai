import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
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

export interface WorkoutExerciseDraft {
  name: string;
  exercise_id?: string | null;
  equipment_required?: string[];
  muscle_groups?: string[];
  sets: number;
  reps: string;
  load: string;
  cue: string;
  rest: string;
  completed_sets: number;
  rpe_target?: number | null;
  rir_target?: number | null;
  tempo?: string;
}

interface Props {
  visible: boolean;
  title: string;
  workoutType: string;
  estimatedMinutes?: number | null;
  exercises: WorkoutExerciseDraft[];
  onChange: (next: WorkoutExerciseDraft[]) => void;
  onApprove: () => void;
  onCancel: () => void;
  saving: boolean;
  reason?: string;
  muscleGroups?: string[];
  warmupNotes?: string;
  cooldownNotes?: string;
  onWarmupNotesChange?: (value: string) => void;
  onCooldownNotesChange?: (value: string) => void;
}

function WorkoutPlanPreview({
  visible,
  title,
  workoutType,
  estimatedMinutes,
  exercises,
  onChange,
  onApprove,
  onCancel,
  saving,
  reason,
  muscleGroups,
  warmupNotes,
  cooldownNotes,
  onWarmupNotesChange,
  onCooldownNotesChange,
}: Props) {
  const [newExerciseName, setNewExerciseName] = useState('');

  const patchExercise = (index: number, patch: Partial<WorkoutExerciseDraft>) => {
    onChange(exercises.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item
    ));
  };

  const moveExercise = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= exercises.length) return;
    const next = [...exercises];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addExercise = () => {
    const name = newExerciseName.trim();
    if (!name) return;
    onChange([...exercises, {
      name,
      sets: 3,
      reps: '8-12',
      load: '',
      cue: '',
      rest: '90 sec',
      completed_sets: 0,
    }]);
    setNewExerciseName('');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>VYRN / PLAN REVIEW</Text>
              <Text style={styles.title}>Your workout, before you start.</Text>
              <Text style={styles.subtitle}>
                Check the exercise order and prescription. You stay in control until you approve it.
              </Text>
            </View>
            <PressableScale onPress={onCancel} style={styles.close} accessibilityLabel="Close workout preview">
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </PressableScale>
          </View>

          <View style={styles.summary}>
            <View style={styles.summaryText}>
              <Text style={styles.planName}>{title}</Text>
              <Text style={styles.planMeta}>
                {workoutType.replace(/_/g, ' ').toUpperCase()}
                {estimatedMinutes ? `  ·  ABOUT ${estimatedMinutes} MIN` : ''}
                { `  ·  ${exercises.length} EXERCISES` }
              </Text>
            </View>
            <Ionicons name="shield-checkmark-outline" size={21} color={COLORS.primaryGreen} />
          </View>

          {!!reason && <Text style={styles.reason}>{reason}</Text>}
          {!!muscleGroups?.length && (
            <Text style={styles.muscles}>FOCUS · {muscleGroups.join(' · ').toUpperCase()}</Text>
          )}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sessionNotesCard}>
              <Text style={styles.sessionNotesTitle}>SESSION PREPARATION</Text>
              <Text style={styles.sessionNotesLabel}>WARM-UP</Text>
              <TextInput
                value={warmupNotes || ''}
                onChangeText={onWarmupNotesChange}
                style={styles.sessionNotesInput}
                placeholder="Mobility, ramp-up sets or preparation notes"
                placeholderTextColor={COLORS.textDim}
                multiline
                maxLength={1000}
                accessibilityLabel="Warm-up instructions"
              />
              <Text style={styles.sessionNotesLabel}>COOL-DOWN</Text>
              <TextInput
                value={cooldownNotes || ''}
                onChangeText={onCooldownNotesChange}
                style={styles.sessionNotesInput}
                placeholder="Cool-down or recovery notes"
                placeholderTextColor={COLORS.textDim}
                multiline
                maxLength={1000}
                accessibilityLabel="Cool-down instructions"
              />
            </View>
            {exercises.map((exercise, index) => (
              <View key={index} style={styles.exerciseCard}>
                <View style={styles.exerciseTop}>
                  <View style={styles.orderBadge}>
                    <Text style={styles.orderText}>{String(index + 1).padStart(2, '0')}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <TextInput
                      value={exercise.name}
                      onChangeText={(value) => patchExercise(index, {
                        name: value,
                        exercise_id: null,
                        equipment_required: [],
                        muscle_groups: [],
                      })}
                      style={styles.exerciseNameInput}
                      placeholder="Exercise name"
                      placeholderTextColor={COLORS.textDim}
                      maxLength={120}
                      accessibilityLabel={`Exercise ${index + 1} name`}
                    />
                    {!!exercise.muscle_groups?.length && (
                      <Text style={styles.exerciseMeta}>
                        {exercise.muscle_groups.join(' · ')}
                      </Text>
                    )}
                    {!!exercise.equipment_required?.length && (
                      <Text style={styles.exerciseMeta}>
                        Equipment · {exercise.equipment_required.join(', ')}
                      </Text>
                    )}
                    {!!exercise.cue && <Text style={styles.cue}>{exercise.cue}</Text>}
                  </View>
                  <View style={styles.orderActions}>
                    <PressableScale
                      onPress={() => moveExercise(index, -1)}
                      disabled={index === 0}
                      style={styles.iconButton}
                      accessibilityLabel={`Move ${exercise.name} up`}
                    >
                      <Ionicons name="chevron-up" size={15} color={index === 0 ? COLORS.textDim : COLORS.textSecondary} />
                    </PressableScale>
                    <PressableScale
                      onPress={() => moveExercise(index, 1)}
                      disabled={index === exercises.length - 1}
                      style={styles.iconButton}
                      accessibilityLabel={`Move ${exercise.name} down`}
                    >
                      <Ionicons name="chevron-down" size={15} color={index === exercises.length - 1 ? COLORS.textDim : COLORS.textSecondary} />
                    </PressableScale>
                    <PressableScale
                      onPress={() => onChange(exercises.filter((_, itemIndex) => itemIndex !== index))}
                      style={styles.iconButton}
                      accessibilityLabel={`Remove ${exercise.name}`}
                    >
                      <Ionicons name="trash-outline" size={14} color={COLORS.recoveryLow} />
                    </PressableScale>
                  </View>
                </View>

                <View style={styles.prescriptionRow}>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>SETS</Text>
                    <View style={styles.stepper}>
                      <PressableScale
                        onPress={() => patchExercise(index, { sets: Math.max(1, exercise.sets - 1) })}
                        style={styles.stepButton}
                        accessibilityLabel={`Decrease ${exercise.name} sets`}
                      >
                        <Ionicons name="remove" size={14} color={COLORS.textSecondary} />
                      </PressableScale>
                      <Text style={styles.stepValue}>{exercise.sets}</Text>
                      <PressableScale
                        onPress={() => patchExercise(index, { sets: Math.min(20, exercise.sets + 1) })}
                        style={styles.stepButton}
                        accessibilityLabel={`Increase ${exercise.name} sets`}
                      >
                        <Ionicons name="add" size={14} color={COLORS.textSecondary} />
                      </PressableScale>
                    </View>
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>REPS</Text>
                    <TextInput
                      value={exercise.reps}
                      onChangeText={(value) => patchExercise(index, { reps: value })}
                      style={styles.input}
                      placeholder="8-12"
                      placeholderTextColor={COLORS.textDim}
                      maxLength={30}
                      accessibilityLabel={`${exercise.name} rep target`}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>LOAD (KG)</Text>
                    <TextInput
                      value={exercise.load}
                      onChangeText={(value) => patchExercise(index, { load: value })}
                      style={styles.input}
                      placeholder="As appropriate"
                      placeholderTextColor={COLORS.textDim}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`${exercise.name} load guidance`}
                    />
                  </View>
                </View>
                <View style={styles.detailRow}>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>REST</Text>
                    <TextInput
                      value={exercise.rest}
                      onChangeText={(value) => patchExercise(index, { rest: value })}
                      style={styles.input}
                      placeholder="90 sec"
                      placeholderTextColor={COLORS.textDim}
                      maxLength={20}
                      accessibilityLabel={`${exercise.name} rest period`}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>TARGET RPE</Text>
                    <TextInput
                      value={exercise.rpe_target == null ? '' : String(exercise.rpe_target)}
                      onChangeText={(value) => {
                        const parsed = value.trim() ? Number(value) : NaN;
                        patchExercise(index, {
                          rpe_target: Number.isFinite(parsed) ? Math.max(1, Math.min(10, parsed)) : null,
                        });
                      }}
                      style={styles.input}
                      placeholder="Optional"
                      placeholderTextColor={COLORS.textDim}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`${exercise.name} target RPE`}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>TARGET RIR</Text>
                    <TextInput
                      value={exercise.rir_target == null ? '' : String(exercise.rir_target)}
                      onChangeText={(value) => {
                        const parsed = value.trim() ? Number(value) : NaN;
                        patchExercise(index, {
                          rir_target: Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : null,
                        });
                      }}
                      style={styles.input}
                      placeholder="Optional"
                      placeholderTextColor={COLORS.textDim}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`${exercise.name} target reps in reserve`}
                    />
                  </View>
                </View>
                <View style={styles.detailRow}>
                  <View style={[styles.field, { flex: 0.75 }]}>
                    <Text style={styles.fieldLabel}>TEMPO</Text>
                    <TextInput
                      value={exercise.tempo || ''}
                      onChangeText={(value) => patchExercise(index, { tempo: value })}
                      style={styles.input}
                      placeholder="e.g. 3-1-1"
                      placeholderTextColor={COLORS.textDim}
                      maxLength={20}
                      accessibilityLabel={`${exercise.name} tempo`}
                    />
                  </View>
                  <View style={[styles.field, { flex: 1.75 }]}>
                    <Text style={styles.fieldLabel}>COACH CUE</Text>
                    <TextInput
                      value={exercise.cue}
                      onChangeText={(value) => patchExercise(index, { cue: value })}
                      style={[styles.input, styles.cueInput]}
                      placeholder="Setup, technique or movement cue"
                      placeholderTextColor={COLORS.textDim}
                      maxLength={500}
                      multiline
                      accessibilityLabel={`${exercise.name} coaching cue`}
                    />
                  </View>
                </View>
              </View>
            ))}

            <View style={styles.addRow}>
              <TextInput
                value={newExerciseName}
                onChangeText={setNewExerciseName}
                style={[styles.input, { flex: 1 }]}
                placeholder="Add another exercise"
                placeholderTextColor={COLORS.textDim}
                maxLength={120}
                returnKeyType="done"
                onSubmitEditing={addExercise}
              />
              <PressableScale onPress={addExercise} style={styles.addButton} accessibilityLabel="Add exercise">
                <Ionicons name="add" size={18} color={COLORS.background} />
              </PressableScale>
            </View>
            {exercises.length === 0 && (
              <Text style={styles.empty}>Add at least one exercise before approving this training session.</Text>
            )}
            <Text style={styles.disclaimer}>
              Load suggestions are starting guidance, not a target to push through pain. Adjust to your equipment and comfortable technique.
            </Text>
          </ScrollView>

          <View style={styles.footer}>
            <PressableScale onPress={onCancel} style={styles.cancelButton} disabled={saving}>
              <Text style={styles.cancelText}>Not now</Text>
            </PressableScale>
            <PressableScale
              onPress={onApprove}
              style={[styles.approveButton, (saving || exercises.length === 0) && styles.disabled]}
              disabled={saving || exercises.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Approve plan and start workout"
            >
              {saving
                ? <ActivityIndicator size="small" color={COLORS.background} />
                : <Ionicons name="checkmark-circle-outline" size={17} color={COLORS.background} />}
              <Text style={styles.approveText}>{saving ? 'SAVING PLAN…' : 'APPROVE & START'}</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '94%',
    minHeight: '72%',
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: Platform.OS === 'ios' ? 30 : SPACING.lg,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 4,
    backgroundColor: COLORS.textDim,
    alignSelf: 'center',
    marginBottom: SPACING.lg,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md, marginBottom: SPACING.lg },
  eyebrow: { ...EYEBROW, color: COLORS.primaryGreen, fontSize: 10, letterSpacing: 1.3 },
  title: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 24, lineHeight: 29, marginTop: 5 },
  subtitle: { ...BODY, color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 6 },
  close: { padding: 8, borderRadius: 24, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  reason: { ...BODY, color: COLORS.textSecondary, fontSize: 11, lineHeight: 16, marginTop: SPACING.sm },
  muscles: { ...EYEBROW, color: COLORS.primaryGreen, fontSize: 10, letterSpacing: 0.8, marginTop: SPACING.xs },
  summary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: SPACING.md, borderRadius: RADIUS.card, backgroundColor: alpha(COLORS.primaryGreen, 0.07),
    borderWidth: 1, borderColor: alpha(COLORS.primaryGreen, 0.2), marginBottom: SPACING.md,
  },
  summaryText: { flex: 1, gap: 4 },
  planName: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 14 },
  planMeta: { ...EYEBROW, color: COLORS.textMuted, fontSize: 10, letterSpacing: 0.7 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  list: { paddingBottom: SPACING.md, gap: SPACING.md },
  sessionNotesCard: { padding: SPACING.md, borderRadius: RADIUS.card, backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border, gap: 7 },
  sessionNotesTitle: { ...EYEBROW, color: COLORS.primaryGreen, fontSize: 9, letterSpacing: 1.1 },
  sessionNotesLabel: { ...EYEBROW, color: COLORS.textMuted, fontSize: 8, letterSpacing: 0.8, marginTop: 3 },
  sessionNotesInput: { minHeight: 42, color: COLORS.text, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 16, textAlignVertical: 'top', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background },
  exerciseCard: {
    padding: SPACING.md, borderRadius: RADIUS.card, backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: COLORS.border,
  },
  exerciseTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  orderBadge: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.cardElevated },
  orderText: { color: COLORS.primaryGreen, fontFamily: FONTS.numericBold, fontSize: 10 },
  exerciseName: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13 },
  exerciseNameInput: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13, paddingVertical: 3, paddingHorizontal: 0, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  exerciseMeta: { ...BODY, color: COLORS.textDim, fontSize: 9, lineHeight: 13, marginTop: 3, textTransform: 'capitalize' },
  cue: { ...BODY, color: COLORS.textMuted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  orderActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  iconButton: { minWidth: 27, minHeight: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: COLORS.cardElevated },
  prescriptionRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  field: { flex: 1, minWidth: 0, gap: 5 },
  fieldLabel: { ...EYEBROW, color: COLORS.textMuted, fontSize: 10 },
  stepper: {
    minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.button, borderWidth: 1, borderColor: COLORS.border,
  },
  stepButton: { width: 27, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepValue: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 13 },
  input: {
    minHeight: 38, color: COLORS.text, fontFamily: FONTS.medium, fontSize: 12,
    paddingHorizontal: 9, paddingVertical: 7, borderRadius: RADIUS.button,
    backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border,
  },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, marginTop: SPACING.md },
  cueInput: { minHeight: 58, textAlignVertical: 'top', paddingTop: 9 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  addButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primaryGreen },
  empty: { color: COLORS.recoveryLow, fontFamily: FONTS.medium, fontSize: 12, textAlign: 'center', padding: SPACING.md },
  disclaimer: { ...BODY, color: COLORS.textDim, fontSize: 10, lineHeight: 15, marginTop: SPACING.xs },
  footer: { flexDirection: 'row', gap: SPACING.sm, paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: SPACING.sm },
  cancelButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.button, borderWidth: 1, borderColor: COLORS.borderLight, backgroundColor: COLORS.card },
  cancelText: { color: COLORS.textSecondary, fontFamily: FONTS.semibold, fontSize: 12 },
  approveButton: { flex: 1.7, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: RADIUS.button, backgroundColor: COLORS.primaryGreen },
  approveText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 11, letterSpacing: 0.5 },
  disabled: { opacity: 0.45 },
});

export default React.memo(WorkoutPlanPreview);
