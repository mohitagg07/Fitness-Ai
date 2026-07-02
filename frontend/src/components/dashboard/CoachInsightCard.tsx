// VYRN — AI Coach
//
// The coach thought about this before the user typed anything — the
// same proactive_brief the mission/today endpoint already computes from
// real signals (see the old ProactiveBriefCard's original notes). This
// is a restyle onto the new design tokens plus an avatar glyph and
// explicit "Chat with Coach" CTA per the new Home spec; the underlying
// data and reasoning-chain logic are unchanged.

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import { ICON_SIZE } from '../../theme/layout';
import Text from '../ui/Text';
import Button from '../ui/Button';
import SectionLabel from '../ui/SectionLabel';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ReasoningStep { label: string; finding: string; implication: string; }
interface ProactiveBrief {
  coach_message: string;
  todays_focus: string;
  suggested_top_set: string | null;
  confidence: string;
  why_summary: string;
  proactive_notices: string[];
  reasoning_steps?: ReasoningStep[];
}

export default function CoachInsightCard({ brief }: { brief: ProactiveBrief }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const confidenceColor =
    brief.confidence === 'High' ? COLORS.recoveryHigh :
    brief.confidence === 'Medium' ? COLORS.recoveryMed : COLORS.recoveryLow;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="sparkles" size={16} color={COLORS.primaryGreen} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="cardTitle">AI Coach</Text>
          <View style={styles.confidenceRow}>
            <View style={[styles.confidenceDot, { backgroundColor: confidenceColor }]} />
            <Text variant="caption" color={confidenceColor}>{brief.confidence} confidence</Text>
          </View>
        </View>
      </View>

      <Text variant="body" color={COLORS.text} style={styles.coachMessage}>{brief.coach_message}</Text>

      <View style={styles.focusRow}>
        <Ionicons name="flag" size={13} color={COLORS.primaryGreen} />
        <Text variant="body" color={COLORS.textSecondary} style={{ flex: 1 }}>{brief.todays_focus}</Text>
      </View>

      {brief.suggested_top_set && (
        <View style={styles.topSetRow}>
          <Ionicons name="barbell-outline" size={14} color={COLORS.recoveryMed} />
          <View>
            <Text variant="caption" color={COLORS.textMuted}>TODAY'S TARGET SET</Text>
            <Text variant="body" weight="bold" numeric color={COLORS.recoveryMed}>{brief.suggested_top_set}</Text>
          </View>
        </View>
      )}

      {brief.proactive_notices?.length > 0 && (
        <View style={styles.noticesBlock}>
          {brief.proactive_notices.slice(0, 2).map((n, i) => (
            <View key={i} style={styles.noticeRow}>
              <View style={styles.noticeDot} />
              <Text variant="caption" color={COLORS.textMuted} style={{ flex: 1, lineHeight: 17 }}>{n}</Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={styles.whyBtn}
        activeOpacity={0.7}
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setShowReasoning((v) => !v);
        }}
      >
        <Text variant="caption" color={COLORS.textDim}>
          {showReasoning ? 'Hide reasoning' : 'Why did the coach decide this?'}
        </Text>
        <Ionicons name={showReasoning ? 'chevron-up' : 'chevron-down'} size={ICON_SIZE.xs} color={COLORS.textDim} />
      </TouchableOpacity>

      {showReasoning && (
        <View style={styles.reasoningBlock}>
          {brief.reasoning_steps?.length ? (
            brief.reasoning_steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNum}><Text variant="caption" color={COLORS.textDim}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text variant="caption" weight="bold" color={COLORS.textMuted} style={{ letterSpacing: 0.5 }}>{step.label}</Text>
                  <Text variant="body" color={COLORS.text}>{step.finding}</Text>
                  <Text variant="caption" color={COLORS.primaryGreen} style={{ marginTop: 2 }}>→ {step.implication}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text variant="body" color={COLORS.textSecondary} style={{ lineHeight: 19 }}>{brief.why_summary}</Text>
          )}
        </View>
      )}

      <Button
        label="Chat with Coach"
        icon="chatbubble-ellipses-outline"
        variant="secondary"
        fullWidth
        onPress={() => router.push('/(tabs)/coach')}
        style={{ marginTop: SPACING.md }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.cardBorder, padding: SPACING.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: alpha(COLORS.primaryGreen, 0.14),
    alignItems: 'center', justifyContent: 'center',
  },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  confidenceDot: { width: 5, height: 5, borderRadius: 2.5 },
  coachMessage: { lineHeight: 21, marginBottom: SPACING.md },
  focusRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  topSetRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.badge,
    padding: SPACING.sm, marginBottom: SPACING.sm,
  },
  noticesBlock: { gap: 5, marginBottom: SPACING.sm },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  noticeDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: COLORS.textDim, marginTop: 6 },
  whyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: SPACING.xs },
  reasoningBlock: {
    backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.badge,
    padding: SPACING.md, marginTop: SPACING.sm, gap: SPACING.sm,
  },
  stepRow: { flexDirection: 'row', gap: SPACING.sm },
  stepNum: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
});
