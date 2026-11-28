/**
 * WorkoutSummaryCard — the Workout Complete event.
 *
 * The single moment in the app most worth making memorable:
 *   - count-up animates every number instead of snapping to a final value
 *   - fires a confetti burst + success haptic when there's a new PR
 *   - shows tomorrow's recovery % as a small ring, not just a word
 *   - surfaces the deterministic coach_message from the backend (see
 *     workouts.py's complete_session — grounded in this session's own
 *     numbers, never invented)
 *   - the sheet itself rises in, then its sections fade up one after
 *     another (hero → stats → PRs → recovery/coach → best set → CTA) so
 *     the reveal reads as a small ceremony instead of a data dump
 *
 * Built entirely on the shared design tokens now (COLORS/RADIUS/SPACING/
 * ELEVATION) instead of one-off hex values, and the PR list uses plain
 * rows on the card's own elevated surface rather than a bordered pill —
 * consistent with the rest of the app after the Badge rework.
 *
 * Sound is intentionally not wired in yet — this app has no audio
 * dependency installed (expo-av/expo-audio), and I'm not silently adding
 * a new native module without being able to test the build here. Haptic
 * feedback covers the "felt" half of the celebration in the meantime.
 */
import React, { useEffect, useRef } from 'react';
import {
  View, StyleSheet, Modal, Animated, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { COLORS, alpha } from '../../theme/colors';
import { RADIUS, SPACING } from '../../theme/spacing';
import { ELEVATION } from '../../theme/layout';
import Text from '../ui/Text';
import Button from '../ui/Button';
import CountUpNumber from '../shared/CountUpNumber';
import ConfettiBurst from './ConfettiBurst';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface NewPR {
  exercise_name: string;
  weight_kg: number;
  previous_pr_kg?: number | null;
  delta_kg?: number | null;
}

interface SummaryData {
  total_volume_kg: number;
  sets_logged: number;
  exercises: string[];
  exercise_count: number;
  best_set: {
    exercise: string;
    weight_kg: number;
    reps: number;
    rpe?: number;
  } | null;
  session_minutes?: number;
  new_prs?: NewPR[];
  recovery_pct?: number | null;
  recovery_prediction?: string | null;
  coach_message?: string | null;
  previous_comparable_session?: {
    session_id?: string;
    session_date?: string | null;
    workout_type?: string | null;
    day_label?: string | null;
    comparison_basis: 'workout_type' | 'day_label';
    previous_total_volume_kg?: number | null;
    current_total_volume_kg?: number | null;
    volume_delta_kg?: number | null;
    volume_delta_pct?: number | null;
    previous_duration_minutes?: number | null;
    current_duration_minutes?: number | null;
    duration_delta_minutes?: number | null;
  } | null;
  planned_vs_actual?: {
    has_plan: boolean;
    planned_exercises: number;
    completed_exercises?: number;
    exercises_with_logged_sets: number;
    partially_completed_exercises?: number;
    skipped_exercises: number;
    replaced_exercises?: number;
    not_started_exercises?: number;
    planned_working_sets: number;
    completed_working_sets: number;
    set_completion_ratio: number | null;
    exercises: Array<{
      name: string;
      current_name?: string;
      planned_sets: number;
      logged_working_sets: number;
      completed: boolean;
      status?: 'completed' | 'partially_completed' | 'skipped' | 'replaced' | 'replacement_not_logged' | 'not_started';
      action?: 'skip' | 'replace' | null;
      reason?: string | null;
    }>;
  };
  session_effort?: number | null;
  energy_level?: number | null;
  pain_status?: 'none' | 'mild' | 'sharp' | 'worsening' | null;
  pain_notes?: string | null;
  calories_is_estimate?: boolean;
}

interface Props {
  visible: boolean;
  data: SummaryData | null;
  onClose: () => void;
}

function recoveryColor(pct: number) {
  if (pct >= 70) return COLORS.recoveryHigh;
  if (pct >= 40) return COLORS.recoveryMed;
  return COLORS.recoveryLow;
}

function RecoveryRing({ pct }: { pct: number }) {
  const size = 56;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = recoveryColor(pct);
  const clamped = Math.max(0, Math.min(100, pct));
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={COLORS.cardBorder} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text variant="caption" weight="bold" numeric color={color} style={recStyles.pct}>{Math.round(clamped)}%</Text>
    </View>
  );
}

// A section that fades + rises in on a stagger, driven by the parent's
// mount value so every sub-block reveals in sequence rather than at once.
function Reveal({ mount, delay, children, style }: { mount: Animated.Value; delay: number; children: React.ReactNode; style?: any }) {
  const opacity = mount.interpolate({
    inputRange: [delay, Math.min(delay + 0.22, 1)],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const translateY = mount.interpolate({
    inputRange: [delay, Math.min(delay + 0.22, 1)],
    outputRange: [10, 0],
    extrapolate: 'clamp',
  });
  return <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

function WorkoutSummaryCard({ visible, data, onClose }: Props) {
  const scaleIn = useRef(new Animated.Value(0.9)).current;
  // Logo/badge "stamp-in" — starts small + rotated, overshoots past 1 on
  // the way in so the mark reads as a celebratory stamp, not a static icon.
  const badgeScale = useRef(new Animated.Value(0)).current;
  const badgeRotate = useRef(new Animated.Value(-1)).current;
  // Drives the staggered Reveal sections below the hero (0 → 1).
  const mount = useRef(new Animated.Value(0)).current;
  const [confettiActive, setConfettiActive] = React.useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!visible || !data) return undefined;
    if (reduceMotion) {
      scaleIn.setValue(1);
      badgeScale.setValue(1);
      badgeRotate.setValue(0);
      mount.setValue(1);
      setConfettiActive(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return undefined;
    }
    scaleIn.setValue(0.9);
    badgeScale.setValue(0);
    badgeRotate.setValue(-1);
    mount.setValue(0);

    Animated.spring(scaleIn, { toValue: 1, useNativeDriver: true, friction: 7, tension: 70 }).start();
    Animated.sequence([
      Animated.delay(120),
      Animated.parallel([
        Animated.spring(badgeScale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 60 }),
        Animated.spring(badgeRotate, { toValue: 0, useNativeDriver: true, friction: 6, tension: 50 }),
        Animated.timing(mount, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start();

    const hasPRs = (data.new_prs?.length || 0) > 0;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (hasPRs) {
      // Small delay so the burst reads as a reaction to the PR row appearing,
      // not a generic "modal opened" flourish.
      const t = setTimeout(() => setConfettiActive(true), 320);
      return () => clearTimeout(t);
    }
    setConfettiActive(false);
  }, [visible, data, reduceMotion]);

  const badgeSpin = badgeRotate.interpolate({ inputRange: [-1, 0], outputRange: ['-25deg', '0deg'] });

  if (!data) return null;

  const prCount = data.new_prs?.length || 0;
  // "Great work. Session saved." told the user nothing they didn't
  // already know — every non-PR session was getting the exact same line.
  // Lead with the best set if we have one (it's the single most
  // motivating real number from the session); otherwise fall back to
  // total volume, which is still a specific, earned stat rather than praise.
  const fallbackSubtitle = data.best_set
    ? `Best set: ${data.best_set.exercise} — ${data.best_set.weight_kg}kg × ${data.best_set.reps}.`
    : `${Math.round(data.total_volume_kg).toLocaleString()}kg moved across ${data.sets_logged} set${data.sets_logged !== 1 ? 's' : ''}.`;
  const badgeColors: [string, string] = prCount > 0
    ? [COLORS.gold, alpha(COLORS.gold, 0.7)]
    : [COLORS.primaryGreen, alpha(COLORS.primaryGreen, 0.7)];

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.backdrop}>
        <ConfettiBurst active={confettiActive && !reduceMotion} />
        <Animated.View style={[styles.card, { transform: [{ scale: scaleIn }] }]}>
          <View style={styles.grabber} />

          {/* Header */}
          <View style={styles.header}>
            <Animated.View
              style={[
                styles.badgeGlow,
                { shadowColor: prCount > 0 ? COLORS.gold : COLORS.primaryGreen },
                { transform: [{ scale: badgeScale }, { rotate: badgeSpin }] },
              ]}
            >
              <LinearGradient colors={badgeColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badgeCircle}>
                <Ionicons name={prCount > 0 ? 'trophy' : 'checkmark'} size={28} color="#000000" />
              </LinearGradient>
            </Animated.View>
            <Text variant="hero" style={styles.title}>Workout Complete</Text>
            <Text variant="body" color={COLORS.textSecondary} align="center" numberOfLines={1}>
              {prCount > 0 ? `${prCount} new personal record${prCount !== 1 ? 's' : ''} today.` : fallbackSubtitle}
            </Text>
          </View>

          {/* Stats grid — count-up, number-first */}
          <Reveal mount={mount} delay={0.05} style={styles.grid}>
            <>
              {data.session_minutes != null && (
                <View style={styles.stat}>
                  <CountUpNumber value={data.session_minutes} style={styles.statVal as any} suffix="m" />
                  <Text variant="caption" color={COLORS.textMuted}>Duration</Text>
                </View>
              )}
              <View style={styles.stat}>
                <CountUpNumber value={data.exercise_count} style={styles.statVal as any} />
                <Text variant="caption" color={COLORS.textMuted}>Exercises</Text>
              </View>
              <View style={styles.stat}>
                <CountUpNumber value={Math.round(data.total_volume_kg)} style={styles.statVal as any} suffix="kg" />
                <Text variant="caption" color={COLORS.textMuted}>Total volume</Text>
              </View>
              <View style={styles.stat}>
                <CountUpNumber
                  value={prCount}
                  style={[styles.statVal, prCount > 0 && { color: COLORS.gold }] as any}
                />
                <Text variant="caption" color={COLORS.textMuted}>PRs</Text>
              </View>
            </>
          </Reveal>

          {/* PR rows — plain rows on the card's elevated surface, no boxed pill */}
          {prCount > 0 && (
            <Reveal mount={mount} delay={0.16} style={styles.prList}>
              <>
                {data.new_prs!.map((pr, i) => (
                  <View key={i} style={styles.prRow}>
                    <Ionicons name="trophy" size={14} color={COLORS.gold} />
                    <Text variant="body" weight="semibold" color={COLORS.text} numberOfLines={1} style={{ flex: 1 }}>
                      {pr.exercise_name}: {pr.weight_kg}kg
                    </Text>
                    {pr.delta_kg != null && (
                      <Text variant="caption" weight="bold" numeric color={COLORS.gold}>+{pr.delta_kg}kg</Text>
                    )}
                  </View>
                ))}
              </>
            </Reveal>
          )}

          {data.planned_vs_actual?.has_plan && (
            <Reveal mount={mount} delay={0.22} style={styles.planReview}>
              <>
                <View style={styles.reviewHeading}>
                  <Text variant="caption" weight="bold" color={COLORS.textDim} style={{ letterSpacing: 1.1 }}>PLAN VS COMPLETED</Text>
                  <Text variant="caption" weight="semibold" color={COLORS.primaryGreen}>
                    {(data.planned_vs_actual.completed_exercises ?? data.planned_vs_actual.exercises_with_logged_sets)}/{data.planned_vs_actual.planned_exercises} completed
                  </Text>
                </View>
                <View style={styles.reviewStats}>
                  <View style={styles.reviewStat}>
                    <Text variant="body" weight="bold" numeric color={COLORS.text}>
                      {data.planned_vs_actual.completed_working_sets}/{data.planned_vs_actual.planned_working_sets}
                    </Text>
                    <Text variant="caption" color={COLORS.textMuted}>Working sets</Text>
                  </View>
                  <View style={styles.reviewStat}>
                    <Text variant="body" weight="bold" numeric color={COLORS.text}>
                      {data.planned_vs_actual.skipped_exercises}
                    </Text>
                    <Text variant="caption" color={COLORS.textMuted}>Exercises skipped</Text>
                  </View>
                  {!!data.planned_vs_actual.replaced_exercises && (
                    <View style={styles.reviewStat}>
                      <Text variant="body" weight="bold" numeric color={COLORS.text}>
                        {data.planned_vs_actual.replaced_exercises}
                      </Text>
                      <Text variant="caption" color={COLORS.textMuted}>Exercises replaced</Text>
                    </View>
                  )}
                  {!!data.planned_vs_actual.partially_completed_exercises && (
                    <View style={styles.reviewStat}>
                      <Text variant="body" weight="bold" numeric color={COLORS.text}>
                        {data.planned_vs_actual.partially_completed_exercises}
                      </Text>
                      <Text variant="caption" color={COLORS.textMuted}>Partially completed</Text>
                    </View>
                  )}
                </View>
                {data.planned_vs_actual.exercises.filter((exercise) => exercise.status && exercise.status !== 'completed').map((exercise, index) => {
                  const wasSkipped = exercise.status === 'skipped';
                  const wasReplaced = exercise.action === 'replace';
                  const statusLabel = wasSkipped
                    ? 'Skipped'
                    : exercise.status === 'replaced'
                      ? 'Completed'
                      : exercise.status === 'partially_completed'
                        ? 'Partially completed'
                        : exercise.status === 'replacement_not_logged'
                          ? 'Replacement not logged'
                          : 'Not started';
                  return (
                    <View key={`${exercise.name}-${index}`} style={styles.skippedRow}>
                      <Ionicons
                        name={wasSkipped ? 'close-circle-outline' : wasReplaced ? 'swap-horizontal-outline' : 'remove-circle-outline'}
                        size={13}
                        color={wasSkipped ? COLORS.textMuted : wasReplaced ? COLORS.recoveryMed : COLORS.textDim}
                      />
                      <View style={{ flex: 1 }}>
                        <Text variant="caption" color={COLORS.textSecondary}>
                          {exercise.name}{wasReplaced && exercise.current_name && exercise.current_name !== exercise.name ? ` → ${exercise.current_name}` : ''}
                        </Text>
                        {!!exercise.reason && (
                          <Text variant="caption" color={COLORS.textMuted}>{exercise.reason}</Text>
                        )}
                      </View>
                      <Text variant="caption" color={COLORS.textMuted}>{statusLabel}</Text>
                    </View>
                  );
                })}
              </>
            </Reveal>
          )}

          {data.previous_comparable_session && (
            <Reveal mount={mount} delay={0.24} style={styles.comparison}>
              <>
                <View style={styles.comparisonHeading}>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" weight="bold" color={COLORS.textDim} style={{ letterSpacing: 1.1 }}>
                      VS LAST {String(data.previous_comparable_session.workout_type || data.previous_comparable_session.day_label || 'MATCHING').replace(/_/g, ' ').toUpperCase()}
                    </Text>
                    <Text variant="caption" color={COLORS.textMuted}>
                      {data.previous_comparable_session.session_date
                        ? `Previous session · ${data.previous_comparable_session.session_date}`
                        : 'Previous comparable session'}
                    </Text>
                  </View>
                  <Ionicons name="git-compare-outline" size={16} color={COLORS.strain} />
                </View>
                {data.previous_comparable_session.volume_delta_kg != null ? (
                  <View style={styles.comparisonMetric}>
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" color={COLORS.textMuted}>Working-set volume</Text>
                      <Text variant="body" weight="semibold" numeric color={COLORS.text}>
                        {Math.round(data.previous_comparable_session.current_total_volume_kg || 0).toLocaleString()} kg
                        {' '}vs{' '}
                        {Math.round(data.previous_comparable_session.previous_total_volume_kg || 0).toLocaleString()} kg
                      </Text>
                    </View>
                    <View style={styles.comparisonDelta}>
                      <Text variant="body" weight="bold" numeric color={COLORS.text}>
                        {data.previous_comparable_session.volume_delta_kg > 0 ? '+' : ''}
                        {data.previous_comparable_session.volume_delta_kg.toLocaleString()} kg
                      </Text>
                      {data.previous_comparable_session.volume_delta_pct != null ? (
                        <Text variant="caption" color={COLORS.textMuted}>
                          {data.previous_comparable_session.volume_delta_pct > 0 ? '+' : ''}
                          {data.previous_comparable_session.volume_delta_pct}%
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : (
                  <Text variant="caption" color={COLORS.textMuted}>Volume comparison is unavailable for one of the sessions.</Text>
                )}
                {data.previous_comparable_session.duration_delta_minutes != null ? (
                  <View style={styles.comparisonFooter}>
                    <Text variant="caption" color={COLORS.textMuted}>
                      Duration: {Math.round(data.previous_comparable_session.current_duration_minutes || 0)} min
                      {' '}vs {Math.round(data.previous_comparable_session.previous_duration_minutes || 0)} min
                      {' '}({data.previous_comparable_session.duration_delta_minutes > 0 ? '+' : ''}
                      {Math.round(data.previous_comparable_session.duration_delta_minutes)} min)
                    </Text>
                  </View>
                ) : null}
                <Text variant="caption" color={COLORS.textDim}>
                  Same workout type comparison. Higher volume is not automatically better; interpret it alongside effort, recovery and technique.
                </Text>
              </>
            </Reveal>
          )}

          {(data.session_effort != null || data.energy_level != null || (data.pain_status && data.pain_status !== 'none')) && (
            <Reveal mount={mount} delay={0.25} style={styles.checkin}>
              <Text variant="caption" weight="bold" color={COLORS.textDim} style={{ letterSpacing: 1.1 }}>YOUR CHECK-IN</Text>
              <View style={styles.checkinRow}>
                {data.session_effort != null && (
                  <Text variant="caption" color={COLORS.textSecondary}>Effort {data.session_effort}/10</Text>
                )}
                {data.energy_level != null && (
                  <Text variant="caption" color={COLORS.textSecondary}>Energy {data.energy_level}/5</Text>
                )}
                {data.pain_status && data.pain_status !== 'none' && (
                  <Text variant="caption" color={data.pain_status === 'sharp' || data.pain_status === 'worsening' ? COLORS.recoveryLow : COLORS.textSecondary}>
                    Pain: {data.pain_status}
                  </Text>
                )}
              </View>
              {!!data.pain_notes && (
                <Text variant="caption" color={COLORS.textMuted}>{data.pain_notes}</Text>
              )}
            </Reveal>
          )}

          {/* Recovery tomorrow + Coach message */}
          <Reveal mount={mount} delay={0.26} style={styles.bottomRow}>
            <>
              {data.recovery_pct != null && (
                <View style={styles.recoveryBlock}>
                  <RecoveryRing pct={data.recovery_pct} />
                  <Text variant="caption" color={COLORS.textMuted} align="center" style={{ lineHeight: 13 }}>Recovery{'\n'}Tomorrow</Text>
                </View>
              )}
              {!!data.coach_message && (
                <View style={styles.coachBlock}>
                  <Text variant="caption" weight="bold" color={COLORS.textDim} style={{ letterSpacing: 1.2 }}>COACH</Text>
                  <Text variant="body" color={COLORS.textSecondary} numberOfLines={2} style={{ lineHeight: 19 }}>{data.coach_message}</Text>
                </View>
              )}
            </>
          </Reveal>

          {/* Best set (fallback detail if present) */}
          {data.best_set && (
            <Reveal mount={mount} delay={0.34} style={styles.bestSet}>
              <>
                <Text variant="caption" weight="bold" color={COLORS.textDim} style={{ letterSpacing: 1.2, marginBottom: 4 }}>BEST SET</Text>
                <Text variant="body" weight="semibold" numeric color={COLORS.text} numberOfLines={1}>
                  {data.best_set.exercise}: {data.best_set.weight_kg}kg × {data.best_set.reps} reps
                  {data.best_set.rpe ? ` (RPE ${data.best_set.rpe})` : ''}
                </Text>
              </>
            </Reveal>
          )}

          <Reveal mount={mount} delay={0.42}>
            <Button
              label="Done"
              size="lg"
              fullWidth
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                onClose();
              }}
              style={{ marginTop: SPACING.xs }}
            />
          </Reveal>
        </Animated.View>
      </View>
    </Modal>
  );
}

const recStyles = StyleSheet.create({
  pct: { position: 'absolute', fontSize: 13 },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: RADIUS.card, borderTopRightRadius: RADIUS.card,
    padding: SPACING.xl, paddingTop: SPACING.md,
    borderTopWidth: 1, borderColor: COLORS.borderLight,
  },
  grabber: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border,
    alignSelf: 'center', marginBottom: SPACING.lg,
  },
  header: { alignItems: 'center', marginBottom: SPACING.lg },
  badgeGlow: {
    marginBottom: SPACING.sm,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 10,
  },
  badgeCircle: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { marginBottom: 4 },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around',
    backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card - 8, padding: SPACING.lg,
    marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  stat: { alignItems: 'center', minWidth: '40%', marginBottom: SPACING.sm, gap: 2 },
  statVal: { color: COLORS.primaryGreen, fontSize: 24, fontWeight: '800' },

  prList: { gap: SPACING.xs, marginBottom: SPACING.md },
  prRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.badge + 2,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
  },

  comparison: {
    marginTop: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 9,
  },
  comparisonHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  comparisonMetric: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  comparisonDelta: { alignItems: 'flex-end', gap: 2 },
  comparisonFooter: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 7 },
  planReview: {
    backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card - 8, padding: SPACING.md,
    marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.cardBorder, gap: SPACING.sm,
  },
  reviewHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  reviewStats: { flexDirection: 'row', gap: SPACING.lg },
  reviewStat: { flex: 1, gap: 2 },
  skippedRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingTop: 3 },
  checkin: { backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card - 8, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.cardBorder, gap: SPACING.xs },
  checkinRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  bottomRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card - 8, padding: SPACING.md,
    marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  recoveryBlock: { alignItems: 'center', gap: 6 },
  coachBlock: { flex: 1, gap: 4 },

  bestSet: {
    backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.badge + 2, padding: SPACING.md,
    marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.cardBorder,
  },
});

export default React.memo(WorkoutSummaryCard);
