// VYRN — Decision Center
// Priority 3: Every AI call logged with evidence trail, confidence, reasoning,
// and hindsight outcome tracking. Shows AI accuracy % as a killer credibility hook.

import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Animated,
} from 'react-native';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Decision {
  id: number;
  date: string;
  decision: string;
  confidence: number;
  evidence: string[];
  outcome: 'correct' | 'incorrect' | 'pending';
  outcomeNote: string | null;
  reasoning: string;
  type: 'workout' | 'recovery' | 'nutrition';
}

// ── Mock data — in production, fetched from GET /api/decisions ────────────────
const DECISIONS: Decision[] = [
  {
    id: 1,
    date: 'Today  7:43 AM',
    decision: 'Heavy Push Day',
    confidence: 87,
    evidence: [
      'Recovery: 8.2/10  (HIGH)',
      'CNS Load: 3.1/10  (FRESH)',
      'Chest last trained 72h ago',
      'Protein: 198g yesterday',
    ],
    outcome: 'pending',
    outcomeNote: null,
    reasoning:
      'All readiness markers are optimal. Volume tolerance high. Last push session was 4 days ago — sufficient supercompensation window.',
    type: 'workout',
  },
  {
    id: 2,
    date: 'Yesterday  8:01 AM',
    decision: 'Deload — Active Recovery Only',
    confidence: 91,
    evidence: [
      'Recovery: 4.1/10  (MED)',
      'CNS Load: 8.3/10  (HIGH)',
      'HRV -22% vs 7-day avg',
      '3 consecutive hard sessions',
    ],
    outcome: 'correct',
    outcomeNote: 'Next-day recovery jumped to 8.2. Good call.',
    reasoning:
      'CNS load critically elevated. Consecutive hard sessions without rest impairs neural drive. A forced deload preserves adaptation.',
    type: 'recovery',
  },
  {
    id: 3,
    date: 'Jun 26  9:15 AM',
    decision: '+200 kcal Calorie Surplus',
    confidence: 78,
    evidence: [
      'Weight stalled 12 days',
      'Training volume increased 15%',
      'Protein consistent at 200g+',
    ],
    outcome: 'incorrect',
    outcomeNote:
      'Weight moved, but body fat also increased. Should have been a smaller surplus.',
    reasoning:
      'Extended weight plateau with increased volume suggests hypocaloric state. Moderate surplus recommended to fuel adaptation.',
    type: 'nutrition',
  },
  {
    id: 4,
    date: 'Jun 24  7:58 AM',
    decision: 'Lower Body Focus Day',
    confidence: 82,
    evidence: [
      'Recovery: 7.8/10',
      'Upper push trained yesterday',
      'Leg volume deficit this week',
    ],
    outcome: 'correct',
    outcomeNote: 'Squat +5 kg. New rep PR.',
    reasoning:
      'Upper body trained yesterday — recovery incomplete. Leg volume lagging this week. Redirecting to lower body is optimal.',
    type: 'workout',
  },
  {
    id: 5,
    date: 'Jun 22  6:50 AM',
    decision: 'Increase Sleep Target to 8.5h',
    confidence: 94,
    evidence: [
      'Avg sleep 6.8h past 2 weeks',
      'HRV trend declining -18%',
      'Self-reported fatigue: HIGH',
    ],
    outcome: 'correct',
    outcomeNote: 'HRV recovered +14ms in 5 days after protocol change.',
    reasoning:
      'Sleep is the highest-ROI recovery lever. HRV data confirms chronic under-recovery. Simple duration increase should resolve most deficit.',
    type: 'recovery',
  },
];

// ── Stats derived from decisions ──────────────────────────────────────────────
const resolved = DECISIONS.filter((d) => d.outcome !== 'pending');
const correct = resolved.filter((d) => d.outcome === 'correct').length;
const accuracy = resolved.length ? Math.round((correct / resolved.length) * 100) : 0;
const avgConf = Math.round(
  DECISIONS.reduce((a, d) => a + d.confidence, 0) / DECISIONS.length,
);

// ── Helpers ───────────────────────────────────────────────────────────────────
function typeColor(type: Decision['type']): string {
  if (type === 'workout')  return COLORS.strain;
  if (type === 'recovery') return COLORS.strainGlow;
  return COLORS.recoveryMed;
}
function typeLabel(type: Decision['type']): string {
  if (type === 'workout')  return 'WORKOUT';
  if (type === 'recovery') return 'RECOVERY';
  return 'NUTRITION';
}

// ── Decision Card ─────────────────────────────────────────────────────────────
function DecisionCard({ decision, idx }: { decision: Decision; idx: number }) {
  const [expanded, setExpanded] = useState(false);

  const outcomeColor =
    decision.outcome === 'correct'
      ? COLORS.recoveryHigh
      : decision.outcome === 'incorrect'
      ? COLORS.recoveryLow
      : COLORS.textMuted;

  const tc = typeColor(decision.type);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.85}
    >
      {/* Row 1 — type chip + date */}
      <View style={styles.cardRow}>
        <View style={[styles.chip, { backgroundColor: `${tc}18`, borderColor: `${tc}30` }]}>
          <Text style={[styles.chipText, { color: tc }]}>{typeLabel(decision.type)}</Text>
        </View>
        <Text style={styles.dateText}>{decision.date}</Text>
        <View style={{ flex: 1 }} />
        {/* Outcome badge */}
        {decision.outcome !== 'pending' ? (
          <View
            style={[
              styles.chip,
              {
                backgroundColor:
                  decision.outcome === 'correct' ? '#16EC0618' : '#FF002618',
                borderColor:
                  decision.outcome === 'correct' ? '#16EC0630' : '#FF002630',
              },
            ]}
          >
            <Text
              style={[
                styles.chipText,
                { color: outcomeColor },
              ]}
            >
              {decision.outcome === 'correct' ? '✓  Correct' : '✗  Wrong'}
            </Text>
          </View>
        ) : (
          <View style={[styles.chip, { backgroundColor: '#1F1F1F', borderColor: '#2A2A2A' }]}>
            <Text style={[styles.chipText, { color: COLORS.textMuted }]}>⏳  Pending</Text>
          </View>
        )}
      </View>

      {/* Decision headline */}
      <Text style={styles.decisionTitle}>{decision.decision}</Text>

      {/* Confidence bar */}
      <View style={styles.confRow}>
        <View style={styles.confTrack}>
          <View style={[styles.confFill, { width: `${decision.confidence}%` }]} />
        </View>
        <Text style={styles.confLabel}>{decision.confidence}% confidence</Text>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </View>

      {/* Expanded detail */}
      {expanded && (
        <View style={styles.expandedContainer}>
          <View style={styles.separator} />

          {/* Evidence */}
          <Text style={[styles.sectionLabel, { color: COLORS.strain }]}>EVIDENCE</Text>
          {decision.evidence.map((e, i) => (
            <View key={i} style={styles.evidenceRow}>
              <View style={styles.evidenceDot} />
              <Text style={styles.evidenceText}>{e}</Text>
            </View>
          ))}

          {/* Reasoning */}
          <Text style={[styles.sectionLabel, { color: COLORS.strainGlow, marginTop: 12 }]}>
            AI REASONING
          </Text>
          <Text style={styles.reasoningText}>{decision.reasoning}</Text>

          {/* Outcome note */}
          {decision.outcomeNote && (
            <View
              style={[
                styles.outcomeBox,
                {
                  backgroundColor:
                    decision.outcome === 'correct' ? '#16EC0610' : '#FF002610',
                  borderColor:
                    decision.outcome === 'correct' ? '#16EC0630' : '#FF002630',
                },
              ]}
            >
              <Text style={[styles.sectionLabel, { color: outcomeColor }]}>OUTCOME</Text>
              <Text style={styles.outcomeText}>{decision.outcomeNote}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function DecisionScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Header */}
      <Text style={styles.title}>Decision Center</Text>
      <Text style={styles.subtitle}>Every AI call — transparent & trackable</Text>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: COLORS.recoveryHigh }]}>{accuracy}%</Text>
          <Text style={styles.statLabel}>ACCURACY</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{DECISIONS.length}</Text>
          <Text style={styles.statLabel}>DECISIONS</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: COLORS.strain }]}>{avgConf}%</Text>
          <Text style={styles.statLabel}>AVG CONF.</Text>
        </View>
      </View>

      {/* Cards */}
      {DECISIONS.map((d, i) => (
        <DecisionCard key={d.id} decision={d} idx={i} />
      ))}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  title: {
    fontFamily: FONTS.bold,
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.cardElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 12,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: FONTS.numericBold,
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
  },
  statLabel: {
    fontFamily: FONTS.bold,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: COLORS.textMuted,
    marginTop: 4,
    textTransform: 'uppercase',
  },

  // Card
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  chip: {
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  chipText: {
    fontFamily: FONTS.bold,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dateText: {
    fontFamily: FONTS.regular,
    fontSize: 10,
    color: COLORS.textMuted,
  },
  decisionTitle: {
    fontFamily: FONTS.semibold,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 10,
  },
  confRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  confTrack: {
    flex: 1,
    height: 3,
    backgroundColor: '#1F1F1F',
    borderRadius: 2,
    overflow: 'hidden',
  },
  confFill: {
    height: '100%',
    backgroundColor: COLORS.strainGlow,
    borderRadius: 2,
  },
  confLabel: {
    fontFamily: FONTS.numericMedium,
    fontSize: 11,
    color: COLORS.strainGlow,
  },
  chevron: {
    fontSize: 12,
    color: COLORS.textMuted,
  },

  // Expanded
  expandedContainer: {
    marginTop: 14,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: FONTS.bold,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5,
  },
  evidenceDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.strain,
  },
  evidenceText: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    flex: 1,
  },
  reasoningText: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
  outcomeBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginTop: 10,
  },
  outcomeText: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});
