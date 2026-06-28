/**
 * WorkoutSummaryCard — shown after finishing a session.
 * Displays total volume, sets logged, exercises hit, best set.
 * Replaces the bare Alert.alert used previously.
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';

interface SummaryData {
  total_volume_kg: number;
  sets_logged: number;
  exercises: string[];
  exercise_count: number;
  best_set: {
    exercise: string;
    weight_kg: number;
    reps: number;
    rpe?: number;
  } | null;
  session_minutes?: number;
}

interface Props {
  visible: boolean;
  data: SummaryData | null;
  onClose: () => void;
}

export default function WorkoutSummaryCard({ visible, data, onClose }: Props) {
  if (!data) return null;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.checkCircle}>
              <Ionicons name="checkmark" size={28} color="#000" />
            </View>
            <Text style={styles.title}>Session Complete</Text>
            <Text style={styles.subtitle}>Great work. Session saved.</Text>
          </View>

          {/* Stats grid */}
          <View style={styles.grid}>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{data.total_volume_kg.toLocaleString()}kg</Text>
              <Text style={styles.statLabel}>Total volume</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{data.sets_logged}</Text>
              <Text style={styles.statLabel}>Sets logged</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{data.exercise_count}</Text>
              <Text style={styles.statLabel}>Exercises</Text>
            </View>
            {data.session_minutes != null && (
              <View style={styles.stat}>
                <Text style={styles.statVal}>{data.session_minutes}m</Text>
                <Text style={styles.statLabel}>Duration</Text>
              </View>
            )}
          </View>

          {/* Best set */}
          {data.best_set && (
            <View style={styles.bestSet}>
              <Text style={styles.bestSetLabel}>BEST SET</Text>
              <Text style={styles.bestSetValue}>
                {data.best_set.exercise}: {data.best_set.weight_kg}kg × {data.best_set.reps} reps
                {data.best_set.rpe ? ` (RPE ${data.best_set.rpe})` : ''}
              </Text>
            </View>
          )}

          {/* Exercises list */}
          {data.exercises.length > 0 && (
            <View style={styles.exList}>
              <Text style={styles.exListLabel}>EXERCISES</Text>
              <Text style={styles.exListText}>{data.exercises.join(' · ')}</Text>
            </View>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#1C1C1C', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 28, borderTopWidth: 1, borderColor: '#2A2A2A',
  },
  header: { alignItems: 'center', marginBottom: 24 },
  checkCircle: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.primaryGreen,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  title: { color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#888', fontSize: 14 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around',
    backgroundColor: '#141414', borderRadius: 12, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: '#222',
  },
  stat: { alignItems: 'center', minWidth: '40%', marginBottom: 8 },
  statVal: { color: COLORS.primaryGreen, fontSize: 22, fontWeight: '800' },
  statLabel: { color: '#666', fontSize: 11, marginTop: 2 },
  bestSet: {
    backgroundColor: '#141414', borderRadius: 10, padding: 12,
    marginBottom: 12, borderWidth: 1, borderColor: '#222',
  },
  bestSetLabel: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  bestSetValue: { color: '#DDD', fontSize: 13, fontWeight: '600' },
  exList: {
    backgroundColor: '#141414', borderRadius: 10, padding: 12,
    marginBottom: 20, borderWidth: 1, borderColor: '#222',
  },
  exListLabel: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  exListText: { color: '#888', fontSize: 12, lineHeight: 18 },
  closeBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  closeBtnText: { color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
});
