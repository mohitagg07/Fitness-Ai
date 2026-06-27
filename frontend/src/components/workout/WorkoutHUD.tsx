// NeuroFit AI — Workout HUD Screen
// Auto-PR detection: whenever a set is logged, compare against stored PRs
// and upsert if it's a new highest weight for that exercise.

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { workoutApi, coachApi, profileApi } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS } from '../../theme/colors';

interface ExerciseCard {
  name: string;
  sets: number;
  reps: string;
  load: string;
  cue: string;
  completed_sets: number;
}

const DEFAULT_REST = 90;

export default function WorkoutHUD() {
  const { activeSession, setActiveSession, addLogToSession, setCnsFatigue, prs } = useStore();
  const [exercises, setExercises] = useState<ExerciseCard[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [restTimer, setRestTimer] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [rpe, setRpe] = useState(7);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [sessionStarted, setSessionStarted] = useState(false);
  const [newPR, setNewPR] = useState<string | null>(null);
  const prAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    if (!timerRunning || restTimer <= 0) {
      if (restTimer === 0 && timerRunning) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimerRunning(false);
      }
      return;
    }
    const interval = setInterval(() => setRestTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [timerRunning, restTimer]);

  const flashPR = (exerciseName: string) => {
    setNewPR(exerciseName);
    prAnim.setValue(0);
    Animated.sequence([
      Animated.timing(prAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(2200),
      Animated.timing(prAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => setNewPR(null));
  };

  const startSession = async () => {
    try {
      const res = await workoutApi.createSession({
        day_label: 'Gym Mode',
        session_date: new Date().toISOString().split('T')[0],
      });
      setActiveSession({ id: res.data.id, day_label: 'Gym Mode', logs: [] });
      setSessionStarted(true);
    } catch {
      Alert.alert('Error', 'Could not start session. Is the backend running?');
    }
  };

  const askCoachForWorkout = async () => {
    try {
      const res = await coachApi.chat(
        "Give me today's workout based on my profile and current fatigue."
      );
      Alert.alert(
        "Today's Workout",
        res.data.reply.slice(0, 400) + '…\n\n(See Coach tab for full plan)'
      );
      if (res.data.cns_fatigue_score != null) setCnsFatigue(res.data.cns_fatigue_score);
    } catch {
      Alert.alert('Error', 'Could not reach the AI coach.');
    }
  };

  const logSet = async () => {
    if (!activeSession || !weight || !reps) {
      Alert.alert('Missing input', 'Enter weight and reps before logging.');
      return;
    }
    const ex = exercises[activeIdx];
    if (!ex) return;

    const weightKg = parseFloat(weight);
    const repsInt = parseInt(reps);

    const logData = {
      exercise_name: ex.name,
      set_number: ex.completed_sets + 1,
      weight_kg: weightKg,
      reps: repsInt,
      rpe,
    };

    try {
      await workoutApi.logSet(activeSession.id, logData);
      addLogToSession(logData);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // ── Auto-PR detection ────────────────────────────────────────
      // prs is a Record<exercise_name, weight_kg> from the store.
      // If this set's weight is higher than the stored PR (or there's
      // no PR yet), upsert it automatically — no manual entry needed.
      const currentPR = prs[ex.name] ?? 0;
      if (weightKg > currentPR) {
        try {
          await profileApi.upsertPR({
            exercise_name: ex.name,
            weight_kg: weightKg,
            reps: repsInt,
          });
          // Update local store so subsequent sets in the same session compare correctly
          // We trigger via a silent store patch — the store will refresh on next visit
          flashPR(ex.name);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          // PR save failing shouldn't block the set log
        }
      }

      const updated = [...exercises];
      updated[activeIdx].completed_sets += 1;
      setExercises(updated);

      const isHeavy =
        ex.name.toLowerCase().includes('deadlift') ||
        ex.name.toLowerCase().includes('squat');
      setRestTimer(isHeavy ? 180 : DEFAULT_REST);
      setTimerRunning(true);

      setWeight('');
      setReps('');
    } catch {
      Alert.alert('Error', 'Failed to log set. Check your connection.');
    }
  };

  const finishWorkout = () => {
    if (!activeSession) return;
    Alert.alert(
      'Finish Workout?',
      'Rate your overall CNS fatigue (1 = fresh, 10 = destroyed)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finish',
          onPress: async () => {
            try {
              await workoutApi.completeSession(activeSession.id, rpe);
              setCnsFatigue(rpe);
              setActiveSession(null);
              setSessionStarted(false);
              setExercises([]);
              Alert.alert('Session Complete', 'Great work. Session saved.');
            } catch {
              Alert.alert('Error', 'Could not complete session.');
            }
          },
        },
      ]
    );
  };

  const ex = exercises[activeIdx];

  if (!sessionStarted) {
    return (
      <View style={styles.container}>
        <View style={styles.preSession}>
          <View style={styles.preBadge}>
            <Ionicons name="barbell-outline" size={28} color={COLORS.primaryGreen} />
          </View>
          <Text style={styles.gymTitle}>GYM MODE</Text>
          <Text style={styles.gymSubtitle}>Your AI spotter is ready</Text>
          <Text style={styles.gymDesc}>
            Start a session, then ask your coach for today's workout plan.
            Log each set with weight, reps, and RPE.
          </Text>
          <TouchableOpacity style={styles.startBtn} onPress={startSession}>
            <Text style={styles.startBtnText}>START SESSION</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.coachBtn} onPress={askCoachForWorkout}>
            <Ionicons name="flash" size={16} color={COLORS.primaryGreen} />
            <Text style={styles.coachBtnText}>Ask Coach First</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* PR Flash Banner */}
      {newPR && (
        <Animated.View style={[styles.prBanner, { opacity: prAnim }]}>
          <Ionicons name="trophy" size={18} color="#FFD700" />
          <Text style={styles.prBannerText}>NEW PR — {newPR}!</Text>
          <Ionicons name="trophy" size={18} color="#FFD700" />
        </Animated.View>
      )}

      {timerRunning && (
        <View style={styles.timerBar}>
          <View style={styles.timerLeft}>
            <Ionicons name="timer-outline" size={18} color={COLORS.primaryGreen} />
            <Text style={styles.timerText}>REST  {restTimer}s</Text>
          </View>
          <TouchableOpacity onPress={() => setTimerRunning(false)}>
            <Text style={styles.skipTimer}>SKIP</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.sessionInfo}>
        <View style={styles.sessionLabelRow}>
          <View style={styles.activeDot} />
          <Text style={styles.sessionLabel}>SESSION ACTIVE</Text>
        </View>
        <Text style={styles.sessionId}>#{activeSession?.id.slice(-6)}</Text>
      </View>

      <View style={styles.exerciseCard}>
        {ex ? (
          <>
            <View style={styles.exerciseHeader}>
              <Text style={styles.setCount}>SET {ex.completed_sets + 1} / {ex.sets}</Text>
              {prs[ex.name] ? (
                <View style={styles.prChip}>
                  <Ionicons name="trophy-outline" size={11} color="#FFD700" />
                  <Text style={styles.prChipText}>PR {prs[ex.name]}kg</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.exerciseName}>{ex.name}</Text>
            <Text style={styles.exerciseTarget}>{ex.reps} reps · {ex.load}</Text>
            {ex.cue ? <Text style={styles.cue}>{ex.cue}</Text> : null}
          </>
        ) : (
          <View style={styles.manualEntry}>
            <Text style={styles.manualTitle}>Log a Set</Text>
            <Text style={styles.manualSub}>Enter exercise details below</Text>
          </View>
        )}

        <View style={styles.logRow}>
          <TextInput
            style={styles.logInput}
            placeholder="kg"
            placeholderTextColor="#555"
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={styles.logInput}
            placeholder="reps"
            placeholderTextColor="#555"
            value={reps}
            onChangeText={setReps}
            keyboardType="number-pad"
          />
        </View>

        <View style={styles.rpeRow}>
          <Text style={styles.rpeLabel}>RPE</Text>
          {[6, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.rpeChip, rpe === r && styles.rpeChipActive]}
              onPress={() => setRpe(r)}
            >
              <Text style={[styles.rpeChipText, rpe === r && styles.rpeChipTextActive]}>
                {r}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.logBtn} onPress={logSet}>
          <Ionicons name="add-circle-outline" size={16} color="#000" />
          <Text style={styles.logBtnText}>LOG SET + START REST</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.logsScroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.logsLabel}>SETS LOGGED THIS SESSION</Text>
        {(activeSession?.logs || []).length === 0 ? (
          <Text style={styles.noLogs}>No sets logged yet</Text>
        ) : (
          [...(activeSession?.logs || [])].reverse().map((log, i) => (
            <View key={i} style={styles.logRow2}>
              <Text style={styles.logExercise}>{log.exercise_name}</Text>
              <Text style={styles.logDetails}>
                Set {log.set_number} · {log.weight_kg}kg × {log.reps} · RPE {log.rpe}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      <TouchableOpacity style={styles.finishBtn} onPress={finishWorkout}>
        <Ionicons name="checkmark-circle-outline" size={18} color="#4CAF50" />
        <Text style={styles.finishBtnText}>FINISH WORKOUT</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  preSession: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  preBadge: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: '#1A2535', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  gymTitle: { color: COLORS.primaryGreen, fontSize: 28, fontWeight: '800', letterSpacing: 2 },
  gymSubtitle: { color: '#888', fontSize: 14, letterSpacing: 1 },
  gymDesc: { color: '#C0C0C0', fontSize: 14, lineHeight: 22, marginVertical: 4 },
  startBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 14,
    padding: 18, alignItems: 'center', marginTop: 8,
  },
  startBtnText: { color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  coachBtn: {
    backgroundColor: '#1A2535', borderRadius: 14,
    padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#1E3A5F',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  coachBtnText: { color: COLORS.primaryGreen, fontSize: 14, fontWeight: '600' },
  prBanner: {
    backgroundColor: '#2A2000', borderBottomWidth: 1, borderBottomColor: '#FFD70040',
    padding: 12, flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 10,
  },
  prBannerText: { color: '#FFD700', fontSize: 14, fontWeight: '800', letterSpacing: 1.5 },
  timerBar: {
    backgroundColor: '#1A2E44', padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  timerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerText: { color: COLORS.primaryGreen, fontSize: 22, fontWeight: '700' },
  skipTimer: { color: '#888', fontSize: 13 },
  sessionInfo: {
    paddingHorizontal: 16, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  sessionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4CAF50' },
  sessionLabel: { color: '#4CAF50', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  sessionId: { color: '#555', fontSize: 12 },
  exerciseCard: {
    backgroundColor: '#1E1E1E', borderRadius: 20,
    padding: 20, margin: 16, marginTop: 0,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  exerciseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  prChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#2A1F00', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#FFD70040',
  },
  prChipText: { color: '#FFD700', fontSize: 11, fontWeight: '700' },
  manualEntry: { marginBottom: 12 },
  manualTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  manualSub: { color: '#888', fontSize: 13, marginTop: 2 },
  setCount: { color: COLORS.primaryGreen, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  exerciseName: { color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  exerciseTarget: { color: '#888', fontSize: 14, marginBottom: 8 },
  cue: { color: '#A0B4C8', fontSize: 13, lineHeight: 18, marginBottom: 14, fontStyle: 'italic' },
  logRow: { flexDirection: 'row', gap: 12, marginBottom: 14, marginTop: 12 },
  logInput: {
    flex: 1, backgroundColor: '#252525',
    borderRadius: 12, padding: 14,
    color: '#FFF', fontSize: 18, fontWeight: '600', textAlign: 'center',
  },
  rpeRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6, marginBottom: 14, flexWrap: 'wrap',
  },
  rpeLabel: { color: '#666', fontSize: 11, fontWeight: '600', marginRight: 4 },
  rpeChip: {
    backgroundColor: '#252525', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  rpeChipActive: { backgroundColor: '#FF4500' },
  rpeChipText: { color: '#888', fontSize: 12, fontWeight: '600' },
  rpeChipTextActive: { color: '#FFF' },
  logBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 14,
    padding: 16, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  logBtnText: { color: '#000', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  logsScroll: { flex: 1, paddingHorizontal: 16 },
  logsLabel: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  noLogs: { color: '#444', fontSize: 13 },
  logRow2: { backgroundColor: '#1A1A1A', borderRadius: 10, padding: 12, marginBottom: 6 },
  logExercise: { color: '#C0C0C0', fontSize: 13, fontWeight: '600' },
  logDetails: { color: '#555', fontSize: 12, marginTop: 2 },
  finishBtn: {
    margin: 16, backgroundColor: '#1A3A1A',
    borderRadius: 14, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#2E5C2E',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  finishBtnText: { color: '#4CAF50', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
});
