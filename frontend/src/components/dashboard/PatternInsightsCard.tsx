// VYRN — Pattern Analysis
//
// Proactive pattern detection (plateau, missed workouts, recovery
// decline, under-eating, PR opportunities...) from pattern_insights on
// the mission/today payload — real detections, not decoration.
//
// Text-density pass: shows only the top 3 insights by severity as
// single-line rows (icon + title + severity dot); tapping a row expands
// it in place for the detail + recommendation. Anything beyond 3 is
// summarized as "+N more" rather than stacking more rows — the point is
// to flag that something needs attention, not to read the full report
// on the dashboard.

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import { ELEVATION, ICON_SIZE } from '../../theme/layout';
import Text from '../ui/Text';
import SectionLabel from '../ui/SectionLabel';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function InsightRow({ insight }: { insight: PatternInsight }) {
  const [expanded, setExpanded] = useState(false);
  const color = SEVERITY_COLORS[insight.severity] || COLORS.textDim;
  const icon = CATEGORY_ICONS[insight.category] || 'information-circle-outline';

  return (
    <TouchableOpacity
      style={[styles.insightRow, { borderLeftColor: color }]}
      onPress={() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((v) => !v);
      }}
      activeOpacity={0.8}
    >
      <View style={styles.insightTop}>
        <Ionicons name={icon as any} size={14} color={color} />
        <Text variant="body" weight="semibold" color={COLORS.text} numberOfLines={1} style={{ flex: 1 }}>
          {insight.title}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={ICON_SIZE.xs} color={COLORS.textDim} />
      </View>

      {expanded && (
        <View style={styles.insightExpanded}>
          <Text variant="caption" color={COLORS.textSecondary} numberOfLines={2} style={{ lineHeight: 17, marginBottom: SPACING.sm }}>
            {insight.detail}
          </Text>
          <View style={styles.recommendationBlock}>
            <Ionicons name="bulb-outline" size={13} color={color} />
            <Text variant="caption" weight="semibold" color={color} numberOfLines={2} style={{ flex: 1, lineHeight: 17 }}>
              {insight.recommendation}
            </Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function PatternInsightsCard({ insights }: Props) {
  if (!insights || insights.length === 0) return null;

  const sorted = [...insights].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
  );
  const shown = sorted.slice(0, 3);
  const hiddenCount = sorted.length - shown.length;
  const criticalCount = insights.filter((i) => i.severity === 'critical').length;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <SectionLabel label="PATTERN ANALYSIS" icon="pulse-outline" color={COLORS.recoveryMed} />
        {criticalCount > 0 && (
          <View style={[styles.badge, { backgroundColor: alpha(COLORS.recoveryLow, 0.16), borderColor: alpha(COLORS.recoveryLow, 0.4) }]}>
            <Text variant="caption" weight="bold" color={COLORS.recoveryLow}>{criticalCount} critical</Text>
          </View>
        )}
      </View>

      {shown.map((insight, i) => (
        <InsightRow key={i} insight={insight} />
      ))}

      {hiddenCount > 0 && (
        <Text variant="caption" color={COLORS.textMuted} style={{ marginTop: 2 }}>
          +{hiddenCount} more insight{hiddenCount === 1 ? '' : 's'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.card,
    padding: SPACING.xl,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    ...ELEVATION.low,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.badge,
    borderWidth: 1,
  },
  insightRow: {
    paddingVertical: SPACING.sm,
    paddingLeft: SPACING.sm + 2,
    borderLeftWidth: 2,
    marginBottom: 4,
    borderRadius: 2,
  },
  insightTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm - 1,
  },
  insightExpanded: { marginTop: SPACING.sm },
  recommendationBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm - 1,
    backgroundColor: COLORS.cardElevated,
    borderRadius: RADIUS.badge - 2,
    padding: SPACING.sm,
  },
});
