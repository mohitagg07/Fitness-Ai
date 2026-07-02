// VYRN — HeroDecisionCard ("Today's Mission")
//
// The primary "what should I do today" card — mission title, AI
// confidence, a short rationale, a glowing anatomical figure highlighting
// the muscle group in focus, and the 5-column readiness stat row
// (Recovery / Sleep / Protein / Fatigue / Injury) beneath it. This is
// the card an athlete reads first every session.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Defs, RadialGradient, Stop } from 'react-native-svg';
import { COLORS, alpha } from '../../theme/colors';
import { Text, Card, Badge, Button, SectionLabel } from '../ui';
import { SPACING, RADIUS } from '../../theme/spacing';

// Simple glowing chest/shoulders silhouette — original vector art, sized
// to sit inside the card's right side without a licensed stock photo.
function MissionFigure({ color, size = 140 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size * 1.15} viewBox="0 0 140 160">
      <Defs>
        <RadialGradient id="missionGlow" cx="0.55" cy="0.35" r="0.7">
          <Stop offset="0" stopColor={color} stopOpacity="0.45" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Path d="M0,0 L140,0 L140,160 L0,160 Z" fill="url(#missionGlow)" />
      {/* head */}
      <Path d="M70,8 a18,18 0 1,0 0.1,0 Z" fill={alpha(color, 0.22)} stroke={color} strokeWidth={1.5} />
      {/* shoulders / chest / traps */}
      <Path
        d="M40,52 C48,40 60,34 70,34 C80,34 92,40 100,52
           C112,58 122,70 124,86 C126,104 120,120 108,130
           L104,120 C110,112 112,100 108,88
           C104,76 92,68 78,66 L78,110 L62,110 L62,66
           C48,68 36,76 32,88 C28,100 30,112 36,120
           L32,130 C20,120 14,104 16,86 C18,70 28,58 40,52 Z"
        fill={alpha(color, 0.16)}
        stroke={color}
        strokeWidth={1.5}
      />
    </Svg>
  );
}

interface StatItem {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  caption: string;
  color: string;
}

interface HeroDecisionCardProps {
  missionTitle: string;
  confidenceLabel: string;
  confidencePct: number;
  description: string;
  stats: StatItem[];
  onViewPlan?: () => void;
  onWhyThisPlan?: () => void;
}

export default function HeroDecisionCard({
  missionTitle,
  confidenceLabel,
  confidencePct,
  description,
  stats,
  onViewPlan,
  onWhyThisPlan,
}: HeroDecisionCardProps) {
  return (
    <Card variant="accent" accentColor={COLORS.primaryGreen} style={styles.card}>
      <SectionLabel
        label="TODAY'S MISSION"
        icon="locate"
        color={COLORS.primaryGreen}
        actionLabel={onViewPlan ? 'View Plan' : undefined}
        onAction={onViewPlan}
      />

      <View style={styles.topRow}>
        <View style={styles.textCol}>
          <Text variant="h1" style={{ marginBottom: SPACING.sm }}>{missionTitle}</Text>
          <View style={styles.confidenceRow}>
            <Badge label={confidenceLabel} color={COLORS.primaryGreen} variant="subtle" dot={false}
              style={{ paddingVertical: 4 }}
            />
            <Text variant="h2" numeric color={COLORS.primaryGreen}>{Math.round(confidencePct)}%</Text>
          </View>
        </View>
        <MissionFigure color={COLORS.primaryGreen} size={110} />
      </View>

      <Text variant="body" color={COLORS.textSecondary} style={styles.description}>
        {description}
      </Text>

      {onWhyThisPlan && (
        <Button
          label="Why this plan?"
          variant="secondary"
          size="sm"
          icon="chevron-forward"
          iconPosition="right"
          accentColor={COLORS.textSecondary}
          onPress={onWhyThisPlan}
          style={{ marginBottom: SPACING.lg, borderColor: COLORS.borderLight }}
        />
      )}

      <View style={styles.statsRow}>
        {stats.map((s) => (
          <View key={s.label} style={styles.statCol}>
            <Ionicons name={s.icon} size={16} color={s.color} style={{ marginBottom: 4 }} />
            <Text variant="caption" color={COLORS.textSecondary} style={styles.statLabel}>{s.label}</Text>
            <Text variant="cardTitle" numeric style={styles.statValue}>{s.value}</Text>
            <Text variant="caption" color={s.color} style={styles.statCaption} numberOfLines={1}>{s.caption}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  textCol: { flex: 1, paddingRight: SPACING.sm },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  description: { fontSize: 13, lineHeight: 19, marginTop: SPACING.md, marginBottom: SPACING.md },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    paddingTop: SPACING.md,
  },
  statCol: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2 },
  statValue: { fontSize: 14 },
  statCaption: { fontSize: 10, marginTop: 2 },
});
