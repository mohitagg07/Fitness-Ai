// VYRN — AI Coach Screen v3
// Full 7-card response system:
//   workout_plan  → WorkoutCard   (exercise table + rest + intensity)
//   live_set      → LiveSetCard   (set analysis + next action + insight)
//   nutrition_tip → NutritionCard (macro targets + advice)
//   recovery_advice→ RecoveryCard (score ring + tips)
//   progress_update→ ProgressCard (PR highlights + trend)
//   weekly_summary→ WeeklyCard   (7-day overview)
//   chat          → ChatBubble   (plain text + optional tips)
// The LLM returns structured JSON; the frontend picks the card.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, Linking,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, ScrollView, Animated, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import Svg, { Circle, Path, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { coachApi, describeApiError, nutritionApi, trainingPlanApi } from '../../utils/api';
import { useCoachChatStream } from '../../hooks/useCoachChatStream';
import { useMissionSummary } from '../../hooks/useDashboardQueries';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import { useStore } from '../../store';
import { COLORS, alpha, recoveryColor } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { RADIUS } from '../../theme/spacing';
import ProfileAvatar from '../shared/ProfileAvatar';
import AmbientGlow from '../shared/AmbientGlow';

import CoachMemoryModal from './CoachMemoryModal';
import PressableScale from '../ui/PressableScale';
import Reveal from '../shared/Reveal';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// ─── Suggestion chips shown on empty state ────────────────────────────────────
// Semantic color per topic (🟡 workout, 🔵 AI/logging, 🟢 recovery,
// 🟣 coach/health) instead of every icon defaulting to green — green
// should mean "recovery is good," not "this is a button."
const SUGGESTIONS = [
  { icon: 'barbell-outline', title: "Build today's workout", description: 'Use my goal, schedule, equipment and training history.', prompt: "What's my workout today?", color: COLORS.gold },
  { icon: 'time-outline', title: 'Fit training into my day', description: 'Adjust a session to my available time and equipment.', prompt: 'I only have 30 minutes today. Build a focused workout for me.', color: COLORS.strain },
  { icon: 'body-outline', title: 'Muscle gain & strength', description: 'Understand weekly training volume and progression.', prompt: 'Help me build muscle and improve strength. What should I focus on?', color: COLORS.recoveryHigh },
  { icon: 'walk-outline', title: 'Fat loss & activity', description: 'Plan sustainable training and activity habits.', prompt: 'Help me improve body composition using my actual progress data.', color: COLORS.coachPurple },
  { icon: 'fitness-outline', title: 'Exercise technique', description: 'Get cues for a specific movement or sticking point.', prompt: 'Help me understand the technique for my next exercise.', color: COLORS.strainGlow },
  { icon: 'nutrition-outline', title: 'Nutrition & protein', description: 'Use my logged meals and dietary preferences.', prompt: 'Review my protein and nutrition progress today.', color: COLORS.protein },
  { icon: 'water-outline', title: 'Hydration habits', description: 'Review water logging and build practical check-ins.', prompt: 'Help me build a hydration routine that fits my day.', color: COLORS.water },
  { icon: 'moon-outline', title: 'Sleep & recovery', description: 'Review sleep, fatigue and recovery signals.', prompt: 'How can I improve my sleep and recovery routine?', color: COLORS.recoveryMed },
  { icon: 'shield-checkmark-outline', title: 'Pain & safe training', description: 'Understand what to pause and when to seek assessment.', prompt: 'I have discomfort during training. Help me understand what information matters and what I should stop doing.', color: COLORS.recoveryLow },
  { icon: 'trending-up-outline', title: 'Progress & plateaus', description: 'Compare real logged sessions and spot trends.', prompt: 'Review my recent progress and help me understand whether I am plateauing.', color: COLORS.gold },
  { icon: 'calendar-outline', title: 'Consistency & habits', description: 'Use my schedule and patterns to make a realistic plan.', prompt: 'Help me build a realistic weekly fitness routine around my schedule.', color: COLORS.primaryGreen },
];

// ─── Exercise thumbnail visual ─────────────────────────────────────────────
// The coach has no licensed exercise photography to show, and reproducing
// real photos pulled from other sites isn't something this app can bundle
// (copyright). Instead each row gets a small original pictogram — hand-
// drawn here as simple line-art figures in the movement's pose (Olympic-
// pictogram style), on a two-tone gradient tile — so it reads as an actual
// demo visual rather than a generic outline icon in a flat box.
type ExercisePose = 'press' | 'row' | 'lateral' | 'curl' | 'tricep' | 'squat' | 'core';
const EXERCISE_VISUAL_RULES: Array<{ match: RegExp; pose: ExercisePose; from: string; to: string }> = [
  { match: /bench|chest|press|push.?up|fly/i,  pose: 'press',   from: COLORS.recoveryHigh, to: COLORS.movementTileEnd },
  { match: /row|pull|lat|back|deadlift/i,       pose: 'row',     from: COLORS.strain,       to: COLORS.movementTileEnd },
  { match: /shoulder|lateral|delt|overhead/i,   pose: 'lateral', from: COLORS.coachPurple,  to: COLORS.movementTileEnd },
  { match: /curl|bicep/i,                       pose: 'curl',    from: COLORS.recoveryMed,  to: COLORS.movementTileEnd },
  { match: /tricep|pushdown|dip/i,              pose: 'tricep',  from: COLORS.strainGlow,   to: COLORS.movementTileEnd },
  { match: /squat|leg|lunge|calf|glute|hip/i,   pose: 'squat',   from: COLORS.recoveryLow,  to: COLORS.movementTileEnd },
  { match: /plank|core|ab|crunch/i,             pose: 'core',    from: COLORS.water,        to: COLORS.movementTileEnd },
];
function exerciseVisual(name: string) {
  const found = EXERCISE_VISUAL_RULES.find(r => r.match.test(name || ''));
  return found || { pose: 'press' as ExercisePose, from: COLORS.recoveryHigh, to: COLORS.movementTileEnd };
}

// Minimal stick-figure pictograms — original line art, one per movement
// pattern. Deliberately abstract/geometric (Olympic-pictogram style) so it
// scans as "demo of the movement" without pretending to be a real photo.
function ExercisePictogram({ pose, color }: { pose: ExercisePose; color: string }) {
  const stroke = { stroke: color, strokeWidth: 3, strokeLinecap: 'round' as const, fill: 'none' };
  switch (pose) {
    case 'press': // lying, arms pressing a bar straight up
      return (
        <Svg width={22} height={22} viewBox="0 0 40 40">
          <Circle cx={10} cy={10} r={4} fill={color} />
          <Path d="M10 14 L26 22" {...stroke} />
          <Path d="M14 17 L14 8 M22 20 L22 11" {...stroke} />
          <Path d="M10 12 L30 4" {...stroke} />
        </Svg>
      );
    case 'row': // bent-over, pulling elbow back
      return (
        <Svg width={22} height={22} viewBox="0 0 40 40">
          <Circle cx={11} cy={9} r={4} fill={color} />
          <Path d="M11 13 L24 22 L20 33" {...stroke} />
          <Path d="M18 17 L30 15 L34 22" {...stroke} />
          <Path d="M24 22 L30 30" {...stroke} />
        </Svg>
      );
    case 'lateral': // standing, arms out horizontal
      return (
        <Svg width={22} height={22} viewBox="0 0 40 40">
          <Circle cx={20} cy={8} r={4} fill={color} />
          <Path d="M20 12 L20 26" {...stroke} />
          <Path d="M6 16 L20 16 L34 16" {...stroke} />
          <Path d="M20 26 L13 36 M20 26 L27 36" {...stroke} />
        </Svg>
      );
    case 'curl': // standing, forearm curled up to shoulder
      return (
        <Svg width={22} height={22} viewBox="0 0 40 40">
          <Circle cx={16} cy={8} r={4} fill={color} />
          <Path d="M16 12 L16 27 M16 27 L10 36 M16 27 L22 36" {...stroke} />
          <Path d="M16 16 L26 20 L20 8" {...stroke} />
        </Svg>
      );
    case 'tricep': // arm bent overhead, forearm dropping behind head
      return (
        <Svg width={22} height={22} viewBox="0 0 40 40">
          <Circle cx={18} cy={8} r={4} fill={color} />
          <Path d="M18 12 L18 27 M18 27 L12 36 M18 27 L24 36" {...stroke} />
          <Path d="M18 14 L28 10 L26 22" {...stroke} />
        </Svg>
      );
    case 'squat': // bent knees, low hip
      return (
        <Svg width={22} height={22} viewBox="0 0 40 40">
          <Circle cx={20} cy={7} r={4} fill={color} />
          <Path d="M20 11 L20 22" {...stroke} />
          <Path d="M20 22 L12 26 L12 36 M20 22 L28 26 L28 36" {...stroke} />
          <Path d="M8 18 L20 15 L32 18" {...stroke} />
        </Svg>
      );
    case 'core': // knees-up crunch
    default:
      return (
        <Svg width={22} height={22} viewBox="0 0 40 40">
          <Circle cx={8} cy={22} r={4} fill={color} />
          <Path d="M12 22 L24 22 L30 14" {...stroke} />
          <Path d="M24 22 L26 32" {...stroke} />
        </Svg>
      );
  }
}

// Wraps the static pictogram in a slow, continuous breathing loop (scale
// 1 → 1.08 → 1, ~1.6s) — reads as "this exercise is demonstrating a rep"
// rather than a frozen icon. This is the honest version of "demo gif" we
// can ship here: no licensed exercise photography/video exists to bundle
// (copyright), so the motion itself carries the "this is alive" signal
// instead of a fake photo would.
function AnimatedPictogram({ pose, color }: { pose: ExercisePose; color: string }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    breathe.stopAnimation();
    if (reduceMotion) {
      breathe.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, reduceMotion]);
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <ExercisePictogram pose={pose} color={color} />
    </Animated.View>
  );
}

function ExMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={C.exMetric}>
      <Text style={C.exMetricValue} numberOfLines={1}>{value}</Text>
      <Text style={C.exMetricLabel}>{label}</Text>
    </View>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────────
function CardShell({
  color,
  icon,
  label,
  accent,
  children,
}: {
  color: string;
  icon: string;
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[C.shell, { borderColor: accent + '40', backgroundColor: color }]}>
      <View style={[C.shellHeader, { borderBottomColor: accent + '25' }]}>
        <Ionicons name={icon as any} size={13} color={accent} />
        <Text style={[C.shellLabel, { color: accent }]}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function TipRow({ text, accent = COLORS.recoveryHigh }: { text: string; accent?: string }) {
  return (
    <View style={C.tipRow}>
      <View style={[C.tipDot, { backgroundColor: accent }]} />
      <Text style={C.tipText}>{text}</Text>
    </View>
  );
}

// ─── 1. Workout Plan Card ─────────────────────────────────────────────────────
function WorkoutCard({ sd, onStartWorkout }: { sd: any; onStartWorkout?: (plan: any) => void }) {
  const exercises = sd.exercises || [];
  const summary   = sd.summary   || {};
  const tips      = sd.tips      || [];

  const intColor = (i: string) => {
    if (!i) return COLORS.textMuted;
    if (i === 'High')     return COLORS.recoveryLow;
    if (i === 'Moderate') return COLORS.recoveryMed;
    return COLORS.recoveryHigh;
  };
  const ic = intColor(summary.intensity);

  return (
    <CardShell color={COLORS.card} icon="barbell-outline" label="TODAY'S WORKOUT" accent={COLORS.recoveryHigh}>
      {/* Intensity + meta row — plain icon+text pairs separated by a thin
          divider line, no filled pill/box backgrounds (matches the
          reference: label pairs in a row, not colored badges). */}
      <View style={C.wMeta}>
        <View style={C.metaItem}>
          <Ionicons name="speedometer-outline" size={13} color={ic} />
          <Text style={[C.metaItemText, { color: ic }]}>
            {summary.intensity?.toUpperCase() || 'PLANNED'}
          </Text>
        </View>
        {summary.estimated_time && (
          <>
            <View style={C.metaDivider} />
            <View style={C.metaItem}>
              <Ionicons name="time-outline" size={13} color={COLORS.textMuted} />
              <Text style={C.metaItemText}>{summary.estimated_time}</Text>
            </View>
          </>
        )}
        {sd.recovery != null && (
          <>
            <View style={C.metaDivider} />
            <View style={C.metaItem}>
              <Ionicons name="pulse-outline" size={13} color={recoveryColor(sd.recovery)} />
              <Text style={[C.metaItemText, { color: recoveryColor(sd.recovery) }]}>
                {sd.recovery}% match
              </Text>
            </View>
          </>
        )}
      </View>
      {/* No "Est. Calories" chip — the coach's workout-plan response doesn't
          return a calorie estimate (backend only computes calories_burned
          after a session is actually logged), so showing one here would be
          a made-up number rather than a real prediction. */}

      {/* Exercise list — one self-contained row per exercise (big demo
          tile, name, focus cue) with sets/reps/load/rest as a metric
          strip underneath. Previously this was a rigid 5-column table;
          on a 390px screen, a real exercise name + a "controlled descent"
          cue had nowhere to go and wrapped mid-word right through the
          numeric columns. Stacking fixes that structurally rather than
          just shrinking the font. */}
      <View style={C.tableWrap}>
        {exercises.map((ex: any, i: number) => {
          const visual = exerciseVisual(ex.name);
          return (
            <View key={i} style={[C.exRow, i % 2 === 1 && C.tableRowAlt]}>
              <View style={C.exHeaderRow}>
                <LinearGradient
                  colors={[alpha(visual.from, 0.35), visual.to]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={[C.exThumb, { borderColor: alpha(visual.from, 0.5) }]}
                >
                  <AnimatedPictogram pose={visual.pose} color={visual.from} />
                </LinearGradient>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={C.exName} numberOfLines={2}>{ex.name}</Text>
                  {ex.focus ? <Text style={C.exFocus} numberOfLines={1}>{ex.focus}</Text> : null}
                </View>
              </View>
              <View style={C.exMetricRow}>
                <ExMetric label="SETS" value={ex.sets} />
                <View style={C.exMetricDivider} />
                <ExMetric label="REPS" value={ex.reps} />
                <View style={C.exMetricDivider} />
                <ExMetric label="LOAD" value={ex.weight || '—'} />
                <View style={C.exMetricDivider} />
                <ExMetric label="REST" value={ex.rest || '—'} />
              </View>
            </View>
          );
        })}
      </View>

      {/* Reason */}
      {summary.reason ? (
        <View style={C.reasonRow}>
          <Text style={C.reasonText}>{summary.reason}</Text>
        </View>
      ) : null}

      {/* Tips */}
      {tips.length > 0 && (
        <View style={C.tipsBlock}>
          {tips.map((t: string, i: number) => <TipRow key={i} text={t} />)}
        </View>
      )}
      {exercises.length > 0 && (
        <View style={{ paddingHorizontal: 14, paddingTop: 13, paddingBottom: 14, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <Text style={{ color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 12, marginBottom: 9 }}>
            Ready to start with {exercises[0].name}?
          </Text>
          <PressableScale
            style={{ minHeight: 46, borderRadius: 14, backgroundColor: COLORS.primaryGreen, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 }}
            onPress={() => onStartWorkout?.(sd)}
            accessibilityRole="button"
            accessibilityLabel="Review this coach workout in Train"
          >
            <Ionicons name="barbell-outline" size={16} color={COLORS.background} />
            <Text style={{ color: COLORS.background, fontFamily: FONTS.bold, fontSize: 12 }}>Review session in Train</Text>
            <Ionicons name="arrow-forward" size={15} color={COLORS.background} />
          </PressableScale>
        </View>
      )}
    </CardShell>
  );
}

// ─── 2. Live Set Card ─────────────────────────────────────────────────────────
function LiveSetCard({ sd }: { sd: any }) {
  const tips = sd.tips || [];
  return (
    <CardShell color={COLORS.cardElevated} icon="flash" label="SET ANALYSIS" accent={COLORS.strainGlow}>
      {sd.next_action && (
        <View style={C.nextActionBlock}>
          <Text style={C.nextActionLabel}>NEXT ACTION</Text>
          <Text style={C.nextActionText}>{sd.next_action}</Text>
        </View>
      )}
      {tips.length > 0 && (
        <View style={C.tipsBlock}>
          {tips.map((t: string, i: number) => <TipRow key={i} text={t} accent={COLORS.strainGlow} />)}
        </View>
      )}
      {sd.coach_insight && (
        <View style={C.insightBlock}>
          <Text style={C.insightText}>"{sd.coach_insight}"</Text>
        </View>
      )}
    </CardShell>
  );
}

// ─── 3. Recovery Card ─────────────────────────────────────────────────────────
function RecoveryCard({ sd }: { sd: any }) {
  const score = sd.recovery ?? 0;
  const rc    = recoveryColor(score);
  const tips  = sd.tips || [];
  const label = score >= 67 ? 'HIGH' : score >= 34 ? 'MEDIUM' : 'LOW';

  return (
    <CardShell color={COLORS.cardElevated} icon="pulse-outline" label="RECOVERY STATUS" accent={COLORS.strain}>
      <View style={C.recoveryBody}>
        {/* Score block */}
        <View style={C.recoveryScoreBlock}>
          <Text style={[C.recoveryScoreNum, { color: rc }]}>{score}</Text>
          <Text style={C.recoveryScoreUnit}>%</Text>
          <View style={[C.recoveryZonePill, { backgroundColor: rc + '22', borderColor: rc + '66' }]}>
            <Text style={[C.recoveryZoneText, { color: rc }]}>{label}</Text>
          </View>
        </View>
        {/* Divider */}
        <View style={C.recoveryDivider} />
        {/* Tips */}
        <View style={C.recoveryTips}>
          {tips.length > 0
            ? tips.map((t: string, i: number) => <TipRow key={i} text={t} accent={COLORS.strain} />)
            : <Text style={C.emptyTip}>No specific recommendations today.</Text>
          }
        </View>
      </View>
    </CardShell>
  );
}

// ─── 4. Nutrition Card ────────────────────────────────────────────────────────
function NutritionCard({ sd, onOpenNutrition }: { sd: any; onOpenNutrition?: () => void }) {
  const tips = sd.tips || [];
  const today = sd.nutrition_today || {};
  const consumed = today.consumed || {};
  const targets = today.targets || {};
  const remaining = today.remaining || {};
  const plans = Array.isArray(sd.meal_plan) ? sd.meal_plan : [];

  return (
    <CardShell color={COLORS.cardElevated} icon="nutrition-outline" label="TODAY'S FOOD PLAN" accent={COLORS.calories}>
      {Object.keys(targets).length > 0 && (
        <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
          <Text style={{ color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 9, letterSpacing: 1.2, marginBottom: 8 }}>
            DAILY TARGETS AND REMAINING
          </Text>
          <View style={C.macroRow}>
            <View style={C.macroChip}>
              <Text style={[C.macroVal, { color: COLORS.calories }]}>{Math.round(consumed.calories || 0)} / {Math.round(targets.calories || 0)}</Text>
              <Text style={C.macroLabel}>KCAL</Text>
            </View>
            <View style={C.macroChip}>
              <Text style={[C.macroVal, { color: COLORS.protein }]}>{Math.round(consumed.protein_g || 0)} / {Math.round(targets.protein_g || 0)}g</Text>
              <Text style={C.macroLabel}>PROTEIN</Text>
            </View>
            <View style={C.macroChip}>
              <Text style={[C.macroVal, { color: COLORS.carbs }]}>{Math.round(consumed.carbs_g || 0)} / {Math.round(targets.carbs_g || 0)}g</Text>
              <Text style={C.macroLabel}>CARBS</Text>
            </View>
            <View style={C.macroChip}>
              <Text style={[C.macroVal, { color: COLORS.fat }]}>{Math.round(consumed.fat_g || 0)} / {Math.round(targets.fat_g || 0)}g</Text>
              <Text style={C.macroLabel}>FAT</Text>
            </View>
          </View>
          <Text style={{ color: COLORS.textSecondary, fontFamily: FONTS.medium, fontSize: 11, marginTop: 7, marginBottom: 4 }}>
            Remaining: {Math.round(remaining.calories || 0)} kcal · {Math.round(remaining.protein_g || 0)}g protein · {Math.round(remaining.carbs_g || 0)}g carbs
          </Text>
          {today.nutrition_target_source === 'estimated_defaults' && (
            <Text style={C.estimateNotice}>
              These targets are estimates because your profile is missing {Array.isArray(today.missing_measurements)
                ? today.missing_measurements.map((item: string) => item.replace(/_/g, ' ')).join(', ')
                : 'required measurements'}. Complete your Profile measurements to personalise them.
            </Text>
          )}
        </View>
      )}
      {plans.length > 0 ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 12, gap: 10 }}>
          <Text style={{ color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 9, letterSpacing: 1.2 }}>
            SUGGESTED MEALS FOR THE REST OF TODAY
          </Text>
          {plans.map((meal: any, index: number) => (
            <View key={meal.meal || index} style={{ borderTopWidth: index === 0 ? 0 : 1, borderTopColor: COLORS.border, paddingTop: index === 0 ? 0 : 10 }}>
              <Text style={{ color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13, marginBottom: 5 }}>{meal.meal}</Text>
              {(meal.items || []).map((item: any, itemIndex: number) => (
                <Text key={itemIndex} style={{ color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 17 }}>
                  {item.grams}g {item.food}
                </Text>
              ))}
              <Text style={{ color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 10, marginTop: 4 }}>
                Approx. {meal.approx_protein_g || 0}g protein · {meal.approx_carbs_g || 0}g carbs
              </Text>
            </View>
          ))}
          <Text style={{ color: COLORS.textDim, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15 }}>
            Portions are estimates. Confirm your food and serving in Nutrition before logging.
          </Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
          <Text style={{ color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 17 }}>
            {sd.nutrition_data_unavailable
              ? 'Today’s intake could not be loaded. Open Nutrition to refresh your targets and food log.'
              : sd.meal_plan_unavailable
                ? 'Your intake is available, but meal suggestions could not be prepared. Open Nutrition to review your remaining targets.'
                : 'Your remaining macro gap does not require another meal suggestion right now.'}
          </Text>
        </View>
      )}
      {tips.length > 0 && (
        <View style={C.tipsBlock}>
          {tips.map((t: string, i: number) => <TipRow key={i} text={t} accent={COLORS.calories} />)}
        </View>
      )}
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, borderTopWidth: 1, borderTopColor: COLORS.border }}>
        <PressableScale
          style={{ minHeight: 46, borderRadius: 14, backgroundColor: COLORS.primaryGreen, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 }}
          onPress={onOpenNutrition}
          accessibilityRole="button"
          accessibilityLabel="Open Nutrition to log food and review daily intake"
        >
          <Ionicons name="restaurant-outline" size={16} color={COLORS.background} />
          <Text style={{ color: COLORS.background, fontFamily: FONTS.bold, fontSize: 12 }}>Open Nutrition & log food</Text>
          <Ionicons name="arrow-forward" size={15} color={COLORS.background} />
        </PressableScale>
      </View>
    </CardShell>
  );
}
// ─── 5. Progress / PR Card ────────────────────────────────────────────────────
function ProgressCard({ sd }: { sd: any }) {
  const tips = sd.tips || [];
  const prs  = sd.new_prs || sd.prs || [];

  return (
    <CardShell color={COLORS.cardElevated} icon="trophy-outline" label="PROGRESS UPDATE" accent={COLORS.recoveryBlue}>
      {prs.length > 0 && (
        <View style={C.prBlock}>
          <Text style={C.prBlockLabel}>NEW PRs</Text>
          {prs.map((pr: any, i: number) => (
            <View key={i} style={C.prRow}>
              <Ionicons name="trophy" size={14} color={COLORS.gold} />
              <Text style={C.prText}>
                {pr.exercise_name || pr.exercise}: {pr.weight_kg || pr.weight} kg × {pr.reps} reps
              </Text>
            </View>
          ))}
        </View>
      )}
      {sd.trend && (
        <View style={C.trendRow}>
          <Ionicons
            name={sd.trend === 'up' ? 'trending-up' : sd.trend === 'down' ? 'trending-down' : 'remove'}
            size={18}
            color={sd.trend === 'up' ? COLORS.recoveryHigh : sd.trend === 'down' ? COLORS.recoveryLow : COLORS.textMuted}
          />
          <Text style={C.trendText}>{sd.trend_label || sd.trend}</Text>
        </View>
      )}
      {tips.length > 0 && (
        <View style={C.tipsBlock}>
          {tips.map((t: string, i: number) => <TipRow key={i} text={t} accent={COLORS.recoveryBlue} />)}
        </View>
      )}
    </CardShell>
  );
}

// ─── 6. Weekly Summary Card ───────────────────────────────────────────────────
function WeeklyCard({ sd }: { sd: any }) {
  const days  = sd.days  || [];
  const stats = sd.stats || {};
  const tips  = sd.tips  || [];

  return (
    <CardShell color={COLORS.card} icon="calendar-outline" label="WEEKLY SUMMARY" accent={COLORS.strain}>
      {/* Stat pills */}
      {Object.keys(stats).length > 0 && (
        <View style={C.weeklyStats}>
          {stats.sessions != null && (
            <View style={C.weeklyStatChip}>
              <Text style={C.weeklyStatVal}>{stats.sessions}</Text>
              <Text style={C.weeklyStatLabel}>SESSIONS</Text>
            </View>
          )}
          {stats.total_volume_kg != null && (
            <View style={C.weeklyStatChip}>
              <Text style={C.weeklyStatVal}>{Math.round(stats.total_volume_kg / 1000)}t</Text>
              <Text style={C.weeklyStatLabel}>VOLUME</Text>
            </View>
          )}
          {stats.avg_recovery != null && (
            <View style={C.weeklyStatChip}>
              <Text style={[C.weeklyStatVal, { color: recoveryColor(stats.avg_recovery) }]}>
                {stats.avg_recovery}%
              </Text>
              <Text style={C.weeklyStatLabel}>AVG REC</Text>
            </View>
          )}
          {stats.protein_days != null && (
            <View style={C.weeklyStatChip}>
              <Text style={C.weeklyStatVal}>{stats.protein_days}/7</Text>
              <Text style={C.weeklyStatLabel}>PROTEIN</Text>
            </View>
          )}
        </View>
      )}
      {/* Day-by-day mini view */}
      {days.length > 0 && (
        <View style={C.weekDays}>
          {days.map((d: any, i: number) => (
            <View key={i} style={C.weekDay}>
              <Text style={C.weekDayLabel}>{d.label || d.day}</Text>
              <View style={[
                C.weekDayDot,
                { backgroundColor: d.trained ? COLORS.recoveryHigh : d.rest ? COLORS.textDim : COLORS.recoveryLow }
              ]} />
            </View>
          ))}
        </View>
      )}
      {tips.length > 0 && (
        <View style={C.tipsBlock}>
          {tips.map((t: string, i: number) => <TipRow key={i} text={t} accent={COLORS.strain} />)}
        </View>
      )}
    </CardShell>
  );
}

// ─── 7. Chat bubble tips (fallback) ──────────────────────────────────────────
function ChatTipsCard({ tips }: { tips: string[] }) {
  if (!tips.length) return null;
  return (
    <View style={C.chatTipsCard}>
      {tips.map((t, i) => <TipRow key={i} text={t} />)}
    </View>
  );
}

// ─── Message renderer — picks the right card ──────────────────────────────────
// Memoized deliberately at this level rather than on each of the 7 card
// types below it — CoachMessage is the actual per-row render FlashList
// calls, so gating re-renders here means WorkoutCard/LiveSetCard/etc.
// never re-render on a screen-level state change (e.g. typing in the
// input box) unless the message item itself is new.
const CoachMessage = React.memo(function CoachMessage({
  item,
  onSelectOption,
  showQuestion,
  onStartWorkout,
  onOpenNutrition,
}: {
  item: any;
  onSelectOption?: (option: string) => void;
  showQuestion?: boolean;
  onStartWorkout?: (plan: any) => void;
  onOpenNutrition?: () => void;
}) {
  const sd = item.structured_decision;
  const coachText = sd?.coach_message || item.content || '';

  const renderCard = () => {
    if (!sd) return null;
    switch (sd.response_type) {
      case 'workout_plan':    return (sd.exercises?.length > 0) ? <WorkoutCard sd={sd} onStartWorkout={onStartWorkout} /> : null;
      case 'live_set':        return <LiveSetCard   sd={sd} />;
      case 'recovery_advice': return <RecoveryCard  sd={sd} />;
      case 'nutrition_tip':   return <NutritionCard sd={sd} onOpenNutrition={onOpenNutrition} />;
      case 'progress_update': return <ProgressCard  sd={sd} />;
      case 'weekly_summary':  return <WeeklyCard    sd={sd} />;
      default:
        return (sd.tips?.length > 0) ? <ChatTipsCard tips={sd.tips} /> : null;
    }
  };

  return (
    <>
      {coachText ? <Text style={S.messageText}>{coachText}</Text> : null}
      {renderCard()}
      {Array.isArray(sd?.knowledge_sources) && sd.knowledge_sources.length > 0 && (
        <View style={S.sourcesBlock}>
          <Text style={S.sourcesLabel}>EVIDENCE USED</Text>
          {sd.knowledge_sources.slice(0, 4).map((source: any, index: number) => (
            <PressableScale
              key={String(source.url || index)}
              accessibilityRole="link"
              onPress={() => {
                if (typeof source.url === 'string' && source.url.startsWith('https://')) {
                  void Linking.openURL(source.url).catch(() => undefined);
                }
              }}
              style={S.sourceLink}
            >
              <Ionicons name="open-outline" size={12} color={COLORS.primaryGreen} />
              <Text style={S.sourceText}>{source.title || 'Read source'}</Text>
            </PressableScale>
          ))}
        </View>
      )}
      {showQuestion && sd?.follow_up_question && (
        <View style={S.questionCard}>
          <Text style={S.questionPrompt}>{sd.follow_up_question}</Text>
          {Array.isArray(sd?.question_options) && sd.question_options.length > 0 && (
            <View style={S.questionOptions}>
              {sd.question_options.slice(0, 5).map((option: string, index: number) => (
                <PressableScale
                  key={`${sd.question_key || 'question'}-${index}`}
                  accessibilityRole="button"
                  onPress={() => onSelectOption?.(option)}
                  style={S.questionOption}
                >
                  <Text style={S.questionOptionText}>{option}</Text>
                  <Ionicons name="chevron-forward" size={15} color={COLORS.primaryGreen} />
                </PressableScale>
              ))}
            </View>
          )}
        </View>
      )}
    </>
  );
});

// ─── Loading animation dots ───────────────────────────────────────────────────
function ThinkingDots() {
  const [dot, setDot] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDot(d => (d + 1) % 4), 420);
    return () => clearInterval(t);
  }, []);
  const dots = '.'.repeat(dot) + '\u00A0'.repeat(3 - dot);
  return (
    <View style={S.thinkingRow}>
      <View style={S.thinkingAvatar}>
        <Ionicons name="flash" size={12} color={COLORS.recoveryHigh} />
      </View>
      <View style={S.thinkingBubble}>
        <Text style={S.thinkingText}>Coach is thinking{dots}</Text>
      </View>
    </View>
  );
}

// ─── Offline/fallback responses when backend is unreachable ──────────────────
// Connection failures are reported honestly; the coach never substitutes generic advice
// for a personalised answer based on unavailable profile or training data.

// ─── Small numeric badge used in the header briefing strip ───────────────────
function trainingWindowStatus(trainingTime: any): string {
  if (!trainingTime?.display_label) return 'SET A PREFERRED TIME';
  if (trainingTime?.source === 'training_history') return 'USUAL TIME';
  const hour = new Date().getHours();
  const windows: Record<string, [number, number]> = {
    morning: [6, 10],
    afternoon: [12, 16],
    evening: [17, 21],
  };
  const range = windows[String(trainingTime.period || '')];
  if (!range) return 'PREFERRED WINDOW';
  if (hour >= range[0] && hour < range[1]) return 'WINDOW OPEN';
  return hour < range[0] ? 'UP NEXT' : 'PASSED FOR TODAY';
}

function weekdayKeyLocal(): string {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CoachScreen() {
  const responsive = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const [input, setInput]   = useState('');
  const [serverStatus, setServerStatus] = useState<'online' | 'offline' | 'unknown'>('unknown');
  const [memoryVisible, setMemoryVisible] = useState(false);
  const [isEnrichingResponse, setIsEnrichingResponse] = useState(false);
  // Real recovery/CNS numbers for the header briefing strip — reuses the
  // same summary endpoint the Dashboard uses, so the two screens never
  // disagree about "how am I today". No fabricated Sleep/Readiness rings
  // here since the backend doesn't return those as distinct scores.
  const [brief, setBrief] = useState<{ recoveryScore: number; cnsFatigue: number; message: string } | null>(null);
  const [todaysPrescription, setTodaysPrescription] = useState<any | null>(null);
  const [trainingPlanLoaded, setTrainingPlanLoaded] = useState(false);
  const flatListRef = useRef<FlashListRef<any>>(null);
  // Selector form — see src/store/index.ts. CoachScreen needs chatHistory/
  // profile/user, but previously re-rendered on every store
  // update including ones it never reads (e.g. Dashboard calling
  // setCnsFatigue, or ProfileScreen editing injuries) since useStore()
  // subscribed to the whole store unconditionally.
  const {
    chatHistory, addChatMessage, hydrateChatHistory, setCnsFatigue,
    activeSession, setPendingCoachWorkout, profile,
  } = useStore((s) => ({
    chatHistory: s.chatHistory,
    addChatMessage: s.addChatMessage,
    hydrateChatHistory: s.hydrateChatHistory,
    setCnsFatigue: s.setCnsFatigue,
    activeSession: s.activeSession,
    setPendingCoachWorkout: s.setPendingCoachWorkout,
    profile: s.profile,
  }));

  // Restore conversation history from Supabase when the Coach tab opens.
  // The store guard prevents a slow history request from overwriting a new
  // message the athlete sends while the request is still in flight.
  useEffect(() => {
    let cancelled = false;

    // The Coach tab is one continuous conversation. Do not use the active
    // workout session ID as a chat session ID; workout and chat lifecycles
    // are independent.
    coachApi.getHistory(50)
      .then((res) => {
        if (cancelled || !Array.isArray(res.data)) return;
        const restored = res.data
          .filter((row: any) =>
            (row?.role === 'user' || row?.role === 'assistant') &&
            typeof row?.content === 'string'
          )
          .map((row: any) => ({
            role: row.role as 'user' | 'assistant',
            content: row.content,
            timestamp: row.created_at ? new Date(row.created_at) : new Date(),
            structured_decision: row.metadata?.structured_decision ?? null,
          }));
        hydrateChatHistory(restored);
      })
      .catch((err) => {
        if (__DEV__) console.warn('[Coach] Could not restore chat history', err?.message || err);
      });

    return () => { cancelled = true; };
  }, [hydrateChatHistory]);

  // PERF: previously an independent useEffect fetch of the exact same
  // mission/dashboard summary DashboardScreen also fetches — meaning
  // switching Home -> Coach fired a second identical network request for
  // data that had usually just loaded seconds earlier. Sharing the query
  // key (qk.dashboard.mission()) means whichever tab loads first
  // populates the cache for both, and the other reads it instantly with
  // no request at all when still fresh (staleTime: 60s).
  const { data: missionSummary } = useMissionSummary();
  useEffect(() => {
    if (!missionSummary) return;
    setBrief({
      recoveryScore: missionSummary.recovery?.score_pct ?? (missionSummary.recovery?.score ?? 0) * 10,
      cnsFatigue: (missionSummary.cns_fatigue ?? 0) * 10,
      message: missionSummary.recovery?.message || "Recovery data will show up here once you've logged a session.",
    });
  }, [missionSummary]);

  useEffect(() => {
    let cancelled = false;
    setTrainingPlanLoaded(false);
    trainingPlanApi.getActive()
      .then((response) => {
        if (cancelled) return;
        const version = response.data?.version;
        const approved = version?.status === 'approved';
        const snapshot = approved ? (version.snapshot || {}) : {};
        const todayKey = weekdayKeyLocal();
        const schedule = approved
          ? (snapshot.schedule || response.data?.plan?.schedule || {})
          : {};
        const workoutType = String(missionSummary?.workout_today?.type || schedule[todayKey] || '').toLowerCase();
        const dayPrescription = snapshot.workouts_by_day?.[todayKey] || null;
        const singlePrescription = !Object.keys(schedule).length ? snapshot.workout || null : null;
        const prescription = workoutType === 'rest' ? null : (dayPrescription || singlePrescription);
        setTodaysPrescription(prescription);
        setTrainingPlanLoaded(true);

        // Local reminders are rebuilt only from an approved weekly plan and
        // the athlete's selected time preference. The helper no-ops on web,
        // respects notification permission and removes stale reminders first.
        const reminderPreference = (missionSummary as any)?.training_time?.source === 'profile_preference'
          ? profile?.workout_time_preference
          : null;
        void import('../../utils/pushNotifications')
          .then(({ syncTrainingWindowReminders }) => (
            syncTrainingWindowReminders(reminderPreference, schedule)
          ))
          .catch((error) => {
            if (__DEV__) console.warn('[Coach] Training reminders could not be synced', error);
          });
      })
      .catch(() => {
        if (!cancelled) {
          setTodaysPrescription(null);
          setTrainingPlanLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, [missionSummary?.generated_at, missionSummary?.workout_today?.type, profile?.workout_time_preference]);

  // Streaming reply: chunks arrive over SSE and accumulate in
  // `streamingText`, rendered as a live "still typing" bubble (see
  // renderMessage below) instead of one big text block appearing after
  // the full round trip. The final `done` event carries the exact same
  // payload shape /chat used to return, so cns_fatigue/emergency/new_prs
  // handling below is unchanged from the non-streaming version.
  const pendingUserMessageRef = useRef<string | null>(null);
  const { send: sendStream, isStreaming, streamingText } = useCoachChatStream({
    onDone: async (data) => {
      pendingUserMessageRef.current = null;
      setServerStatus('online');
      let structured = data.structured_decision || null;
      if (structured?.response_type === 'nutrition_tip') {
        setIsEnrichingResponse(true);
        try {
          const [todayResult, planResult] = await Promise.allSettled([
            nutritionApi.getToday(),
            nutritionApi.getMealPlan(undefined, new Date().getHours()),
          ]);
          structured = {
            ...structured,
            ...(todayResult.status === 'fulfilled'
              ? { nutrition_today: todayResult.value.data }
              : { nutrition_data_unavailable: true }),
            ...(planResult.status === 'fulfilled'
              ? { meal_plan: Array.isArray(planResult.value.data?.plans) ? planResult.value.data.plans : [] }
              : { meal_plan_unavailable: true }),
          };
          if (todayResult.status === 'rejected' || planResult.status === 'rejected') {
            if (__DEV__) console.warn('[Coach] Some nutrition context could not be loaded');
          }
        } finally {
          setIsEnrichingResponse(false);
        }
      }
      addChatMessage('assistant', data.reply, structured);
      if (data.cns_fatigue_score != null) setCnsFatigue(data.cns_fatigue_score);
      if (data.emergency) {
        Alert.alert('Training Stopped', 'Injury signal detected. See the message below.', [
          { text: 'Understood', style: 'default' },
        ]);
      }
    },
    onError: (message) => {
      const pendingMessage = pendingUserMessageRef.current;
      pendingUserMessageRef.current = null;
      setServerStatus('offline');
      const detail = pendingMessage
        ? 'I could not complete that coaching request. Your logged data has not been changed. Please try again when the connection is available.'
        : message;
      addChatMessage('assistant', detail);
    },
  });
  // The stream hook owns connection, auth, cancellation and error settlement.

  const startWorkoutFromCoach = useCallback((plan: any) => {
    if (missionSummary?.recovery?.action === 'pain_review') {
      Alert.alert(
        'Review pain before training',
        missionSummary.recovery.message || 'Your recent post-workout check-in reported sharp or worsening pain. Do not repeat the movement that caused it. Keep the approved plan unchanged while you review the symptoms.',
      );
      return;
    }
    if (activeSession) {
      Alert.alert(
        'Workout already in progress',
        'Continue your current session in Train. Finish it before starting another plan.',
      );
      router.push('/(tabs)/workout');
      return;
    }
    setPendingCoachWorkout(plan);
    router.push('/(tabs)/workout');
  }, [activeSession, missionSummary?.recovery?.action, missionSummary?.recovery?.message, setPendingCoachWorkout]);

  const openNutritionFromCoach = useCallback(() => {
    router.push({ pathname: '/(tabs)/nutrition', params: { openLog: '1' } } as any);
  }, []);

  const sendMessage = useCallback((text?: string) => {
    const message = text || input.trim();
    if (!message || isStreaming || isEnrichingResponse) return;

    setInput('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    addChatMessage('user', message);
    pendingUserMessageRef.current = message;

    void sendStream(message);
  }, [input, isStreaming, isEnrichingResponse, addChatMessage, sendStream]);

  useEffect(() => {
    if (chatHistory.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chatHistory.length]);

  // Keep the message renderer stable while still exposing current question choices.
  const renderMessage = useCallback(({ item, index }: { item: any; index: number }) => (
    <View style={[S.bubble, item.role === 'user' ? S.userBubble : S.aiBubble]}>
      {item.role === 'assistant' && (
        <View style={S.roleLabelRow}>
          <Ionicons name="flash" size={10} color={COLORS.recoveryHigh} />
          <Text style={S.roleLabel}>COACH</Text>
        </View>
      )}
      {item.role === 'assistant'
        ? (
          <CoachMessage
            item={item}
            onSelectOption={sendMessage}
            onStartWorkout={startWorkoutFromCoach}
            onOpenNutrition={openNutritionFromCoach}
            showQuestion={index === chatHistory.length - 1}
          />
        )
        : <Text style={[S.messageText, S.userText]}>{item.content}</Text>
      }
    </View>
  ), [sendMessage, startWorkoutFromCoach, openNutritionFromCoach, chatHistory.length]);

  return (
    <KeyboardAvoidingView
      style={[S.container, { width: '100%', maxWidth: responsive.pageMaxWidth, alignSelf: 'center' }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <AmbientGlow variant="coach" />
      {/* Header */}
      <View style={[S.header, { paddingTop: insets.top + 12 }]}>
        <View style={S.headerTopRow}>
          <ProfileAvatar size={40} onPress={() => router.push('/(tabs)/profile')} />
          <View style={S.headerTitleCol}>
            <View style={S.headerTitleRow}>
              <Text style={S.headerTitle}>Coach</Text>
              <View style={S.proBadge}>
                <Text style={S.proBadgeText}>PERSONAL COACH</Text>
              </View>
            </View>
            <Text style={S.headerSub}>Your training, in context</Text>
          </View>
          <View style={S.headerIcons}>
            <PressableScale hitSlop={10} onPress={() => setMemoryVisible(true)} accessibilityRole="button" accessibilityLabel="Open coach memory">
              <Ionicons name="bookmark-outline" size={21} color={COLORS.textSecondary} />
            </PressableScale>
          </View>
        </View>

        {/* Recovery/CNS briefing — avatar tile (initials, since there's no
            uploaded profile photo to show) + greeting + three live signal
            rings. Readiness is a transparent composite of the two real
            numbers next to it (not a separate fabricated metric) so all
            three rings stay honest about what data backs them. */}
        {brief && (
          <View style={S.briefCard}>
            <Ionicons name="pulse-outline" size={14} color={COLORS.recoveryHigh} />
            <Text style={S.briefContextTitle}>TODAY'S CONTEXT</Text>
            <View style={S.briefDividerVertical} />
            <Text style={S.briefMetricInline}>Recovery <Text style={{ color: recoveryColor(brief.recoveryScore) }}>{Math.round(brief.recoveryScore)}</Text></Text>
            <View style={S.briefDividerVertical} />
            <Text style={S.briefMetricInline}>CNS load <Text style={{ color: brief.cnsFatigue <= 30 ? COLORS.recoveryHigh : brief.cnsFatigue <= 60 ? COLORS.recoveryMed : COLORS.recoveryLow }}>{Math.round(brief.cnsFatigue)}</Text></Text>
          </View>
        )}
        <View style={S.dailyBriefCard}>
          <View style={S.dailyBriefTop}>
            <View style={S.dailyBriefEyebrowRow}>
              <View style={S.dailyBriefLiveDot} />
              <Text style={S.dailyBriefEyebrow}>YOUR COACH · DAILY BRIEF</Text>
            </View>
            <Text style={S.dailyBriefStatus}>
              {missionSummary?.recovery?.action === 'pain_review'
                ? 'PAIN REVIEW'
                : missionSummary?.recovery?.action === 'rest'
                  ? 'RECOVERY DAY'
                  : trainingWindowStatus((missionSummary as any)?.training_time)}
            </Text>
          </View>
          <Text style={S.dailyBriefTitle}>
            {(missionSummary as any)?.mission
              || (missionSummary as any)?.workout_today?.type?.replace(/_/g, ' ')?.replace(/\b\w/g, (m: string) => m.toUpperCase())
              || 'Your training direction'}
          </Text>
          <Text style={S.dailyBriefMessage}>
            {(missionSummary as any)?.proactive_brief?.coach_message
              || (missionSummary as any)?.proactive_brief?.todays_focus
              || (missionSummary as any)?.workout_today?.message
              || 'Your coach will update this briefing when your training and recovery data is available.'}
          </Text>
          {(missionSummary as any)?.workout_today?.rescheduled ? (
            <View style={S.dailyBriefScheduleNotice}>
              <Ionicons name="calendar-outline" size={14} color={COLORS.recoveryMed} />
              <Text style={S.dailyBriefScheduleNoticeText}>
                This recommendation accounts for a missed session. Your approved weekly schedule has not been changed; any adjustment still needs your approval.
              </Text>
            </View>
          ) : null}
          {(missionSummary as any)?.proactive_brief?.why_summary ? (
            <View style={S.dailyBriefWhy}>
              <Text style={S.dailyBriefWhyLabel}>WHY THIS RECOMMENDATION</Text>
              <Text style={S.dailyBriefWhyText}>{(missionSummary as any).proactive_brief.why_summary}</Text>
            </View>
          ) : null}

          <View style={S.dailyBriefSchedule}>
            <View style={S.dailyBriefScheduleIcon}>
              <Ionicons name="time-outline" size={16} color={COLORS.primaryGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.dailyBriefScheduleLabel}>
                {(missionSummary as any)?.training_time?.source === 'training_history'
                  ? 'USUAL START TIME'
                  : 'PREFERRED TRAINING WINDOW'}
              </Text>
              <Text style={S.dailyBriefScheduleTime}>
                {(missionSummary as any)?.training_time?.display_label || 'Not set in your profile'}
              </Text>
              <Text style={S.dailyBriefScheduleNote}>
                {(missionSummary as any)?.training_time?.display_label
                  ? (missionSummary as any)?.training_time?.note
                    || 'A suggested window based on your profile preference, not a booked appointment.'
                  : 'Choose morning, afternoon or evening in your profile to personalise timing.'}
              </Text>
              {!(missionSummary as any)?.training_time?.display_label ? (
                <PressableScale
                  style={S.dailyBriefSetTime}
                  onPress={() => router.push('/(tabs)/profile')}
                  accessibilityRole="button"
                  accessibilityLabel="Set preferred training time in Profile"
                >
                  <Text style={S.dailyBriefSetTimeText}>Set training window</Text>
                  <Ionicons name="arrow-forward" size={13} color={COLORS.primaryGreen} />
                </PressableScale>
              ) : null}
            </View>
          </View>

          {Array.isArray(todaysPrescription?.exercises) && todaysPrescription.exercises.length > 0 ? (
            <View style={S.dailyBriefExercises}>
              <Text style={S.dailyBriefExercisesTitle}>TODAY'S PRESCRIBED SESSION</Text>
              {todaysPrescription.exercises.slice(0, 3).map((exercise: any, index: number) => (
                <View key={exercise.exercise_id || exercise.name || index} style={S.dailyBriefExerciseRow}>
                  <View style={S.dailyBriefExerciseIndex}><Text style={S.dailyBriefExerciseIndexText}>{String(index + 1).padStart(2, '0')}</Text></View>
                  <Text style={S.dailyBriefExerciseName} numberOfLines={1}>{exercise.name}</Text>
                  <Text style={S.dailyBriefExerciseTarget}>{exercise.sets} × {exercise.reps}</Text>
                </View>
              ))}
              {todaysPrescription.exercises.length > 3 ? (
                <Text style={S.dailyBriefMoreExercises}>+ {todaysPrescription.exercises.length - 3} more movements in your session</Text>
              ) : null}
            </View>
          ) : trainingPlanLoaded && missionSummary?.workout_today?.type && missionSummary.workout_today.type !== 'rest' ? (
            <Text style={S.dailyBriefPlanNote}>Your training day is set. Open Train to review the active prescription or prepare a session.</Text>
          ) : null}

          <View style={S.dailyBriefActions}>
            <PressableScale
              style={S.dailyBriefPrimary}
              onPress={() => {
                if (missionSummary?.recovery?.action === 'pain_review') {
                  Alert.alert(
                    'Training paused for review',
                    missionSummary.recovery.message || 'Do not repeat the movement that caused the reported pain. Keep the approved plan unchanged while you review the symptoms.',
                  );
                  return;
                }
                router.push('/(tabs)/workout');
              }}
              accessibilityRole="button"
              accessibilityLabel={
                missionSummary?.recovery?.action === 'pain_review'
                  ? 'Read pain-related training guidance'
                  : activeSession ? 'Continue current workout' : 'Review today’s training session'
              }
            >
              <Ionicons
                name={missionSummary?.recovery?.action === 'pain_review'
                  ? 'shield-checkmark-outline'
                  : activeSession ? 'play' : 'barbell-outline'}
                size={15}
                color={COLORS.background}
              />
              <Text style={S.dailyBriefPrimaryText}>
                {missionSummary?.recovery?.action === 'pain_review'
                  ? 'Read guidance'
                  : activeSession ? 'Continue session' : 'Review in Train'}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.background} />
            </PressableScale>
            <PressableScale
              style={S.dailyBriefSecondary}
              onPress={openNutritionFromCoach}
              accessibilityRole="button"
              accessibilityLabel="Open nutrition and log food"
            >
              <Ionicons name="nutrition-outline" size={15} color={COLORS.text} />
              <Text style={S.dailyBriefSecondaryText}>Food</Text>
            </PressableScale>
          </View>
        </View>
      </View>
      <CoachMemoryModal visible={memoryVisible} onClose={() => setMemoryVisible(false)} />

      {/* Offline warning banner */}
      {serverStatus === 'offline' && (
        <View style={S.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={13} color={COLORS.recoveryMed} />
          <Text style={S.offlineBannerText}>
            Coach is offline. Your request could not be completed; reconnect to continue.
          </Text>
        </View>
      )}

      {/* Empty state */}
      {chatHistory.length === 0 ? (
        <ScrollView style={S.emptyScroll} contentContainerStyle={S.emptyContent} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
          <View style={S.emptyHero}>
            <View style={S.coachOrb}>
              <View style={S.coachOrbInner}>
                <ProfileAvatar size={58} />
              </View>
              <View style={S.coachOrbStatus} />
            </View>
            <Text style={S.emptyEyebrow}>COACHING, CONTINUED</Text>
            <Text style={S.emptyTitle}>Your day is already in view.</Text>
            <Text style={S.emptySubtitle}>
              Your daily recommendation and preferred training window are above. Use chat for adjustments, questions and set-by-set guidance.
            </Text>
          </View>
          <View style={S.suggestionsHeading}>
            <Text style={S.suggestionsHeadingLabel}>ASK FOR A DEEPER LOOK</Text>
          </View>
          <View style={S.suggestions}>
            {SUGGESTIONS.map((s, i) => (
              <Reveal key={'suggestion-' + i} delay={i * 34}>
                <PressableScale
                  style={S.suggestion}
                  onPress={() => sendMessage(s.prompt)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ask Coach: ${s.title}`}
                >
                  <View style={[S.suggestionIcon, { backgroundColor: `${s.color}18` }]}>
                    <Ionicons name={s.icon as any} size={18} color={s.color} />
                  </View>
                  <View style={S.suggestionCopy}>
                    <Text style={S.suggestionTitle}>{s.title}</Text>
                    <Text style={S.suggestionText}>{s.description}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={16} color={COLORS.textMuted} />
                </PressableScale>
              </Reveal>
            ))}
          </View>
        </ScrollView>
      ) : (
        <FlashList
          ref={flatListRef}
          data={chatHistory}
          keyExtractor={(_: unknown, i: number) => String(i)}
          renderItem={renderMessage}
          contentContainerStyle={S.messageList}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Streaming reply — grows chunk-by-chunk as SSE events arrive (see
          useCoachChatStream). Before the first chunk lands this shows the
          same dot-typing indicator as before; once text starts arriving
          it's replaced by the live-growing bubble so the user is reading
          the reply well before the full response has finished. */}
      {(isStreaming || isEnrichingResponse) && (
        isStreaming && streamingText ? (
          <Reveal distance={5} duration={220}><View style={[S.bubble, S.aiBubble]}>
            <View style={S.roleLabelRow}>
              <Ionicons name="flash" size={10} color={COLORS.recoveryHigh} />
              <Text style={S.roleLabel}>COACH</Text>
            </View>
            <Text style={[S.messageText]}>{streamingText}</Text>
          </View></Reveal>
        ) : (
          <ThinkingDots />
        )
      )}

      {/* Input row */}
      <View style={[S.inputRow, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          style={S.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about training, food or recovery..."
          placeholderTextColor={COLORS.textDim}
          multiline
          maxLength={2000}
          onSubmitEditing={() => sendMessage()}
          blurOnSubmit={false}
          keyboardAppearance="light"
          selectionColor={COLORS.primaryGreen}
          underlineColorAndroid="transparent"
        />
        <PressableScale
          style={[S.sendBtn, (!input.trim() || isStreaming || isEnrichingResponse) && S.sendBtnOff]}
          onPress={() => sendMessage()}
          disabled={!input.trim() || isStreaming || isEnrichingResponse}
        >
          <Ionicons
            name="arrow-up"
            size={18}
            color={input.trim() && !isStreaming && !isEnrichingResponse ? COLORS.background : COLORS.textDim}
          />
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Card styles (C) ──────────────────────────────────────────────────────────
const C = StyleSheet.create({
  // Shell
  shell:       { borderRadius: RADIUS.card, overflow: 'hidden', marginTop: 12, borderWidth: 1,
                 shadowColor: COLORS.background, shadowOpacity: 0.14, shadowRadius: 14,
                 shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  shellHeader: { flexDirection: 'row', alignItems: 'center', gap: 7,
                 paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  shellLabel: { fontFamily: FONTS.bold,  fontSize: 10, fontWeight: '700', letterSpacing: 1.6 },

  // Tips
  tipsBlock: { paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  tipRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipDot:    { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
  tipText: { fontFamily: FONTS.regular,  color: COLORS.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 },
  emptyTip: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 12 },
  estimateNotice: { color: COLORS.recoveryMed, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15, marginTop: 6, padding: 9, borderRadius: 10, backgroundColor: alpha(COLORS.recoveryMed, 0.08) },

  // Workout card
  wMeta:         { flexDirection: 'row', alignItems: 'center', gap: 10,
                   paddingHorizontal: 14, paddingVertical: 10 },
  metaItem:      { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaItemText: { fontFamily: FONTS.bold,  color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  metaDivider:   { width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.10)' },

  tableWrap:  { borderTopWidth: 1, borderTopColor: COLORS.border },
  exRow:      { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  exHeaderRow:{ flexDirection: 'row', alignItems: 'center', gap: 12 },
  tableRowAlt:{ backgroundColor: COLORS.backgroundTop },
  exName: { fontFamily: FONTS.bold,  color: COLORS.text, fontSize: 14, fontWeight: '700', lineHeight: 18 },
  exThumb:    { width: 56, height: 56, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  exFocus: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 11, marginTop: 3, fontStyle: 'italic' },
  exMetricRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12, paddingVertical: 8,
  },
  exMetric: { flex: 1, alignItems: 'center', gap: 2 },
  exMetricValue: { fontFamily: FONTS.numericSemibold,  color: COLORS.text, fontSize: 13, fontWeight: '800' },
  exMetricLabel: { fontFamily: FONTS.bold,  color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  exMetricDivider: { width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.08)' },

  reasonRow:  { paddingHorizontal: 14, paddingVertical: 10,
                borderTopWidth: 1, borderTopColor: COLORS.border },
  reasonText: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 12, lineHeight: 18 },

  // Live set card
  nextActionBlock: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  nextActionLabel: { fontFamily: FONTS.bold,  color: COLORS.strainGlow, fontSize: 10, fontWeight: '800',
                     letterSpacing: 1.5, marginBottom: 4 },
  nextActionText: { fontFamily: FONTS.bold,  color: COLORS.text, fontSize: 20, fontWeight: '800', lineHeight: 26 },
  insightBlock:    { paddingHorizontal: 14, paddingVertical: 10,
                     borderTopWidth: 1, borderTopColor: COLORS.border },
  insightText: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic' },

  // Recovery card
  recoveryBody:       { flexDirection: 'row', padding: 14, alignItems: 'center', gap: 14 },
  recoveryScoreBlock: { alignItems: 'center', minWidth: 72 },
  recoveryScoreNum: { fontFamily: FONTS.numericSemibold,  fontSize: 42, fontWeight: '800', lineHeight: 48 },
  recoveryScoreUnit: { fontFamily: FONTS.semibold,  color: COLORS.textMuted, fontSize: 14, fontWeight: '600', marginTop: -6 },
  recoveryZonePill:   { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8,
                        paddingVertical: 3, marginTop: 6 },
  recoveryZoneText: { fontFamily: FONTS.bold,  fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  recoveryDivider:    { width: 1, height: 52, backgroundColor: COLORS.border },
  recoveryTips:       { flex: 1, gap: 6 },

  // Nutrition card
  macroRow:    { flexDirection: 'row', padding: 14, gap: 8, flexWrap: 'wrap' },
  macroChip:   { flex: 1, minWidth: 60, backgroundColor: COLORS.cardElevated,
                 borderRadius: 10, padding: 10, alignItems: 'center',
                 borderWidth: 1, borderColor: COLORS.border },
  macroVal: { fontFamily: FONTS.numericSemibold,  fontSize: 18, fontWeight: '800', color: COLORS.text },
  macroLabel: { fontFamily: FONTS.bold,  color: COLORS.textMuted, fontSize: 10, fontWeight: '700',
                 letterSpacing: 1, marginTop: 2 },

  // Progress card
  prBlock:      { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  prBlockLabel: { fontFamily: FONTS.bold,  color: COLORS.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },
  prRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  prText: { fontFamily: FONTS.semibold,  color: COLORS.text, fontSize: 13, fontWeight: '600' },
  trendRow:     { flexDirection: 'row', alignItems: 'center', gap: 8,
                  paddingHorizontal: 14, paddingVertical: 10,
                  borderTopWidth: 1, borderTopColor: COLORS.border },
  trendText: { fontFamily: FONTS.semibold,  color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },

  // Weekly card
  weeklyStats:     { flexDirection: 'row', padding: 14, gap: 8 },
  weeklyStatChip:  { flex: 1, backgroundColor: COLORS.cardElevated, borderRadius: 10,
                     padding: 10, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  weeklyStatVal: { fontFamily: FONTS.numericSemibold,  fontSize: 20, fontWeight: '800', color: COLORS.text },
  weeklyStatLabel: { fontFamily: FONTS.bold,  color: COLORS.textMuted, fontSize: 10, fontWeight: '700',
                     letterSpacing: 1, marginTop: 2 },
  weekDays:        { flexDirection: 'row', paddingHorizontal: 14, paddingBottom: 14, gap: 6 },
  weekDay:         { flex: 1, alignItems: 'center', gap: 5 },
  weekDayLabel: { fontFamily: FONTS.semibold,  color: COLORS.textMuted, fontSize: 10, fontWeight: '600' },
  weekDayDot:      { width: 8, height: 8, borderRadius: 4 },

  // Chat tips
  chatTipsCard: { backgroundColor: COLORS.card, borderRadius: 12, marginTop: 8,
                  paddingHorizontal: 12, paddingVertical: 8,
                  borderWidth: 1, borderColor: COLORS.border },
});

// ─── Screen styles (S) ────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 13,
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitleCol: { flex: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 21, fontWeight: '600', letterSpacing: -0.45 },
  proBadge: {
    backgroundColor: COLORS.recoveryHigh + '20', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: COLORS.recoveryHigh + '50',
  },
  proBadgeText: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 10, fontWeight: '800', letterSpacing: 0.9 },
  headerSub: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 11, letterSpacing: 0.1, marginTop: 1 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  notifDot: {
    position: 'absolute', top: -1, right: -1, width: 7, height: 7, borderRadius: 4,
    backgroundColor: COLORS.recoveryHigh, borderWidth: 1.5, borderColor: COLORS.background,
  },
  // Live training context stays secondary to the actual coaching actions.
  briefCard: { minHeight: 38, paddingHorizontal: 12, paddingVertical: 8, marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  briefContextTitle: { fontFamily: FONTS.bold, color: COLORS.textMuted, fontSize: 10, letterSpacing: 0.8 },
  briefDividerVertical: { width: 1, height: 15, backgroundColor: COLORS.border },
  briefMetricInline: { color: COLORS.textSecondary, fontFamily: FONTS.medium, fontSize: 10 },
  dailyBriefCard: { marginTop: 13, padding: 15, backgroundColor: COLORS.cardElevated, borderRadius: 20, borderWidth: 1, borderColor: COLORS.borderLight, gap: 10 },
  dailyBriefTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 7 },
  dailyBriefEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dailyBriefLiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.primaryGreen },
  dailyBriefEyebrow: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 9, letterSpacing: 1.15 },
  dailyBriefStatus: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 0.65 },
  dailyBriefTitle: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 23, lineHeight: 28, letterSpacing: -0.45 },
  dailyBriefMessage: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 12, lineHeight: 19 },
  dailyBriefScheduleNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 12, backgroundColor: alpha(COLORS.recoveryMed, 0.08), borderWidth: 1, borderColor: alpha(COLORS.recoveryMed, 0.2) },
  dailyBriefScheduleNoticeText: { flex: 1, color: COLORS.recoveryMed, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15 },
  dailyBriefWhy: { gap: 4, paddingTop: 2 },
  dailyBriefWhyLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 0.9 },
  dailyBriefWhyText: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15 },
  dailyBriefSchedule: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.backgroundTop, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 11, marginTop: 1 },
  dailyBriefScheduleIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(COLORS.primaryGreen, 0.12) },
  dailyBriefScheduleLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 0.9 },
  dailyBriefScheduleTime: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 14, marginTop: 2 },
  dailyBriefScheduleNote: { color: COLORS.textDim, fontFamily: FONTS.regular, fontSize: 9, lineHeight: 13, marginTop: 2 },
  dailyBriefSetTime: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingTop: 7 },
  dailyBriefSetTimeText: { color: COLORS.primaryGreen, fontFamily: FONTS.semibold, fontSize: 10 },
  dailyBriefExercises: { paddingTop: 3, gap: 7 },
  dailyBriefExercisesTitle: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1, marginBottom: 1 },
  dailyBriefExerciseRow: { minHeight: 35, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 5 },
  dailyBriefExerciseIndex: { width: 25, height: 25, borderRadius: 8, backgroundColor: alpha(COLORS.primaryGreen, 0.10), alignItems: 'center', justifyContent: 'center' },
  dailyBriefExerciseIndexText: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 9 },
  dailyBriefExerciseName: { color: COLORS.text, fontFamily: FONTS.medium, fontSize: 11, flex: 1 },
  dailyBriefExerciseTarget: { color: COLORS.textSecondary, fontFamily: FONTS.numericSemibold, fontSize: 10 },
  dailyBriefMoreExercises: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 9, paddingTop: 3 },
  dailyBriefPlanNote: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15 },
  dailyBriefActions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 3 },
  dailyBriefPrimary: { flex: 1, minHeight: 43, borderRadius: 13, backgroundColor: COLORS.primaryGreen, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10 },
  dailyBriefPrimaryText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 11, flex: 1 },
  dailyBriefSecondary: { minWidth: 82, minHeight: 43, borderRadius: 13, backgroundColor: COLORS.backgroundTop, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 11 },
  dailyBriefSecondaryText: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 11 },
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: alpha(COLORS.recoveryMed, 0.10), paddingVertical: 9, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: alpha(COLORS.recoveryMed, 0.24),
  },
  offlineBannerText: { fontFamily: FONTS.regular,  color: COLORS.recoveryMed, fontSize: 11, flex: 1, lineHeight: 16 },

  emptyScroll: { flex: 1 },
  emptyContent: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24 },
  emptyHero: { alignItems: 'flex-start', marginBottom: 26 },
  coachOrb: {
    width: 66, height: 66, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.borderLight,
    marginBottom: 22, position: 'relative',
  },
  coachOrbInner: {
    width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(COLORS.primaryGreen, 0.10),
  },
  coachOrbStatus: {
    position: 'absolute', right: -3, bottom: -3, width: 13, height: 13, borderRadius: 7,
    backgroundColor: COLORS.recoveryHigh, borderWidth: 3, borderColor: COLORS.background,
  },
  emptyEyebrow: { fontFamily: FONTS.bold,  color: COLORS.primaryGreen, fontSize: 10, fontWeight: '800', letterSpacing: 1.8, marginBottom: 9 },
  emptyTitle: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 28, lineHeight: 33, fontWeight: '700', letterSpacing: -0.8, marginBottom: 9, maxWidth: 310 },
  emptySubtitle: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 12, lineHeight: 19, maxWidth: 340 },
  suggestionsHeading: { marginBottom: 11 },
  suggestionsHeadingLabel: { fontFamily: FONTS.bold, color: COLORS.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  suggestions: { gap: 9 },
  suggestion: { width: '100%', minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: COLORS.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border },
  suggestionIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  suggestionCopy: { flex: 1, minWidth: 0, gap: 4 },
  suggestionTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13, lineHeight: 17 },
  suggestionText: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 16 },

  messageList: { padding: 16, paddingBottom: 12 },
  bubble:      { marginBottom: 12, borderRadius: 18, padding: 15, maxWidth: '92%' },
  userBubble:  { backgroundColor: COLORS.userBubble, alignSelf: 'flex-end',
                 borderWidth: 1, borderColor: COLORS.strain + '40' },
  aiBubble:    { backgroundColor: COLORS.card, alignSelf: 'flex-start',
                 borderWidth: 1, borderColor: COLORS.border, maxWidth: '97%' },
  roleLabelRow:{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  roleLabel: { fontFamily: FONTS.bold,  color: COLORS.recoveryHigh, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  messageText: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 14, lineHeight: 22 },
  userText:    { color: COLORS.text },
  questionCard: { marginTop: 13, padding: 12, borderRadius: 15, backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.cardBorder, gap: 10 },
  questionPrompt: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13, lineHeight: 19 },
  questionOptions: { gap: 7 },
  questionOption: { minHeight: 43, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  questionOptionText: { color: COLORS.text, fontFamily: FONTS.medium, fontSize: 12, flex: 1, lineHeight: 17 },
  sourcesBlock: { marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: COLORS.border, gap: 6 },
  sourcesLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.1 },
  sourceLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  sourceText: { color: COLORS.primaryGreen, fontFamily: FONTS.medium, fontSize: 10, flex: 1, lineHeight: 15 },

  thinkingRow:    { flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingHorizontal: 20, paddingVertical: 10 },
  thinkingAvatar: { width: 28, height: 28, borderRadius: 9,
                    backgroundColor: COLORS.recoveryHigh + '18',
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: COLORS.recoveryHigh + '30' },
  thinkingBubble: { backgroundColor: COLORS.card, borderRadius: 12, paddingHorizontal: 14,
                    paddingVertical: 8, borderWidth: 1, borderColor: COLORS.border },
  thinkingText: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 13 },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10,
              paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
              backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border },
  input:    { flex: 1, backgroundColor: COLORS.inputBg, borderRadius: 16,
              paddingHorizontal: 16, paddingVertical: 11, color: COLORS.text,
              fontFamily: FONTS.regular, fontSize: 14, maxHeight: 110, borderWidth: 1, borderColor: COLORS.border },
  sendBtn:  { width: 44, height: 44, borderRadius: 15,
              backgroundColor: COLORS.primaryGreen, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: COLORS.cardElevated, shadowOpacity: 0, elevation: 0 },
});