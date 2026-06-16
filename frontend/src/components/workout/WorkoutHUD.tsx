import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { workoutApi, coachApi } from '../../utils/api';
import { useStore } from '../../store';

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
  const [sessionStarted, setSessionStarted] = useState(false);

  // Rest countdown with haptic at 0
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
      const res = await coachApi.chat("Give me today's workout based on my profile and current fatigue.");
      Alert.alert('Your Workout', res.data.reply.slice(0, 400) + '…\n\n(See Coach tab for full plan)');
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

    const logData = {
      exercise_name: ex.name,
      set_number: ex.completed_sets + 1,
      weight_kg: parseFloat(weight),
      reps: parseInt(reps),
      rpe,
    };

    try {
      await workoutApi.logSet(activeSession.id, logData);
      addLogToSession(logData);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const updated = [...exercises];
      updated[activeIdx].completed_sets += 1;
      setExercises(updated);

      const isHeavy = ex.name.toLowerCase().includes('deadlift') || ex.name.toLowerCase().includes('squat');
      const restSeconds = isHeavy ? 180 : DEFAULT_REST;
      setRestTimer(restSeconds);
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
              Alert.alert('Done 🏆', 'Session saved. Great work.');
            } catch {
              Alert.alert('Error', 'Could not complete session.');
            }
          },
        },
      ]
    );
  };

  const ex = exercises[activeIdx];

  // Pre-session state
  if (!sessionStarted) {
    return (
      <View style={styles.container}>
        <View style={styles.preSession}>
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
            <Text style={styles.coachBtnText}>🦅 Ask Coach First</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Rest Timer */}
      {timerRunning && (
        <View style={styles.timerBar}>
          <Text style={styles.timerText}>REST  {restTimer}s</Text>
          <TouchableOpacity onPress={() => setTimerRunning(false)}>
            <Text style={styles.skipTimer}>SKIP</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Session info */}
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionLabel}>SESSION ACTIVE</Text>
        <Text style={styles.sessionId}>#{activeSession?.id.slice(-6)}</Text>
      </View>

      {/* Exercise Card - manual entry mode */}
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
          </View>
        )}

        {/* Weight / Reps inputs */}
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

        {/* RPE Selector */}
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
          <Text style={styles.logBtnText}>LOG SET + START REST</Text>
        </TouchableOpacity>
      </View>

      {/* Recent logs */}
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
        <Text style={styles.finishBtnText}>FINISH WORKOUT</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  preSession: { flex: 1, justifyContent: 'center', padding: 28, gap: 16 },
  gymTitle: { color: '#FFD700', fontSize: 28, fontWeight: '800', letterSpacing: 2 },
  gymSubtitle: { color: '#888', fontSize: 14, letterSpacing: 1 },
  gymDesc: { color: '#C0C0C0', fontSize: 14, lineHeight: 22, marginVertical: 8 },
  startBtn: {
    backgroundColor: '#FFD700', borderRadius: 14,
    padding: 18, alignItems: 'center', marginTop: 8,
  },
  startBtnText: { color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  coachBtn: {
    backgroundColor: '#1A2535', borderRadius: 14,
    padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#1E3A5F',
  },
  coachBtnText: { color: '#FFD700', fontSize: 14, fontWeight: '600' },
  timerBar: {
    backgroundColor: '#1A2E44', padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  timerText: { color: '#FFD700', fontSize: 22, fontWeight: '700' },
  skipTimer: { color: '#888', fontSize: 13 },
  sessionInfo: {
    paddingHorizontal: 16, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  sessionLabel: { color: '#4CAF50', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  sessionId: { color: '#555', fontSize: 12 },
  exerciseCard: {
    backgroundColor: '#1E1E1E', borderRadius: 20,
    padding: 20, margin: 16, marginTop: 0,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  manualEntry: { marginBottom: 12 },
  manualTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  manualSub: { color: '#888', fontSize: 13, marginTop: 2 },
  setCount: { color: '#FFD700', fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
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
    backgroundColor: '#FFD700', borderRadius: 14,
    padding: 16, alignItems: 'center',
  },
  logBtnText: { color: '#000', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  logsScroll: { flex: 1, paddingHorizontal: 16 },
  logsLabel: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  noLogs: { color: '#444', fontSize: 13 },
  logRow2: {
    backgroundColor: '#1A1A1A', borderRadius: 10,
    padding: 12, marginBottom: 6,
  },
  logExercise: { color: '#C0C0C0', fontSize: 13, fontWeight: '600' },
  logDetails: { color: '#555', fontSize: 12, marginTop: 2 },
  finishBtn: {
    margin: 16, backgroundColor: '#1A3A1A',
    borderRadius: 14, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#2E5C2E',
  },
  finishBtnText: { color: '#4CAF50', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
});
