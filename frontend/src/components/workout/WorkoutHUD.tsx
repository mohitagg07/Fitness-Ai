// VYRN — Workout HUD v3
// NEW IN v3:
//   • Previous set ghost — shows last logged set for same exercise under inputs
//   • Volume accumulator — live total kg·reps shown in session header
//   • RPE selector with colour coding (6-7 green → 8.5-9.5 amber → 10 red)
//   • Exercise notes (coach cue from plan persisted in card)
//   • WorkoutSummaryCard replaces bare Alert on finish
//   • Next exercise flow: auto-advances index on tap
//   • Rest timer now shows circular progress ring (SVG-free: pure View)

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { workoutApi, coachApi } from '../../utils/api';
import { confirmAsync } from '../../utils/confirm';
import { useStore } from '../../store';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS, EYEBROW, BODY } from '../../theme/typography';
import { SPACING, RADIUS } from '../../theme/spacing';
import WorkoutSummaryCard from './WorkoutSummaryCard';
import WorkoutHistoryModal from './WorkoutHistoryModal';

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

function rpeColor(r: number): string {
  if (r <= 7)   return COLORS.primaryGreen;
  if (r <= 8)   return COLORS.recoveryMed;
  if (r <= 9.5) return COLORS.calories;
  return COLORS.recoveryLow;
}

// ─── Rest Timer ───────────────────────────────────────────────────────────────
function RestTimerBar({
  seconds,
  total,
  onSkip,
}: {
  seconds: number;
  total: number;
  onSkip: () => void;
}) {
  const pct = total > 0 ? (seconds / total) : 0;
  const urgent = seconds <= 10;
  const barColor = urgent ? COLORS.recoveryLow : COLORS.primaryGreen;

  return (
    <View style={T.timerBar}>
      <View style={T.timerContent}>
        <View style={T.timerLeft}>
          <Ionicons name="timer-outline" size={16} color={barColor} />
          <Text style={[T.timerLabel, { color: barColor }]}>REST</Text>
          <Text style={[T.timerSeconds, { color: barColor }]}>{seconds}s</Text>
        </View>
        {/* Progress track */}
        <View style={T.timerTrack}>
          <View style={[T.timerFill, { width: `${pct * 100}%` as any, backgroundColor: barColor }]} />
        </View>
        <TouchableOpacity onPress={onSkip} style={T.skipBtn}>
          <Text style={T.skipText}>SKIP</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Volume bar ───────────────────────────────────────────────────────────────
function SessionHeader({
  elapsed,
  totalVolume,
  setCount,
}: {
  elapsed: string;
  totalVolume: number;
  setCount: number;
}) {
  return (
    <View style={H.row}>
      <View style={H.pill}>
        <View style={H.activeDot} />
        <Text style={H.pillText}>ACTIVE</Text>
      </View>
      <View style={H.stat}>
        <Text style={H.statVal}>{elapsed || '0:00'}</Text>
        <Text style={H.statLabel}>TIME</Text>
      </View>
      <View style={H.divider} />
      <View style={H.stat}>
        <Text style={H.statVal}>{setCount}</Text>
        <Text style={H.statLabel}>SETS</Text>
      </View>
      <View style={H.divider} />
      <View style={H.stat}>
        <Text style={[H.statVal, { color: COLORS.primaryGreen }]}>
          {totalVolume >= 1000
            ? `${(totalVolume / 1000).toFixed(1)}t`
            : `${totalVolume}kg`}
        </Text>
        <Text style={H.statLabel}>VOLUME</Text>
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
export default function WorkoutHUD() {
  const {
    activeSession, setActiveSession, addLogToSession, setCnsFatigue,
  } = useStore();

  const [exercises, setExercises]       = useState<ExerciseCard[]>([]);
  const [activeIdx, setActiveIdx]       = useState(0);
  const [restTimer, setRestTimer]       = useState(0);
  const [restTotal, setRestTotal]       = useState(90);
  const [timerRunning, setTimerRunning] = useState(false);
  const [rpe, setRpe]                   = useState(8);
  const [weight, setWeight]             = useState('');
  const [reps, setReps]                 = useState('');
  const [exerciseName, setExerciseName] = useState('');
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [summaryData, setSummaryData]       = useState<any>(null);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [, forceTick]                   = useState(0);
  const [isLogging, setIsLogging]       = useState(false);
  const [isFinishing, setIsFinishing]   = useState(false);
  const [streakVisible, setStreakVisible] = useState(false);
  const [streakData, setStreakData]     = useState<{ workout: number; protein: number } | null>(null);

  // Tick for elapsed time
  useEffect(() => {
    if (!activeSession?.startedAt) return;
    const id = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [activeSession?.startedAt]);

  // Rest timer countdown
  useEffect(() => {
    if (!timerRunning || restTimer <= 0) {
      if (restTimer === 0 && timerRunning) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimerRunning(false);
      }
      return;
    }
    const id = setInterval(() => setRestTimer(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning, restTimer]);

  const sessionStarted = !!activeSession;

  const elapsedLabel = (() => {
    if (!activeSession?.startedAt) return '';
    const s = Math.max(0, Math.floor((Date.now() - activeSession.startedAt) / 1000));
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  })();

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
    if (activeSession) return;
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

  const logSet = async () => {
    if (!activeSession) return;
    // Guards against a fast double-tap firing two requests before the store
    // updates — without this, both calls read the same currentSetNum and
    // both succeed, logging two sets with an identical set_number and
    // silently corrupting volume/PR totals for this session.
    if (isLogging) return;

    const w = parseFloat(weight);
    const r = parseInt(reps);
    const name = resolvedName;

    if (!name) { Alert.alert('Missing exercise', 'Enter an exercise name.'); return; }
    if (!w || w <= 0) { Alert.alert('Missing weight', 'Enter the weight in kg.'); return; }
    if (!r || r <= 0) { Alert.alert('Missing reps',   'Enter the reps.');         return; }

    const setNum = currentSetNum;
    const logData = { exercise_name: name, set_number: setNum, weight_kg: w, reps: r, rpe };

    setIsLogging(true);
    try {
      await workoutApi.logSet(activeSession.id, logData);
      addLogToSession(logData);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Start rest timer (parse from exercise card or default 90s)
      const ex = exercises[activeIdx];
      const restStr = ex?.rest || '';
      const parsed = parseInt(restStr.replace(/[^0-9]/g, ''));
      const restSec = (!isNaN(parsed) && parsed > 0) ? parsed : 90;
      setRestTotal(restSec);
      setRestTimer(restSec);
      setTimerRunning(true);

      // Pre-fill next set with same weight
      setReps('');
      // Advance exercise card completed_sets
      if (exercises.length > 0) {
        setExercises(prev => prev.map((e, i) =>
          i === activeIdx ? { ...e, completed_sets: e.completed_sets + 1 } : e
        ));
      }
    } catch {
      Alert.alert('Error', 'Could not log set.');
    } finally {
      setIsLogging(false);
    }
  };

  const nextExercise = () => {
    setWeight('');
    setReps('');
    setExerciseName('');
    setTimerRunning(false);
    setRestTimer(0);
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
  const completeAndShowSummary = async () => {
    if (!activeSession || isFinishing) return;
    setIsFinishing(true);
    try {
      const res = await workoutApi.completeSession(activeSession.id);
      const summary = res.data;
      setActiveSession(null);
      setExercises([]);
      setActiveIdx(0);
      setTimerRunning(false);
      setRestTimer(0);
      setSummaryData(summary || {
        total_volume_kg: Math.round(totalVolume),
        sets_logged: totalSets,
        exercises: [...new Set((activeSession.logs as SetLog[]).map(l => l.exercise_name))],
        exercise_count: new Set((activeSession.logs as SetLog[]).map(l => l.exercise_name)).size,
        best_set: null,
        session_minutes: Math.round((Date.now() - (activeSession.startedAt || Date.now())) / 60000),
      });
      setSummaryVisible(true);
    } catch {
      // Local session state is left untouched here on purpose — the sets
      // already logged during the session live server-side (each logSet
      // call already persisted), so nothing is lost and Retry can safely
      // call the same idempotent endpoint again.
      Alert.alert('Error', 'Could not complete session. Check your connection and try again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retry', style: 'default', onPress: () => completeAndShowSummary() },
      ]);
    } finally {
      setIsFinishing(false);
    }
  };

  const finishWorkout = () => {
    if (!activeSession) return;
    Alert.alert('Finish Workout?', 'This will end your session and save all sets.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Finish', style: 'default', onPress: () => completeAndShowSummary() },
    ]);
  };

  // Group logs by exercise for display
  const groupedLogs = (): Array<[string, SetLog[]]> => {
    const logs: SetLog[] = activeSession?.logs || [];
    const groups: Record<string, SetLog[]> = {};
    [...logs].reverse().forEach(log => {
      if (!groups[log.exercise_name]) groups[log.exercise_name] = [];
      groups[log.exercise_name].push(log);
    });
    return Object.entries(groups);
  };

  const ex = exercises[activeIdx];

  // ── Pre-session ─────────────────────────────────────────────────────────────
  if (!sessionStarted) {
    return (
      <View style={S.container}>
        <WorkoutSummaryCard
          visible={summaryVisible}
          data={summaryData}
          onClose={() => setSummaryVisible(false)}
        />
        <WorkoutHistoryModal
          visible={historyVisible}
          onClose={() => setHistoryVisible(false)}
        />
        <View style={S.preSession}>
          <View style={S.preBadge}>
            <Ionicons name="barbell-outline" size={28} color={COLORS.primaryGreen} />
          </View>
          <Text style={S.gymTitle}>GYM MODE</Text>
          <Text style={S.gymSubtitle}>Log every set, get stronger</Text>
          <Text style={S.gymDesc}>
            Start a session, then log each set with weight, reps, and RPE.
            Ask your coach for today's plan anytime.
          </Text>
          <TouchableOpacity style={S.startBtn} onPress={startSession}>
            <Text style={S.startBtnText}>START SESSION</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.coachBtn} onPress={askCoachForWorkout}>
            <Ionicons name="flash" size={16} color={COLORS.primaryGreen} />
            <Text style={S.coachBtnText}>Ask Coach for Today's Plan</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.historyBtn} onPress={() => setHistoryVisible(true)}>
            <Ionicons name="time-outline" size={16} color={COLORS.textSecondary} />
            <Text style={S.historyBtnText}>View Workout History</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Active session ───────────────────────────────────────────────────────────
  return (
    <View style={S.container}>
      <WorkoutSummaryCard
        visible={summaryVisible}
        data={summaryData}
        onClose={() => setSummaryVisible(false)}
      />

      {timerRunning && (
        <RestTimerBar
          seconds={restTimer}
          total={restTotal}
          onSkip={() => { setTimerRunning(false); setRestTimer(0); }}
        />
      )}

      <SessionHeader
        elapsed={elapsedLabel}
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
              <TouchableOpacity
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
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Log card */}
      <View style={S.exerciseCard}>
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
                <TouchableOpacity style={S.nextExInline} onPress={nextExercise}>
                  <Text style={S.nextExInlineText}>Next</Text>
                  <Ionicons name="arrow-forward" size={14} color={COLORS.strain} />
                </TouchableOpacity>
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
            />
          </View>
        )}

        {/* Weight + Reps inputs */}
        <View style={S.logRow}>
          <View style={S.inputWrap}>
            <TextInput
              style={S.logInput}
              placeholder="kg"
              placeholderTextColor={COLORS.textMuted}
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
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
            />
            <Text style={S.inputUnit}>reps</Text>
          </View>
        </View>

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
                  <TouchableOpacity
                    key={r}
                    style={[
                      S.rpeChip,
                      active && { backgroundColor: alpha(color, 0.15), borderColor: color },
                    ]}
                    onPress={() => setRpe(r)}
                  >
                    <Text style={[S.rpeChipText, active && { color }]}>{r}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>

        <TouchableOpacity
          style={[S.logBtn, isLogging && S.logBtnDisabled]}
          onPress={logSet}
          disabled={isLogging}
          accessibilityRole="button"
          accessibilityLabel="Log set and start rest timer"
          accessibilityState={{ disabled: isLogging }}
        >
          <Ionicons name="add-circle-outline" size={16} color="#000" />
          <Text style={S.logBtnText}>{isLogging ? 'LOGGING…' : 'LOG SET + START REST'}</Text>
        </TouchableOpacity>
      </View>

      {/* Sets logged */}
      <ScrollView style={S.logsScroll} showsVerticalScrollIndicator={false}>
        <Text style={S.logsLabel}>SETS LOGGED</Text>
        {groupedLogs().length === 0 ? (
          <Text style={S.noLogs}>No sets yet — log your first set above</Text>
        ) : (
          groupedLogs().map(([name, logs], gi) => (
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
      </ScrollView>

      <TouchableOpacity
        style={[S.finishBtn, isFinishing && S.logBtnDisabled]}
        onPress={finishWorkout}
        disabled={isFinishing}
        accessibilityRole="button"
        accessibilityLabel="Finish workout and save session"
        accessibilityState={{ disabled: isFinishing }}
      >
        <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.primaryGreen} />
        <Text style={S.finishBtnText}>{isFinishing ? 'SAVING…' : 'FINISH WORKOUT'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Timer styles ─────────────────────────────────────────────────────────────
// Rest timer bar — subtle green-tinted strip that never competes with the
// exercise card below it; the countdown number is the only strong element.
const T = StyleSheet.create({
  timerBar: {
    backgroundColor: alpha(COLORS.primaryGreen, 0.05),
    borderBottomWidth: 1,
    borderBottomColor: alpha(COLORS.primaryGreen, 0.1),
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  timerContent: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  timerLeft:    { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, width: 90 },
  timerLabel:   { ...EYEBROW, fontSize: 10 },
  timerSeconds: { fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 22, lineHeight: 26 },
  timerTrack:   { flex: 1, height: 3, backgroundColor: COLORS.cardElevated, borderRadius: 2, overflow: 'hidden' },
  timerFill:    { height: 3, borderRadius: 2 },
  skipBtn:      { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs,
                  backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.badge },
  skipText:     { ...EYEBROW, color: COLORS.textMuted, fontSize: 11 },
});

// ─── Session header styles ────────────────────────────────────────────────────
const H = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md, backgroundColor: COLORS.card,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: SPACING.md,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: alpha(COLORS.primaryGreen, 0.08), borderRadius: 20, paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs, borderWidth: 1, borderColor: alpha(COLORS.primaryGreen, 0.25),
  },
  activeDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.primaryGreen },
  pillText:   { ...EYEBROW, color: COLORS.primaryGreen, fontSize: 9 },
  stat:       { alignItems: 'center' },
  statVal:    { color: COLORS.text, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 16 },
  statLabel:  { ...EYEBROW, color: COLORS.textDim, fontSize: 8, marginTop: 1 },
  divider:    { width: 1, height: 24, backgroundColor: COLORS.border },
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

  // Pre-session
  preSession:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xxl },
  // Accent now comes from the icon color alone (green), not a mismatched
  // blue-tinted tile behind a green icon.
  preBadge:    { width: 60, height: 60, borderRadius: RADIUS.card, backgroundColor: COLORS.cardElevated,
                 alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xl },
  gymTitle:    { color: COLORS.primaryGreen, fontFamily: FONTS.extrabold, fontSize: 28, letterSpacing: 1 },
  gymSubtitle: { ...BODY, color: COLORS.textSecondary, fontSize: 14, marginTop: SPACING.xs, marginBottom: SPACING.lg },
  gymDesc:     { ...BODY, color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: SPACING.xxl },
  startBtn:    { backgroundColor: COLORS.primaryGreen, borderRadius: RADIUS.card,
                 paddingVertical: SPACING.lg, paddingHorizontal: SPACING.xxl, width: '100%',
                 alignItems: 'center', marginBottom: SPACING.md },
  startBtnText:{ color: '#000', fontFamily: FONTS.extrabold, fontSize: 15, letterSpacing: 1 },
  coachBtn:    { backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card, paddingVertical: SPACING.lg,
                 paddingHorizontal: SPACING.xxl, width: '100%', alignItems: 'center',
                 flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm },
  coachBtnText:{ color: COLORS.primaryGreen, fontFamily: FONTS.semibold, fontSize: 14 },
  historyBtn:  { marginTop: SPACING.md, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl,
                 alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm },
  historyBtnText: { color: COLORS.textSecondary, fontFamily: FONTS.semibold, fontSize: 13 },

  // Exercise tabs
  exTabsScroll: { maxHeight: 68 },
  exTabs:       { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.sm, flexDirection: 'row' },
  exTab:        { backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.button, paddingHorizontal: SPACING.md,
                  paddingVertical: SPACING.sm, borderWidth: 1, borderColor: COLORS.borderLight, alignItems: 'center' },
  exTabActive:  { backgroundColor: alpha(COLORS.primaryGreen, 0.08), borderColor: alpha(COLORS.primaryGreen, 0.4) },
  exTabDone:    { opacity: 0.45 },
  exTabText:    { ...BODY, color: COLORS.textMuted, fontSize: 11, fontFamily: FONTS.semibold },
  exTabTextActive:{ color: COLORS.primaryGreen },
  exTabSets:    { ...BODY, color: COLORS.textMuted, fontSize: 10, marginTop: 2 },
  exTabSetsActive:{ color: alpha(COLORS.primaryGreen, 0.7) },
  exTabSetsDone:{ color: COLORS.borderLight },

  // Log card — the single most important surface during a session, so it
  // gets the same card treatment (radius, border) as everywhere else in
  // the app rather than its own one-off values.
  exerciseCard:   { backgroundColor: COLORS.card, borderRadius: RADIUS.card, margin: SPACING.md,
                    marginTop: SPACING.sm, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.cardBorder },
  exCardHeader:   { flexDirection: 'row', justifyContent: 'space-between',
                    alignItems: 'flex-start', marginBottom: SPACING.sm },
  setCount:       { ...EYEBROW, color: COLORS.primaryGreen, fontSize: 10, marginBottom: 2 },
  exerciseName:   { color: COLORS.text, fontFamily: FONTS.extrabold, fontSize: 20 },
  exerciseTarget: { ...BODY, color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  nextExInline:   { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
                    backgroundColor: alpha(COLORS.strain, 0.1), borderRadius: RADIUS.badge, paddingHorizontal: SPACING.sm,
                    paddingVertical: SPACING.sm, borderWidth: 1, borderColor: alpha(COLORS.strain, 0.25) },
  nextExInlineText:{ color: COLORS.strain, fontFamily: FONTS.semibold, fontSize: 12 },
  cueRow:         { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.md },
  cue:            { ...BODY, color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic', flex: 1 },
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

  rpeRow:    { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  rpeLabel:  { ...EYEBROW, color: COLORS.textSecondary, fontSize: 10, width: 30 },
  rpeChips:  { flexDirection: 'row', gap: SPACING.xs },
  rpeChip:   { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: RADIUS.badge,
               backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.borderLight },
  rpeChipText:{ color: COLORS.textSecondary, fontFamily: FONTS.semibold, fontSize: 12 },

  // Primary action during an active session — same weight and radius as
  // the Dashboard's "Start Workout" CTA so every screen's main action
  // reads the same way.
  logBtn:     { backgroundColor: COLORS.primaryGreen, borderRadius: RADIUS.card, paddingVertical: SPACING.md,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  logBtnDisabled: { opacity: 0.5 },
  logBtnText: { color: '#000', fontFamily: FONTS.extrabold, fontSize: 13, letterSpacing: 0.5 },

  // Logs
  logsScroll:       { flex: 1, paddingHorizontal: SPACING.md },
  logsLabel:        { ...EYEBROW, color: COLORS.textMuted, fontSize: 9,
                      marginBottom: SPACING.sm, marginTop: SPACING.xs },
  noLogs:           { ...BODY, color: COLORS.textDim, fontSize: 13, textAlign: 'center', paddingTop: SPACING.md },
  exerciseGroup:    { marginBottom: SPACING.sm, backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card,
                      overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  groupExerciseName:{ color: COLORS.text, fontFamily: FONTS.bold, fontSize: 13,
                      paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
                      borderBottomWidth: 1, borderBottomColor: COLORS.border },
  setRow:           { flexDirection: 'row', alignItems: 'center',
                      paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
                      borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder, gap: SPACING.md },
  setLabel:         { ...BODY, color: COLORS.textMuted, fontFamily: FONTS.semibold, fontSize: 11, width: 40 },
  setDetails:       { ...BODY, color: COLORS.textSecondary, fontSize: 13, flex: 1 },
  rpeBadge:         { borderRadius: RADIUS.badge, paddingHorizontal: 7, paddingVertical: 2,
                      backgroundColor: COLORS.cardElevated, borderWidth: 1 },
  rpeBadgeText:     { fontFamily: FONTS.semibold, fontSize: 11 },

  // Secondary/closing action — kept visually quieter than the green Log
  // Set CTA above (tinted, not solid) since it ends the session rather
  // than driving it.
  finishBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: SPACING.sm, margin: SPACING.md, backgroundColor: alpha(COLORS.primaryGreen, 0.08), borderRadius: RADIUS.card,
                   paddingVertical: SPACING.lg, borderWidth: 1, borderColor: alpha(COLORS.primaryGreen, 0.25) },
  // Was a hardcoded #4CAF50 — a different green from every other accent
  // in the app. Now the same primaryGreen used everywhere else.
  finishBtnText: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 14, letterSpacing: 0.5 },
});