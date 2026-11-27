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
import {
  View, Text, StyleSheet, ScrollView,
  TextInput, Alert, Animated, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { workoutApi, coachApi } from '../../utils/api';
import { confirmAsync } from '../../utils/confirm';
import { useStore } from '../../store';
import { useCompleteSession, useLogSet } from '../../hooks/useWorkoutMutations';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS, EYEBROW, BODY } from '../../theme/typography';
import { SPACING, RADIUS } from '../../theme/spacing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import WorkoutSummaryCard from './WorkoutSummaryCard';
import WorkoutHistoryModal from './WorkoutHistoryModal';
import MilestoneCelebration from './MilestoneCelebration';
import MoodPickerModal, { MoodValue } from './MoodPickerModal';
import PressableScale from '../ui/PressableScale';
import Reveal from '../shared/Reveal';

interface ExerciseCard {
  name: string;
  sets: number;
  reps: string;
  load: string;
  cue: string;
  rest: string;
  completed_sets: number;
}

interface SetLog {
  exercise_name: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe: number;
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
    const animation = Animated.timing(ringProgress, {
      toValue: pct,
      duration: 220,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [pct, ringProgress]);
  const ringOffset = ringProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });
  const ringSize = 58;
  const ringStroke = 4;
  const ringRadius = (ringSize - ringStroke) / 2;
  const circumference = 2 * Math.PI * ringRadius;

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
}: {
  startedAt: number;
  totalVolume: number;
  setCount: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  // Keep the live clock inside this small component. A one-second clock tick
  // must not re-render exercise inputs, logged sets, or the rest of the HUD.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
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
          <Text style={H.pillText}>LIVE SESSION</Text>
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
  // Selector form — see src/store/index.ts. This screen already re-renders
  // every second for the live clock/rest timer; without a selector it was
  // ALSO re-rendering on every chat message and CNS-fatigue update fired
  // from the Coach/Dashboard tabs in the background.
  const insets = useSafeAreaInsets();
  const {
    activeSession, setActiveSession, addLogToSession, setCnsFatigue,
  } = useStore((s) => ({
    activeSession: s.activeSession,
    setActiveSession: s.setActiveSession,
    addLogToSession: s.addLogToSession,
    setCnsFatigue: s.setCnsFatigue,
  }));

  const [exercises, setExercises]       = useState<ExerciseCard[]>([]);
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
  const [isFinishing, setIsFinishing]   = useState(false);
  const [streakVisible, setStreakVisible] = useState(false);
  const [streakData, setStreakData]     = useState<MilestoneInfo | null>(null);
  const [moodPickerVisible, setMoodPickerVisible] = useState(false);
  const [pendingMood, setPendingMood]   = useState<MoodValue | undefined>(undefined);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

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
          .filter((session: any) => session && session.completed !== true)
          .sort((a: any, b: any) =>
            new Date(b.created_at || b.session_date || 0).getTime() -
            new Date(a.created_at || a.session_date || 0).getTime()
          );
        const session = pending[0];
        if (!alive || !session) return;

        const logs: SetLog[] = (Array.isArray(session.exercise_logs) ? session.exercise_logs : [])
          .map((log: any) => ({
            exercise_name: String(log.exercise_name || ''),
            set_number: Number(log.set_number || 1),
            weight_kg: Number(log.weight_kg || 0),
            reps: Number(log.reps || 0),
            rpe: Number(log.rpe ?? 8),
          }))
          .filter((log: SetLog) => log.exercise_name.length > 0)
          .sort((a: SetLog, b: SetLog) => a.set_number - b.set_number);

        const names = [...new Set(logs.map((log) => log.exercise_name))];
        const restoredExercises: ExerciseCard[] = names.map((name) => {
          const exerciseLogs = logs.filter((log) => log.exercise_name === name);
          const last = exerciseLogs[exerciseLogs.length - 1];
          return {
            name,
            sets: Math.max(3, exerciseLogs.length + 1),
            reps: String(last?.reps || 8),
            load: last ? `${last.weight_kg}kg` : '',
            cue: 'Continue your saved session',
            rest: '90 sec',
            completed_sets: exerciseLogs.length,
          };
        });

        const createdAt = session.created_at ? new Date(session.created_at).getTime() : Date.now();
        setActiveSession({
          ...session,
          logs,
          startedAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        });
        setExercises(restoredExercises);
        if (restoredExercises.length > 0) setActiveIdx(restoredExercises.length - 1);
      } catch (error: any) {
        if (__DEV__) console.warn('[Workout] Could not restore active session', error?.message || error);
      } finally {
        if (alive) setIsRestoringSession(false);
      }
    })();

    return () => { alive = false; };
  }, []);

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
  const startSession = async () => {
    if (activeSession || isRestoringSession) return;
    try {
      const res = await workoutApi.createSession({ day_label: 'Training Session' });
      setActiveSession({ ...res.data, logs: [], startedAt: Date.now() });
    } catch {
      Alert.alert('Error', 'Could not start session.');
    }
  };

  const askCoachForWorkout = async () => {
    try {
      const res = await coachApi.chat("What's my workout today?");
      const sd = res.data?.structured_decision;
      if (sd?.exercises?.length > 0) {
        setExercises(sd.exercises.map((e: any) => ({
          name: e.name,
          sets: parseInt(e.sets) || 3,
          reps: e.reps || '8',
          load: e.weight || '',
          cue:  e.focus  || '',
          rest: e.rest   || '',
          completed_sets: 0,
        })));
        setActiveIdx(0);
        if (!activeSession) await startSession();
      } else {
        Alert.alert('Coach', res.data?.reply || 'Check the Coach tab for your plan.');
      }
    } catch {
      Alert.alert('Error', 'Could not fetch workout plan.');
    }
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
    if (!activeSession) return;
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

    logSetMutation.mutate(
      { sessionId: activeSession.id, ...logData },
      {
        onError: () => {
          setExercises((previous) => previous.map((exercise, index) =>
            index === activeIdx
              ? { ...exercise, completed_sets: Math.max(0, exercise.completed_sets - 1) }
              : exercise
          ));
          Alert.alert('Error', 'Could not log set. It has been removed from your session.');
        },
      }
    );

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
  const completeAndShowSummary = useCallback(async (moodOverride?: MoodValue) => {
    if (!activeSession || isFinishing) return;
    setIsFinishing(true);
    // moodOverride avoids a stale-closure read of `pendingMood` right after
    // setPendingMood() — state updates aren't synchronous, so the caller
    // passes the freshly-picked value directly instead of relying on it
    // having already landed in state by the time this runs.
    const moodToSend = moodOverride ?? pendingMood;
    try {
      const res = await completeSessionMutation.mutateAsync({
        sessionId: activeSession.id,
        mood: moodToSend,
      });
      const summary = res.data;
      setActiveSession(null);
      setExercises([]);
      setActiveIdx(0);
      setRestStartedAt(null);
      setSummaryData(summary || {
        total_volume_kg: Math.round(totalVolume),
        sets_logged: totalSets,
        exercises: [...new Set((activeSession.logs as SetLog[]).map(l => l.exercise_name))],
        exercise_count: new Set((activeSession.logs as SetLog[]).map(l => l.exercise_name)).size,
        best_set: null,
        session_minutes: Math.round((Date.now() - (activeSession.startedAt || Date.now())) / 60000),
      });
      // Queue a milestone card (if this session hit a streak milestone) to
      // show right after the summary card is dismissed, so the two
      // celebrations don't compete for attention at once.
      setStreakData(computeMilestone(summary));
      setSummaryVisible(true);
    } catch {
      // Local session state is left untouched here on purpose — the sets
      // already logged during the session live server-side (each logSet
      // call already persisted), so nothing is lost and Retry can safely
      // call the same idempotent endpoint again.
      // BUG FIX: same web/Alert.alert button-array issue as finishWorkout()
      // above — use confirmAsync so Retry actually fires on web.
      const retry = await confirmAsync(
        'Error',
        'Could not complete session. Check your connection and try again.',
        'Retry',
        'Cancel'
      );
      if (retry) await completeAndShowSummary(moodToSend);
    } finally {
      setIsFinishing(false);
    }
  }, [activeSession, isFinishing, pendingMood, totalVolume, totalSets, completeSessionMutation.mutateAsync]);

  const finishWorkout = async () => {
    if (!activeSession) return;
    // BUG FIX: this used to call Alert.alert(title, message, [buttons]) directly.
    // react-native-web renders NOTHING for the multi-button form and never
    // fires onPress, so on web (this build) tapping "Finish Workout" looked
    // like the button did nothing at all. confirmAsync() is the cross-platform
    // helper built for exactly this (see utils/confirm.ts) — use it here too.
    const ok = await confirmAsync(
      'Finish Workout?',
      'This will end your session and save all sets.',
      'Finish',
      'Cancel'
    );
    // One optional tap before the summary — see MoodPickerModal for why
    // this is the moment it's asked, and why it's skippable.
    if (ok) setMoodPickerVisible(true);
  };

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
  const handleMoodSelect = useCallback((mood: MoodValue) => {
    setPendingMood(mood);
    setMoodPickerVisible(false);
    completeAndShowSummary(mood);
  }, [completeAndShowSummary]);

  const handleMoodSkip = useCallback(() => {
    setPendingMood(undefined);
    setMoodPickerVisible(false);
    completeAndShowSummary(undefined);
  }, [completeAndShowSummary]);

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
        <View style={S.preSession}>
          <View style={S.preBadge}>
            <Ionicons name="barbell-outline" size={28} color={COLORS.primaryGreen} />
          </View>
          <Text style={S.gymTitle}>Ready to train?</Text>
          <Text style={S.gymSubtitle}>Your next session starts here.</Text>
          <Text style={S.gymDesc}>
            Track each set, manage your rest and keep your progress in one place.
            Start with a blank session or let your coach build today's plan.
          </Text>
          <PressableScale style={S.startBtn} onPress={startSession} disabled={isRestoringSession}>
            <Text style={S.startBtnText}>{isRestoringSession ? 'Checking saved session…' : 'Start empty session'}</Text>
          </PressableScale>
          <PressableScale style={S.coachBtn} onPress={askCoachForWorkout} disabled={isRestoringSession}>
            <Ionicons name="flash" size={16} color={COLORS.primaryGreen} />
            <Text style={S.coachBtnText}>Build today's plan with Coach</Text>
          </PressableScale>
          <PressableScale style={S.historyBtn} onPress={() => setHistoryVisible(true)}>
            <Ionicons name="time-outline" size={16} color={COLORS.textSecondary} />
            <Text style={S.historyBtnText}>View workout history</Text>
          </PressableScale>
        </View>
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
      <MoodPickerModal
        visible={moodPickerVisible}
        onSelect={handleMoodSelect}
        onSkip={handleMoodSkip}
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

      <SessionHeader
        startedAt={Number(activeSession?.startedAt) || Date.now()}
        totalVolume={Math.round(totalVolume)}
        setCount={totalSets}
      />

      {/* Exercise plan tabs */}
      {exercises.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={S.exTabsScroll}
          contentContainerStyle={S.exTabs}
        >
          {exercises.map((e, i) => {
            const done = e.completed_sets >= e.sets;
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
                  {e.completed_sets}/{e.sets}
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
                <Text style={S.setCount}>SET {ex.completed_sets + 1} / {ex.sets}</Text>
                <Text style={S.exerciseName}>{ex.name}</Text>
                <Text style={S.exerciseTarget}>{ex.reps} reps · {ex.load}</Text>
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
              keyboardAppearance="dark"
              selectionColor={COLORS.primaryGreen}
              underlineColorAndroid="transparent"
            />
          </View>
        )}

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
        <Text style={S.inputHint}>Use 0 kg for bodyweight exercises.</Text>

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
          style={[S.logBtn, isLogging && S.logBtnDisabled]}
          onPress={logSet}
          disabled={isLogging}
          accessibilityRole="button"
          accessibilityLabel="Log set and start rest timer"
          accessibilityState={{ disabled: isLogging }}
        >
          <Ionicons name="add-circle-outline" size={16} color={COLORS.background} />
          <Text style={S.logBtnText}>{isLogging ? 'LOGGING…' : 'LOG SET + START REST'}</Text>
        </PressableScale>
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

      <PressableScale
        style={[S.finishBtn, isFinishing && S.logBtnDisabled]}
        onPress={finishWorkout}
        disabled={isFinishing}
        accessibilityRole="button"
        accessibilityLabel="Finish workout and save session"
        accessibilityState={{ disabled: isFinishing }}
      >
        <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.primaryGreen} />
        <Text style={S.finishBtnText}>{isFinishing ? 'SAVING…' : 'FINISH WORKOUT'}</Text>
      </PressableScale>
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
  timerUnit: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 6, letterSpacing: 1.1, marginTop: 1 },
  timerCopy: { flex: 1, minWidth: 0, gap: 3 },
  timerLabel: { fontFamily: FONTS.regular,  ...EYEBROW, fontSize: 8, letterSpacing: 1.2 },
  timerTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 12, lineHeight: 16 },
  timerHint: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 9, lineHeight: 13 },
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
  skipText: { fontFamily: FONTS.regular,  ...EYEBROW, color: COLORS.textSecondary, fontSize: 9 },
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
  pillText: { fontFamily: FONTS.regular,  ...EYEBROW, color: COLORS.primaryGreen, fontSize: 8 },
  timeValue: { color: COLORS.text, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 25, lineHeight: 29, letterSpacing: -0.7 },
  timeLabel: { fontFamily: FONTS.regular,  ...EYEBROW, color: COLORS.textMuted, fontSize: 7, letterSpacing: 1.05 },
  metrics: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  stat: { alignItems: 'flex-end', minWidth: 45 },
  statVal: { color: COLORS.text, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 17, lineHeight: 22 },
  statLabel: { fontFamily: FONTS.regular,  ...EYEBROW, color: COLORS.textDim, fontSize: 7, marginTop: 1 },
  metricDivider: { width: 1, height: 27, backgroundColor: COLORS.border },
});

// ─── Ghost styles ─────────────────────────────────────────────────────────────
const G = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.sm },
  text: { fontFamily: FONTS.regular,  ...BODY, color: COLORS.textDim, fontSize: 12 },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  // Was a one-off #121212 — now matches the true-black canvas every other
  // screen in the app uses.
  container: { flex: 1, backgroundColor: COLORS.background },

  // Pre-session
  preSession:  {
    flex: 1, justifyContent: 'center', alignItems: 'stretch',
    paddingHorizontal: SPACING.xl, paddingTop: SPACING.xl, paddingBottom: 42,
  },
  // Accent now comes from the icon color alone (green), not a mismatched
  // blue-tinted tile behind a green icon.
  preBadge:    { width: 64, height: 64, borderRadius: 20, backgroundColor: COLORS.cardElevated,
                 alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xl },
  gymTitle:    { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 32, letterSpacing: -0.8, textAlign: 'left' },
  gymSubtitle: { ...BODY, color: COLORS.primaryGreen, fontSize: 15, fontFamily: FONTS.semibold, marginTop: SPACING.xs, marginBottom: SPACING.lg },
  gymDesc: { fontFamily: FONTS.regular,  ...BODY, color: COLORS.textSecondary, fontSize: 14, textAlign: 'left', lineHeight: 22, marginBottom: SPACING.xxl, maxWidth: 340 },
  startBtn:    { backgroundColor: COLORS.primaryGreen, borderRadius: RADIUS.button,
                 paddingVertical: 17, paddingHorizontal: SPACING.xl, width: '100%',
                 alignItems: 'center', marginBottom: SPACING.md },
  startBtnText:{ color: COLORS.background, fontFamily: FONTS.bold, fontSize: 15, letterSpacing: 0.1 },
  coachBtn:    { backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.button, paddingVertical: 16,
                 paddingHorizontal: SPACING.xl, width: '100%', alignItems: 'center',
                 borderWidth: 1, borderColor: COLORS.borderLight,
                 flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.sm },
  coachBtnText:{ color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 14 },
  historyBtn:  { marginTop: SPACING.md, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl,
                 alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm },
  historyBtnText: { color: COLORS.textSecondary, fontFamily: FONTS.medium, fontSize: 13 },

  // Exercise tabs
  exTabsScroll: { maxHeight: 68 },
  exTabs:       { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.sm, flexDirection: 'row' },
  exTab:        { backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.button, paddingHorizontal: SPACING.md,
                  paddingVertical: SPACING.sm, borderWidth: 1, borderColor: COLORS.borderLight, alignItems: 'center' },
  exTabActive:  { backgroundColor: alpha(COLORS.primaryGreen, 0.08), borderColor: alpha(COLORS.primaryGreen, 0.4) },
  exTabDone:    { opacity: 0.45 },
  exTabText:    { ...BODY, color: COLORS.textMuted, fontSize: 11, fontFamily: FONTS.semibold },
  exTabTextActive:{ color: COLORS.primaryGreen },
  exTabSets: { fontFamily: FONTS.regular,  ...BODY, color: COLORS.textMuted, fontSize: 10, marginTop: 2 },
  exTabSetsActive:{ color: alpha(COLORS.primaryGreen, 0.7) },
  exTabSetsDone:{ color: COLORS.borderLight },

  // Log card — the single most important surface during a session, so it
  // gets the same card treatment (radius, border) as everywhere else in
  // the app rather than its own one-off values.
  exerciseCard:   { backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card, margin: SPACING.md,
                    marginTop: SPACING.sm, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.cardBorder },
  exCardHeader:   { flexDirection: 'row', justifyContent: 'space-between',
                    alignItems: 'flex-start', marginBottom: SPACING.sm },
  setCount: { fontFamily: FONTS.numericSemibold,  ...EYEBROW, color: COLORS.primaryGreen, fontSize: 10, marginBottom: 2 },
  exerciseName:   { color: COLORS.text, fontFamily: FONTS.extrabold, fontSize: 20 },
  exerciseTarget: { fontFamily: FONTS.regular,  ...BODY, color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  nextExInline:   { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
                    backgroundColor: alpha(COLORS.strain, 0.1), borderRadius: RADIUS.badge, paddingHorizontal: SPACING.sm,
                    paddingVertical: SPACING.sm, borderWidth: 1, borderColor: alpha(COLORS.strain, 0.25) },
  nextExInlineText:{ color: COLORS.strain, fontFamily: FONTS.semibold, fontSize: 12 },
  cueRow:         { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.md },
  cue: { fontFamily: FONTS.regular,  ...BODY, color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic', flex: 1 },
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
  inputHint: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 11, marginTop: -SPACING.xs, marginBottom: SPACING.sm },

  rpeRow:    { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  rpeLabel: { fontFamily: FONTS.regular,  ...EYEBROW, color: COLORS.textSecondary, fontSize: 10, width: 30 },
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
  logsLabel: { fontFamily: FONTS.regular,  ...EYEBROW, color: COLORS.textMuted, fontSize: 9,
                      marginBottom: SPACING.sm, marginTop: SPACING.xs },
  noLogs: { fontFamily: FONTS.regular,  ...BODY, color: COLORS.textDim, fontSize: 13, textAlign: 'center', paddingTop: SPACING.md },
  exerciseGroup:    { marginBottom: SPACING.sm, backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card,
                      overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  groupExerciseName:{ color: COLORS.text, fontFamily: FONTS.bold, fontSize: 13,
                      paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
                      borderBottomWidth: 1, borderBottomColor: COLORS.border },
  setRow:           { flexDirection: 'row', alignItems: 'center',
                      paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
                      borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder, gap: SPACING.md },
  setLabel:         { ...BODY, color: COLORS.textMuted, fontFamily: FONTS.semibold, fontSize: 11, width: 40 },
  setDetails: { fontFamily: FONTS.regular,  ...BODY, color: COLORS.textSecondary, fontSize: 13, flex: 1 },
  rpeBadge:         { borderRadius: RADIUS.badge, paddingHorizontal: 7, paddingVertical: 2,
                      backgroundColor: COLORS.cardElevated, borderWidth: 1 },
  rpeBadgeText:     { fontFamily: FONTS.semibold, fontSize: 11 },

  // Secondary/closing action — kept visually quieter than the green Log
  // Set CTA above (tinted, not solid) since it ends the session rather
  // than driving it.
  finishBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: SPACING.sm, margin: SPACING.md, backgroundColor: alpha(COLORS.primaryGreen, 0.08), borderRadius: RADIUS.button,
                   paddingVertical: SPACING.lg, borderWidth: 1, borderColor: alpha(COLORS.primaryGreen, 0.25) },
  // Was a hardcoded #4CAF50 — a different green from every other accent
  // in the app. Now the same primaryGreen used everywhere else.
  finishBtnText: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 14, letterSpacing: 0.5 },
});

export default React.memo(WorkoutHUD);