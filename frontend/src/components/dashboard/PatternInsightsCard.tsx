// PatternInsightsCard — VYRN
//
// Displays proactive pattern detection alerts on the dashboard.
// Each insight has a severity (critical/warning/info) and a recommendation.
// Users can expand each one to see the full detail and recommendation.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';

interface PatternInsight {
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  recommendation: string;
  confidence: string;
}

interface Props {
  insights: PatternInsight[];
}

const CATEGORY_ICONS: Record<string, string> = {
  plateau: 'trending-up-outline',
  missed_workout: 'calendar-outline',
  recovery_decline: 'battery-dead-outline',
  under_eating: 'nutrition-outline',
  protein_deficit: 'nutrition-outline',
  pr_opportunity: 'star-outline',
  great_streak: 'flame-outline',
  volume_increase: 'barbell-outline',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: COLORS.recoveryLow,
  warning: COLORS.recoveryMed,
  info: COLORS.recoveryHigh,
};

function InsightRow({ insight }: { insight: PatternInsight }) {
  const [expanded, setExpanded] = useState(false);
  const color = SEVERITY_COLORS[insight.severity] || COLORS.textDim;
  const icon = CATEGORY_ICONS[insight.category] || 'information-circle-outline';

  return (
    <TouchableOpacity
      style={[styles.insightRow, { borderLeftColor: color }]}
      onPress={() => setExpanded(v => !v)}
      activeOpacity={0.8}
    >
      <View style={styles.insightTop}>
        <Ionicons name={icon as any} size={14} color={color} />
        <Text style={styles.insightTitle} numberOfLines={expanded ? undefined : 1}>
          {insight.title}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={12}
          color={COLORS.textDim}
        />
      </View>

      {expanded && (
        <View style={styles.insightExpanded}>
          <Text style={styles.insightDetail}>{insight.detail}</Text>
          <View style={styles.recommendationBlock}>
            <Ionicons name="bulb-outline" size={12} color={color} />
            <Text style={[styles.recommendationText, { color }]}>
              {insight.recommendation}
            </Text>
          </View>
          <Text style={styles.confidenceTag}>
            Confidence: {insight.confidence}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function PatternInsightsCard({ insights }: Props) {
  if (!insights || insights.length === 0) return null;

  const criticalCount = insights.filter(i => i.severity === 'critical').length;
  const warningCount = insights.filter(i => i.severity === 'warning').length;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerLeft}>
          <Ionicons name="pulse-outline" size={13} color={COLORS.recoveryMed} />
          <Text style={styles.cardTitle}>PATTERN ANALYSIS</Text>
        </View>
        <View style={styles.badgeRow}>
          {criticalCount > 0 && (
            <View style={[styles.badge, { backgroundColor: COLORS.recoveryLow + '30', borderColor: COLORS.recoveryLow + '60' }]}>
              <Text style={[styles.badgeText, { color: COLORS.recoveryLow }]}>
                {criticalCount} critical
              </Text>
            </View>
          )}
          {warningCount > 0 && (
            <View style={[styles.badge, { backgroundColor: COLORS.recoveryMed + '20', borderColor: COLORS.recoveryMed + '50' }]}>
              <Text style={[styles.badgeText, { color: COLORS.recoveryMed }]}>
                {warningCount} warning
              </Text>
            </View>
          )}
        </View>
      </View>

      {insights.map((insight, i) => (
        <InsightRow key={i} insight={insight} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0d0d0d',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardTitle: {
    color: COLORS.recoveryMed,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  badgeRow: { flexDirection: 'row', gap: 6 },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontWeight: '600' },

  insightRow: {
    paddingVertical: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    marginBottom: 6,
    borderRadius: 2,
  },
  insightTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  insightTitle: {
    color: '#fff',
    fontSize: 13,
    flex: 1,
    fontWeight: '500',
  },
  insightExpanded: { marginTop: 8 },
  insightDetail: {
    color: COLORS.textDim,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  recommendationBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#111',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  recommendationText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
    fontWeight: '500',
  },
  confidenceTag: {
    color: COLORS.textDim,
    fontSize: 10,
    fontStyle: 'italic',
  },
});
