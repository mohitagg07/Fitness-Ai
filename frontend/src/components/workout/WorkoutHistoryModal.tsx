// VYRN — Workout History Modal
//
// This did not exist before: the backend already had GET /workouts/history
// and GET /workouts/sessions/{id}/detail fully built (with real volume,
// exercise counts, and per-set detail from exercise_logs), but nothing on
// the frontend ever called them — there was no way to see past sessions
// by date. This modal is the missing UI for those two endpoints.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { workoutApi, describeApiError } from '../../utils/api';
import { COLORS } from '../../theme/colors';
import EmptyState from '../shared/EmptyState';

interface SessionSummary {
  id: string; session_date: string; day_label?: string; workout_type?: string;
  total_volume_kg?: number; duration_minutes?: number; calories_burned?: number;
  exercise_count: number; exercises: string[]; set_count: number; working_set_count: number;
}
interface SetRow { weight_kg: number; reps: number; rpe?: number; is_warmup?: boolean; logged_at?: string; }
interface ExerciseGroup { exercise_name: string; sets: SetRow[]; }

function formatDate(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export default function WorkoutHistoryModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [hasData, setHasData] = useState(true);
  const [emptyMsg, setEmptyMsg] = useState('');

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSession, setDetailSession] = useState<SessionSummary | null>(null);
  const [detailExercises, setDetailExercises] = useState<ExerciseGroup[]>([]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await workoutApi.getHistory(30, 0);
      setHasData(!!res.data.has_data);
      setSessions(res.data.sessions || []);
      setEmptyMsg(res.data.empty_state || '');
    } catch (err: any) {
      const { message } = describeApiError(err);
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) { setDetailId(null); loadHistory(); }
  }, [visible, loadHistory]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    try {
      const res = await workoutApi.getSessionDetail(id);
      setDetailSession(res.data.session);
      setDetailExercises(res.data.exercises || []);
    } catch {
      setDetailSession(null);
      setDetailExercises([]);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          {detailId ? (
            <TouchableOpacity onPress={() => setDetailId(null)} style={styles.headerBtn}>
              <Ionicons name="chevron-back" size={20} color={COLORS.text} />
              <Text style={styles.headerBtnText}>History</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
          <Text style={styles.title}>{detailId ? 'Session Detail' : 'Workout History'}</Text>
          <TouchableOpacity onPress={onClose} style={{ width: 60, alignItems: 'flex-end' }}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        {!detailId ? (
          loading ? (
            <View style={styles.center}><ActivityIndicator color={COLORS.primaryGreen} /></View>
          ) : errorMsg ? (
            <View style={styles.center}>
              <Ionicons name="cloud-offline-outline" size={28} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>{errorMsg}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={loadHistory}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : !hasData || sessions.length === 0 ? (
            <EmptyState
              icon="barbell-outline"
              title="No Workout History Yet"
              body={emptyMsg || "Complete your first workout and the AI will automatically build your progress timeline."}
              actionLabel="Start Workout"
              onAction={() => { onClose(); router.push('/(tabs)/workout'); }}
            />
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {sessions.map((s) => (
                <TouchableOpacity key={s.id} style={styles.sessionCard} onPress={() => openDetail(s.id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionDate}>{formatDate(s.session_date)}</Text>
                    <Text style={styles.sessionType}>
                      {s.workout_type || s.day_label || 'Training'} · {s.exercise_count} exercise{s.exercise_count === 1 ? '' : 's'} · {s.working_set_count} sets
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {!!s.total_volume_kg && (
                      <Text style={styles.sessionVolume}>{Math.round(s.total_volume_kg)} kg</Text>
                    )}
                    {!!s.duration_minutes && (
                      <Text style={styles.sessionMeta}>{s.duration_minutes} min</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} style={{ marginLeft: 8 }} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )
        ) : detailLoading ? (
          <View style={styles.center}><ActivityIndicator color={COLORS.primaryGreen} /></View>
        ) : !detailSession ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>Could not load this session.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <View style={styles.detailHeaderCard}>
              <Text style={styles.sessionDate}>{formatDate(detailSession.session_date)}</Text>
              <Text style={styles.sessionType}>{detailSession.workout_type || detailSession.day_label || 'Training'}</Text>
              <View style={styles.detailStatsRow}>
                {!!detailSession.total_volume_kg && <Stat label="VOLUME" value={`${Math.round(detailSession.total_volume_kg)} kg`} />}
                {!!detailSession.duration_minutes && <Stat label="DURATION" value={`${detailSession.duration_minutes} min`} />}
                {!!detailSession.calories_burned && <Stat label="CALORIES" value={`${detailSession.calories_burned}`} />}
              </View>
            </View>

            {detailExercises.map((ex, i) => (
              <View key={i} style={styles.exerciseCard}>
                <Text style={styles.exerciseName}>{ex.exercise_name}</Text>
                {ex.sets.map((set, si) => (
                  <View key={si} style={styles.setRow}>
                    <Text style={styles.setLabel}>
                      Set {si + 1}{set.is_warmup ? ' (warmup)' : ''}
                    </Text>
                    <Text style={styles.setValue}>
                      {set.weight_kg}kg × {set.reps}{set.rpe ? ` @ RPE ${set.rpe}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={styles.detailStatValue}>{value}</Text>
      <Text style={styles.detailStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 56, paddingBottom: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerBtn: { flexDirection: 'row', alignItems: 'center', width: 90 },
  headerBtnText: { color: COLORS.text, fontSize: 14, marginLeft: 2 },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  closeText: { color: COLORS.primaryGreen, fontSize: 14, fontWeight: '600' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryBtn: { marginTop: 6, backgroundColor: COLORS.cardElevated, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 9, borderWidth: 1, borderColor: COLORS.border },
  retryText: { color: COLORS.primaryGreen, fontSize: 13, fontWeight: '700' },

  list: { padding: 16, paddingBottom: 40 },

  sessionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.cardElevated, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 14, marginBottom: 10,
  },
  sessionDate: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  sessionType: { color: COLORS.textSecondary, fontSize: 12, marginTop: 3 },
  sessionVolume: { color: COLORS.primaryGreen, fontSize: 14, fontWeight: '700' },
  sessionMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },

  detailHeaderCard: {
    backgroundColor: COLORS.cardElevated, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, padding: 16, marginBottom: 14,
  },
  detailStatsRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 14 },
  detailStatValue: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  detailStatLabel: { color: COLORS.textMuted, fontSize: 10, marginTop: 3, letterSpacing: 0.5 },

  exerciseCard: {
    backgroundColor: COLORS.card, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 14, marginBottom: 10,
  },
  exerciseName: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  setRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: COLORS.border },
  setLabel: { color: COLORS.textMuted, fontSize: 12 },
  setValue: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
});