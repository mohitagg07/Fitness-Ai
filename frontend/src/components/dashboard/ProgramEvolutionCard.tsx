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
import { FONTS } from '../../theme/typography';
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
  evidence?: Array<{
    category: string;
    severity: string;
    title: string;
    detail: string;
    recommendation: string;
    confidence: string;
    data?: Record<string, unknown>;
  }>;
  change_details?: Array<{
    day: string;
    scope: string;
    exercise: string;
    proposed_exercise?: string;
    fields: Array<{ field: string; before: unknown; after: unknown }>;
  }>;
  unchanged_items?: Array<{
    day: string;
    exercise: string;
    prescription?: Record<string, unknown>;
  }>;
  unchanged_days?: string[];
  previous_snapshot?: {
    workout?: {
      label?: string;
      exercises?: Array<{
        name: string;
        sets: number;
        reps: string;
        load_kg?: number | null;
      }>;
    };
  };
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
    adaptive_guardrails?: string[];
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
  const [planId, setPlanId] = useState<string | null>(null);
  const [canPropose, setCanPropose] = useState(false);

  const load = async () => {
    try {
      const active = await trainingPlanApi.getActive();
      const activePlanId = active.data?.plan?.id;
      const activeVersionId = active.data?.plan?.current_version_id;
      setPlanId(activePlanId || null);
      setCanPropose(Boolean(activePlanId && activeVersionId));
      if (activePlanId) {
        const response = await trainingPlanApi.getVersions(activePlanId, 20);
        const rows = response.data?.versions || [];
        const mapped: ProgramVersion[] = rows.map((version: any) => ({
          id: version.id,
          version_number: version.version_number,
          trigger: version.snapshot?.adaptive_trigger || version.change_reason || version.status,
          explanation: version.snapshot?.change_reason || version.change_reason || 'Versioned training plan',
          changes: version.snapshot?.adaptive_changes || [],
          created_at: version.created_at,
          status: version.status,
          evidence: version.snapshot?.adaptive_evidence || [],
          change_details: version.snapshot?.adaptive_change_details || [],
          unchanged_items: version.snapshot?.adaptive_unchanged_items || [],
          unchanged_days: version.snapshot?.adaptive_unchanged_days || [],
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
          evidence: res.data.evidence || [],
          change_details: res.data.change_details || [],
          unchanged_items: res.data.unchanged_items || [],
          unchanged_days: res.data.unchanged_days || [],
          snapshot: res.data.snapshot || {},
          previous_snapshot: res.data.previous_snapshot || {},
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

  const restoreVersion = async () => {
    if (!active || !planId || active.status !== 'superseded' || proposalAction) return;
    Alert.alert(
      'Restore this program version?',
      'A new approved version will be created from this historical snapshot. Completed workout sessions will not change.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore version',
          onPress: async () => {
            setProposalAction(true);
            try {
              await trainingPlanApi.rollbackVersion(planId, active.id);
              await load();
              Alert.alert('Version restored', 'The selected training prescription is active for future sessions.');
            } catch (error: any) {
              Alert.alert('Could not restore version', error?.response?.data?.detail || 'Your active plan remains unchanged.');
            } finally {
              setProposalAction(false);
            }
          },
        },
      ],
    );
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
        <TouchableOpacity style={styles.rewriteBtn} onPress={handleRewrite} disabled={rewriting || !canPropose}>
          {rewriting
            ? <ActivityIndicator color="#000" size="small" />
            : canPropose
              ? <><Ionicons name="refresh" size={13} color="#000" /><Text style={styles.rewriteBtnText}>Check Now</Text></>
              : <><Ionicons name="lock-closed-outline" size={13} color="#000" /><Text style={styles.rewriteBtnText}>Approve a detailed plan first</Text></>
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
          {!!proposal.evidence?.length && (
            <>
              <Text style={styles.reviewLabel}>EVIDENCE THAT TRIGGERED THIS PROPOSAL</Text>
              {proposal.evidence.map((item, index) => (
                <View key={`evidence-${index}`} style={styles.proposedChange}>
                  <Ionicons name="analytics-outline" size={13} color={COLORS.recoveryMed} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.proposedChangeText}>
                      {item.title} · {item.severity.toUpperCase()} · {item.confidence} confidence
                    </Text>
                    <Text style={styles.evidenceDetail}>{item.detail}</Text>
                    {!!item.data && Object.keys(item.data).length > 0 ? (
                      <Text style={styles.evidenceData}>
                        {Object.entries(item.data).map(([key, value]) =>
                          `${key.replace(/_/g, ' ')}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
                        ).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </>
          )}
          <Text style={styles.reviewLabel}>WHAT CHANGES</Text>
          {(proposal.changes || []).map((change: any, index) => (
            <View key={`change-${index}`} style={styles.proposedChange}>
              <Ionicons name="arrow-forward-circle-outline" size={13} color={COLORS.recoveryHigh} />
              <Text style={styles.proposedChangeText}>
                {change.description || change.reason || change.label || change.type?.replace(/_/g, ' ') || 'Training adjustment'}
                {change.exercise ? ` · ${change.exercise}` : ''}
              </Text>
            </View>
          ))}
          {!!proposal.change_details?.length && (
            <>
              <Text style={styles.reviewLabel}>EXACT PRESCRIPTION CHANGES</Text>
              {proposal.change_details.map((detail, index) => (
                <View key={`delta-${index}`} style={styles.proposedExercise}>
                  <Text style={styles.currentPrescription}>
                    {detail.day.toUpperCase()} · {detail.exercise}
                    {detail.proposed_exercise && detail.proposed_exercise !== detail.exercise
                      ? ` → ${detail.proposed_exercise}`
                      : ''}
                  </Text>
                  {(detail.fields || []).map((field, fieldIndex) => (
                    <Text key={fieldIndex} style={styles.proposedExerciseMeta}>
                      {field.field.replace(/_/g, ' ')}: {field.before == null ? '—' : String(field.before)}
                      {' → '}
                      {field.after == null ? '—' : String(field.after)}
                      {field.field === 'load_kg' ? ' kg' : ''}
                    </Text>
                  ))}
                </View>
              ))}
            </>
          )}
          {!!proposal.unchanged_days?.length || !!proposal.unchanged_items?.length ? (
            <>
              <Text style={styles.reviewLabel}>WHAT REMAINS UNCHANGED</Text>
              {!!proposal.unchanged_days?.length ? (
                <Text style={styles.proposalFootnote}>
                  Unchanged scheduled days: {proposal.unchanged_days.map(day => day.toUpperCase()).join(', ')}
                </Text>
              ) : null}
              {(proposal.unchanged_items || []).slice(0, 5).map((item, index) => (
                <View key={`same-${index}`} style={styles.proposedChange}>
                  <Ionicons name="checkmark-circle-outline" size={13} color={COLORS.textMuted} />
                  <Text style={styles.proposedChangeText}>
                    {item.day.toUpperCase()} · {item.exercise}: {String(item.prescription?.sets ?? '—')} sets × {String(item.prescription?.reps ?? '—')}
                    {item.prescription?.load_kg != null ? ` · ${String(item.prescription.load_kg)}kg` : ''}
                  </Text>
                </View>
              ))}
              {(proposal.unchanged_items?.length || 0) > 5 ? (
                <Text style={styles.proposalFootnote}>
                  + {(proposal.unchanged_items?.length || 0) - 5} more unchanged exercise prescriptions
                </Text>
              ) : null}
            </>
          ) : null}

          {(proposal.snapshot.adaptive_guardrails || []).map((item, index) => (
            <View key={index} style={styles.guardrailRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={COLORS.recoveryMed} />
              <Text style={styles.guardrailText}>{item}</Text>
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
            {versions.some(v => v.status === 'approved') && (
              <View style={[styles.chip, styles.chipLatest]}>
                <Text style={[styles.chipText, { color: COLORS.strain }]}>
                  ACTIVE v{versions.find(v => v.status === 'approved')?.version_number}
                </Text>
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
              {active.status === 'superseded' && planId ? (
                <TouchableOpacity style={styles.restoreBtn} onPress={restoreVersion} disabled={proposalAction}>
                  {proposalAction
                    ? <ActivityIndicator color="#000" size="small" />
                    : <><Ionicons name="refresh-circle-outline" size={14} color="#000" /><Text style={styles.approveText}>Restore this version</Text></>}
                </TouchableOpacity>
              ) : null}

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
    backgroundColor: COLORS.card, borderRadius: 18,
    padding: 18, borderWidth: 1, borderColor: COLORS.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  label: { fontFamily: FONTS.bold, color: COLORS.strain, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  emptyText: { fontFamily: FONTS.regular, color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  chipRow: { flexDirection: 'row', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
  chip: {
    paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8,
    backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.strain + '20', borderColor: COLORS.strain + '80' },
  chipLatest: { borderColor: COLORS.strain + '40' },
  chipText: { fontFamily: FONTS.bold, color: COLORS.textMuted, fontSize: 10, fontWeight: '700' },
  chipTextActive: { color: COLORS.strain },
  triggerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  triggerText: { fontFamily: FONTS.bold, color: COLORS.recoveryMed, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  explanation: { fontFamily: FONTS.regular, color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  changesList: { gap: 10, marginBottom: 14 },
  changeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  changeDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  changeDesc: { fontFamily: FONTS.medium, color: COLORS.text, fontSize: 12, lineHeight: 17, marginBottom: 4 },
  adjustmentChip: {
    borderWidth: 1, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6, alignSelf: 'flex-start',
  },
  adjustmentText: { fontFamily: FONTS.bold, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  proposal: { backgroundColor: COLORS.cardElevated, borderRadius: 14, borderWidth: 1, borderColor: COLORS.recoveryHigh + '50', padding: 14, marginBottom: 14, gap: 9 },
  proposalTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proposalEyebrow: { fontFamily: FONTS.bold, color: COLORS.recoveryHigh, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  proposalTitle: { fontFamily: FONTS.bold, color: COLORS.text, fontSize: 14, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 },
  pendingChip: { borderWidth: 1, borderColor: COLORS.recoveryMed + '70', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7 },
  pendingText: { fontFamily: FONTS.bold, color: COLORS.recoveryMed, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  reviewLabel: { fontFamily: FONTS.bold, color: COLORS.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  proposalWorkout: { fontFamily: FONTS.semibold, color: COLORS.text, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  proposedExercise: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 7, gap: 5 },
  currentPrescription: { fontFamily: FONTS.regular, color: COLORS.textMuted, fontSize: 10, lineHeight: 13 },
  proposedExerciseRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  proposedChange: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  proposedChangeText: { fontFamily: FONTS.regular, color: COLORS.textSecondary, fontSize: 10, lineHeight: 14, flex: 1 },
  proposedExerciseName: { fontFamily: FONTS.semibold, color: COLORS.text, fontSize: 11, fontWeight: '700' },
  proposedExerciseMeta: { fontFamily: FONTS.regular, color: COLORS.textMuted, fontSize: 10, marginTop: 3 },
  guardrailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 4 },
  guardrailText: { fontFamily: FONTS.medium, color: COLORS.recoveryMed, fontSize: 10, lineHeight: 14, flex: 1 },
  restoreBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: COLORS.recoveryHigh, borderRadius: 9, padding: 10, marginBottom: 12 },
  evidenceDetail: { fontFamily: FONTS.regular, color: COLORS.textSecondary, fontSize: 10, lineHeight: 14, marginTop: 3 },
  evidenceData: { fontFamily: FONTS.regular, color: COLORS.textMuted, fontSize: 10, lineHeight: 13, marginTop: 2 },
  proposalFootnote: { fontFamily: FONTS.regular, color: COLORS.textMuted, fontSize: 10, lineHeight: 14 },
  proposalActions: { flexDirection: 'row', gap: 8, marginTop: 3 },
  rejectBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.borderLight, borderRadius: 9, padding: 10, alignItems: 'center' },
  rejectText: { fontFamily: FONTS.semibold, color: COLORS.textSecondary, fontSize: 10, fontWeight: '700' },
  approveBtn: { flex: 1.2, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: COLORS.recoveryHigh, borderRadius: 9, padding: 10 },
  approveText: { fontFamily: FONTS.bold, color: '#000', fontSize: 10, fontWeight: '800' },
  rewriteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.strain, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start',
  },
  rewriteBtnText: { fontFamily: FONTS.bold, color: '#000', fontSize: 12, fontWeight: '800' },
});

export default React.memo(ProgramEvolutionCard);
