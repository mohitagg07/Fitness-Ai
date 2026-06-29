// ProactiveBriefCard — VYRN
//
// Renders the AI's proactive decision on the dashboard.
// The coach thought about this before the user typed anything.
// Includes:
//   - Coach's opening message
//   - Today's focus
//   - Suggested top set (if applicable)
//   - Transparent reasoning (expandable "Why?" section)
//   - Proactive notices

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';

interface ReasoningStep {
  label: string;
  finding: string;
  implication: string;
}

interface ProactiveBrief {
  coach_message: string;
  todays_focus: string;
  recommendation: string;
  suggested_top_set: string | null;
  confidence_pct: number;
  confidence: string;
  why_summary: string;
  proactive_notices: string[];
  reasoning_steps?: ReasoningStep[];
}

interface Props {
  brief: ProactiveBrief;
  firstName?: string;
}

export default function ProactiveBriefCard({ brief, firstName }: Props) {
  const [showReasoning, setShowReasoning] = useState(false);

  const confidenceColor =
    brief.confidence === 'High' ? COLORS.recoveryHigh :
    brief.confidence === 'Medium' ? COLORS.recoveryMed : COLORS.recoveryLow;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="sparkles" size={13} color={COLORS.recoveryHigh} />
          <Text style={styles.headerLabel}>COACH INSIGHT</Text>
        </View>
        <View style={[styles.confidenceBadge, { borderColor: confidenceColor + '50' }]}>
          <View style={[styles.confidenceDot, { backgroundColor: confidenceColor }]} />
          <Text style={[styles.confidenceText, { color: confidenceColor }]}>
            {brief.confidence} confidence
          </Text>
        </View>
      </View>

      {/* Coach message */}
      <Text style={styles.coachMessage}>{brief.coach_message}</Text>

      {/* Today's focus */}
      <View style={styles.focusRow}>
        <View style={styles.focusIcon}>
          <Ionicons name="flag-outline" size={13} color="#000" />
        </View>
        <Text style={styles.focusText}>{brief.todays_focus}</Text>
      </View>

      {/* Suggested top set */}
      {brief.suggested_top_set && (
        <View style={styles.topSetRow}>
          <Ionicons name="barbell-outline" size={14} color={COLORS.recoveryMed} />
          <View>
            <Text style={styles.topSetLabel}>Today's Target Set</Text>
            <Text style={styles.topSetValue}>{brief.suggested_top_set}</Text>
          </View>
        </View>
      )}

      {/* Proactive notices */}
      {brief.proactive_notices && brief.proactive_notices.length > 0 && (
        <View style={styles.noticesBlock}>
          {brief.proactive_notices.map((notice, i) => (
            <View key={i} style={styles.noticeRow}>
              <View style={styles.noticeDot} />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Why button */}
      <TouchableOpacity
        style={styles.whyBtn}
        onPress={() => setShowReasoning(v => !v)}
        activeOpacity={0.7}
      >
        <Ionicons
          name={showReasoning ? 'chevron-up' : 'help-circle-outline'}
          size={14}
          color={COLORS.textDim}
        />
        <Text style={styles.whyBtnText}>
          {showReasoning ? 'Hide reasoning' : 'Why did the coach decide this?'}
        </Text>
      </TouchableOpacity>

      {/* Reasoning steps */}
      {showReasoning && (
        <View style={styles.reasoningBlock}>
          <Text style={styles.reasoningHeader}>Coach's Reasoning Chain</Text>

          {brief.reasoning_steps && brief.reasoning_steps.length > 0 ? (
            brief.reasoning_steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepLabel}>{step.label}</Text>
                  <Text style={styles.stepFinding}>{step.finding}</Text>
                  <Text style={styles.stepImpl}>→ {step.implication}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.whySummary}>{brief.why_summary}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0a120a',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.recoveryHigh + '25',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerLabel: {
    color: COLORS.recoveryHigh,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  confidenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  confidenceDot: { width: 5, height: 5, borderRadius: 3 },
  confidenceText: { fontSize: 10, fontWeight: '600' },

  coachMessage: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },

  focusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  focusIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.recoveryHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusText: {
    color: COLORS.textMuted,
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },

  topSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  topSetLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  topSetValue: { color: COLORS.recoveryMed, fontSize: 16, fontWeight: '700', marginTop: 1 },

  noticesBlock: { marginBottom: 10 },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 5 },
  noticeDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: COLORS.textDim,
    marginTop: 5,
  },
  noticeText: { color: COLORS.textDim, fontSize: 12, flex: 1, lineHeight: 17 },

  whyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#161616',
    marginTop: 4,
  },
  whyBtnText: { color: COLORS.textDim, fontSize: 12 },

  reasoningBlock: {
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  reasoningHeader: {
    color: COLORS.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: COLORS.textDim, fontSize: 10, fontWeight: '700' },
  stepContent: { flex: 1 },
  stepLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  stepFinding: { color: '#fff', fontSize: 13 },
  stepImpl: { color: COLORS.recoveryHigh + 'CC', fontSize: 12, marginTop: 2 },
  whySummary: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19 },
});
