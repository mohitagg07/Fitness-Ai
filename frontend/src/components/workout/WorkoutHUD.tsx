import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, FlatList,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { workoutApi, coachApi } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS } from '../../theme/colors';

const DEFAULT_REST = 90;

const COMMON_EXERCISES = [
  'Bench Press', 'Incline Bench Press', 'Decline Bench Press',
  'Squat', 'Front Squat', 'Leg Press',
  'Deadlift', 'Romanian Deadlift', 'Sumo Deadlift',
  'Pull Up', 'Lat Pulldown', 'Seated Cable Row', 'Barbell Row',
  'Overhead Press', 'Arnold Press', 'Lateral Raise',
  'Bicep Curl', 'Hammer Curl', 'Tricep Pushdown',
  'Leg Curl', 'Leg Extension', 'Calf Raise',
  'Cable Fly', 'Dumbbell Fly', 'Chest Dip',
];

interface SetEntry {
  exercise_name: string;
  weight_kg: number;
  reps: number;
  rpe: number;
  set_number: number;
  is_pr?: boolean;
}

interface ExerciseGroup {
  name: string;
  sets: SetEntry[];
}

export default function WorkoutHUD() {
  const { activeSession, setActiveSession, setCnsFatigue } = useStore();
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionDate] = useState(new Date().toISOString().split('T')[0]);

  // Per-session data
  const [exerciseGroups, setExerciseGroups] = useState<ExerciseGroup[]>([]);
  const [allLogs, setAllLogs] = useState<SetEntry[]>([]);

  // Input state
  const [exerciseName, setExerciseName] = useState('');
  const [showExPicker, setShowExPicker] = useState(false);
  const [exQuery, setExQuery] = useState('');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [rpe, setRpe] = useState(7);

  // Rest timer
  const [restTimer, setRestTimer] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);

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
        day_label: getDayLabel(),
        session_date: sessionDate,
      });
      setActiveSession({ id: res.data.id, day_label: getDayLabel(), logs: [] });
      setSessionStarted(true);
    } catch {
      Alert.alert('Error', 'Could not start session. Is the backend running?');
    }
  };

  const getDayLabel = () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `${days[new Date().getDay()]} — ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  };

  const askCoachForWorkout = async () => {
    try {
      const res = await coachApi.chat("Give me today's workout plan based on my profile, goal, and current recovery.");
      Alert.alert("Today's Plan", res.data.reply.slice(0, 500) + (res.data.reply.length > 500 ? '…\n\n(See Coach tab for full plan)' : ''));
      if (res.data.cns_fatigue_score != null) setCnsFatigue(res.data.cns_fatigue_score);
    } catch {
      Alert.alert('Error', 'Could not reach the AI coach.');
    }
  };

  const setsForCurrentExercise = () => {
    return allLogs.filter((l) => l.exercise_name === exerciseName).length;
  };

  const bestWeightForExercise = (name: string) => {
    const sets = allLogs.filter((l) => l.exercise_name === name);
    if (!sets.length) return null;
    return Math.max(...sets.map((s) => s.weight_kg));
  };

  const logSet = async () => {
    if (!activeSession) return;
    if (!exerciseName.trim()) {
      Alert.alert('Missing exercise', 'Select or type an exercise name first.');
      return;
    }
    if (!weight || !reps) {
      Alert.alert('Missing input', 'Enter weight and reps.');
      return;
    }

    const weightVal = parseFloat(weight);
    const repsVal = parseInt(reps);
    const setNum = setsForCurrentExercise() + 1;

    // PR detection
    const prev = bestWeightForExercise(exerciseName);
    const isPR = prev === null || weightVal > prev;

    const logData: SetEntry = {
      exercise_name: exerciseName.trim(),
      weight_kg: weightVal,
      reps: repsVal,
      rpe,
      set_number: setNum,
      is_pr: isPR && setNum === 1 ? false : isPR, // only PR if heavier than previous set in session
    };

    try {
      await workoutApi.logSet(activeSession.id, {
        exercise_name: logData.exercise_name,
        weight_kg: logData.weight_kg,
        reps: logData.reps,
        rpe: logData.rpe,
      });

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const newLogs = [...allLogs, logData];
      setAllLogs(newLogs);

      // Update exercise groups
      setExerciseGroups((prev) => {
        const existing = prev.find((g) => g.name === logData.exercise_name);
        if (existing) {
          return prev.map((g) =>
            g.name === logData.exercise_name ? { ...g, sets: [...g.sets, logData] } : g
          );
        }
        return [...prev, { name: logData.exercise_name, sets: [logData] }];
      });

      if (isPR && prev !== null) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('🏆 New PR!', `${exerciseName}: ${weightVal}kg — new personal record!`);
      }

      const isHeavy = ['deadlift', 'squat', 'bench'].some((k) => exerciseName.toLowerCase().includes(k));
      setRestTimer(isHeavy ? 180 : DEFAULT_REST);
      setTimerRunning(true);

      setWeight('');
      setReps('');
    } catch {
      Alert.alert('Error', 'Failed to log set.');
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
              setExerciseGroups([]);
              setAllLogs([]);
              setExerciseName('');
              Alert.alert('Session Complete ✓', `${allLogs.length} sets logged. Great work!`);
            } catch {
              Alert.alert('Error', 'Could not complete session.');
            }
          },
        },
      ]
    );
  };

  const filteredExercises = COMMON_EXERCISES.filter((e) =>
    e.toLowerCase().includes(exQuery.toLowerCase())
  );

  if (!sessionStarted) {
    return (
      <View style={styles.container}>
        <View style={styles.preSession}>
          <View style={styles.preBadge}>
            <Ionicons name="barbell-outline" size={28} color={COLORS.primaryGreen} />
          </View>
          <Text style={styles.gymTitle}>GYM MODE</Text>
          <Text style={styles.gymSubtitle}>Your AI spotter is ready</Text>
          <Text style={styles.gymDate}>{getDayLabel()}</Text>
          <Text style={styles.gymDesc}>
            Start a session to log sets with weight, reps, and RPE. PRs are auto-detected.
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
      {/* Rest Timer */}
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

      {/* Session header */}
      <View style={styles.sessionInfo}>
        <View style={styles.sessionLabelRow}>
          <View style={styles.activeDot} />
          <Text style={styles.sessionLabel}>SESSION ACTIVE</Text>
        </View>
        <Text style={styles.sessionDate}>{getDayLabel()}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Log Set Card */}
        <View style={styles.logCard}>
          <Text style={styles.logCardTitle}>LOG A SET</Text>

          {/* Exercise selector */}
          <TouchableOpacity style={styles.exSelector} onPress={() => { setExQuery(''); setShowExPicker(true); }}>
            <Ionicons name="barbell-outline" size={16} color={exerciseName ? COLORS.primaryGreen : '#555'} />
            <Text style={[styles.exSelectorText, exerciseName && { color: '#FFF' }]}>
              {exerciseName || 'Select exercise...'}
            </Text>
            <Ionicons name="chevron-down" size={16} color="#555" />
          </TouchableOpacity>

          {exerciseName ? (
            <Text style={styles.setCount}>
              Set {setsForCurrentExercise() + 1} of {exerciseName}
            </Text>
          ) : null}

          {/* Weight + Reps */}
          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>WEIGHT</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.bigInput}
                  value={weight}
                  onChangeText={setWeight}
                  placeholder="0"
                  placeholderTextColor="#333"
                  keyboardType="decimal-pad"
                />
                <Text style={styles.inputUnit}>kg</Text>
              </View>
            </View>
            <View style={styles.inputDivider} />
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>REPS</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.bigInput}
                  value={reps}
                  onChangeText={setReps}
                  placeholder="0"
                  placeholderTextColor="#333"
                  keyboardType="number-pad"
                />
                <Text style={styles.inputUnit}>×</Text>
              </View>
            </View>
          </View>

          {/* RPE */}
          <View style={styles.rpeRow}>
            <Text style={styles.rpeLabel}>RPE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.rpeChips}>
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
            </ScrollView>
          </View>

          <TouchableOpacity style={styles.logBtn} onPress={logSet}>
            <Ionicons name="add-circle-outline" size={16} color="#000" />
            <Text style={styles.logBtnText}>LOG SET + START REST</Text>
          </TouchableOpacity>
        </View>

        {/* Exercise Groups (day view) */}
        {exerciseGroups.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>TODAY'S WORKOUT</Text>
            {exerciseGroups.map((group) => (
              <View key={group.name} style={styles.exGroup}>
                <View style={styles.exGroupHeader}>
                  <Ionicons name="barbell-outline" size={14} color={COLORS.primaryGreen} />
                  <Text style={styles.exGroupName}>{group.name}</Text>
                  <Text style={styles.exGroupCount}>{group.sets.length} sets</Text>
                </View>
                {group.sets.map((s, i) => (
                  <View key={i} style={styles.setRow}>
                    <Text style={styles.setNum}>Set {s.set_number}</Text>
                    <Text style={styles.setDetail}>{s.weight_kg} kg</Text>
                    <Text style={styles.setDetail}>× {s.reps}</Text>
                    <Text style={styles.setRpe}>RPE {s.rpe}</Text>
                    {s.is_pr && (
                      <View style={styles.prBadge}>
                        <Text style={styles.prBadgeText}>PR</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      <TouchableOpacity style={styles.finishBtn} onPress={finishWorkout}>
        <Ionicons name="checkmark-circle-outline" size={18} color="#4CAF50" />
        <Text style={styles.finishBtnText}>FINISH WORKOUT</Text>
      </TouchableOpacity>

      {/* Exercise Picker Modal */}
      <Modal visible={showExPicker} animationType="slide" transparent>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Exercise</Text>
              <TouchableOpacity onPress={() => setShowExPicker(false)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.pickerSearch}
              value={exQuery}
              onChangeText={setExQuery}
              placeholder="Search or type exercise name..."
              placeholderTextColor="#555"
            />
            {exQuery.length > 0 && !COMMON_EXERCISES.some((e) => e.toLowerCase() === exQuery.toLowerCase()) && (
              <TouchableOpacity
                style={styles.customExBtn}
                onPress={() => { setExerciseName(exQuery); setShowExPicker(false); }}
              >
                <Ionicons name="add-circle-outline" size={16} color={COLORS.primaryGreen} />
                <Text style={styles.customExText}>Use "{exQuery}"</Text>
              </TouchableOpacity>
            )}
            <FlatList
              data={filteredExercises}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerItem}
                  onPress={() => { setExerciseName(item); setShowExPicker(false); }}
                >
                  <Text style={styles.pickerItemText}>{item}</Text>
                  {exerciseName === item && (
                    <Ionicons name="checkmark" size={16} color={COLORS.primaryGreen} />
                  )}
                </TouchableOpacity>
              )}
              keyboardShouldPersistTaps="handled"
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  preSession: { flex: 1, justifyContent: 'center', padding: 28, gap: 12 },
  preBadge: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#1A2535', alignItems: 'center', justifyContent: 'center' },
  gymTitle: { color: COLORS.primaryGreen, fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: 2 },
  gymSubtitle: { color: '#888', fontSize: 14, fontFamily: 'Inter_400Regular' },
  gymDate: { color: '#555', fontSize: 12, fontFamily: 'Inter_400Regular' },
  gymDesc: { color: '#C0C0C0', fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  startBtn: { backgroundColor: COLORS.primaryGreen, borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 8 },
  startBtnText: { color: '#000', fontSize: 15, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  coachBtn: { backgroundColor: '#1A2535', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#1E3A5F', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  coachBtnText: { color: COLORS.primaryGreen, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  timerBar: { backgroundColor: '#1A2E44', padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerText: { color: COLORS.primaryGreen, fontSize: 22, fontFamily: 'Inter_700Bold' },
  skipTimer: { color: '#888', fontSize: 13, fontFamily: 'Inter_400Regular' },
  sessionInfo: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sessionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4CAF50' },
  sessionLabel: { color: '#4CAF50', fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },
  sessionDate: { color: '#555', fontSize: 11, fontFamily: 'Inter_400Regular' },
  logCard: { backgroundColor: '#1E1E1E', borderRadius: 20, padding: 20, margin: 16, borderWidth: 1, borderColor: '#2A2A2A' },
  logCardTitle: { color: '#555', fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, marginBottom: 14 },
  exSelector: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#252525', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#2A2A2A' },
  exSelectorText: { flex: 1, color: '#555', fontSize: 15, fontFamily: 'Inter_400Regular' },
  setCount: { color: COLORS.primaryGreen, fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, marginBottom: 10, marginTop: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 14, gap: 0 },
  inputGroup: { flex: 1, alignItems: 'center' },
  inputLabel: { color: '#555', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  bigInput: { color: '#FFF', fontSize: 40, fontFamily: 'Inter_700Bold', textAlign: 'center', minWidth: 80, backgroundColor: '#252525', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  inputUnit: { color: '#555', fontSize: 18, fontFamily: 'Inter_400Regular' },
  inputDivider: { width: 1, height: 60, backgroundColor: '#2A2A2A', marginHorizontal: 8 },
  rpeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  rpeLabel: { color: '#555', fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  rpeChips: { flexDirection: 'row', gap: 6 },
  rpeChip: { backgroundColor: '#252525', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  rpeChipActive: { backgroundColor: '#FF4500' },
  rpeChipText: { color: '#666', fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  rpeChipTextActive: { color: '#FFF' },
  logBtn: { backgroundColor: COLORS.primaryGreen, borderRadius: 14, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  logBtnText: { color: '#000', fontSize: 14, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  section: { paddingHorizontal: 16 },
  sectionLabel: { color: '#555', fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, marginBottom: 10, marginTop: 4 },
  exGroup: { backgroundColor: '#1A1A1A', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#2A2A2A' },
  exGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  exGroupName: { flex: 1, color: '#FFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  exGroupCount: { color: '#555', fontSize: 12, fontFamily: 'Inter_400Regular' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#222' },
  setNum: { color: '#555', fontSize: 11, fontFamily: 'Inter_400Regular', width: 36 },
  setDetail: { color: '#C0C0C0', fontSize: 13, fontFamily: 'Inter_600SemiBold', flex: 1 },
  setRpe: { color: '#555', fontSize: 11, fontFamily: 'Inter_400Regular' },
  prBadge: { backgroundColor: '#FFD700' + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  prBadgeText: { color: '#FFD700', fontSize: 10, fontFamily: 'Inter_700Bold' },
  finishBtn: { margin: 16, backgroundColor: '#1A3A1A', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#2E5C2E', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  finishBtnText: { color: '#4CAF50', fontSize: 14, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '80%' },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  pickerTitle: { color: '#FFF', fontSize: 17, fontFamily: 'Inter_700Bold' },
  pickerSearch: { backgroundColor: '#252525', borderRadius: 12, padding: 12, color: '#FFF', fontSize: 15, fontFamily: 'Inter_400Regular', marginBottom: 10, borderWidth: 1, borderColor: '#2A2A2A' },
  customExBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: COLORS.primaryGreen + '15', borderRadius: 10, marginBottom: 8 },
  customExText: { color: COLORS.primaryGreen, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#222' },
  pickerItemText: { color: '#C0C0C0', fontSize: 14, fontFamily: 'Inter_400Regular' },
});