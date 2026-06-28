// NeuroFit AI — Workout HUD Screen
// FIXED: exercise name input, multi-exercise support, set saving

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert,
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

export default function WorkoutHUD() {
  const { activeSession, setActiveSession, addLogToSession, setCnsFatigue } = useStore();
  const [exercises, setExercises] = useState<ExerciseCard[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [restTimer, setRestTimer] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [rpe, setRpe] = useState(7);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  // FIX: exercise name field for manual entry
  const [exerciseName, setExerciseName] = useState('');
  const [sessionStarted, setSessionStarted] = useState(false);

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
    if (!activeSession) {
      Alert.alert('No session', 'Start a session first.');
      return;
    }
    if (!weight || !reps) {
      Alert.alert('Missing input', 'Enter weight and reps before logging.');
      return;
    }

    const ex = exercises[activeIdx];
    // FIX: use exercise name from field if no AI plan loaded
    const resolvedName = ex?.name || exerciseName.trim();
    if (!resolvedName) {
      Alert.alert('Missing exercise', 'Enter the exercise name before logging.');
      return;
    }

    const logData = {
      exercise_name: resolvedName,
      set_number: (ex?.completed_sets ?? 0) + 1,
      weight_kg: parseFloat(weight),
      reps: parseInt(reps),
      rpe,
    };

    try {
      await workoutApi.logSet(activeSession.id, logData);
      addLogToSession(logData);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (ex) {
        const updated = [...exercises];
        updated[activeIdx].completed_sets += 1;
        setExercises(updated);
      }

      const isHeavy =
        resolvedName.toLowerCase().includes('deadlift') ||
        resolvedName.toLowerCase().includes('squat');
      setRestTimer(isHeavy ? 180 : DEFAULT_REST);
      setTimerRunning(true);

      // FIX: only clear weight/reps, keep exercise name so user can log
      // multiple sets of the same exercise without re-typing
      setWeight('');
      setReps('');
    } catch {
      Alert.alert('Error', 'Failed to log set. Check your connection.');
    }
  };

  // FIX: helper to move to next exercise (or allow typing a new name)
  const nextExercise = () => {
    if (activeIdx < exercises.length - 1) {
      setActiveIdx(activeIdx + 1);
      setWeight('');
      setReps('');
    } else {
      // No more AI exercises: clear name field so user can type a new one
      setExerciseName('');
      setWeight('');
      setReps('');
      Alert.alert('Add another exercise', 'Type the next exercise name in the field above kg/reps.');
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
              setExerciseName('');
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
            <Text style={styles.setCount}>SET {ex.completed_sets + 1} / {ex.sets}</Text>
            <Text style={styles.exerciseName}>{ex.name}</Text>
            <Text style={styles.exerciseTarget}>{ex.reps} reps · {ex.load}</Text>
            {ex.cue ? <Text style={styles.cue}>{ex.cue}</Text> : null}
          </>
        ) : (
          <View style={styles.manualEntry}>
            <Text style={styles.manualTitle}>Log a Set</Text>
            {/* FIX: exercise name input field */}
            <TextInput
              style={styles.exerciseNameInput}
              placeholder="Exercise name (e.g. Bench Press)"
              placeholderTextColor="#555"
              value={exerciseName}
              onChangeText={setExerciseName}
              returnKeyType="next"
            />
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

        {/* FIX: Next Exercise button */}
        {(ex || exerciseName.trim()) && (
          <TouchableOpacity style={styles.nextExBtn} onPress={nextExercise}>
            <Text style={styles.nextExText}>Next Exercise →</Text>
          </TouchableOpacity>
        )}
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
  preSession: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  preBadge: {
    width: 60, height: 60, borderRadius: 16,
    backgroundColor: '#1A2535', alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  gymTitle: { color: COLORS.primaryGreen, fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  gymSubtitle: { color: '#888', fontSize: 14, marginTop: 4, marginBottom: 16 },
  gymDesc: {
    color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 32,
  },
  startBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 32, width: '100%',
    alignItems: 'center', marginBottom: 12,
  },
  startBtnText: { color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  coachBtn: {
    backgroundColor: '#1A2535', borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 32, width: '100%',
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  coachBtnText: { color: COLORS.primaryGreen, fontSize: 14, fontWeight: '600' },
  timerBar: {
    backgroundColor: '#0C1F17', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1A2A1A',
  },
  timerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerText: { color: COLORS.primaryGreen, fontSize: 16, fontWeight: '700' },
  skipTimer: { color: '#888', fontSize: 12, fontWeight: '600' },
  sessionInfo: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  sessionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primaryGreen },
  sessionLabel: { color: '#888', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  sessionId: { color: '#444', fontSize: 11 },
  exerciseCard: {
    backgroundColor: '#1C1C1C', borderRadius: 16, margin: 16, padding: 16,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  setCount: { color: '#888', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  exerciseName: { color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  exerciseTarget: { color: '#888', fontSize: 14, marginBottom: 8 },
  cue: { color: '#666', fontSize: 12, fontStyle: 'italic', marginBottom: 12 },
  manualEntry: { marginBottom: 8 },
  manualTitle: { color: '#FFF', fontSize: 17, fontWeight: '700', marginBottom: 8 },
  // FIX: new exercise name input style
  exerciseNameInput: {
    backgroundColor: '#2A2A2A', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: '#FFF', fontSize: 15, marginBottom: 4, borderWidth: 1, borderColor: '#3A3A3A',
  },
  logRow: { flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 8 },
  logInput: {
    flex: 1, backgroundColor: '#2A2A2A', borderRadius: 10,
    paddingVertical: 14, color: '#FFF', fontSize: 24, fontWeight: '700',
    textAlign: 'center', borderWidth: 1, borderColor: '#3A3A3A',
  },
  rpeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  rpeLabel: { color: '#888', fontSize: 11, fontWeight: '700', width: 30 },
  rpeChip: {
    paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8,
    backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: '#3A3A3A',
  },
  rpeChipActive: { backgroundColor: '#FF6B35', borderColor: '#FF6B35' },
  rpeChipText: { color: '#888', fontSize: 12, fontWeight: '600' },
  rpeChipTextActive: { color: '#FFF' },
  logBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 12,
    paddingVertical: 14, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  },
  logBtnText: { color: '#000', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  // FIX: Next exercise button
  nextExBtn: {
    marginTop: 10, alignItems: 'center', paddingVertical: 8,
  },
  nextExText: { color: '#4A9EFF', fontSize: 13, fontWeight: '600' },
  logsScroll: { flex: 1, paddingHorizontal: 16 },
  logsLabel: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8, marginTop: 4 },
  noLogs: { color: '#444', fontSize: 13 },
  logRow2: {
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1C1C1C',
  },
  logExercise: { color: '#DDD', fontSize: 14, fontWeight: '600' },
  logDetails: { color: '#666', fontSize: 12, marginTop: 2 },
  finishBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, margin: 16, backgroundColor: '#0E1F12', borderRadius: 14,
    paddingVertical: 16, borderWidth: 1, borderColor: '#1A3A20',
  },
  finishBtnText: { color: '#4CAF50', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
});
