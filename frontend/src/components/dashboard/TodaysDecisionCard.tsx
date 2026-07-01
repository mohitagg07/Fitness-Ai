// VYRN — Today's Decision (AI Decision Center hero card)
//
// This is the README's signature feature — "the AI thinks before you ask,
// explains every recommendation with evidence" — surfaced as a proper
// screen element for the first time. The backend has had a fully real,
// deterministic decision engine (decision_engine.py's build_decision_center)
// and a persistence layer (/api/decisions) since earlier work: every
// signal (recovery, sleep, protein, strength trend, injury status) is read
// from real logged data, `favorable` is a plain threshold check, and
// confidence_pct is a weighted average of those signals — never asked of
// an LLM. None of that was reachable from the Dashboard itself before;
// it only lived on a hidden `/decisions` history tab nobody would find.
//
// This card calls POST /decisions/save (idempotent — safe every app open)
// then reads the freshest entry back, and renders it as the first thing
// under the greeting header: decision, confidence, evidence signals,
// expected outcome, and the "if things go wrong" alternative — with a
// link into the full Decision History for past accuracy tracking.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, LayoutAnimation, Platform, UIManager } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { decisionsApi } from '../../utils/api';
import { COLORS } from '../../theme/colors';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Signal { label: string; value: string; favorable: boolean; }
interface WhyNotItem { option: string; reason: string; }
interface TodayDecision {
  id: string;
  decision: string;
  confidence_pct: number;
  reasoning: string;
  expected_outcome?: string | null;
  alternative?: string | null;
  signals: Signal[];
  why_not?: WhyNotItem[];
}

function confidenceColor(pct: number) {
  if (pct >= 80) return COLORS.recoveryHigh;
  if (pct >= 60) return COLORS.recoveryMed;
  return COLORS.recoveryLow;
}

export default function TodaysDecisionCard() {
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<TodayDecision | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await decisionsApi.saveToday(); // idempotent — no-ops if already saved today
        const res = await decisionsApi.list(1);
        const latest = res.data?.decisions?.[0] || null;
        if (!cancelled) setDecision(latest);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={COLORS.recoveryHigh} />
      </View>
    );
  }

  if (failed || !decision) {
    return null; // Fail quiet — the rest of the dashboard still works.
  }

  const cc = confidenceColor(decision.confidence_pct);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Ionicons name="analytics" size={13} color={cc} />
          <Text style={styles.headerLabel}>Today's Decision</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/(tabs)/decisions')} style={styles.historyLink}>
          <Text style={styles.historyLinkText}>History</Text>
          <Ionicons name="chevron-forward" size={12} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.mainRow}>
        <Text style={styles.decisionText}>{decision.decision}</Text>
        <View style={styles.confidenceBadge}>
          <Text style={[styles.confidencePct, { color: cc }]}>{decision.confidence_pct}%</Text>
          <Text style={styles.confidenceLabel}>CONFIDENCE</Text>
        </View>
      </View>

      {/* Evidence signal pills */}
      {decision.signals?.length > 0 && (
        <View style={styles.signalsRow}>
          {decision.signals.map((s, i) => (
            <View
              key={i}
              style={[
                styles.signalPill,
                { borderColor: (s.favorable ? COLORS.recoveryHigh : COLORS.recoveryLow) + '55' },
              ]}
            >
              <Ionicons
                name={s.favorable ? 'checkmark-circle' : 'close-circle'}
                size={10}
                color={s.favorable ? COLORS.recoveryHigh : COLORS.recoveryLow}
              />
              <Text style={styles.signalLabel}>{s.label}</Text>
              <Text style={[styles.signalValue, { color: s.favorable ? COLORS.recoveryHigh : COLORS.textSecondary }]}>
                {s.value}
              </Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={styles.whyBtn}
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setExpanded((v) => !v);
        }}
      >
        <Ionicons name="help-circle-outline" size={14} color={COLORS.strainGlow} />
        <Text style={styles.whyBtnText}>Why?</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={COLORS.strainGlow} />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.whyPanel}>
          {!!decision.reasoning && <Text style={styles.whyReasoning}>{decision.reasoning}</Text>}
          {!!decision.expected_outcome && (
            <View style={styles.whyRow}>
              <Text style={styles.whyRowLabel}>EXPECTED OUTCOME</Text>
              <Text style={styles.whyRowText}>{decision.expected_outcome}</Text>
            </View>
          )}
          {!!decision.why_not?.length && (
            <View style={styles.whyRow}>
              <Text style={styles.whyRowLabel}>WHY NOT</Text>
              {decision.why_not.map((w, i) => (
                <Text key={i} style={styles.whyRowText}>
                  <Text style={styles.whyNotOption}>{w.option}: </Text>
                  {w.reason}
                </Text>
              ))}
            </View>
          )}
          {!!decision.alternative && (
            <View style={styles.whyRow}>
              <Text style={styles.whyRowLabel}>IF THINGS GO WRONG</Text>
              <Text style={styles.whyRowText}>{decision.alternative}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.cardElevated,
    borderRadius: 18,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.3 },
  historyLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  historyLinkText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },

  mainRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  decisionText: { color: COLORS.text, fontSize: 24, fontWeight: '800', flex: 1, marginRight: 12 },
  confidenceBadge: { alignItems: 'center' },
  confidencePct: { fontSize: 24, fontWeight: '800' },
  confidenceLabel: { color: COLORS.textMuted, fontSize: 8, fontWeight: '700', letterSpacing: 0.5, marginTop: 1 },

  signalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  signalPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 8,
    backgroundColor: COLORS.card,
  },
  signalLabel: { color: COLORS.textSecondary, fontSize: 10, fontWeight: '600' },
  signalValue: { fontSize: 10, fontWeight: '700' },

  whyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 6 },
  whyBtnText: { color: COLORS.strainGlow, fontSize: 12, fontWeight: '700' },
  whyPanel: {
    marginTop: 6, backgroundColor: COLORS.card, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 10,
  },
  whyReasoning: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20 },
  whyRow: { gap: 3 },
  whyRowLabel: { color: COLORS.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  whyRowText: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  whyNotOption: { color: COLORS.text, fontWeight: '700' },
});