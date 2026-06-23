// NeuroFit AI — Workout HUD
// Fixed: exercise name input for manual entry, proper session start/log flow

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { workoutApi, coachApi } from '../../utils/api';
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
const RPE_VALUES = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];

export default function WorkoutHUD() {
  const { activeSession, setActiveSession, addLogToSession, setCnsFatigue } = useStore() as any;
  const [exercises, setExercises] = useState<ExerciseCard[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [restTimer, setRestTimer] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [rpe, setRpe] = useState(8);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [exerciseName, setExerciseName] = useState('');
  const [sessionStarted, setSessionStarted] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [loggingSet, setLoggingSet] = useState(false);

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

  const startSession = async () => {
    setStartingSession(true);
    try {
      const res = await workoutApi.createSession({
        day_label: 'Gym Session',
        session_date: new Date().toISOString().split('T')[0],
      });
      setActiveSession({ id: res.data.id, day_label: 'Gym Session', logs: [] });
      setSessionStarted(true);
    } catch {
      Alert.alert('Error', 'Could not start session. Is the backend running?');
    } finally {
      setStartingSession(false);
    }
  };

  const askCoachForWorkout = async () => {
    try {
      const res = await coachApi.chat(
        "Give me today's workout based on my profile, goal, and current fatigue."
      );
      Alert.alert(
        "Today's Plan",
        (res.data.reply || '').slice(0, 500) + '\n\n(Full plan in Coach tab)',
        [{ text: 'Got it' }]
      );
      if (res.data.cns_fatigue_score != null) setCnsFatigue(res.data.cns_fatigue_score);
    } catch {
      Alert.alert('Error', 'Could not reach the AI coach.');
    }
  };

  const logSet = async () => {
    if (!activeSession) {
      Alert.alert('No session', 'Start a session first.');
      return;
    }
    if (!weight.trim() || !reps.trim()) {
      Alert.alert('Missing input', 'Enter both weight (kg) and reps.');
      return;
    }
    const ex = exercises[activeIdx];
    const resolvedName = ex?.name || exerciseName.trim();
    if (!resolvedName) {
      Alert.alert('No exercise', 'Type the exercise name above before logging.');
      return;
    }

    const wKg = parseFloat(weight);
    const repsN = parseInt(reps, 10);
    if (isNaN(wKg) || wKg < 0 || wKg > 500) {
      Alert.alert('Invalid weight', 'Enter a weight between 0 and 500 kg.');
      return;
    }
    if (isNaN(repsN) || repsN < 1 || repsN > 100) {
      Alert.alert('Invalid reps', 'Enter reps between 1 and 100.');
      return;
    }

    setLoggingSet(true);
    const logData = {
      exercise_name: resolvedName,
      set_number: (ex?.completed_sets ?? activeSession.logs?.length ?? 0) + 1,
      weight_kg: wKg,
      reps: repsN,
      rpe,
    };

    try {
      await workoutApi.logSet(activeSession.id, logData);
      addLogToSession(logData);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (ex) {
        const updated = [...exercises];
        updated[activeIdx] = { ...updated[activeIdx], completed_sets: updated[activeIdx].completed_sets + 1 };
        setExercises(updated);
      }

      const heavy = resolvedName.toLowerCase().includes('deadlift') ||
                    resolvedName.toLowerCase().includes('squat');
      setRestTimer(heavy ? 180 : DEFAULT_REST);
      setTimerRunning(true);
      setWeight('');
      setReps('');
    } catch {
      Alert.alert('Error', 'Failed to log set. Check your connection.');
    } finally {
      setLoggingSet(false);
    }
  };

  const finishWorkout = () => {
    if (!activeSession) return;
    Alert.alert(
      'Finish Workout?',
      `You logged ${activeSession.logs?.length ?? 0} sets. Rate your overall CNS fatigue (1=fresh, 10=destroyed)`,
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
              setExerciseName('');
              Alert.alert('Session Complete ✓', 'Great work. Session saved to your log.');
            } catch {
              Alert.alert('Error', 'Could not complete session.');
            }
          },
        },
      ]
    );
  };

  const ex = exercises[activeIdx];

  // ── Pre-session screen ──────────────────────────────────────────────────
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
            Start a session to begin logging sets. Ask the coach first for a personalised workout plan based on your profile.
          </Text>

          <TouchableOpacity
            style={[styles.startBtn, startingSession && styles.btnDisabled]}
            onPress={startSession}
            disabled={startingSession}
          >
            {startingSession
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.startBtnText}>START SESSION</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.coachBtn} onPress={askCoachForWorkout}>
            <Ionicons name="flash" size={16} color={COLORS.primaryGreen} />
            <Text style={styles.coachBtnText}>Ask Coach for Today's Plan</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Active session ──────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* Rest timer banner */}
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

      {/* Session status bar */}
      <View style={styles.sessionInfo}>
        <View style={styles.sessionLabelRow}>
          <View style={styles.activeDot} />
          <Text style={styles.sessionLabel}>SESSION ACTIVE</Text>
        </View>
        <Text style={styles.sessionId}>#{activeSession?.id?.slice(-6)}</Text>
      </View>

      {/* Log card */}
      <View style={styles.exerciseCard}>
        {ex ? (
          <>
            <Text style={styles.setCount}>SET {ex.completed_sets + 1} / {ex.sets}</Text>
            <Text style={styles.exerciseName}>{ex.name}</Text>
            <Text style={styles.exerciseTarget}>{ex.reps} reps · {ex.load}</Text>
            {ex.cue ? <Text style={styles.cue}>{ex.cue}</Text> : null}
          </>
        ) : (
          <View style={styles.manualEntry}>
            <Text style={styles.manualTitle}>Log a Set</Text>
            <Text style={styles.manualSub}>Enter exercise details below</Text>
            {/* Exercise name field — was missing, causing log to silently skip */}
            <TextInput
              style={styles.exerciseInput}
              placeholder="Exercise name (e.g. Bench Press)"
              placeholderTextColor="#555"
              value={exerciseName}
              onChangeText={setExerciseName}
              autoCapitalize="words"
            />
          </View>
        )}

        {/* Weight + Reps */}
        <View style={styles.logRow}>
          <View style={styles.logInputWrap}>
            <Text style={styles.logInputLabel}>WEIGHT</Text>
            <TextInput
              style={styles.logInput}
              placeholder="0"
              placeholderTextColor="#555"
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
            />
            <Text style={styles.logInputUnit}>kg</Text>
          </View>
          <View style={styles.logInputWrap}>
            <Text style={styles.logInputLabel}>REPS</Text>
            <TextInput
              style={styles.logInput}
              placeholder="0"
              placeholderTextColor="#555"
              value={reps}
              onChangeText={setReps}
              keyboardType="number-pad"
            />
          </View>
        </View>

        {/* RPE */}
        <View style={styles.rpeRow}>
          <Text style={styles.rpeLabel}>RPE</Text>
          {RPE_VALUES.map((r) => (
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

        <TouchableOpacity
          style={[styles.logBtn, loggingSet && styles.btnDisabled]}
          onPress={logSet}
          disabled={loggingSet}
        >
          {loggingSet
            ? <ActivityIndicator color="#000" size="small" />
            : <>
                <Ionicons name="add-circle-outline" size={16} color="#000" />
                <Text style={styles.logBtnText}>LOG SET + START REST</Text>
              </>}
        </TouchableOpacity>
      </View>

      {/* Logged sets list */}
      <ScrollView style={styles.logsScroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.logsLabel}>SETS LOGGED THIS SESSION</Text>
        {(activeSession?.logs || []).length === 0 ? (
          <Text style={styles.noLogs}>No sets logged yet</Text>
        ) : (
          [...(activeSession?.logs || [])].reverse().map((log: any, i: number) => (
            <View key={i} style={styles.logRow2}>
              <View style={styles.logRow2Left}>
                <Text style={styles.logExercise}>{log.exercise_name}</Text>
                <Text style={styles.logDetails}>
                  Set {log.set_number} · {log.weight_kg}kg × {log.reps} reps
                </Text>
              </View>
              <View style={styles.rpeBadge}>
                <Text style={styles.rpeBadgeText}>RPE {log.rpe}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Finish button */}
      <TouchableOpacity style={styles.finishBtn} onPress={finishWorkout}>
        <Ionicons name="checkmark-circle-outline" size={18} color="#4CAF50" />
        <Text style={styles.finishBtnText}>FINISH WORKOUT</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  btnDisabled: { opacity: 0.55 },

  // Pre-session
  preSession: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  preBadge: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: '#1A2535', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
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
    backgroundColor: '#1A2535', borderRadius: 14, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#1E3A5F',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  coachBtnText: { color: COLORS.primaryGreen, fontSize: 14, fontWeight: '600' },

  // Timer
  timerBar: {
    backgroundColor: '#0A1E30', padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#1A3A50',
  },
  timerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerText: { color: COLORS.primaryGreen, fontSize: 22, fontWeight: '700' },
  skipTimer: { color: '#888', fontSize: 13, fontWeight: '600' },

  // Session bar
  sessionInfo: {
    paddingHorizontal: 16, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  sessionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4CAF50' },
  sessionLabel: { color: '#4CAF50', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  sessionId: { color: '#555', fontSize: 12 },

  // Exercise card
  exerciseCard: {
    backgroundColor: '#1E1E1E', borderRadius: 20,
    padding: 20, margin: 16, marginTop: 0,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  manualEntry: { marginBottom: 8 },
  manualTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  manualSub: { color: '#888', fontSize: 13, marginTop: 2, marginBottom: 10 },
  exerciseInput: {
    backgroundColor: '#252525', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    color: '#FFF', fontSize: 15,
    borderWidth: 1, borderColor: '#333',
  },
  setCount: { color: COLORS.primaryGreen, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
  exerciseName: { color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  exerciseTarget: { color: '#888', fontSize: 14, marginBottom: 8 },
  cue: { color: '#A0B4C8', fontSize: 13, lineHeight: 18, marginBottom: 14, fontStyle: 'italic' },

  // Weight/Reps row
  logRow: { flexDirection: 'row', gap: 12, marginTop: 14, marginBottom: 14 },
  logInputWrap: { flex: 1, alignItems: 'center' },
  logInputLabel: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 6 },
  logInput: {
    width: '100%', backgroundColor: '#252525',
    borderRadius: 12, paddingVertical: 16,
    color: '#FFF', fontSize: 22, fontWeight: '700', textAlign: 'center',
  },
  logInputUnit: { color: '#555', fontSize: 11, marginTop: 4 },

  // RPE
  rpeRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 5, marginBottom: 14, flexWrap: 'wrap',
  },
  rpeLabel: { color: '#555', fontSize: 11, fontWeight: '600', marginRight: 2 },
  rpeChip: {
    backgroundColor: '#252525', borderRadius: 8,
    paddingHorizontal: 9, paddingVertical: 6,
  },
  rpeChipActive: { backgroundColor: '#D9400A' },
  rpeChipText: { color: '#777', fontSize: 12, fontWeight: '600' },
  rpeChipTextActive: { color: '#FFF', fontWeight: '700' },

  logBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 14,
    padding: 16, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  logBtnText: { color: '#000', fontSize: 14, fontWeight: '700', letterSpacing: 1 },

  // Log history
  logsScroll: { flex: 1, paddingHorizontal: 16 },
  logsLabel: { color: '#444', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  noLogs: { color: '#333', fontSize: 13 },
  logRow2: {
    backgroundColor: '#1A1A1A', borderRadius: 10,
    padding: 12, marginBottom: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  logRow2Left: { flex: 1 },
  logExercise: { color: '#C0C0C0', fontSize: 13, fontWeight: '600' },
  logDetails: { color: '#555', fontSize: 12, marginTop: 2 },
  rpeBadge: {
    backgroundColor: '#2A1A0A', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: '#4A3020',
  },
  rpeBadgeText: { color: '#D9400A', fontSize: 11, fontWeight: '700' },

  // Finish
  finishBtn: {
    margin: 16, backgroundColor: '#0A2A0A',
    borderRadius: 14, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#1A4A1A',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  finishBtnText: { color: '#4CAF50', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
});
