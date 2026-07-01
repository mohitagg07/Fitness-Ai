// VYRN — Coach Memory Modal
//
// The backend has extracted and stored real memories (profile prefs,
// injuries, and freeform facts recalled from ChromaDB — see GET
// /coach/memory's docstring) since earlier work, but nothing in the app
// ever showed them to the user. Without this, there's no way to know the
// coach remembers anything at all. This modal is the missing UI for that
// existing, real endpoint — every value shown here is something the coach
// actually has access to on every chat turn, not a separate display copy.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { coachApi, describeApiError } from '../../utils/api';
import { COLORS } from '../../theme/colors';

interface MemoryData {
  known_preferences: {
    goal?: string | null;
    experience_level?: string | null;
    workout_time_preference?: string | null;
    equipment?: string[];
    food_preference?: string | null;
  };
  injuries: { body_part: string; issue_type: string; severity: number }[];
  freeform_memories: string[];
}

function cap(s?: string | null): string {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CoachMemoryModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [data, setData] = useState<MemoryData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await coachApi.getMemory();
      setData(res.data);
    } catch (err: any) {
      const { message } = describeApiError(err);
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const prefs = data?.known_preferences;
  const hasAnyPrefs = !!(prefs && (prefs.goal || prefs.experience_level || prefs.workout_time_preference || prefs.food_preference || prefs.equipment?.length));
  const memoryCount = data?.freeform_memories?.length || 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ width: 60 }} />
          <Text style={styles.title}>Coach Memory</Text>
          <TouchableOpacity onPress={onClose} style={{ width: 60, alignItems: 'flex-end' }}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={COLORS.primaryGreen} /></View>
        ) : errorMsg ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={28} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <View style={styles.introCard}>
              <Ionicons name="sparkles" size={20} color={COLORS.primaryGreen} />
              <Text style={styles.introText}>
                This is what your coach actually remembers about you — the same data it reads before every reply.
              </Text>
            </View>

            <SectionLabel text="WHAT YOUR COACH KNOWS" />
            {hasAnyPrefs ? (
              <View style={styles.card}>
                {!!prefs?.goal && <MemoryRow icon="flag-outline" label="Goal" value={cap(prefs.goal)} />}
                {!!prefs?.experience_level && <MemoryRow icon="trending-up-outline" label="Experience" value={cap(prefs.experience_level)} />}
                {!!prefs?.workout_time_preference && <MemoryRow icon="time-outline" label="Preferred Time" value={cap(prefs.workout_time_preference)} />}
                {!!prefs?.food_preference && <MemoryRow icon="nutrition-outline" label="Diet" value={cap(prefs.food_preference)} />}
                {!!prefs?.equipment?.length && (
                  <MemoryRow icon="barbell-outline" label="Equipment" value={prefs.equipment.map(cap).join(', ')} last />
                )}
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.emptyHint}>No preferences on file yet — complete your profile so the coach can personalize sessions.</Text>
              </View>
            )}

            <SectionLabel text="INJURY AWARENESS" />
            {data?.injuries?.length ? (
              <View style={styles.card}>
                {data.injuries.map((inj, i) => (
                  <MemoryRow
                    key={i}
                    icon="shield-checkmark-outline"
                    label={cap(inj.body_part)}
                    value={`${cap(inj.issue_type)} · ${inj.severity}/10`}
                    last={i === data.injuries.length - 1}
                    valueColor={inj.severity >= 7 ? COLORS.recoveryLow : COLORS.recoveryMed}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.emptyHint}>No injuries on file — the coach will train you at full intensity.</Text>
              </View>
            )}

            <SectionLabel text={`STORED MEMORIES (${memoryCount})`} />
            {memoryCount > 0 ? (
              <View style={styles.card}>
                {data!.freeform_memories.map((m, i) => (
                  <View key={i} style={[styles.freeformRow, i === memoryCount - 1 && { borderBottomWidth: 0 }]}>
                    <Ionicons name="bookmark-outline" size={13} color={COLORS.textMuted} style={{ marginTop: 2 }} />
                    <Text style={styles.freeformText}>{m}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.emptyHint}>Nothing extracted yet — the more you chat with your coach, the more it remembers.</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function MemoryRow({
  icon, label, value, last, valueColor,
}: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; last?: boolean; valueColor?: string }) {
  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={14} color={COLORS.textMuted} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
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
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  closeText: { color: COLORS.primaryGreen, fontSize: 14, fontWeight: '600' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryBtn: { marginTop: 6, backgroundColor: COLORS.cardElevated, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 9, borderWidth: 1, borderColor: COLORS.border },
  retryText: { color: COLORS.primaryGreen, fontSize: 13, fontWeight: '700' },

  list: { padding: 16, paddingBottom: 40 },

  introCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: COLORS.primaryGreen + '12', borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.primaryGreen + '30',
    padding: 14, marginBottom: 20,
  },
  introText: { flex: 1, color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18 },

  sectionLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.3, marginBottom: 8, marginTop: 4 },

  card: {
    backgroundColor: COLORS.cardElevated, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 4, marginBottom: 20,
  },
  emptyHint: { color: COLORS.textMuted, fontSize: 12.5, lineHeight: 18, padding: 12 },

  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { color: COLORS.textSecondary, fontSize: 13 },
  rowValue: { color: COLORS.text, fontSize: 13, fontWeight: '600', maxWidth: '55%', textAlign: 'right' },

  freeformRow: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  freeformText: { flex: 1, color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18 },
});
