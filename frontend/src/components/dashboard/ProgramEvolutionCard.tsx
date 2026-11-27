// VYRN — Program Evolution Card
//
// Shows program version chips (v1 → v2 → v3...) and the diff for the
// latest version. Calls GET /api/program/versions (real data).
// Also has a "Rewrite Now" trigger for on-demand rewrites.

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { programApi, trainingPlanApi } from '../../utils/api';

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
  status?: string;
}

interface AdaptiveProposal {
  plan_id: string;
  version_id: string;
  version_number: number;
  trigger: string;
  explanation: string;
  changes: ChangeItem[];
  snapshot: {
    workout?: {
      label?: string;
      workout_type?: string;
      estimated_duration_minutes?: number;
      exercises?: Array<{
        name: string;
        sets: number;
        reps: string;
        load_kg?: number | null;
        load_guidance?: string | null;
        rest_seconds?: number;
      }>;
    };
  };
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

function ProgramEvolutionCard() {
  const [versions, setVersions] = useState<ProgramVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [rewriting, setRewriting] = useState(false);
  const [proposalAction, setProposalAction] = useState(false);
  const [proposal, setProposal] = useState<AdaptiveProposal | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number>(0);

  const load = async () => {
    try {
      const active = await trainingPlanApi.getActive();
      const planId = active.data?.plan?.id;
      if (planId) {
        const response = await trainingPlanApi.getVersions(planId, 20);
        const rows = response.data?.versions || [];
        const mapped: ProgramVersion[] = rows.map((version: any) => ({
          id: version.id,
          version_number: version.version_number,
          trigger: version.snapshot?.adaptive_trigger || version.change_reason || version.status,
          explanation: version.snapshot?.change_reason || version.change_reason || 'Versioned training plan',
          changes: version.snapshot?.adaptive_changes || [],
          created_at: version.created_at,
          status: version.status,
        }));
        setVersions(mapped);
        if (mapped.length > 0) setSelectedVersion(mapped[0].version_number);
      } else {
        const legacy = await programApi.getVersions(10);
        const rows = legacy.data?.versions || [];
        setVersions(rows);
        if (rows.length > 0) setSelectedVersion(rows[0].version_number);
      }
    } catch {
      // Keep the last successfully loaded view; retry remains available.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRewrite = async () => {
    setRewriting(true);
    try {
      const res = await programApi.proposeRewrite();
      if (res.data?.proposal_created) {
        setProposal({
          plan_id: res.data.plan_id,
          version_id: res.data.version_id,
          version_number: res.data.version_number,
          trigger: res.data.trigger,
          explanation: res.data.explanation,
          changes: res.data.changes || [],
          snapshot: res.data.snapshot || {},
        });
      } else {
        Alert.alert('No change recommended', res.data?.explanation || 'Your current plan should stay as it is.');
      }
    } catch (error: any) {
      Alert.alert(
        'Could not prepare a proposal',
        error?.response?.data?.detail || 'Check that you have an approved detailed training plan and try again.'
      );
    } finally {
      setRewriting(false);
    }
  };

  const approveProposal = async () => {
    if (!proposal || proposalAction) return;
    setProposalAction(true);
    try {
      await trainingPlanApi.approveVersion(proposal.plan_id, proposal.version_id);
      setProposal(null);
      await load();
      Alert.alert('Training plan updated', 'The approved changes are now active for future sessions.');
    } catch (error: any) {
      Alert.alert('Could not apply changes', error?.response?.data?.detail || 'Your current approved plan remains active.');
    } finally {
      setProposalAction(false);
    }
  };

  const rejectProposal = async () => {
    if (!proposal || proposalAction) return;
    setProposalAction(true);
    try {
      await trainingPlanApi.rejectVersion(proposal.plan_id, proposal.version_id);
      setProposal(null);
    } catch (error: any) {
      Alert.alert('Could not dismiss proposal', error?.response?.data?.detail || 'The proposal has not been changed.');
    } finally {
      setProposalAction(false);
    }
  };

  if (!loading && versions.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Ionicons name="git-branch-outline" size={13} color={COLORS.strain} />
          <Text style={styles.label}>PROGRAM EVOLUTION</Text>
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
        <Text style={styles.label}>PROGRAM EVOLUTION</Text>
      </View>

      {proposal && (
        <View style={styles.proposal}>
          <View style={styles.proposalTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.proposalEyebrow}>PROPOSED CHANGE · V{proposal.version_number}</Text>
              <Text style={styles.proposalTitle}>{proposal.trigger.replace(/_/g, ' ')}</Text>
            </View>
            <View style={styles.pendingChip}>
              <Text style={styles.pendingText}>AWAITING APPROVAL</Text>
            </View>
          </View>
          <Text style={styles.explanation}>{proposal.explanation}</Text>
          <Text style={styles.reviewLabel}>PROPOSED SESSION</Text>
          <Text style={styles.proposalWorkout}>
            {proposal.snapshot.workout?.label || proposal.snapshot.workout?.workout_type?.replace(/_/g, ' ') || 'Updated workout'}
            {proposal.snapshot.workout?.estimated_duration_minutes
              ? ` · ${proposal.snapshot.workout.estimated_duration_minutes} min`
              : ''}
          </Text>
          {(proposal.snapshot.workout?.exercises || []).map((exercise, index) => (
            <View key={`${exercise.name}-${index}`} style={styles.proposedExercise}>
              <View style={{ flex: 1 }}>
                <Text style={styles.proposedExerciseName}>{exercise.name}</Text>
                <Text style={styles.proposedExerciseMeta}>
                  {exercise.sets} sets · {exercise.reps} reps · {exercise.rest_seconds || 90}s rest
                  {exercise.load_kg != null ? ` · ${exercise.load_kg}kg` : ''}
                </Text>
              </View>
            </View>
          ))}
          <Text style={styles.proposalFootnote}>
            Nothing changes until you approve this version. Your completed sessions keep their original prescription.
          </Text>
          <View style={styles.proposalActions}>
            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={rejectProposal}
              disabled={proposalAction}
              accessibilityRole="button"
            >
              <Text style={styles.rejectText}>Keep current plan</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.approveBtn}
              onPress={approveProposal}
              disabled={proposalAction}
              accessibilityRole="button"
            >
              {proposalAction
                ? <ActivityIndicator color="#000" size="small" />
                : <><Ionicons name="checkmark" size={14} color="#000" /><Text style={styles.approveText}>Approve changes</Text></>}
            </TouchableOpacity>
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
  proposal: { backgroundColor: '#171D1A', borderRadius: 14, borderWidth: 1, borderColor: COLORS.recoveryHigh + '50', padding: 14, marginBottom: 14, gap: 9 },
  proposalTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proposalEyebrow: { color: COLORS.recoveryHigh, fontSize: 8, fontWeight: '800', letterSpacing: 1.1 },
  proposalTitle: { color: '#F2F4F2', fontSize: 14, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 },
  pendingChip: { borderWidth: 1, borderColor: COLORS.recoveryMed + '70', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7 },
  pendingText: { color: COLORS.recoveryMed, fontSize: 7, fontWeight: '800', letterSpacing: 0.4 },
  reviewLabel: { color: '#7F9290', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  proposalWorkout: { color: '#F2F4F2', fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  proposedExercise: { borderTopWidth: 1, borderTopColor: '#2A3732', paddingTop: 7 },
  proposedExerciseName: { color: '#E0E8E3', fontSize: 11, fontWeight: '700' },
  proposedExerciseMeta: { color: '#8C9C95', fontSize: 9, marginTop: 3 },
  proposalFootnote: { color: '#8C9C95', fontSize: 9, lineHeight: 14 },
  proposalActions: { flexDirection: 'row', gap: 8, marginTop: 3 },
  rejectBtn: { flex: 1, borderWidth: 1, borderColor: '#4A5B52', borderRadius: 9, padding: 10, alignItems: 'center' },
  rejectText: { color: '#C8D2CC', fontSize: 10, fontWeight: '700' },
  approveBtn: { flex: 1.2, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: COLORS.recoveryHigh, borderRadius: 9, padding: 10 },
  approveText: { color: '#000', fontSize: 10, fontWeight: '800' },
  rewriteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.strain, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start',
  },
  rewriteBtnText: { color: '#000', fontSize: 12, fontWeight: '800' },
});

export default React.memo(ProgramEvolutionCard);
