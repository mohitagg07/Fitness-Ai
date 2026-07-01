// VYRN — Decision History (real data, not mock)
//
// Previously this screen showed hardcoded mock data while decision_engine.py
// ran on every dashboard load but never persisted. Now:
//   - GET /api/decisions/  feeds this screen with real historical decisions
//   - GET /api/decisions/accuracy  drives the AI Accuracy % badge
//   - POST /api/decisions/{id}/outcome  lets user mark outcomes
//   - Each card has an expandable "Why?" panel surfacing reasoning_steps

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, LayoutAnimation,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS } from '../../theme/colors';
import api, { describeApiError } from '../../utils/api';
import EmptyState from '../shared/EmptyState';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Signal {
  label: string;
  value: string;
  favorable: boolean;
}

interface Decision {
  id: string;
  decision_date: string;
  decision: string;
  confidence_pct: number;
  reasoning: string;
  expected_outcome?: string | null;
  alternative?: string | null;
  signals: Signal[];
  outcome: 'correct' | 'incorrect' | 'partial' | 'pending';
  outcome_note?: string | null;
}

interface Accuracy {
  accuracy_pct: number | null;
  total_resolved: number;
  correct: number;
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function outcomeColor(outcome: Decision['outcome']) {
  if (outcome === 'correct') return COLORS.recoveryHigh;
  if (outcome === 'incorrect') return COLORS.recoveryLow;
  if (outcome === 'partial') return COLORS.recoveryMed;
  return '#5C6B6E';
}

function outcomeLabel(outcome: Decision['outcome']) {
  if (outcome === 'correct') return 'CORRECT';
  if (outcome === 'incorrect') return 'INCORRECT';
  if (outcome === 'partial') return 'PARTIAL';
  return 'PENDING';
}

function confidenceColor(pct: number) {
  if (pct >= 80) return COLORS.recoveryHigh;
  if (pct >= 60) return COLORS.recoveryMed;
  return COLORS.recoveryLow;
}

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function DecisionScreen() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [accuracy, setAccuracy] = useState<Accuracy | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setErrorMsg(null);
    try {
      const [decRes, accRes] = await Promise.all([
        api.get('/decisions/'),
        api.get('/decisions/accuracy'),
      ]);
      setDecisions(decRes.data.decisions || []);
      setAccuracy(accRes.data);
    } catch (err: any) {
      const { message } = describeApiError(err);
      setErrorMsg(message);
    }
  }, []);

  // Save today's decision (idempotent — safe to call on every visit) then
  // reload the list. Shared by the initial mount load and the silent
  // focus refetch below so both stay in sync with the same behavior.
  const saveAndLoad = useCallback(async () => {
    try { await api.post('/decisions/save'); } catch {}
    await loadData();
  }, [loadData]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await saveAndLoad();
      setLoading(false);
    })();
  }, [saveAndLoad]);

  // Silent refetch on tab focus (e.g. after a new decision was generated
  // from the Dashboard) — skips the first focus since the mount effect
  // above already covers it, and doesn't toggle `loading` so switching
  // tabs never flashes the loading state.
  const hasFocusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return;
      }
      saveAndLoad();
    }, [saveAndLoad])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId(prev => prev === id ? null : id);
  };

  const markOutcome = async (id: string, outcome: string) => {
    try {
      await api.post(`/decisions/${id}/outcome`, { outcome });
      setDecisions(prev =>
        prev.map(d => d.id === id ? { ...d, outcome: outcome as Decision['outcome'] } : d)
      );
      // Refresh accuracy badge
      const accRes = await api.get('/decisions/accuracy');
      setAccuracy(accRes.data);
    } catch {}
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.recoveryHigh} size="large" />
        <Text style={styles.loadingLabel}>Loading decision history…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.recoveryHigh} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>DECISION HISTORY</Text>
        <Text style={styles.headerSub}>Every AI recommendation, tracked with evidence</Text>
      </View>

      {/* AI Accuracy Badge */}
      {accuracy && accuracy.accuracy_pct !== null && (
        <View style={styles.accuracyCard}>
          <View style={styles.accuracyLeft}>
            <Ionicons name="shield-checkmark" size={28} color={COLORS.recoveryHigh} />
            <View style={{ marginLeft: 12 }}>
              <Text style={styles.accuracyPct}>{accuracy.accuracy_pct}%</Text>
              <Text style={styles.accuracyLabel}>AI ACCURACY</Text>
            </View>
          </View>
          <Text style={styles.accuracySub}>{accuracy.correct} of {accuracy.total_resolved} resolved</Text>
        </View>
      )}

      {errorMsg && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={14} color={COLORS.recoveryMed} />
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      {decisions.length === 0 && !loading && (
        <EmptyState
          icon="analytics-outline"
          title="No decisions yet"
          body="Open the Dashboard to generate your first AI decision. It'll appear here with full reasoning."
          actionLabel="Open Dashboard"
          onAction={() => router.push('/(tabs)')}
        />
      )}

      {/* Decision cards */}
      {decisions.map((d) => (
        <DecisionCard
          key={d.id}
          decision={d}
          expanded={expandedId === d.id}
          onToggle={() => toggleExpand(d.id)}
          onMarkOutcome={(outcome) => markOutcome(d.id, outcome)}
        />
      ))}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ── Decision card ─────────────────────────────────────────────────────────────
function DecisionCard({
  decision, expanded, onToggle, onMarkOutcome,
}: {
  decision: Decision;
  expanded: boolean;
  onToggle: () => void;
  onMarkOutcome: (o: string) => void;
}) {
  const cc = confidenceColor(decision.confidence_pct);
  const oc = outcomeColor(decision.outcome);

  return (
    <View style={styles.card}>
      {/* Top row */}
      <View style={styles.cardTop}>
        <View style={styles.cardTopLeft}>
          <Text style={styles.cardDate}>{formatDate(decision.decision_date)}</Text>
          <Text style={styles.cardDecision}>{decision.decision}</Text>
        </View>
        <View style={styles.confidenceBadge}>
          <Text style={[styles.confidencePct, { color: cc }]}>{decision.confidence_pct}%</Text>
          <Text style={styles.confidenceLabel}>CONF.</Text>
        </View>
      </View>

      {/* Outcome badge */}
      <View style={[styles.outcomeBadge, { borderColor: oc + '60' }]}>
        <View style={[styles.outcomeDot, { backgroundColor: oc }]} />
        <Text style={[styles.outcomeText, { color: oc }]}>{outcomeLabel(decision.outcome)}</Text>
      </View>

      {/* Signal pills */}
      {decision.signals && decision.signals.length > 0 && (
        <View style={styles.signalsRow}>
          {decision.signals.map((s, i) => (
            <View key={i} style={[styles.signalPill, { borderColor: s.favorable ? COLORS.recoveryHigh + '60' : COLORS.recoveryLow + '60' }]}>
              <Ionicons
                name={s.favorable ? 'checkmark-circle' : 'close-circle'}
                size={10}
                color={s.favorable ? COLORS.recoveryHigh : COLORS.recoveryLow}
              />
              <Text style={styles.signalLabel}>{s.label}</Text>
              <Text style={[styles.signalValue, { color: s.favorable ? COLORS.recoveryHigh : '#C8D2D4' }]}>{s.value}</Text>
            </View>
          ))}
        </View>
      )}

      {/* "Why?" expandable panel */}
      <TouchableOpacity style={styles.whyBtn} onPress={onToggle} activeOpacity={0.7}>
        <Ionicons name="help-circle-outline" size={14} color={COLORS.strainGlow} />
        <Text style={styles.whyBtnText}>Why?</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={COLORS.strainGlow} />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.whyPanel}>
          {decision.reasoning ? (
            <Text style={styles.whyReasoning}>{decision.reasoning}</Text>
          ) : null}
          {decision.expected_outcome ? (
            <View style={styles.whyRow}>
              <Text style={styles.whyRowLabel}>EXPECTED OUTCOME</Text>
              <Text style={styles.whyRowText}>{decision.expected_outcome}</Text>
            </View>
          ) : null}
          {decision.alternative ? (
            <View style={styles.whyRow}>
              <Text style={styles.whyRowLabel}>IF THINGS GO WRONG</Text>
              <Text style={styles.whyRowText}>{decision.alternative}</Text>
            </View>
          ) : null}

          {/* Outcome marking — only show if pending */}
          {decision.outcome === 'pending' && (
            <View style={styles.markOutcomeRow}>
              <Text style={styles.markOutcomeLabel}>Was this right?</Text>
              <TouchableOpacity
                style={[styles.markBtn, { borderColor: COLORS.recoveryHigh }]}
                onPress={() => onMarkOutcome('correct')}
              >
                <Text style={[styles.markBtnText, { color: COLORS.recoveryHigh }]}>✓ Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.markBtn, { borderColor: COLORS.recoveryLow }]}
                onPress={() => onMarkOutcome('incorrect')}
              >
                <Text style={[styles.markBtnText, { color: COLORS.recoveryLow }]}>✗ No</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.markBtn, { borderColor: COLORS.recoveryMed }]}
                onPress={() => onMarkOutcome('partial')}
              >
                <Text style={[styles.markBtnText, { color: COLORS.recoveryMed }]}>~ Partial</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  loadingLabel: { color: '#5C6B6E', fontSize: 13, marginTop: 14 },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { color: '#FFF', fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  headerSub: { color: '#5C6B6E', fontSize: 13, marginTop: 4 },
  accuracyCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#0C1714', borderRadius: 16, marginHorizontal: 16,
    marginBottom: 12, padding: 16, borderWidth: 1, borderColor: COLORS.recoveryHigh + '30',
  },
  accuracyLeft: { flexDirection: 'row', alignItems: 'center' },
  accuracyPct: { color: COLORS.recoveryHigh, fontSize: 28, fontWeight: '800' },
  accuracyLabel: { color: '#5C6B6E', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  accuracySub: { color: '#5C6B6E', fontSize: 12 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1A1606', paddingVertical: 8, paddingHorizontal: 16, marginBottom: 8,
  },
  errorText: { color: COLORS.recoveryMed, fontSize: 11, flex: 1 },
  emptyState: { alignItems: 'center', padding: 40, gap: 12 },
  emptyTitle: { color: '#5C6B6E', fontSize: 16, fontWeight: '700' },
  emptyBody: { color: '#3F4A4C', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  card: {
    backgroundColor: '#0E0E0E', borderRadius: 18, marginHorizontal: 16, marginBottom: 12,
    padding: 18, borderWidth: 1, borderColor: '#1C1C1C',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  cardTopLeft: { flex: 1 },
  cardDate: { color: '#5C6B6E', fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 },
  cardDecision: { color: '#FFF', fontSize: 20, fontWeight: '800' },
  confidenceBadge: { alignItems: 'center', justifyContent: 'center' },
  confidencePct: { fontSize: 22, fontWeight: '800' },
  confidenceLabel: { color: '#5C6B6E', fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  outcomeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10,
    alignSelf: 'flex-start', marginBottom: 12,
  },
  outcomeDot: { width: 6, height: 6, borderRadius: 3 },
  outcomeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  signalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  signalPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 8,
    backgroundColor: '#121212',
  },
  signalLabel: { color: '#7A8A8E', fontSize: 10, fontWeight: '600' },
  signalValue: { fontSize: 10, fontWeight: '700' },
  whyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  whyBtnText: { color: COLORS.strainGlow, fontSize: 12, fontWeight: '700' },
  whyPanel: {
    marginTop: 12, backgroundColor: '#0A0A0A', borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: '#1C1C1C',
    gap: 10,
  },
  whyReasoning: { color: '#C8D2D4', fontSize: 13, lineHeight: 20 },
  whyRow: { gap: 3 },
  whyRowLabel: { color: '#5C6B6E', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  whyRowText: { color: '#C8D2D4', fontSize: 12, lineHeight: 18 },
  markOutcomeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4,
  },
  markOutcomeLabel: { color: '#5C6B6E', fontSize: 11, flex: 1 },
  markBtn: {
    borderWidth: 1, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12,
  },
  markBtnText: { fontSize: 11, fontWeight: '700' },
});