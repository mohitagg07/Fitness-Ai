// NeuroFit AI — Workout HUD v3
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
import { useStore } from '../../store';
import { COLORS } from '../../theme/colors';
import WorkoutSummaryCard from './WorkoutSummaryCard';

interface ExerciseCard {
  name: string;
  sets: number;
  reps: string;
  load: string;
  cue: string;
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
  if (r <= 7)   return '#4CAF50';
  if (r <= 8)   return COLORS.recoveryMed;
  if (r <= 9.5) return '#FF6B35';
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
      <Ionicons name="time-outline" size={12} color="#444" />
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
  const [, forceTick]                   = useState(0);

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
    const w = parseFloat(weight);
    const r = parseInt(reps);
    const name = resolvedName;

    if (!name) { Alert.alert('Missing exercise', 'Enter an exercise name.'); return; }
    if (!w || w <= 0) { Alert.alert('Missing weight', 'Enter the weight in kg.'); return; }
    if (!r || r <= 0) { Alert.alert('Missing reps',   'Enter the reps.');         return; }

    const setNum = currentSetNum;
    const logData = { exercise_name: name, set_number: setNum, weight_kg: w, reps: r, rpe };

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

  const finishWorkout = () => {
    if (!activeSession) return;
    Alert.alert('Finish Workout?', 'This will end your session and save all sets.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        style: 'default',
        onPress: async () => {
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
            Alert.alert('Error', 'Could not complete session.');
          }
        },
      },
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
        <View style={S.preSession}>
          <View style={S.preBadge}>
            <Ionicons name="barbell-outline" size={28} color={COLORS.primaryGreen} />
          </View>
          <Text style={S.gymTitle}>GYM MODE</Text>
          <Text style={S.gymSubtitle}>Your AI spotter is ready</Text>
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
                <Ionicons name="bulb-outline" size={12} color="#444" />
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
              placeholderTextColor="#555"
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
              placeholderTextColor="#555"
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
              placeholderTextColor="#555"
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
                      active && { backgroundColor: color + '25', borderColor: color },
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

        <TouchableOpacity style={S.logBtn} onPress={logSet}>
          <Ionicons name="add-circle-outline" size={16} color="#000" />
          <Text style={S.logBtnText}>LOG SET + START REST</Text>
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
                  <View style={[S.rpeBadge, { borderColor: rpeColor(log.rpe) + '60' }]}>
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

      <TouchableOpacity style={S.finishBtn} onPress={finishWorkout}>
        <Ionicons name="checkmark-circle-outline" size={18} color="#4CAF50" />
        <Text style={S.finishBtnText}>FINISH WORKOUT</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Timer styles ─────────────────────────────────────────────────────────────
const T = StyleSheet.create({
  timerBar: {
    backgroundColor: '#030E06',
    borderBottomWidth: 1,
    borderBottomColor: '#0D2410',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  timerContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timerLeft:    { flexDirection: 'row', alignItems: 'center', gap: 6, width: 90 },
  timerLabel:   { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  timerSeconds: { fontSize: 22, fontWeight: '800', lineHeight: 26 },
  timerTrack:   { flex: 1, height: 3, backgroundColor: '#1A1A1A', borderRadius: 2, overflow: 'hidden' },
  timerFill:    { height: 3, borderRadius: 2 },
  skipBtn:      { paddingHorizontal: 10, paddingVertical: 4,
                  backgroundColor: '#1A1A1A', borderRadius: 8 },
  skipText:     { color: '#666', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});

// ─── Session header styles ────────────────────────────────────────────────────
const H = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20,
    paddingVertical: 10, backgroundColor: '#0A0A0A',
    borderBottomWidth: 1, borderBottomColor: '#141414', gap: 12,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#0D1F0D', borderRadius: 20, paddingHorizontal: 8,
    paddingVertical: 4, borderWidth: 1, borderColor: '#1A3A1A',
  },
  activeDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.primaryGreen },
  pillText:   { color: COLORS.primaryGreen, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  stat:       { alignItems: 'center' },
  statVal:    { color: '#DDD', fontSize: 16, fontWeight: '800' },
  statLabel:  { color: '#444', fontSize: 8, fontWeight: '700', letterSpacing: 1, marginTop: 1 },
  divider:    { width: 1, height: 24, backgroundColor: '#1E1E1E' },
});

// ─── Ghost styles ─────────────────────────────────────────────────────────────
const G = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  text: { color: '#444', fontSize: 12 },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },

  // Pre-session
  preSession:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  preBadge:    { width: 60, height: 60, borderRadius: 16, backgroundColor: '#1A2535',
                 alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  gymTitle:    { color: COLORS.primaryGreen, fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  gymSubtitle: { color: '#888', fontSize: 14, marginTop: 4, marginBottom: 16 },
  gymDesc:     { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  startBtn:    { backgroundColor: COLORS.primaryGreen, borderRadius: 14,
                 paddingVertical: 16, paddingHorizontal: 32, width: '100%',
                 alignItems: 'center', marginBottom: 12 },
  startBtnText:{ color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  coachBtn:    { backgroundColor: '#1A2535', borderRadius: 14, paddingVertical: 14,
                 paddingHorizontal: 32, width: '100%', alignItems: 'center',
                 flexDirection: 'row', justifyContent: 'center', gap: 8 },
  coachBtnText:{ color: COLORS.primaryGreen, fontSize: 14, fontWeight: '600' },

  // Exercise tabs
  exTabsScroll: { maxHeight: 68 },
  exTabs:       { paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: 'row' },
  exTab:        { backgroundColor: '#1A1A1A', borderRadius: 10, paddingHorizontal: 12,
                  paddingVertical: 6, borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center' },
  exTabActive:  { backgroundColor: '#0D1A0D', borderColor: COLORS.primaryGreen + '60' },
  exTabDone:    { opacity: 0.45 },
  exTabText:    { color: '#666', fontSize: 11, fontWeight: '600' },
  exTabTextActive:{ color: COLORS.primaryGreen },
  exTabSets:    { color: '#444', fontSize: 10, marginTop: 2 },
  exTabSetsActive:{ color: COLORS.primaryGreen + 'AA' },
  exTabSetsDone:{ color: '#2A2A2A' },

  // Log card
  exerciseCard:   { backgroundColor: '#1C1C1C', borderRadius: 16, margin: 12,
                    marginTop: 8, padding: 14, borderWidth: 1, borderColor: '#2A2A2A' },
  exCardHeader:   { flexDirection: 'row', justifyContent: 'space-between',
                    alignItems: 'flex-start', marginBottom: 8 },
  setCount:       { color: COLORS.primaryGreen, fontSize: 10, fontWeight: '700',
                    letterSpacing: 1, marginBottom: 2 },
  exerciseName:   { color: '#FFF', fontSize: 20, fontWeight: '700' },
  exerciseTarget: { color: '#888', fontSize: 13, marginTop: 2 },
  nextExInline:   { flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: '#1A2535', borderRadius: 8, paddingHorizontal: 10,
                    paddingVertical: 6, borderWidth: 1, borderColor: '#0093E720' },
  nextExInlineText:{ color: COLORS.strain, fontSize: 12, fontWeight: '600' },
  cueRow:         { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  cue:            { color: '#555', fontSize: 12, fontStyle: 'italic', flex: 1 },
  manualEntry:    { marginBottom: 8 },
  manualTitle:    { color: '#FFF', fontSize: 17, fontWeight: '700', marginBottom: 8 },
  setCountManual: { color: COLORS.primaryGreen, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  exerciseNameInput:{ backgroundColor: '#2A2A2A', borderRadius: 10, paddingHorizontal: 14,
                      paddingVertical: 12, color: '#FFF', fontSize: 15, marginBottom: 4,
                      borderWidth: 1, borderColor: '#3A3A3A' },

  logRow:    { flexDirection: 'row', gap: 10, marginTop: 6, marginBottom: 6 },
  inputWrap: { flex: 1, position: 'relative' },
  logInput:  { backgroundColor: '#2A2A2A', borderRadius: 10, paddingVertical: 12,
               paddingHorizontal: 14, color: '#FFF', fontSize: 28, fontWeight: '800',
               textAlign: 'center', borderWidth: 1, borderColor: '#3A3A3A' },
  inputUnit: { position: 'absolute', bottom: 6, right: 10, color: '#444',
               fontSize: 11, fontWeight: '600' },

  rpeRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  rpeLabel:  { color: '#888', fontSize: 10, fontWeight: '700', letterSpacing: 1, width: 30 },
  rpeChips:  { flexDirection: 'row', gap: 5 },
  rpeChip:   { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
               backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: '#3A3A3A' },
  rpeChipText:{ color: '#888', fontSize: 12, fontWeight: '600' },

  logBtn:     { backgroundColor: COLORS.primaryGreen, borderRadius: 12, paddingVertical: 14,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  logBtnText: { color: '#000', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },

  // Logs
  logsScroll:       { flex: 1, paddingHorizontal: 12 },
  logsLabel:        { color: '#555', fontSize: 9, fontWeight: '700', letterSpacing: 1.5,
                      marginBottom: 8, marginTop: 4 },
  noLogs:           { color: '#333', fontSize: 13, textAlign: 'center', paddingTop: 12 },
  exerciseGroup:    { marginBottom: 10, backgroundColor: '#1A1A1A', borderRadius: 12,
                      overflow: 'hidden', borderWidth: 1, borderColor: '#222' },
  groupExerciseName:{ color: '#DDD', fontSize: 13, fontWeight: '700',
                      paddingHorizontal: 14, paddingVertical: 10,
                      borderBottomWidth: 1, borderBottomColor: '#222' },
  setRow:           { flexDirection: 'row', alignItems: 'center',
                      paddingHorizontal: 14, paddingVertical: 8,
                      borderBottomWidth: 1, borderBottomColor: '#1C1C1C', gap: 10 },
  setLabel:         { color: '#444', fontSize: 11, fontWeight: '600', width: 40 },
  setDetails:       { color: '#CCC', fontSize: 13, flex: 1 },
  rpeBadge:         { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
                      backgroundColor: '#1A1A1A', borderWidth: 1 },
  rpeBadgeText:     { fontSize: 11, fontWeight: '600' },

  finishBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: 8, margin: 12, backgroundColor: '#0E1F12', borderRadius: 14,
                   paddingVertical: 15, borderWidth: 1, borderColor: '#1A3A20' },
  finishBtnText: { color: '#4CAF50', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
});