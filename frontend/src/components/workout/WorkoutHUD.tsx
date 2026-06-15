import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Vibration,
} from 'react-native';
import { workoutApi } from '../../utils/api';
import { useStore } from '../../store';

interface ExerciseCard {
  name: string;
  sets: number;
  reps: string;
  load: string;
  cue: string;
  completed_sets: number;
}

const DEFAULT_REST = 90; // seconds

export default function WorkoutHUD({ navigation }: any) {
  const { activeSession, addLogToSession } = useStore();
  const [exercises, setExercises] = useState<ExerciseCard[]>([]);
  const [activeExerciseIdx, setActiveExerciseIdx] = useState(0);
  const [restTimer, setRestTimer] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [rpe, setRpe] = useState(7);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');

  // Rest countdown
  useEffect(() => {
    if (!timerRunning || restTimer <= 0) {
      if (restTimer === 0 && timerRunning) {
        Vibration.vibrate([0, 300, 100, 300]);
        setTimerRunning(false);
      }
      return;
    }
    const interval = setInterval(() => setRestTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [timerRunning, restTimer]);

  const startRestTimer = (seconds = DEFAULT_REST) => {
    setRestTimer(seconds);
    setTimerRunning(true);
  };

  const logSet = async () => {
    if (!activeSession || !weight || !reps) return;
    const ex = exercises[activeExerciseIdx];
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

      // Update exercise state
      const updated = [...exercises];
      updated[activeExerciseIdx].completed_sets += 1;
      setExercises(updated);

      // Start rest timer
      startRestTimer(ex.name.toLowerCase().includes('deadlift') || ex.name.toLowerCase().includes('squat') ? 180 : DEFAULT_REST);

      setWeight('');
      setReps('');
    } catch (err) {
      Alert.alert('Error', 'Failed to log set. Check connection.');
    }
  };

  const finishWorkout = async () => {
    if (!activeSession) return;
    Alert.alert(
      'Finish Workout?',
      'Rate your CNS fatigue after this session (1=fresh, 10=destroyed)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finish',
          onPress: async () => {
            await workoutApi.completeSession(activeSession.id, rpe);
            navigation.goBack();
          },
        },
      ]
    );
  };

  const ex = exercises[activeExerciseIdx];

  return (
    <View style={styles.container}>
      {/* Rest Timer Bar */}
      {timerRunning && (
        <View style={styles.timerBar}>
          <Text style={styles.timerText}>REST  {restTimer}s</Text>
          <TouchableOpacity onPress={() => setTimerRunning(false)}>
            <Text style={styles.skipTimer}>SKIP</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Active Exercise Card */}
      {ex ? (
        <View style={styles.exerciseCard}>
          <Text style={styles.setCount}>SET {ex.completed_sets + 1} / {ex.sets}</Text>
          <Text style={styles.exerciseName}>{ex.name}</Text>
          <Text style={styles.exerciseTarget}>{ex.reps} reps  ·  {ex.load}</Text>
          <Text style={styles.cue}>{ex.cue}</Text>

          {/* Log inputs */}
          <View style={styles.logRow}>
            <TextInput
              style={styles.logInput}
              placeholder="kg"
              placeholderTextColor="#666"
              value={weight}
              onChangeText={setWeight}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.logInput}
              placeholder="reps"
              placeholderTextColor="#666"
              value={reps}
              onChangeText={setReps}
              keyboardType="numeric"
            />
          </View>

          {/* RPE Slider */}
          <View style={styles.rpeRow}>
            <Text style={styles.rpeLabel}>RPE</Text>
            {[6, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.rpeChip, rpe === r && styles.rpeChipActive]}
                onPress={() => setRpe(r)}
              >
                <Text style={[styles.rpeChipText, rpe === r && styles.rpeChipTextActive]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.logBtn} onPress={logSet}>
            <Text style={styles.logBtnText}>LOG SET + START REST</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.exerciseCard}>
          <Text style={styles.doneText}>All exercises logged 🏆</Text>
        </View>
      )}

      {/* Exercise List */}
      <ScrollView style={styles.exerciseList} horizontal showsHorizontalScrollIndicator={false}>
        {exercises.map((e, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.exChip, i === activeExerciseIdx && styles.exChipActive]}
            onPress={() => setActiveExerciseIdx(i)}
          >
            <Text style={styles.exChipText} numberOfLines={1}>{e.name}</Text>
            <Text style={styles.exChipSets}>{e.completed_sets}/{e.sets}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity style={styles.finishBtn} onPress={finishWorkout}>
        <Text style={styles.finishBtnText}>FINISH WORKOUT</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', padding: 16 },
  timerBar: {
    backgroundColor: '#1A2E44',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  timerText: { color: '#FFD700', fontSize: 20, fontWeight: '700' },
  skipTimer: { color: '#888', fontSize: 13 },
  exerciseCard: {
    backgroundColor: '#1E1E1E',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  setCount: { color: '#FFD700', fontSize: 12, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
  exerciseName: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', marginBottom: 4 },
  exerciseTarget: { color: '#888', fontSize: 14, marginBottom: 12 },
  cue: { color: '#A0B4C8', fontSize: 13, lineHeight: 18, marginBottom: 16, fontStyle: 'italic' },
  logRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  logInput: {
    flex: 1,
    backgroundColor: '#252525',
    borderRadius: 12,
    padding: 14,
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  rpeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
  rpeLabel: { color: '#666', fontSize: 12, fontWeight: '600', marginRight: 4 },
  rpeChip: {
    backgroundColor: '#252525',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rpeChipActive: { backgroundColor: '#FF4500' },
  rpeChipText: { color: '#888', fontSize: 12, fontWeight: '600' },
  rpeChipTextActive: { color: '#FFF' },
  logBtn: {
    backgroundColor: '#FFD700',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  logBtnText: { color: '#000', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  doneText: { color: '#FFD700', fontSize: 20, fontWeight: '700', textAlign: 'center', padding: 20 },
  exerciseList: { maxHeight: 80, marginBottom: 12 },
  exChip: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 12,
    marginRight: 8,
    minWidth: 100,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  exChipActive: { borderColor: '#FFD700' },
  exChipText: { color: '#C0C0C0', fontSize: 12, marginBottom: 2 },
  exChipSets: { color: '#FFD700', fontSize: 11, fontWeight: '700' },
  finishBtn: {
    backgroundColor: '#1A3A1A',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2E5C2E',
  },
  finishBtnText: { color: '#4CAF50', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
});
