// VYRN — Program Health
//
// Answers "is my program still the right one?" — real version history +
// on-demand adaptive rewrite. Calls GET /api/program/versions (real data,
// unchanged from the original Program Evolution card). Renamed and
// restyled onto the new Home layout; the underlying data/rewrite logic
// is untouched. Deliberately does NOT show a fabricated "96% health
// score" — there's no backend field for that — so the status line below
// shows only real values: version count and last-updated date.

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import api from '../../utils/api';

interface ChangeItem {
  type: string;
  description: string;
  exercise?: string;
  swap_to?: string;
  adjustment: string;
}

interface ProgramVersion {
  id: string;
  version_number: number;
  trigger: string;
  explanation: string;
  changes: ChangeItem[] | string;
  created_at: string;
}

function parseChanges(raw: ChangeItem[] | string): ChangeItem[] {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function triggerIcon(trigger: string) {
  if (trigger.includes('plateau')) return 'trending-up-outline';
  if (trigger.includes('recovery')) return 'heart-outline';
  if (trigger.includes('eating') || trigger.includes('protein')) return 'nutrition-outline';
  return 'git-branch-outline';
}

function changeTypeColor(type: string) {
  if (type === 'volume_reduction') return COLORS.recoveryMed;
  if (type === 'intensity_increase') return COLORS.recoveryHigh;
  if (type === 'exercise_swap') return COLORS.strainGlow;
  if (type === 'deload') return '#5AC8FA';
  return '#AEAEB2';
}

function formatDate(iso: string) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ProgramHealthCard() {
  const [versions, setVersions] = useState<ProgramVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [rewriting, setRewriting] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number>(0);

  const load = async () => {
    try {
      const res = await api.get('/program/versions');
      const v = res.data.versions || [];
      setVersions(v);
      if (v.length > 0) setSelectedVersion(v[0].version_number);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleRewrite = async () => {
    setRewriting(true);
    try {
      const res = await api.post('/program/rewrite');
      if (res.data.rewrite_triggered) {
        await load();
        Alert.alert(
          `Program v${res.data.version_number} Ready`,
          res.data.explanation,
          [{ text: 'Got it', style: 'default' }]
        );
      } else {
        Alert.alert('No Rewrite Needed', res.data.explanation || 'All patterns are within normal range.');
      }
    } catch {
      Alert.alert('Error', 'Could not run program rewriter. Try again shortly.');
    }
    setRewriting(false);
  };

  if (!loading && versions.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Ionicons name="git-branch-outline" size={13} color={COLORS.strain} />
          <Text style={styles.label}>PROGRAM HEALTH</Text>
        </View>
        <Text style={styles.emptyText}>No program rewrites yet. The coach will rewrite your program when a plateau or recovery issue is detected.</Text>
        <TouchableOpacity style={styles.rewriteBtn} onPress={handleRewrite} disabled={rewriting}>
          {rewriting
            ? <ActivityIndicator color="#000" size="small" />
            : <><Ionicons name="refresh" size={13} color="#000" /><Text style={styles.rewriteBtnText}>Check Now</Text></>
          }
        </TouchableOpacity>
      </View>
    );
  }

  const active = versions.find(v => v.version_number === selectedVersion) || versions[0];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="git-branch-outline" size={13} color={COLORS.strain} />
        <Text style={styles.label}>PROGRAM HEALTH</Text>
      </View>

      {versions.length > 0 && (
        <View style={styles.statusRow}>
          <View style={styles.statusItem}>
            <Text style={styles.statusValue}>v{versions[0]?.version_number ?? 1}</Text>
            <Text style={styles.statusLabel}>Current Version</Text>
          </View>
          <View style={styles.statusDivider} />
          <View style={styles.statusItem}>
            <Text style={styles.statusValue}>{formatDate(versions[0]?.created_at)}</Text>
            <Text style={styles.statusLabel}>Last Updated</Text>
          </View>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={COLORS.recoveryHigh} size="small" style={{ marginVertical: 8 }} />
      ) : (
        <>
          {/* Version chip row */}
          <View style={styles.chipRow}>
            {[...versions].reverse().map(v => (
              <TouchableOpacity
                key={v.version_number}
                style={[styles.chip, selectedVersion === v.version_number && styles.chipActive]}
                onPress={() => setSelectedVersion(v.version_number)}
              >
                <Text style={[styles.chipText, selectedVersion === v.version_number && styles.chipTextActive]}>
                  v{v.version_number}
                </Text>
              </TouchableOpacity>
            ))}
            {versions.length > 0 && (
              <View style={[styles.chip, styles.chipLatest]}>
                <Text style={[styles.chipText, { color: COLORS.strain }]}>CURRENT</Text>
              </View>
            )}
          </View>

          {/* Active version diff */}
          {active && (
            <>
              <View style={styles.triggerRow}>
                <Ionicons name={triggerIcon(active.trigger) as any} size={12} color={COLORS.recoveryMed} />
                <Text style={styles.triggerText}>{active.trigger.replace(/_/g, ' ').toUpperCase()}</Text>
              </View>
              <Text style={styles.explanation}>{active.explanation}</Text>

              <View style={styles.changesList}>
                {parseChanges(active.changes).map((c, i) => (
                  <View key={i} style={styles.changeRow}>
                    <View style={[styles.changeDot, { backgroundColor: changeTypeColor(c.type) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.changeDesc}>{c.description}</Text>
                      <View style={[styles.adjustmentChip, { borderColor: changeTypeColor(c.type) + '60' }]}>
                        <Text style={[styles.adjustmentText, { color: changeTypeColor(c.type) }]}>{c.adjustment}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          <TouchableOpacity style={styles.rewriteBtn} onPress={handleRewrite} disabled={rewriting}>
            {rewriting
              ? <ActivityIndicator color="#000" size="small" />
              : <><Ionicons name="refresh" size={13} color="#000" /><Text style={styles.rewriteBtnText}>Rewrite Program</Text></>
            }
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: '#0E0A18', borderRadius: 18,
    padding: 18, borderWidth: 1, borderColor: COLORS.strain + '30',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  label: { color: COLORS.strain, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 14,
    paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1F1F1F',
  },
  statusItem: { flex: 1 },
  statusValue: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  statusLabel: { color: '#5C6B6E', fontSize: 10, marginTop: 2 },
  statusDivider: { width: 1, height: 28, backgroundColor: '#1F1F1F', marginHorizontal: 12 },
  emptyText: { color: '#5C6B6E', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  chipRow: { flexDirection: 'row', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
  chip: {
    paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8,
    backgroundColor: '#1C1C1C', borderWidth: 1, borderColor: '#2C2C2C',
  },
  chipActive: { backgroundColor: COLORS.strain + '20', borderColor: COLORS.strain + '80' },
  chipLatest: { borderColor: COLORS.strain + '40' },
  chipText: { color: '#5C6B6E', fontSize: 10, fontWeight: '700' },
  chipTextActive: { color: COLORS.strain },
  triggerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  triggerText: { color: COLORS.recoveryMed, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  explanation: { color: '#C8D2D4', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  changesList: { gap: 10, marginBottom: 14 },
  changeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  changeDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  changeDesc: { color: '#E0E0E0', fontSize: 12, lineHeight: 17, marginBottom: 4 },
  adjustmentChip: {
    borderWidth: 1, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6, alignSelf: 'flex-start',
  },
  adjustmentText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  rewriteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.strain, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start',
  },
  rewriteBtnText: { color: '#000', fontSize: 12, fontWeight: '800' },
});
