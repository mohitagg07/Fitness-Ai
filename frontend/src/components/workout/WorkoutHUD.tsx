// VYRN — Workout HUD v3
// NEW IN v3:
//   • Previous set ghost — shows last logged set for same exercise under inputs
//   • Volume accumulator — live total kg·reps shown in session header
//   • RPE selector with colour coding (6-7 green → 8.5-9.5 amber → 10 red)
//   • Exercise notes (coach cue from plan persisted in card)
//   • WorkoutSummaryCard replaces bare Alert on finish
//   • Next exercise flow: auto-advances index on tap
//   • Rest timer now shows circular progress ring (SVG-free: pure View)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { router } from 'expo-router';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, AppState,
  TextInput, Alert, Animated, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { workoutApi, coachApi, trainingPlanApi } from '../../utils/api';
import { useMissionSummary } from '../../hooks/useDashboardQueries';
import { confirmAsync } from '../../utils/confirm';
import { useStore } from '../../store';
import { useCompleteSession, useLogSet, syncPendingWorkoutSets } from '../../hooks/useWorkoutMutations';
import { getPendingWorkoutSets } from '../../utils/workoutOutbox';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS, EYEBROW, BODY } from '../../theme/typography';
import { SPACING, RADIUS } from '../../theme/spacing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import WorkoutSummaryCard from './WorkoutSummaryCard';
import WorkoutPlanPreview, { WorkoutExerciseDraft } from './WorkoutPlanPreview';
import WorkoutHistoryModal from './WorkoutHistoryModal';
import MilestoneCelebration from './MilestoneCelebration';
import MoodPickerModal, { WorkoutFeedback } from './MoodPickerModal';
import PressableScale from '../ui/PressableScale';
import Reveal from '../shared/Reveal';
import ProfileAvatar from '../shared/ProfileAvatar';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import AmbientGlow from '../shared/AmbientGlow';

interface ExerciseCard {
  name: string;
  original_name?: string;
  sets: number;
  reps: string;
  load: string;
  cue: string;
  rest: string;
  completed_sets: number;
  target_unknown?: boolean;
  exercise_id?: string | null;
  equipment_required?: string[];
  muscle_groups?: string[];
  rpe_target?: number | null;
  rir_target?: number | null;
  tempo?: string;
  skipped?: boolean;
  replaced?: boolean;
}

interface SetLog {
  exercise_name: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe: number;
  client_request_id?: string;
}

interface DraftPlanReference {
  planId: string;
  versionId: string;
  sessionRequestId: string;
  sessionDate: string;
  name: string;
  workoutType: string;
  estimatedMinutes: number | null;
  muscleGroups: string[];
  approved: boolean;
}

const RPE_LEVELS = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ─── Milestone detection ────────────────────────────────────────────────────
// The backend has tracked workout_streak / protein_streak on agent_state for
// a while (see /sessions/{id}/complete) but nothing on the frontend ever did
// anything with the numbers it returns — `streakVisible`/`streakData` state
// existed below and was never set. This turns those two already-shipped
// numbers into the "milestone" celebration moment.
const WORKOUT_STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
const PROTEIN_STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

export interface MilestoneInfo {
  kind: 'workout' | 'protein';
  streak: number;
  title: string;
  message: string;
}

function localDateKey(value: Date = new Date()): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function computeMilestone(summary: any): MilestoneInfo | null {
  if (!summary) return null;
  const w = summary.workout_streak as number | undefined;
  const p = summary.protein_streak as number | undefined;

  // Workout streak takes priority — it's the harder habit and the one this
  // screen is already about.
  if (typeof w === 'number' && WORKOUT_STREAK_MILESTONES.includes(w)) {
    return {
      kind: 'workout',
      streak: w,
      title: `${w}-Day Streak`,
      message:
        w >= 100 ? "That's elite-level consistency. Most people never get here."
        : w >= 30  ? "A full month straight. This is who you are now."
        : w >= 14  ? "Two weeks in a row. The habit is locking in."
        : w >= 7   ? "One full week, every day. Real momentum."
        : "Three days straight — the hardest part is behind you.",
    };
  }
  if (typeof p === 'number' && PROTEIN_STREAK_MILESTONES.includes(p)) {
    return {
      kind: 'protein',
      streak: p,
      title: `${p}-Day Protein Streak`,
      message:
        p >= 60 ? "Nutrition discipline like this is what separates good results from great ones."
        : p >= 30 ? "A full month of hitting your protein target. Muscle-building mode: locked."
        : p >= 14 ? "Two straight weeks on target — this is where gains happen."
        : p >= 7  ? "A full week hitting your protein goal every day."
        : "Three days in a row on target. Keep stacking them.",
    };
  }
  return null;
}

function rpeColor(r: number): string {
  if (r <= 7)   return COLORS.primaryGreen;
  if (r <= 8)   return COLORS.recoveryMed;
  if (r <= 9.5) return COLORS.calories;
  return COLORS.recoveryLow;
}

// ─── Rest Timer ───────────────────────────────────────────────────────────────
function RestTimerBar({
  startedAt,
  total,
  onSkip,
  onComplete,
}: {
  startedAt: number;
  total: number;
  onSkip: () => void;
  onComplete: () => void;
}) {
  const [seconds, setSeconds] = useState(total);
  const ringProgress = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();

  // Derive remaining time from an absolute deadline. This avoids countdown
  // drift if the JS thread is busy or the app briefly moves to the background.
  // The timer owns its state, so the workout screen does not re-render each tick.
  useEffect(() => {
    let completed = false;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((startedAt + total * 1000 - Date.now()) / 1000));
      setSeconds((current) => current === remaining ? current : remaining);
      if (remaining === 0 && !completed) {
        completed = true;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        onComplete();
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [startedAt, total, onComplete]);

  const pct = total > 0 ? Math.max(0, Math.min(1, seconds / total)) : 0;
  const urgent = seconds <= 10;
  const barColor = urgent ? COLORS.recoveryLow : COLORS.primaryGreen;
  useEffect(() => {
    ringProgress.stopAnimation();
    if (reduceMotion) {
      ringProgress.setValue(pct);
      return undefined;
    }
    const animation = Animated.timing(ringProgress, {
      toValue: pct,
      duration: 220,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [pct, ringProgress, reduceMotion]);
  const ringSize = 58;
  const ringStroke = 4;
  const ringRadius = (ringSize - ringStroke) / 2;
  const circumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <View style={T.timerBar}>
      <View style={T.timerVisual}>
        <Svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`}>
          <Circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={ringRadius}
            fill="none"
            stroke={COLORS.borderLight}
            strokeWidth={ringStroke}
          />
          <AnimatedCircle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={ringRadius}
            fill="none"
            stroke={barColor}
            strokeWidth={ringStroke}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={ringOffset as any}
            strokeLinecap="round"
            rotation="-90"
            origin={`${ringSize / 2}, ${ringSize / 2}`}
          />
        </Svg>
        <View style={T.timerRingText}>
          <Text style={[T.timerSeconds, { color: barColor }]}>{seconds}</Text>
          <Text style={T.timerUnit}>SEC</Text>
        </View>
      </View>

      <View style={T.timerCopy}>
        <Text style={[T.timerLabel, { color: barColor }]}>REST INTERVAL</Text>
        <Text style={T.timerTitle}>{urgent ? 'Get ready for the next set' : 'Recover. Then go again.'}</Text>
        <Text style={T.timerHint}>Timer stays accurate when you switch apps</Text>
      </View>

      <PressableScale
        onPress={onSkip}
        style={T.skipBtn}
        accessibilityRole="button"
        accessibilityLabel="Skip rest timer"
      >
        <Ionicons name="play" size={12} color={COLORS.textSecondary} />
        <Text style={T.skipText}>SKIP</Text>
      </PressableScale>
    </View>
  );
}

// ─── Volume bar ───────────────────────────────────────────────────────────────
function SessionHeader({
  startedAt,
  totalVolume,
  setCount,
  paused,
  pausedAt,
  pausedDurationSeconds,
}: {
  startedAt: number;
  totalVolume: number;
  setCount: number;
  paused: boolean;
  pausedAt?: string | null;
  pausedDurationSeconds?: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  // Keep the live clock inside this small component. A one-second clock tick
  // must not re-render exercise inputs, logged sets, or the rest of the HUD.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const pausedAtMs = pausedAt ? new Date(pausedAt).getTime() : null;
  const clockEnd = paused && pausedAtMs && Number.isFinite(pausedAtMs) ? pausedAtMs : now;
  const elapsedSeconds = Math.max(0, Math.floor(
    (clockEnd - startedAt) / 1000 - Math.max(0, pausedDurationSeconds || 0)
  ));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  const elapsed = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <View style={H.row}>
      <View style={H.timeBlock}>
        <View style={H.pill}>
          <View style={H.activeDot} />
          <Text style={H.pillText}>{paused ? 'SESSION PAUSED' : 'LIVE SESSION'}</Text>
        </View>
        <Text style={H.timeValue}>{elapsed}</Text>
        <Text style={H.timeLabel}>ELAPSED TIME</Text>
      </View>
      <View style={H.metrics}>
        <View style={H.stat}>
          <Text style={H.statVal}>{setCount}</Text>
          <Text style={H.statLabel}>SETS</Text>
        </View>
        <View style={H.metricDivider} />
        <View style={H.stat}>
          <Text style={[H.statVal, { color: COLORS.primaryGreen }]}>
            {totalVolume >= 1000
              ? `${(totalVolume / 1000).toFixed(1)}t`
              : `${totalVolume}kg`}
          </Text>
          <Text style={H.statLabel}>VOLUME</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Previous set ghost ───────────────────────────────────────────────────────
function PrevSetGhost({ log }: { log: SetLog | null }) {
  if (!log) return null;
  return (
    <View style={G.row}>
      <Ionicons name="time-outline" size={12} color={COLORS.textDim} />
      <Text style={G.text}>
        Last: {log.weight_kg}kg × {log.reps} @ RPE {log.rpe}
      </Text>
    </View>
  );
}

// ─── Main HUD ────────────────────────────────────────────────────────────────
function WorkoutHUD() {
  const responsive = useResponsiveLayout();
  const { data: missionSummary } = useMissionSummary();
  const recommendedWorkout = missionSummary?.workout_today?.type?.trim() || null;
  const recommendedNote = missionSummary?.workout_today?.message || missionSummary?.next_task || null;
  // Selector form — see src/store/index.ts. This screen already re-renders
  // every second for the live clock/rest timer; without a selector it was
  // ALSO re-rendering on every chat message and CNS-fatigue update fired
  // from the Coach/Dashboard tabs in the background.
  const insets = useSafeAreaInsets();
  const {
    activeSession, setActiveSession, addLogToSession, setCnsFatigue,
    pendingCoachWorkout, setPendingCoachWorkout,
  } = useStore((s) => ({
    activeSession: s.activeSession,
    setActiveSession: s.setActiveSession,
    addLogToSession: s.addLogToSession,
    setCnsFatigue: s.setCnsFatigue,
    pendingCoachWorkout: s.pendingCoachWorkout,
    setPendingCoachWorkout: s.setPendingCoachWorkout,
  }));

  const [exercises, setExercises]       = useState<ExerciseCard[]>([]);
  const [warmupNotes, setWarmupNotes] = useState('');
  const [cooldownNotes, setCooldownNotes] = useState('');
  const [activeIdx, setActiveIdx]       = useState(0);
  const [restStartedAt, setRestStartedAt] = useState<number | null>(null);
  const [restTotal, setRestTotal] = useState(90);
  const clearRestTimer = useCallback(() => setRestStartedAt(null), []);
  const [rpe, setRpe]                   = useState(8);
  const [weight, setWeight]             = useState('');
  const [reps, setReps]                 = useState('');
  const [exerciseName, setExerciseName] = useState('');
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [summaryData, setSummaryData]       = useState<any>(null);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [isLogging, setIsLogging]       = useState(false);
  const [pendingSetCount, setPendingSetCount] = useState(0);
  const [pendingSyncBlocked, setPendingSyncBlocked] = useState(false);
  const [isFinishing, setIsFinishing]   = useState(false);
  const [streakVisible, setStreakVisible] = useState(false);
  const [streakData, setStreakData]     = useState<MilestoneInfo | null>(null);
  const [moodPickerVisible, setMoodPickerVisible] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [restoredPlanUnavailable, setRestoredPlanUnavailable] = useState(false);
  const [isBuildingPlan, setIsBuildingPlan] = useState(false);
  const [isApprovingPlan, setIsApprovingPlan] = useState(false);
  const [planPreviewVisible, setPlanPreviewVisible] = useState(false);
  const [draftPlan, setDraftPlan] = useState<DraftPlanReference | null>(null);
  const [isSessionPaused, setIsSessionPaused] = useState(false);
  const [isExerciseChangeSaving, setIsExerciseChangeSaving] = useState(false);
  const [showReplacementInput, setShowReplacementInput] = useState(false);
  const [replacementExerciseName, setReplacementExerciseName] = useState('');
  const pendingSetWrites = useRef<Set<Promise<any>>>(new Set());
  const profile = useStore((state) => state.profile);

  // Restore an unfinished workout from the server after app restart. The
  // immutable prescription snapshot is authoritative; logged sets only update
  // completion counts and never define which exercises existed in the plan.
  // Restore an unfinished workout from the server after app restart. Set rows
  // are already persisted individually; this reconnects them to the live HUD.
  useEffect(() => {
    let alive = true;
    if (activeSession) {
      setIsRestoringSession(false);
      return () => { alive = false; };
    }

    (async () => {
      try {
        const response = await workoutApi.getSessions(20);
        const pending = (Array.isArray(response.data) ? response.data : [])
          .filter((session: any) => session && (
            session.status === 'active'
            || session.status === 'paused'
            || (!session.status && session.completed !== true)
          ))
          .sort((a: any, b: any) =>
            new Date(b.started_at || b.created_at || b.session_date || 0).getTime() -
            new Date(a.started_at || a.created_at || a.session_date || 0).getTime()
          );
        const session = pending[0];
        if (!alive || !session) return;

        const serverLogs: SetLog[] = (Array.isArray(session.exercise_logs) ? session.exercise_logs : [])
          .map((log: any) => ({
            exercise_name: String(log.exercise_name || ''),
            set_number: Number(log.set_number || 1),
            weight_kg: Number(log.weight_kg || 0),
            reps: Number(log.reps || 0),
            rpe: Number(log.rpe ?? 8),
            client_request_id: log.client_request_id || undefined,
          }))
          .filter((log: SetLog) => log.exercise_name.length > 0);
        // A damaged/unreadable local queue must not prevent the server
        // session itself from being restored. Keep a visible fail-closed
        // pending marker; sync and completion will continue to reject until
        // the queue can be read safely.
        const queuedPending = await getPendingWorkoutSets(session.id).catch(() => null);
        if (queuedPending === null) setPendingSetCount(1);
        else setPendingSetCount(queuedPending.length);
        const serverRequestIds = new Set(serverLogs.map((log) => log.client_request_id).filter(Boolean));
        const queuedLogs: SetLog[] = (queuedPending || [])
          .filter((item) => !serverRequestIds.has(item.client_request_id))
          .map((item) => ({
            exercise_name: item.exercise_name,
            set_number: item.set_number,
            weight_kg: item.weight_kg,
            reps: item.reps,
            rpe: item.rpe ?? 8,
            client_request_id: item.client_request_id,
          }));
        const logs: SetLog[] = [...serverLogs, ...queuedLogs]
          .sort((a: SetLog, b: SetLog) => {
            const byExercise = a.exercise_name.localeCompare(b.exercise_name);
            return byExercise || a.set_number - b.set_number;
          });

        const plannedExercises = session.planned_workout_snapshot?.exercises;
        const hasRestorablePrescription = Array.isArray(plannedExercises) && plannedExercises.length > 0;
        setRestoredPlanUnavailable(!hasRestorablePrescription);
        const eventResponse = await workoutApi.getSessionExerciseEvents(session.id).catch(() => ({ data: { events: [] } }));
        const exerciseEvents = Array.isArray(eventResponse.data?.events) ? eventResponse.data.events : [];
        const latestEventByExercise = new Map<string, any>();
        exerciseEvents.forEach((event: any) => {
          const original = String(event.exercise_name || '').trim().toLowerCase();
          if (original) latestEventByExercise.set(original, event);
        });
        const names = [...new Set(logs.map((log) => log.exercise_name))];
        const restoredExercises: ExerciseCard[] = Array.isArray(plannedExercises) && plannedExercises.length > 0
          ? plannedExercises.map((planned: any) => {
              const originalName = String(planned.name || planned.exercise_name || 'Exercise');
              const event = latestEventByExercise.get(originalName.toLowerCase());
              const skipped = event?.action === 'skip';
              const name = event?.action === 'replace'
                ? String(event.replacement_exercise || originalName)
                : originalName;
              const exerciseLogs = logs.filter((log) => log.exercise_name.toLowerCase() === name.toLowerCase());
              const loadText = planned.load_kg != null
                ? String(planned.load_kg) + 'kg'
                : String(planned.load_guidance || '');
              return {
                name,
                original_name: originalName,
                sets: Number(planned.sets) || 3,
                reps: String(planned.reps || '8-12'),
                load: loadText,
                cue: skipped
                  ? 'You skipped the remaining sets for this exercise.'
                  : event?.action === 'replace'
                    ? 'Replacement for ' + originalName
                    : String(planned.cue || 'Follow the approved exercise prescription'),
                rest: String(Number(planned.rest_seconds) || 90) + ' sec',
                rpe_target: planned.rpe_target ?? null,
                rir_target: planned.rir_target ?? null,
                tempo: String(planned.tempo || ''),
                exercise_id: planned.exercise_id || null,
                equipment_required: Array.isArray(planned.equipment_required) ? planned.equipment_required : [],
                muscle_groups: Array.isArray(planned.muscle_groups) ? planned.muscle_groups : [],
                completed_sets: exerciseLogs.length,
                skipped,
                replaced: event?.action === 'replace',
              };
            })
          : names.map((name) => {
              const exerciseLogs = logs.filter((log) => log.exercise_name === name);
              const last = exerciseLogs[exerciseLogs.length - 1];
              return {
                name,
                original_name: name,
                // Legacy sessions without an approved prescription snapshot
                // cannot truthfully recover planned sets or rep targets.
                sets: Math.max(1, exerciseLogs.length + 1),
                reps: last ? String(last.reps) : '',
                load: last ? `${last.weight_kg}kg` : '',
                cue: 'Original prescription unavailable. Use the previous logged set only as a reference; no target was saved for this session.',
                rest: '90 sec default',
                completed_sets: exerciseLogs.length,
                target_unknown: true,
              };
            });

        const startedAt = session.started_at || session.created_at;
        const startedAtMs = startedAt ? new Date(startedAt).getTime() : Date.now();
        setActiveSession({
          ...session,
          logs,
          startedAt: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
        });
        setExercises(restoredExercises);
        setIsSessionPaused(session.status === 'paused');
        const nextExerciseIndex = restoredExercises.findIndex(
          (exercise) => !exercise.skipped && exercise.completed_sets < exercise.sets
        );
        const firstAvailableIndex = restoredExercises.findIndex((exercise) => !exercise.skipped);
        if (restoredExercises.length > 0) {
          setActiveIdx(
            nextExerciseIndex >= 0
              ? nextExerciseIndex
              : firstAvailableIndex >= 0
                ? firstAvailableIndex
                : restoredExercises.length - 1
          );
        }
      } catch (error: any) {
        if (__DEV__) console.warn('[Workout] Could not restore active session', error?.message || error);
      } finally {
        if (alive) setIsRestoringSession(false);
      }
    })();

    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const sessionId = activeSession?.id;
    if (!sessionId) {
      setPendingSetCount(0);
      setPendingSyncBlocked(false);
      return undefined;
    }

    let alive = true;
    let syncing = false;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const before = await getPendingWorkoutSets(sessionId);
        if (alive) setPendingSetCount(before.length);
        if (before.length > 0 && !isSessionPaused) {
          const result = await syncPendingWorkoutSets(sessionId);
          if (alive) {
            setPendingSetCount(result.remaining);
            setPendingSyncBlocked(result.blocked);
          }
        }
      } catch {
        // Never discard unreadable pending writes. Keep a visible warning so
        // the athlete knows not to finish or clear app data.
        if (alive) setPendingSetCount((count) => Math.max(count, 1));
      } finally {
        syncing = false;
      }
    };

    void sync();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [activeSession?.id, isSessionPaused]);

  // The elapsed clock and rest countdown update inside isolated child components.

  const sessionStarted = !!activeSession;

  // Derive set counts from store logs (never goes stale on re-mount)
  const setCountByExercise = (() => {
    const counts: Record<string, number> = {};
    for (const log of (activeSession?.logs || []) as SetLog[]) {
      counts[log.exercise_name] = (counts[log.exercise_name] || 0) + 1;
    }
    return counts;
  })();

  // Total volume
  const totalVolume = ((activeSession?.logs || []) as SetLog[]).reduce(
    (sum, l) => sum + (l.weight_kg * l.reps), 0
  );
  const totalSets = (activeSession?.logs || []).length;

  // Previous set for current exercise
  const resolvedName = (exercises[activeIdx]?.name || exerciseName).trim();
  const prevSet: SetLog | null = (() => {
    const logs = ((activeSession?.logs || []) as SetLog[])
      .filter(l => l.exercise_name === resolvedName);
    return logs.length > 0 ? logs[logs.length - 1] : null;
  })();

  const currentSetNum = (setCountByExercise[resolvedName] || 0) + 1;

  // ── Actions ─────────────────────────────────────────────────────────────────
  const buildDraftPayload = (items: WorkoutExerciseDraft[], draft: DraftPlanReference) => ({
    name: draft.name,
    goal: profile?.goal || null,
    phase: profile?.current_phase || null,
    weeks: 4,
    schedule: {},
    session_date: draft.sessionDate,
    change_reason: 'Coach-generated training session awaiting athlete approval',
    workout: {
      label: draft.name,
      workout_type: draft.workoutType,
      muscle_groups: draft.muscleGroups,
      estimated_duration_minutes: draft.estimatedMinutes,
      warmup_notes: warmupNotes.trim() || null,
      cooldown_notes: cooldownNotes.trim() || null,
      exercises: items.map((exercise) => {
        const loadMatch = exercise.load.match(/-?\d+(?:\.\d+)?/);
        const loadKg = loadMatch ? Number(loadMatch[0]) : null;
        const restMatch = exercise.rest.match(/\d+/);
        return {
          name: exercise.name.trim(),
          sets: Math.max(1, Math.min(20, Number(exercise.sets) || 3)),
          reps: exercise.reps.trim() || '8-12',
          load_kg: Number.isFinite(loadKg) ? loadKg : null,
          load_guidance: exercise.load.trim() || null,
          rest_seconds: restMatch ? Math.max(0, Math.min(900, Number(restMatch[0]))) : 90,
          rpe_target: exercise.rpe_target ?? null,
          rir_target: exercise.rir_target ?? null,
          tempo: exercise.tempo?.trim() || null,
          cue: exercise.cue || null,
          equipment_required: exercise.equipment_required || [],
          muscle_groups: exercise.muscle_groups || [],
        };
      }),
    },
  });

  const prepareCoachWorkoutDraft = useCallback(async (sd: any) => {
    if (!sd?.exercises?.length) throw new Error('The coach did not return an exercise plan.');

    const allowedTypes = ['push', 'pull', 'legs', 'upper', 'lower', 'full_body', 'cardio', 'mobility', 'recovery'];
    const proposedType = String(sd.workout_type || recommendedWorkout || 'full_body').toLowerCase();
    const workoutType = allowedTypes.includes(proposedType) ? proposedType : 'full_body';
    const nextExercises: ExerciseCard[] = sd.exercises.map((exercise: any) => ({
      name: String(exercise.name || '').trim(),
      sets: Math.max(1, Math.min(20, Number.parseInt(String(exercise.sets), 10) || 3)),
      reps: String(exercise.reps || '8-12'),
      load: String(exercise.weight || exercise.load_guidance || ''),
      cue: String(exercise.focus || exercise.cue || ''),
      rest: String(exercise.rest || '90 sec'),
      rpe_target: exercise.rpe_target != null ? Number(exercise.rpe_target) : null,
      rir_target: exercise.rir_target != null ? Number(exercise.rir_target) : null,
      tempo: String(exercise.tempo || ''),
      exercise_id: exercise.exercise_id ? String(exercise.exercise_id) : null,
      equipment_required: Array.isArray(exercise.equipment_required) ? exercise.equipment_required.map((item: unknown) => String(item)) : [],
      muscle_groups: Array.isArray(exercise.muscle_groups) ? exercise.muscle_groups.map((item: unknown) => String(item)) : [],
      completed_sets: 0,
    })).filter((exercise: ExerciseCard) => exercise.name.length > 0);

    if (!nextExercises.length) throw new Error('The proposed workout did not include valid exercises.');

    const estimatedText = String(sd.summary?.estimated_time || sd.estimated_time || '');
    const estimatedMatch = estimatedText.match(/\d+/);
    const estimatedMinutes = estimatedMatch ? Number(estimatedMatch[0]) : null;
    const title = String(sd.summary?.label || `${workoutType.replace(/_/g, ' ')} workout`).trim();
    const muscleGroups = Array.isArray(sd.muscle_groups)
      ? sd.muscle_groups.map((item: unknown) => String(item))
      : [];
    const requestedWarmupNotes = String(sd.warmup_notes || sd.warm_up_notes || '');
    const requestedCooldownNotes = String(sd.cooldown_notes || sd.cool_down_notes || '');
    setWarmupNotes(requestedWarmupNotes);
    setCooldownNotes(requestedCooldownNotes);
    const sessionDate = localDateKey();
    const draftPayload = {
      name: title,
      goal: profile?.goal || null,
      phase: profile?.current_phase || null,
      weeks: 4,
      schedule: {},
      session_date: sessionDate,
      change_reason: 'Coach-generated training session awaiting athlete approval',
      workout: {
        label: title,
        workout_type: workoutType,
        muscle_groups: muscleGroups,
        estimated_duration_minutes: estimatedMinutes,
        warmup_notes: requestedWarmupNotes.trim() || null,
        cooldown_notes: requestedCooldownNotes.trim() || null,
        exercises: nextExercises.map((exercise) => {
          const loadMatch = exercise.load.match(/-?\d+(?:\.\d+)?/);
          const restMatch = exercise.rest.match(/\d+/);
          return {
            name: exercise.name,
            sets: exercise.sets,
            reps: exercise.reps,
            load_kg: loadMatch ? Number(loadMatch[0]) : null,
            load_guidance: exercise.load || null,
            rest_seconds: restMatch ? Math.max(0, Math.min(900, Number(restMatch[0]))) : 90,
            rpe_target: exercise.rpe_target ?? null,
            rir_target: exercise.rir_target ?? null,
            tempo: exercise.tempo?.trim() || null,
            cue: exercise.cue || null,
            equipment_required: [],
            muscle_groups: [],
          };
        }),
      },
    };

    const created = await trainingPlanApi.createDraft(draftPayload);
    const planId = String(created.data?.plan?.id || '');
    const versionId = String(created.data?.version?.id || '');
    if (!planId || !versionId) throw new Error('The server did not return a saved draft version.');

    // Use the server-validated exercise catalogue metadata in the review UI.
    // The server, not the LLM, owns canonical IDs, muscle groups and equipment.
    const canonicalWorkout = created.data?.version?.snapshot?.workout || {};
    setWarmupNotes(String(canonicalWorkout.warmup_notes || requestedWarmupNotes));
    setCooldownNotes(String(canonicalWorkout.cooldown_notes || requestedCooldownNotes));
    const canonicalExercises = canonicalWorkout.exercises;
    const reviewExercises: ExerciseCard[] = nextExercises.map((exercise, index) => {
      const canonical = Array.isArray(canonicalExercises) ? canonicalExercises[index] : null;
      return {
        ...exercise,
        exercise_id: canonical?.exercise_id || null,
        equipment_required: Array.isArray(canonical?.equipment_required) ? canonical.equipment_required : [],
        muscle_groups: Array.isArray(canonical?.muscle_groups) ? canonical.muscle_groups : [],
      };
    });

    setDraftPlan({
      planId,
      versionId,
      sessionRequestId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`,
      sessionDate,
      name: title,
      workoutType,
      estimatedMinutes,
      muscleGroups,
      approved: false,
    });
    setExercises(reviewExercises);
    setActiveIdx(0);
    setRestoredPlanUnavailable(false);
    setPlanPreviewVisible(true);
  }, [profile?.goal, profile?.current_phase, recommendedWorkout]);

  // A workout created in Coach is handed into this existing plan-review and
  // approval flow. It is not regenerated, replaced, or started without consent.
  useEffect(() => {
    if (!pendingCoachWorkout || activeSession || isRestoringSession || isBuildingPlan || draftPlan || planPreviewVisible) return;
    setIsBuildingPlan(true);
    void prepareCoachWorkoutDraft(pendingCoachWorkout)
      .then(() => setPendingCoachWorkout(null))
      .catch((error: any) => {
        setPendingCoachWorkout(null);
        Alert.alert(
          'Could not prepare workout',
          error?.response?.data?.detail || error?.message || 'The coach plan could not be saved. Please try again.',
        );
      })
      .finally(() => setIsBuildingPlan(false));
  }, [
    pendingCoachWorkout, activeSession, isRestoringSession, isBuildingPlan,
    draftPlan, planPreviewVisible, prepareCoachWorkoutDraft, setPendingCoachWorkout,
  ]);

  const askCoachForWorkout = async () => {
    if (isBuildingPlan || isRestoringSession || isApprovingPlan) return;
    if (missionSummary?.recovery?.action === 'pain_review') {
      Alert.alert(
        'Review pain before training',
        missionSummary.recovery.message || 'Do not repeat the movement that caused the pain. Keep the approved plan unchanged while you review the symptoms.',
      );
      return;
    }
    setIsBuildingPlan(true);
    try {
      const res = await coachApi.chat("What's my workout today?");
      await prepareCoachWorkoutDraft(res.data?.structured_decision);
    } catch (error: any) {
      Alert.alert(
        'Could not prepare workout',
        error?.response?.data?.detail || error?.message || 'Could not save the workout draft. Check your connection and try again.',
      );
    } finally {
      setIsBuildingPlan(false);
    }
  };

  const approveDraftAndStart = async () => {
    if (!draftPlan || isApprovingPlan || exercises.length === 0) return;
    if (missionSummary?.recovery?.action === 'pain_review') {
      Alert.alert(
        'Workout not started',
        missionSummary.recovery.message || 'A recent post-workout check-in requires a pain review. Your approved plan has not been changed.',
      );
      return;
    }
    setIsApprovingPlan(true);
    try {
      let approvedDraft = draftPlan;
      if (!approvedDraft.approved) {
        // A request may have reached the server even when the client timed out.
        // Check the active version before trying to edit/approve the same draft.
        let alreadyActive = false;
        try {
          const current = await trainingPlanApi.getActive();
          const activeVersionId = current.data?.version?.id || current.data?.plan?.current_version_id;
          alreadyActive = activeVersionId === approvedDraft.versionId;
        } catch {
          // The normal update/approve path below will surface a useful error.
        }

        if (!alreadyActive) {
          const payload = buildDraftPayload(exercises, approvedDraft);
          await trainingPlanApi.updateDraft(approvedDraft.planId, approvedDraft.versionId, payload);
          try {
            await trainingPlanApi.approveVersion(approvedDraft.planId, approvedDraft.versionId);
          } catch (approvalError) {
            // Approval can commit while its HTTP response is lost. Verify the
            // current version before treating that as a failed approval.
            const current = await trainingPlanApi.getActive();
            const activeVersionId = current.data?.version?.id || current.data?.plan?.current_version_id;
            if (activeVersionId !== approvedDraft.versionId) throw approvalError;
          }
        }
        approvedDraft = { ...approvedDraft, approved: true };
        setDraftPlan(approvedDraft);
      }

      const localSessionDate = approvedDraft.sessionDate || localDateKey();
      // client_request_id is stable for this preview. A network retry returns
      // the already-created session instead of opening a duplicate workout.
      const created = await workoutApi.createSession({
        plan_id: approvedDraft.planId,
        plan_version_id: approvedDraft.versionId,
        client_request_id: approvedDraft.sessionRequestId,
        session_date: localSessionDate,
      });
      const serverSession = created.data;
      const startedAtValue = serverSession?.started_at || serverSession?.created_at;
      const startedAtMs = startedAtValue ? new Date(startedAtValue).getTime() : Date.now();
      setActiveSession({
        ...serverSession,
        logs: [],
        startedAt: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
      });
      setRestoredPlanUnavailable(false);
      setActiveIdx(0);
      setIsSessionPaused(false);
      setRestStartedAt(null);
      setPlanPreviewVisible(false);
      setDraftPlan(null);
    } catch (error: any) {
      Alert.alert('Could not start workout', error?.response?.data?.detail || 'Your plan is safe. Check your connection and retry; VYRN will reuse the same session request.');
    } finally {
      setIsApprovingPlan(false);
    }
  };

  const cancelPlanPreview = async () => {
    if (draftPlan && !draftPlan.approved) {
      trainingPlanApi.rejectVersion(draftPlan.planId, draftPlan.versionId).catch(() => undefined);
    }
    setPlanPreviewVisible(false);
    setDraftPlan(null);
    setExercises([]);
    setWarmupNotes('');
    setCooldownNotes('');
  };

  const logSetMutation = useLogSet();
  const completeSessionMutation = useCompleteSession();

  // PERF: this used to be `await workoutApi.logSet(...)` gating
  // *everything* — the haptic, the rest timer starting, the set counter
  // advancing all waited on a network round trip before the user saw any
  // reaction to their tap. Now the store update, haptic, timer, and set
  // counter all run synchronously, in the same tick as the tap — the
  // mutation is fired with `.mutate()` (not awaited) and runs in the
  // background. useLogSet's onMutate has already optimistically appended
  // the log to the session before this function returns; if the request
  // later fails, its onError rolls that entry back out and the `onError`
  // callback passed here surfaces the alert — the failure path is a beat
  // later, not the success path.
  const logSet = () => {
    if (!activeSession || isSessionPaused) return;
    // Guards against a fast double-tap firing two requests before the store
    // updates — without this, both calls read the same currentSetNum and
    // both succeed, logging two sets with an identical set_number and
    // silently corrupting volume/PR totals for this session.
    if (isLogging) return;

    const weightInput = weight.trim();
    const w = Number(weightInput);
    const repsInput = reps.trim();
    const r = Number(repsInput);
    const name = resolvedName;

    if (!name) { Alert.alert('Missing exercise', 'Enter an exercise name.'); return; }
    if (!weightInput) {
      Alert.alert('Missing weight', 'Enter the load in kg. Use 0 for bodyweight exercises.');
      return;
    }
    if (!Number.isFinite(w) || w < 0) {
      Alert.alert('Invalid weight', 'Enter a valid load in kg. Use 0 for bodyweight exercises.');
      return;
    }
    if (!repsInput || !Number.isInteger(r) || r <= 0) {
      Alert.alert('Missing reps', 'Enter a whole number of reps greater than zero.');
      return;
    }

    const setNum = currentSetNum;
    const logData = { exercise_name: name, set_number: setNum, weight_kg: w, reps: r, rpe };

    // Brief re-entrancy guard only — cleared on the next tick rather than
    // held until the network settles, since there's no longer anything
    // to wait on before the UI is ready for the next tap.
    setIsLogging(true);
    setTimeout(() => setIsLogging(false), 250);

    const write = logSetMutation.mutateAsync({
      sessionId: activeSession.id,
      ...logData,
      client_request_id: `${activeSession.id}:${String(logData.exercise_name).toLowerCase()}:${logData.set_number}`,
    });
    pendingSetWrites.current.add(write);
    void write.then(async (result) => {
      if (result.pending) {
        const queued = await getPendingWorkoutSets(activeSession.id).catch(() => null);
        setPendingSetCount(queued ? queued.length : 1);
        setPendingSyncBlocked(Boolean(result.blocked));
        Alert.alert(
          result.blocked ? 'Set needs attention' : 'Set saved on this device',
          result.blocked
            ? `The set is safely retained on this device, but the server rejected the write. Keep this workout open and resolve the server response before finishing. ${result.errorMessage || 'Retry sync after checking your session.'}`
            : 'This set is safely queued on this device. Tap SYNC when your connection is back, or return to the app to retry. Keep this workout open until it syncs.'
        );
        return;
      }
      // A queue-read failure after a successful network write must never be
      // mistaken for a failed set or decrement the visible exercise count.
      try {
        const queued = await getPendingWorkoutSets(activeSession.id);
        setPendingSetCount(queued.length);
        if (queued.length === 0) setPendingSyncBlocked(false);
      } catch {
        setPendingSetCount((count) => Math.max(count, 1));
      }
    }).catch(() => {
      // A local outbox write failure is not an offline save. The mutation
      // rejects before the optimistic log is added, so roll back the card count.
      setExercises((previous) => previous.map((exercise, index) =>
        index === activeIdx
          ? { ...exercise, completed_sets: Math.max(0, exercise.completed_sets - 1) }
          : exercise
      ));
      Alert.alert('Set not saved', 'VYRN could not save this set to the device queue. Check device storage and try again.');
    }).finally(() => {
      pendingSetWrites.current.delete(write);
    });

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Start rest timer (parse from exercise card or default 90s)
    const ex = exercises[activeIdx];
    const restStr = ex?.rest || '';
    const parsed = parseInt(restStr.replace(/[^0-9]/g, ''));
    const restSec = (!isNaN(parsed) && parsed > 0) ? parsed : 90;
    setRestTotal(restSec);
    setRestStartedAt(Date.now());

    // Pre-fill next set with same weight
    setReps('');
    // Advance exercise card completed_sets
    if (exercises.length > 0) {
      setExercises(prev => prev.map((e, i) =>
        i === activeIdx ? { ...e, completed_sets: e.completed_sets + 1 } : e
      ));
    }
  };

  const nextExercise = () => {
    setWeight('');
    setReps('');
    setExerciseName('');
    setRestStartedAt(null);
    if (activeIdx < exercises.length - 1) {
      setActiveIdx(i => i + 1);
    }
  };

  const skipCurrentExercise = async () => {
    if (!activeSession || !ex || ex.skipped || ex.replaced || isExerciseChangeSaving || isSessionPaused) return;
    if (!activeSession.planned_workout_snapshot?.exercises?.length) {
      Alert.alert('Cannot skip this movement', 'This session has no approved exercise prescription to update.');
      return;
    }
    const confirmed = await confirmAsync(
      'Skip this exercise?',
      'Any sets already logged will stay in your history. The remaining sets will be marked as skipped.',
      'Skip exercise',
      'Keep it'
    );
    if (!confirmed) return;

    const originalName = ex.original_name || ex.name;
    setIsExerciseChangeSaving(true);
    try {
      await workoutApi.recordExerciseEvent(activeSession.id, {
        action: 'skip',
        exercise_name: originalName,
        client_request_id: activeSession.id + ':skip:' + originalName.toLowerCase(),
        reason: 'Athlete chose to skip the remaining sets',
      });
      setExercises((previous) => previous.map((item, index) =>
        index === activeIdx ? { ...item, skipped: true } : item
      ));
      setShowReplacementInput(false);
      setReplacementExerciseName('');
      const nextIndex = exercises.findIndex((item, index) =>
        index > activeIdx && !item.skipped && !item.replaced && item.completed_sets < item.sets
      );
      const fallbackIndex = exercises.findIndex((item, index) =>
        index !== activeIdx && !item.skipped && !item.replaced && item.completed_sets < item.sets
      );
      if (nextIndex >= 0) setActiveIdx(nextIndex);
      else if (fallbackIndex >= 0) setActiveIdx(fallbackIndex);
      setRestStartedAt(null);
    } catch (error: any) {
      Alert.alert(
        'Exercise not skipped',
        error?.response?.data?.detail || 'The workout is unchanged. Check your connection and try again.'
      );
    } finally {
      setIsExerciseChangeSaving(false);
    }
  };

  const saveExerciseReplacement = async () => {
    if (!activeSession || !ex || ex.skipped || ex.replaced || isExerciseChangeSaving || isSessionPaused) return;
    const replacement = replacementExerciseName.trim();
    if (!replacement) {
      Alert.alert('Replacement required', 'Enter the name of the exercise you want to use instead.');
      return;
    }
    if (!activeSession.planned_workout_snapshot?.exercises?.length) {
      Alert.alert('Cannot replace this movement', 'This session has no approved exercise prescription to update.');
      return;
    }

    const originalName = ex.original_name || ex.name;
    setIsExerciseChangeSaving(true);
    try {
      await workoutApi.recordExerciseEvent(activeSession.id, {
        action: 'replace',
        exercise_name: originalName,
        replacement_exercise: replacement,
        client_request_id: activeSession.id + ':replace:' + originalName.toLowerCase() + ':' + replacement.toLowerCase(),
        reason: 'Athlete-selected exercise replacement',
      });
      setExercises((previous) => previous.map((item, index) =>
        index === activeIdx
          ? {
              ...item,
              name: replacement,
              original_name: originalName,
              cue: 'Replacement for ' + originalName + ' — follow the approved set and rep target',
              replaced: true,
              skipped: false,
            }
          : item
      ));
      setReplacementExerciseName('');
      setShowReplacementInput(false);
      setRestStartedAt(null);
      setWeight('');
      setReps('');
    } catch (error: any) {
      Alert.alert(
        'Replacement not saved',
        error?.response?.data?.detail || 'The approved exercise remains unchanged. Try a supported movement and retry.'
      );
    } finally {
      setIsExerciseChangeSaving(false);
    }
  };

  const toggleSessionPause = async () => {
    if (!activeSession || isFinishing) return;
    try {
      const action = isSessionPaused ? 'resume' : 'pause';
      const response = await workoutApi.transitionSession(activeSession.id, action);
      const next = response.data;
      setActiveSession({ ...activeSession, ...next });
      setIsSessionPaused(next.status === 'paused');
      if (next.status === 'paused') setRestStartedAt(null);
    } catch (error: any) {
      Alert.alert('Workout not updated', error?.response?.data?.detail || 'Could not change the workout state. Your saved sets are still available.');
    }
  };

  const abandonSession = async () => {
    if (!activeSession || isFinishing) return;
    const queued = await getPendingWorkoutSets(activeSession.id).catch(() => null);
    if (queued === null || queued.length > 0) {
      Alert.alert(
        'Sets still waiting to sync',
        'Reconnect and sync the pending sets before abandoning this workout. The local queue will be retained.'
      );
      return;
    }
    const confirmed = await confirmAsync(
      'Abandon this workout?',
      'The session will be marked abandoned. Your already-saved set history will be retained.',
      'Abandon',
      'Keep training'
    );
    if (!confirmed) return;
    try {
      await workoutApi.transitionSession(activeSession.id, 'abandon');
      setActiveSession(null);
      setExercises([]);
      setActiveIdx(0);
      setIsSessionPaused(false);
      setRestStartedAt(null);
      setWeight('');
      setReps('');
    } catch (error: any) {
      Alert.alert('Could not abandon workout', error?.response?.data?.detail || 'Try again. The session has not been changed.');
    }
  };

  // Extracted so a failed completion can be retried directly — without this,
  // a network blip meant the only way to retry was dismissing the alert and
  // going back through the destructive "Finish Workout?" confirm again.
  // The backend PATCH /sessions/{id}/complete recomputes stats from the
  // already-persisted logs and upserts PRs idempotently, so calling it again
  // on the same session id after a failed/lost response is safe.
  // useCallback here matters for a reason that isn't about this function
  // itself: it's passed down (indirectly, via the handlers below) into
  // MoodPickerModal/WorkoutSummaryCard/MilestoneCelebration, all three
  // of which are now React.memo'd. WorkoutHUD re-renders every second
  // (the session clock and rest timer now update inside isolated children) — if
  // this were redefined on workout state changes, the memo on those three would
  // silently defeated the entire time a workout is active, which is
  // exactly when it matters most.
  const completeAndShowSummary = useCallback(async (feedback?: WorkoutFeedback) => {
    if (!activeSession || isFinishing) return;
    setIsFinishing(true);
    try {
      const sync = await syncPendingWorkoutSets(activeSession.id);
      setPendingSetCount(sync.remaining);
      setPendingSyncBlocked(sync.blocked);
      if (sync.remaining > 0) {
        Alert.alert(
          sync.blocked ? 'Server rejected a saved set' : 'Sets still waiting to sync',
          sync.blocked
            ? `The workout cannot be completed until this saved set is accepted by the server. ${sync.errorMessage || 'Check the set and session, then retry SYNC.'}`
            : 'Your workout is still safe on this device, but the server has not confirmed every set. Reconnect and sync before completing the session.'
        );
        return;
      }
      const res = await completeSessionMutation.mutateAsync({
        sessionId: activeSession.id,
        feedback,
      });
      const summary = res.data;
      setActiveSession(null);
      setExercises([]);
      setActiveIdx(0);
      setIsSessionPaused(false);
      setRestStartedAt(null);
      setSummaryData(summary || {
        total_volume_kg: Math.round(totalVolume),
        sets_logged: totalSets,
        exercises: [...new Set((activeSession.logs as SetLog[]).map(l => l.exercise_name))],
        exercise_count: new Set((activeSession.logs as SetLog[]).map(l => l.exercise_name)).size,
        best_set: null,
        session_minutes: Math.round((Date.now() - (activeSession.startedAt || Date.now())) / 60000),
      });
      setStreakData(computeMilestone(summary));
      setSummaryVisible(true);
    } catch {
      const retry = await confirmAsync(
        'Error',
        'Could not complete session. Check your connection and try again.',
        'Retry',
        'Cancel'
      );
      if (retry) await completeAndShowSummary(feedback);
    } finally {
      setIsFinishing(false);
    }
  }, [activeSession, isFinishing, totalVolume, totalSets, completeSessionMutation.mutateAsync]);

  const finishWorkout = async () => {
    if (!activeSession || isFinishing) return;
    const ok = await confirmAsync(
      'Finish Workout?',
      'This will end your session and save all sets.',
      'Finish',
      'Cancel'
    );
    if (!ok) return;

    // Do not close the session while an optimistic set write is unresolved.
    setIsFinishing(true);
    try {
      while (pendingSetWrites.current.size > 0) {
        await Promise.allSettled(Array.from(pendingSetWrites.current));
      }
      const sync = await syncPendingWorkoutSets(activeSession.id);
      setPendingSetCount(sync.remaining);
      setPendingSyncBlocked(sync.blocked);
      if (sync.remaining > 0) {
        Alert.alert(
          sync.blocked ? 'Server rejected a saved set' : 'Sets still waiting to sync',
          sync.blocked
            ? `VYRN has kept the set on this device, but the server rejected it. Resolve this response before finishing. ${sync.errorMessage || 'Check the session and retry SYNC.'}`
            : 'VYRN has kept your unsynced sets on this device. Reconnect and tap SYNC before finishing the workout.'
        );
        return;
      }
      setMoodPickerVisible(true);
    } catch {
      Alert.alert(
        'Could not sync workout sets',
        'Your pending sets remain saved on this device. Check the connection and try SYNC again before finishing.'
      );
    } finally {
      setIsFinishing(false);
    }
  };

  const handleFeedbackSelect = useCallback((feedback: WorkoutFeedback) => {
    setMoodPickerVisible(false);
    void completeAndShowSummary(feedback);
  }, [completeAndShowSummary]);

  const handleFeedbackSkip = useCallback(() => {
    setMoodPickerVisible(false);
    void completeAndShowSummary(undefined);
  }, [completeAndShowSummary]);

  // Group logs by exercise for display. This screen re-renders every
  // second (live workout clock) — groupedLogs() was previously a plain
  // function called twice per render (once to check .length, once to
  // .map()), each call reversing and regrouping the *entire* logs array
  // from scratch even though logs only actually change when a set is
  // completed, not every tick. useMemo keyed on the logs array means the
  // regroup only runs when a set is actually logged.
  const groupedLogs = React.useMemo((): Array<[string, SetLog[]]> => {
    const logs: SetLog[] = activeSession?.logs || [];
    const groups: Record<string, SetLog[]> = {};
    [...logs].reverse().forEach(log => {
      if (!groups[log.exercise_name]) groups[log.exercise_name] = [];
      groups[log.exercise_name].push(log);
    });
    return Object.entries(groups);
  }, [activeSession?.logs]);

  const ex = exercises[activeIdx];

  // These four callbacks must be declared before any early return below —
  // hooks can't be conditional, and the pre-session branch used to return
  // before reaching them, so the hook count differed between the
  // "no session" and "session started" renders (React's "Rendered more
  // hooks than during the previous render" error, thrown the instant
  // startSession() flips sessionStarted from false to true).
  const handleSummaryClose = useCallback(() => {
    setSummaryVisible(false);
    if (streakData) setTimeout(() => setStreakVisible(true), 300);
  }, [streakData]);

  const handleMilestoneClose = useCallback(() => setStreakVisible(false), []);

  // ── Pre-session ─────────────────────────────────────────────────────────────
  if (!sessionStarted) {
    return (
      <KeyboardAvoidingView
        style={[S.container, { paddingTop: insets.top, width: '100%', maxWidth: responsive.pageMaxWidth, alignSelf: 'center' }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <AmbientGlow variant="workout" />
        <WorkoutPlanPreview
          visible={planPreviewVisible}
          title={draftPlan?.name || 'Workout plan'}
          workoutType={draftPlan?.workoutType || recommendedWorkout || 'full_body'}
          estimatedMinutes={draftPlan?.estimatedMinutes}
          exercises={exercises}
          onChange={(next) => setExercises(next)}
          onApprove={approveDraftAndStart}
          onCancel={cancelPlanPreview}
          saving={isApprovingPlan}
          reason={draftPlan ? 'This proposal is not active until you approve it.' : undefined}
          muscleGroups={draftPlan?.muscleGroups}
          warmupNotes={warmupNotes}
          cooldownNotes={cooldownNotes}
          onWarmupNotesChange={setWarmupNotes}
          onCooldownNotesChange={setCooldownNotes}
        />
        <WorkoutSummaryCard
          visible={summaryVisible}
          data={summaryData}
          onClose={() => {
            setSummaryVisible(false);
            // Give the milestone card its own beat instead of stacking two
            // modals at once — it appears a moment after the summary closes.
            if (streakData) setTimeout(() => setStreakVisible(true), 300);
          }}
        />
        <MilestoneCelebration
          visible={streakVisible}
          data={streakData}
          onClose={() => setStreakVisible(false)}
        />
        <WorkoutHistoryModal
          visible={historyVisible}
          onClose={() => setHistoryVisible(false)}
        />
        <View style={S.screenBar}>
          <View>
            <Text style={S.screenEyebrow}>VYRN / TRAIN</Text>
            <Text style={S.screenBarTitle}>Your session</Text>
          </View>
          <ProfileAvatar size={42} onPress={() => router.push('/(tabs)/profile')} />
        </View>
        <ScrollView style={S.preSessionScroll} contentContainerStyle={S.preSession} showsVerticalScrollIndicator={false}>
          <View style={S.trainIntro}>
            <Text style={S.trainEyebrow}>YOUR TRAINING SPACE</Text>
            <Text style={S.gymTitle}>Make today count.</Text>
            <Text style={S.gymDesc}>
              Start a session, log every working set and let VYRN keep your rest and training history organised.
            </Text>
          </View>
          <View style={S.recommendationCard}>
            <View style={S.recommendationTop}>
              <Ionicons name="calendar-outline" size={15} color={COLORS.primaryGreen} />
              <Text style={S.recommendationLabel}>TODAY'S TRAINING</Text>
            </View>
            <Text style={S.recommendationTitle}>{recommendedWorkout || 'No session scheduled'}</Text>
            <Text style={S.recommendationNote}>
              {recommendedNote || 'Start from scratch or ask Coach to build a plan around your goal.'}
            </Text>
          </View>
          <View style={S.trainActions}>
            <Text style={S.actionSectionLabel}>CHOOSE HOW TO START</Text>
            <PressableScale style={S.startBtn} onPress={askCoachForWorkout} disabled={isRestoringSession || isBuildingPlan || isApprovingPlan} accessibilityRole="button" accessibilityLabel="Review today's workout before starting">
              <View style={S.actionCopy}>
                <Text style={S.startBtnText}>
                  {isRestoringSession
                    ? 'Checking saved session…'
                    : isBuildingPlan
                      ? 'Preparing your plan…'
                      : missionSummary?.recovery?.action === 'pain_review'
                        ? 'Training paused for pain review'
                        : 'Review today’s workout'}
                </Text>
                <Text style={S.actionHelper}>
                  {missionSummary?.recovery?.action === 'pain_review'
                    ? 'Read the Coach guidance before repeating the affected movement'
                    : 'See, edit and approve the exercise plan before training'}
                </Text>
              </View>
              {isBuildingPlan ? <ActivityIndicator size="small" color={COLORS.background} /> : <Ionicons name="arrow-forward" size={18} color={COLORS.background} />}
            </PressableScale>
            <PressableScale style={S.coachBtn} onPress={() => router.push('/(tabs)/coach')} disabled={isRestoringSession || isBuildingPlan} accessibilityRole="button" accessibilityLabel="Open Coach to personalize the workout">
              <Ionicons name="chatbubble-ellipses-outline" size={19} color={COLORS.coachPurple} />
              <View style={S.actionCopy}>
                <Text style={S.coachBtnText}>Customize with Coach</Text>
                <Text style={S.coachHelper}>Discuss your goals, constraints or exercise choices</Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={COLORS.textMuted} />
            </PressableScale>
          </View>
          <PressableScale style={S.historyBtn} onPress={() => setHistoryVisible(true)} accessibilityRole="button">
            <Ionicons name="time-outline" size={16} color={COLORS.textSecondary} />
            <Text style={S.historyBtnText}>View past workouts</Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
          </PressableScale>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Active session ───────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={[S.container, { paddingTop: insets.top, width: '100%', maxWidth: responsive.pageMaxWidth, alignSelf: 'center' }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <AmbientGlow variant="workout" />
      <MoodPickerModal
        visible={moodPickerVisible}
        onSelect={handleFeedbackSelect}
        onSkip={handleFeedbackSkip}
      />
      <WorkoutSummaryCard
        visible={summaryVisible}
        data={summaryData}
        onClose={handleSummaryClose}
      />
      <MilestoneCelebration
        visible={streakVisible}
        data={streakData}
        onClose={handleMilestoneClose}
      />

      {restStartedAt !== null && (
        <Reveal distance={5} duration={200}><RestTimerBar
          key={restStartedAt}
          startedAt={restStartedAt}
          total={restTotal}
          onSkip={clearRestTimer}
          onComplete={clearRestTimer}
        /></Reveal>
      )}

      <View style={S.screenBar}>
        <View>
          <Text style={S.screenEyebrow}>VYRN / TRAIN</Text>
          <Text style={S.screenBarTitle}>Your session</Text>
        </View>
        <ProfileAvatar size={42} onPress={() => router.push('/(tabs)/profile')} />
      </View>
      <SessionHeader
        startedAt={Number(activeSession?.startedAt) || Date.now()}
        totalVolume={Math.round(totalVolume)}
        setCount={totalSets}
        paused={isSessionPaused}
        pausedAt={activeSession?.paused_at || null}
        pausedDurationSeconds={Number(activeSession?.paused_duration_seconds || 0)}
      />

      {pendingSetCount > 0 && (
        <PressableScale
          style={S.pendingSyncBanner}
          onPress={() => {
            if (!activeSession?.id) return;
            void syncPendingWorkoutSets(activeSession.id)
              .then((result) => {
                setPendingSetCount(result.remaining);
                setPendingSyncBlocked(result.blocked);
                if (result.blocked) {
                  Alert.alert(
                    'Server rejected a saved set',
                    result.errorMessage || 'The set remains saved on this device. Check the session and set details before retrying.'
                  );
                }
              })
              .catch(() => setPendingSetCount((count) => Math.max(count, 1)));
          }}
          accessibilityRole="button"
          accessibilityLabel="Retry syncing saved workout sets"
        >
          <Ionicons name="cloud-upload-outline" size={16} color={COLORS.recoveryMed} />
          <Text style={S.pendingSyncText}>
            {pendingSetCount} set{pendingSetCount === 1 ? '' : 's'} saved on this device · {pendingSyncBlocked ? 'server needs attention' : 'waiting to sync'}
          </Text>
          <Text style={S.pendingSyncAction}>SYNC</Text>
        </PressableScale>
      )}

      {restoredPlanUnavailable && (
        <View style={S.planUnavailableBanner}>
          <Ionicons name="information-circle-outline" size={15} color={COLORS.recoveryMed} />
          <Text style={S.planUnavailableText}>
            This older session has no saved exercise prescription. Only logged movements were restored; original exercise order, targets and unstarted movements cannot be recovered.
          </Text>
        </View>
      )}

      {/* Exercise plan tabs */}
      {exercises.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={S.exTabsScroll}
          contentContainerStyle={S.exTabs}
        >
          {exercises.map((e, i) => {
            const done = e.skipped || (!e.target_unknown && e.completed_sets >= e.sets);
            return (
              <PressableScale
                key={i}
                style={[S.exTab, i === activeIdx && S.exTabActive, done && S.exTabDone]}
                onPress={() => setActiveIdx(i)}
              >
                <Text style={[S.exTabText, i === activeIdx && S.exTabTextActive]}>
                  {e.name.split(' ').slice(0, 2).join(' ')}
                </Text>
                <Text style={[S.exTabSets, done ? S.exTabSetsDone : i === activeIdx && S.exTabSetsActive]}>
                  {e.skipped ? 'SKIP' : e.target_unknown ? `${e.completed_sets} LOGGED` : String(e.completed_sets) + '/' + String(e.sets)}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      )}

      {/* Log card */}
      <Reveal delay={35} distance={8}><View style={S.exerciseCard}>
        {ex ? (
          <>
            <View style={S.exCardHeader}>
              <View>
                <Text style={S.setCount}>
                  {ex.skipped
                    ? 'SKIPPED'
                    : ex.target_unknown
                      ? `SET ${ex.completed_sets + 1} · TARGET UNKNOWN`
                      : 'SET ' + (ex.completed_sets + 1) + ' / ' + ex.sets}
                </Text>
                <Text style={S.exerciseName}>{ex.name}</Text>
                <Text style={S.exerciseTarget}>
                  {ex.target_unknown
                    ? (ex.completed_sets > 0
                      ? `No saved target · last logged: ${ex.load} × ${ex.reps}`
                      : 'Original exercise target was not saved')
                    : ex.skipped
                      ? 'Remaining sets skipped'
                      : ex.replaced
                        ? 'Replacement · ' + ex.reps + ' reps · ' + ex.load
                        : ex.reps + ' reps · ' + ex.load}
                </Text>
              </View>
              {/* Next exercise button */}
              {activeIdx < exercises.length - 1 && (
                <PressableScale style={S.nextExInline} onPress={nextExercise}>
                  <Text style={S.nextExInlineText}>Next</Text>
                  <Ionicons name="arrow-forward" size={14} color={COLORS.strain} />
                </PressableScale>
              )}
            </View>
            {ex.cue ? (
              <View style={S.cueRow}>
                <Ionicons name="bulb-outline" size={12} color={COLORS.textMuted} />
                <Text style={S.cue}>{ex.cue}</Text>
              </View>
            ) : null}
            {activeSession?.planned_workout_snapshot?.exercises?.length && !ex.skipped && !ex.replaced ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <PressableScale
                  onPress={skipCurrentExercise}
                  disabled={isExerciseChangeSaving || isSessionPaused || isFinishing}
                  style={{
                    flex: 1,
                    minHeight: 38,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: isExerciseChangeSaving ? 0.5 : 1,
                  }}
                >
                  <Text style={{ color: COLORS.textSecondary, fontSize: 10, fontWeight: '700' }}>
                    {isExerciseChangeSaving ? 'SAVING…' : 'SKIP EXERCISE'}
                  </Text>
                </PressableScale>
                <PressableScale
                  onPress={() => {
                    setReplacementExerciseName('');
                    setShowReplacementInput(true);
                  }}
                  disabled={isExerciseChangeSaving || isSessionPaused || isFinishing}
                  style={{
                    flex: 1,
                    minHeight: 38,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: alpha(COLORS.primaryGreen, 0.45),
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: COLORS.primaryGreen, fontSize: 10, fontWeight: '700' }}>
                    REPLACE EXERCISE
                  </Text>
                </PressableScale>
              </View>
            ) : null}
            {showReplacementInput && !ex.skipped && !ex.replaced ? (
              <View style={{ gap: 8, marginTop: 10 }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: 10 }}>
                  Enter a supported replacement. Equipment and injury rules are checked before it is saved.
                </Text>
                <TextInput
                  style={S.exerciseNameInput}
                  placeholder="Replacement exercise name"
                  placeholderTextColor={COLORS.textMuted}
                  value={replacementExerciseName}
                  onChangeText={setReplacementExerciseName}
                  editable={!isExerciseChangeSaving}
                  returnKeyType="done"
                  onSubmitEditing={saveExerciseReplacement}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <PressableScale
                    onPress={() => {
                      setShowReplacementInput(false);
                      setReplacementExerciseName('');
                    }}
                    disabled={isExerciseChangeSaving}
                    style={{ flex: 1, minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: COLORS.textSecondary, fontSize: 10, fontWeight: '700' }}>CANCEL</Text>
                  </PressableScale>
                  <PressableScale
                    onPress={saveExerciseReplacement}
                    disabled={isExerciseChangeSaving || !replacementExerciseName.trim()}
                    style={{ flex: 1, minHeight: 38, borderRadius: 10, backgroundColor: alpha(COLORS.primaryGreen, 0.14), alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: COLORS.primaryGreen, fontSize: 10, fontWeight: '700' }}>
                      {isExerciseChangeSaving ? 'SAVING…' : 'SAVE REPLACEMENT'}
                    </Text>
                  </PressableScale>
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <View style={S.manualEntry}>
            {resolvedName ? (
              <Text style={S.setCountManual}>{exerciseName} — SET {currentSetNum}</Text>
            ) : (
              <Text style={S.manualTitle}>Log a Set</Text>
            )}
            <TextInput
              style={S.exerciseNameInput}
              placeholder="Exercise name (e.g. Bench Press)"
              placeholderTextColor={COLORS.textMuted}
              value={exerciseName}
              onChangeText={setExerciseName}
              returnKeyType="next"
              keyboardAppearance="light"
              selectionColor={COLORS.primaryGreen}
              underlineColorAndroid="transparent"
            />
          </View>
        )}

        {ex?.skipped ? (
          <View style={{ paddingVertical: 18, alignItems: 'center', gap: 6 }}>
            <Ionicons name="checkmark-circle-outline" size={22} color={COLORS.textMuted} />
            <Text style={{ color: COLORS.textSecondary, fontSize: 11, fontWeight: '700' }}>
              This exercise was skipped. Logged sets have been retained.
            </Text>
          </View>
        ) : (
        <>
        {/* Weight + Reps inputs */}
        <View style={S.logRow}>
          <View style={S.inputWrap}>
            <TextInput
              style={S.logInput}
              placeholder="kg or 0"
              placeholderTextColor={COLORS.textMuted}
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              keyboardAppearance="dark"
              selectionColor={COLORS.primaryGreen}
              underlineColorAndroid="transparent"
            />
            <Text style={S.inputUnit}>kg</Text>
          </View>
          <View style={S.inputWrap}>
            <TextInput
              style={S.logInput}
              placeholder="reps"
              placeholderTextColor={COLORS.textMuted}
              value={reps}
              onChangeText={setReps}
              keyboardType="number-pad"
              keyboardAppearance="dark"
              selectionColor={COLORS.primaryGreen}
              underlineColorAndroid="transparent"
            />
            <Text style={S.inputUnit}>reps</Text>
          </View>
        </View>
        <Text style={S.inputHint}>{isSessionPaused ? 'This workout is paused. Resume to log another set.' : 'Use 0 kg for bodyweight exercises.'}</Text>

        {/* Previous set ghost */}
        <PrevSetGhost log={prevSet} />

        {/* RPE selector */}
        <View style={S.rpeRow}>
          <Text style={S.rpeLabel}>RPE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={S.rpeChips}>
              {RPE_LEVELS.map(r => {
                const active = rpe === r;
                const color  = rpeColor(r);
                return (
                  <PressableScale
                    key={r}
                    style={[
                      S.rpeChip,
                      active && { backgroundColor: alpha(color, 0.15), borderColor: color },
                    ]}
                    onPress={() => setRpe(r)}
                  >
                    <Text style={[S.rpeChipText, active && { color }]}>{r}</Text>
                  </PressableScale>
                );
              })}
            </View>
          </ScrollView>
        </View>

        <PressableScale
          style={[S.logBtn, (isLogging || isSessionPaused) && S.logBtnDisabled]}
          onPress={logSet}
          disabled={isLogging || isSessionPaused}
          accessibilityRole="button"
          accessibilityLabel="Log set and start rest timer"
          accessibilityState={{ disabled: isLogging }}
        >
          <Ionicons name="add-circle-outline" size={16} color={COLORS.background} />
          <Text style={S.logBtnText}>{isSessionPaused ? 'RESUME TO LOG SETS' : isLogging ? 'LOGGING…' : 'LOG SET + START REST'}</Text>
        </PressableScale>
        </>
        )}
      </View></Reveal>

      {/* Sets logged */}
      <Reveal delay={85} style={S.logsReveal}><ScrollView style={S.logsScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
        <Text style={S.logsLabel}>SETS LOGGED</Text>
        {groupedLogs.length === 0 ? (
          <Text style={S.noLogs}>No sets yet — log your first set above</Text>
        ) : (
          groupedLogs.map(([name, logs], gi) => (
            <View key={gi} style={S.exerciseGroup}>
              <Text style={S.groupExerciseName}>{name}</Text>
              {logs.map((log, i) => (
                <View key={i} style={S.setRow}>
                  <Text style={S.setLabel}>Set {log.set_number}</Text>
                  <Text style={S.setDetails}>{log.weight_kg}kg × {log.reps} reps</Text>
                  <View style={[S.rpeBadge, { borderColor: alpha(rpeColor(log.rpe), 0.4) }]}>
                    <Text style={[S.rpeBadgeText, { color: rpeColor(log.rpe) }]}>
                      RPE {log.rpe}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ))
        )}
        <View style={{ height: 16 }} />
      </ScrollView></Reveal>

      {isSessionPaused && (
        <View style={S.pausedBanner}>
          <Ionicons name="pause-circle-outline" size={16} color={COLORS.recoveryMed} />
          <Text style={S.pausedBannerText}>Workout paused. Resume when you are ready to continue.</Text>
        </View>
      )}
      <View style={S.sessionActions}>
        <PressableScale
          style={S.pauseBtn}
          onPress={toggleSessionPause}
          disabled={isFinishing}
          accessibilityRole="button"
          accessibilityLabel={isSessionPaused ? 'Resume workout' : 'Pause workout'}
        >
          <Ionicons name={isSessionPaused ? 'play-outline' : 'pause-outline'} size={16} color={COLORS.text} />
          <Text style={S.pauseBtnText}>{isSessionPaused ? 'RESUME' : 'PAUSE'}</Text>
        </PressableScale>
        <PressableScale
          style={S.abandonBtn}
          onPress={abandonSession}
          disabled={isFinishing}
          accessibilityRole="button"
          accessibilityLabel="Abandon workout"
        >
          <Ionicons name="exit-outline" size={16} color={COLORS.recoveryLow} />
          <Text style={S.abandonBtnText}>ABANDON</Text>
        </PressableScale>
        <PressableScale
          style={[S.finishBtn, { flex: 1.8 }, isFinishing && S.logBtnDisabled]}
          onPress={finishWorkout}
          disabled={isFinishing}
          accessibilityRole="button"
          accessibilityLabel="Finish workout and save session"
          accessibilityState={{ disabled: isFinishing }}
        >
          <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.primaryGreen} />
          <Text style={S.finishBtnText}>{isFinishing ? 'SAVING…' : 'FINISH'}</Text>
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Timer styles ─────────────────────────────────────────────────────────────
// Rest timer bar — subtle green-tinted strip that never competes with the
// exercise card below it; the countdown number is the only strong element.
const T = StyleSheet.create({
  timerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  timerVisual: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  timerRingText: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  timerSeconds: { color: COLORS.text, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 18, lineHeight: 20 },
  timerUnit: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.1, marginTop: 1 },
  timerCopy: { flex: 1, minWidth: 0, gap: 3 },
  timerLabel: { ...EYEBROW, fontSize: 10, letterSpacing: 1.2 },
  timerTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 12, lineHeight: 16 },
  timerHint: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 13 },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.button,
  },
  skipText: { ...EYEBROW, color: COLORS.textSecondary, fontSize: 10 },
});

// ─── Session header styles ────────────────────────────────────────────────────
const H = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.md,
  },
  timeBlock: { flex: 1, gap: 2 },
  pill: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: SPACING.xs,
    backgroundColor: alpha(COLORS.primaryGreen, 0.08), borderRadius: 20, paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs, borderWidth: 1, borderColor: alpha(COLORS.primaryGreen, 0.25),
    marginBottom: 3,
  },
  activeDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.primaryGreen },
  pillText: { ...EYEBROW, color: COLORS.primaryGreen, fontSize: 10 },
  timeValue: { color: COLORS.text, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 25, lineHeight: 29, letterSpacing: -0.7 },
  timeLabel: { ...EYEBROW, color: COLORS.textMuted, fontSize: 10, letterSpacing: 1.05 },
  metrics: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  stat: { alignItems: 'flex-end', minWidth: 45 },
  statVal: { color: COLORS.text, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 17, lineHeight: 22 },
  statLabel: { ...EYEBROW, color: COLORS.textDim, fontSize: 10, marginTop: 1 },
  metricDivider: { width: 1, height: 27, backgroundColor: COLORS.border },
});

// ─── Ghost styles ─────────────────────────────────────────────────────────────
const G = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.sm },
  text: { ...BODY, color: COLORS.textDim, fontSize: 12 },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  // Was a one-off #121212 — now matches the true-black canvas every other
  // screen in the app uses.
  container: { flex: 1, backgroundColor: COLORS.background },

  // Shared screen identity/header for both preparation and active training.
  screenBar: { minHeight: 68, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.background },
  screenEyebrow: { ...EYEBROW, color: COLORS.primaryGreen, fontSize: 10, letterSpacing: 1.3 },
  screenBarTitle: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 19, lineHeight: 24 },
  // Pre-session: a clear plan preview and two distinct start paths.
  preSessionScroll: { flex: 1 },
  preSession: { flexGrow: 1, alignItems: 'stretch', paddingHorizontal: SPACING.xl, paddingTop: SPACING.xl, paddingBottom: 28 },
  trainIntro: { marginBottom: SPACING.xl },
  trainEyebrow: { ...EYEBROW, color: COLORS.primaryGreen, fontSize: 10, marginBottom: SPACING.sm },
  gymTitle: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 34, lineHeight: 40, letterSpacing: -0.9, textAlign: 'left' },
  gymDesc: { ...BODY, color: COLORS.textSecondary, fontSize: 13, textAlign: 'left', lineHeight: 20, marginTop: SPACING.sm, maxWidth: 360 },
  recommendationCard: { backgroundColor: COLORS.card, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.lg, marginBottom: SPACING.xl },
  recommendationTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  recommendationLabel: { ...EYEBROW, color: COLORS.textMuted, fontSize: 10 },
  recommendationTitle: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 21, lineHeight: 27 },
  recommendationNote: { ...BODY, color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, marginTop: SPACING.xs },
  trainActions: { gap: SPACING.sm },
  actionSectionLabel: { ...EYEBROW, color: COLORS.textMuted, fontSize: 10, marginBottom: SPACING.xs },
  actionCopy: { flex: 1, alignItems: 'flex-start', minWidth: 0, gap: 3 },
  actionHelper: { color: alpha(COLORS.background, 0.72), fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15 },
  coachHelper: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15 },
  startBtn: { backgroundColor: COLORS.primaryGreen, borderRadius: RADIUS.button, paddingVertical: SPACING.lg, paddingHorizontal: SPACING.lg, width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.md, marginBottom: SPACING.xs },
  startBtnText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 15, letterSpacing: 0.1 },
  coachBtn: { backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.button, paddingVertical: SPACING.lg, paddingHorizontal: SPACING.lg, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: COLORS.borderLight, flexDirection: 'row', justifyContent: 'flex-start', gap: SPACING.md },
  coachBtnText: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13 },
  historyBtn: { marginTop: SPACING.lg, paddingVertical: SPACING.md, paddingHorizontal: SPACING.sm, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm },
  historyBtnText: { color: COLORS.textSecondary, fontFamily: FONTS.medium, fontSize: 12 },

  // Exercise tabs
  exTabsScroll: { maxHeight: 68 },
  exTabs:       { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.sm, flexDirection: 'row' },
  exTab:        { backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.button, paddingHorizontal: SPACING.md,
                  paddingVertical: SPACING.sm, borderWidth: 1, borderColor: COLORS.borderLight, alignItems: 'center' },
  exTabActive:  { backgroundColor: alpha(COLORS.primaryGreen, 0.08), borderColor: alpha(COLORS.primaryGreen, 0.4) },
  exTabDone:    { opacity: 0.45 },
  exTabText:    { ...BODY, color: COLORS.textMuted, fontSize: 11, fontFamily: FONTS.semibold },
  exTabTextActive:{ color: COLORS.primaryGreen },
  exTabSets: { ...BODY, color: COLORS.textMuted, fontSize: 10, marginTop: 2 },
  exTabSetsActive:{ color: alpha(COLORS.primaryGreen, 0.7) },
  exTabSetsDone:{ color: COLORS.borderLight },

  // Log card — the single most important surface during a session, so it
  // gets the same card treatment (radius, border) as everywhere else in
  // the app rather than its own one-off values.
  exerciseCard:   { backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card, margin: SPACING.md,
                    marginTop: SPACING.sm, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.cardBorder },
  exCardHeader:   { flexDirection: 'row', justifyContent: 'space-between',
                    alignItems: 'flex-start', marginBottom: SPACING.sm },
  setCount: { ...EYEBROW, color: COLORS.primaryGreen, fontSize: 10, marginBottom: 2 },
  exerciseName:   { color: COLORS.text, fontFamily: FONTS.extrabold, fontSize: 20 },
  exerciseTarget: { ...BODY, color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  nextExInline:   { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
                    backgroundColor: alpha(COLORS.strain, 0.1), borderRadius: RADIUS.badge, paddingHorizontal: SPACING.sm,
                    paddingVertical: SPACING.sm, borderWidth: 1, borderColor: alpha(COLORS.strain, 0.25) },
  nextExInlineText:{ color: COLORS.strain, fontFamily: FONTS.semibold, fontSize: 12 },
  cueRow:         { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.md },
  cue: { ...BODY, color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic', flex: 1 },
  manualEntry:    { marginBottom: SPACING.sm },
  manualTitle:    { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 17, marginBottom: SPACING.sm },
  setCountManual: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 13, marginBottom: SPACING.sm },
  exerciseNameInput:{ backgroundColor: COLORS.inputBg, borderRadius: RADIUS.button, paddingHorizontal: SPACING.lg,
                      paddingVertical: SPACING.md, color: COLORS.text, fontFamily: FONTS.regular, fontSize: 15, marginBottom: SPACING.xs,
                      borderWidth: 1, borderColor: COLORS.borderLight },

  logRow:    { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.sm, marginBottom: SPACING.sm },
  inputWrap: { flex: 1, position: 'relative' },
  // Big tappable number fields — deliberately the largest text on the
  // screen next to the rest timer, since weight/reps are what the user
  // is looking at between every single set.
  logInput:  { backgroundColor: COLORS.inputBg, borderRadius: RADIUS.button, paddingVertical: SPACING.md,
               paddingHorizontal: SPACING.lg, color: COLORS.text, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 28,
               textAlign: 'center', borderWidth: 1, borderColor: COLORS.borderLight },
  inputUnit: { position: 'absolute', bottom: 6, right: SPACING.sm, color: COLORS.textMuted,
               fontFamily: FONTS.semibold, fontSize: 11 },
  inputHint: { color: COLORS.textMuted, fontSize: 11, marginTop: -SPACING.xs, marginBottom: SPACING.sm },

  rpeRow:    { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  rpeLabel: { ...EYEBROW, color: COLORS.textSecondary, fontSize: 10, width: 30 },
  rpeChips:  { flexDirection: 'row', gap: SPACING.xs },
  rpeChip:   { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: RADIUS.badge,
               backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.borderLight },
  rpeChipText:{ color: COLORS.textSecondary, fontFamily: FONTS.semibold, fontSize: 12 },

  // Primary action during an active session — same weight and radius as
  // the Dashboard's "Start Workout" CTA so every screen's main action
  // reads the same way.
  logBtn:     { backgroundColor: COLORS.primaryGreen, borderRadius: RADIUS.button, paddingVertical: SPACING.md,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  logBtnDisabled: { opacity: 0.5 },
  logBtnText: { color: COLORS.background, fontFamily: FONTS.extrabold, fontSize: 13, letterSpacing: 0.5 },

  // Logs
  logsScroll:       { flex: 1, paddingHorizontal: SPACING.md },
  logsReveal: { flex: 1 },
  logsLabel: { ...EYEBROW, color: COLORS.textMuted, fontSize: 10,
                      marginBottom: SPACING.sm, marginTop: SPACING.xs },
  noLogs: { ...BODY, color: COLORS.textDim, fontSize: 13, textAlign: 'center', paddingTop: SPACING.md },
  exerciseGroup:    { marginBottom: SPACING.sm, backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card,
                      overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  groupExerciseName:{ color: COLORS.text, fontFamily: FONTS.bold, fontSize: 13,
                      paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
                      borderBottomWidth: 1, borderBottomColor: COLORS.border },
  setRow:           { flexDirection: 'row', alignItems: 'center',
                      paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
                      borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder, gap: SPACING.md },
  setLabel:         { ...BODY, color: COLORS.textMuted, fontFamily: FONTS.semibold, fontSize: 11, width: 40 },
  setDetails: { ...BODY, color: COLORS.textSecondary, fontSize: 13, flex: 1 },
  rpeBadge:         { borderRadius: RADIUS.badge, paddingHorizontal: 7, paddingVertical: 2,
                      backgroundColor: COLORS.cardElevated, borderWidth: 1 },
  rpeBadgeText:     { fontFamily: FONTS.semibold, fontSize: 11 },

  // Secondary/closing action — kept visually quieter than the green Log
  // Set CTA above (tinted, not solid) since it ends the session rather
  // than driving it.
  planUnavailableBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginTop: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.button, backgroundColor: alpha(COLORS.recoveryMed, 0.09), borderWidth: 1, borderColor: alpha(COLORS.recoveryMed, 0.24) },
  planUnavailableText: { ...BODY, flex: 1, color: COLORS.recoveryMed, fontSize: 10, lineHeight: 15 },
  pendingSyncBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginTop: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.button, backgroundColor: alpha(COLORS.recoveryMed, 0.09), borderWidth: 1, borderColor: alpha(COLORS.recoveryMed, 0.28) },
  pendingSyncText: { ...BODY, color: COLORS.textSecondary, fontSize: 11, flex: 1 },
  pendingSyncAction: { color: COLORS.recoveryMed, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.8 },
  sessionActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  pauseBtn: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.button, borderWidth: 1, borderColor: COLORS.borderLight, backgroundColor: COLORS.card },
  pauseBtnText: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.5 },
  abandonBtn: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: RADIUS.button, borderWidth: 1, borderColor: alpha(COLORS.recoveryLow, 0.35), backgroundColor: COLORS.card },
  abandonBtnText: { color: COLORS.recoveryLow, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.4 },
  pausedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SPACING.lg, marginTop: SPACING.sm, padding: SPACING.sm, borderRadius: RADIUS.button, backgroundColor: alpha(COLORS.recoveryMed, 0.1), borderWidth: 1, borderColor: alpha(COLORS.recoveryMed, 0.25) },
  pausedBannerText: { color: COLORS.textSecondary, fontFamily: FONTS.medium, fontSize: 10, flex: 1 },
  finishBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: SPACING.sm, margin: SPACING.md, backgroundColor: alpha(COLORS.primaryGreen, 0.08), borderRadius: RADIUS.button,
                   paddingVertical: SPACING.lg, borderWidth: 1, borderColor: alpha(COLORS.primaryGreen, 0.25) },
  // Was a hardcoded #4CAF50 — a different green from every other accent
  // in the app. Now the same primaryGreen used everywhere else.
  finishBtnText: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 14, letterSpacing: 0.5 },
});

export default React.memo(WorkoutHUD);