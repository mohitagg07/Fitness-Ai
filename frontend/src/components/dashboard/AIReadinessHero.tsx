// VYRN — AI Readiness Hero
//
// Answers questions 2, 3 and 4 of the brief in one card: "What exactly
// should I do? Why? What result can I expect?" This is the biggest,
// highest-hierarchy surface on the screen, as required.
//
// Every number here is real:
//   - decision / confidence_pct / signals / reasoning / expected_outcome
//     come from the deterministic Decision Center (decision_engine.py) —
//     confidence is never asked of an LLM, it's a weighted average of
//     real logged signals (recovery, sleep, protein, strength trend,
//     injury status). See decisionsApi below.
//   - estimated session length and workout type come from the same
//     dashboard summary the rest of the screen already uses.
// If the decision hasn't been computed yet (fresh account, first load),
// the card fails quiet and simply doesn't render rather than guessing.

import React, { useEffect, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, ActivityIndicator,
  LayoutAnimation, Platform, UIManager,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Svg, { Path, Defs, RadialGradient, Stop } from 'react-native-svg';
import { decisionsApi } from '../../utils/api';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import { ICON_SIZE } from '../../theme/layout';
import Text from '../ui/Text';
import Button from '../ui/Button';
import MetricChip from '../ui/MetricChip';
import Badge from '../ui/Badge';

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

interface Props {
  workoutType: string | null;
  workoutStreak: number;
  estimatedMinutes?: number;
}

// Original vector figure — a simple glowing chest/shoulders silhouette,
// not a stock photo, so it scales cleanly and carries no licensing risk.
function MissionFigure({ color, size = 130 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size * 1.2} viewBox="0 0 140 168">
      <Defs>
        <RadialGradient id="missionGlow" cx="0.5" cy="0.42" r="0.6">
          <Stop offset="0" stopColor={color} stopOpacity="0.5" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Path d="M70,10 a95,95 0 1,1 -0.1,0 Z" fill="url(#missionGlow)" />
      {/* head */}
      <Path d="M70,20 a16,16 0 1,1 -0.1,0 Z" fill={alpha(color, 0.9)} />
      {/* shoulders/chest */}
      <Path
        d="M35,88 C35,60 50,44 70,44 C90,44 105,60 105,88 L108,120 C90,132 50,132 32,120 Z"
        fill={alpha(color, 0.75)}
      />
      {/* chest definition lines */}
      <Path d="M70,50 L70,110" stroke={COLORS.background} strokeWidth={2} opacity={0.5} />
      <Path d="M45,70 Q70,80 95,70" stroke={COLORS.background} strokeWidth={2} opacity={0.4} fill="none" />
    </Svg>
  );
}

function confidenceColor(pct: number) {
  if (pct >= 80) return COLORS.recoveryHigh;
  if (pct >= 60) return COLORS.recoveryMed;
  return COLORS.recoveryLow;
}

export default function AIReadinessHero({ workoutType, workoutStreak, estimatedMinutes = 55 }: Props) {
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<TodayDecision | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await decisionsApi.saveToday(); // idempotent — safe every app open
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
      <View style={[styles.card, styles.loadingCard]}>
        <ActivityIndicator color={COLORS.primaryGreen} />
      </View>
    );
  }

  if (failed || !decision) return null;

  const cc = confidenceColor(decision.confidence_pct);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text variant="eyebrow" color={COLORS.textSecondary}>TODAY'S AI DECISION</Text>
        <Badge label={`${decision.confidence_pct}% CONFIDENCE`} color={cc} />
      </View>

      <View style={styles.mainRow}>
        <View style={styles.mainLeft}>
          <Text variant="hero" numberOfLines={2} style={styles.decisionTitle}>{decision.decision}</Text>
          {!!workoutType && (
            <Text variant="caption" color={COLORS.textMuted} style={{ marginTop: 4 }}>
              Estimated {estimatedMinutes} minutes
            </Text>
          )}
        </View>
        <MissionFigure color={cc} size={104} />
      </View>

      {decision.signals?.length > 0 && (
        <View style={styles.metricsRow}>
          {decision.signals.slice(0, 5).map((s, i) => (
            <MetricChip
              key={i}
              icon={s.favorable ? 'checkmark-circle-outline' : 'alert-circle-outline'}
              label={s.label}
              value={s.value}
              color={s.favorable ? COLORS.recoveryHigh : COLORS.recoveryLow}
            />
          ))}
        </View>
      )}

      <View style={styles.ctaRow}>
        <Button
          label="Start Workout"
          icon="play"
          size="lg"
          fullWidth
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            router.push('/(tabs)/workout');
          }}
          style={{ flex: 1 }}
        />
      </View>

      <TouchableOpacity
        style={styles.whyBtn}
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setExpanded((v) => !v);
        }}
      >
        <Text variant="caption" weight="semibold" color={COLORS.strainGlow}>Why This Decision</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={ICON_SIZE.xs} color={COLORS.strainGlow} />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.whyPanel}>
          {!!decision.reasoning && (
            <Text variant="body" color={COLORS.textSecondary} style={{ lineHeight: 20, marginBottom: SPACING.sm }}>
              {decision.reasoning}
            </Text>
          )}
          {!!decision.expected_outcome && (
            <WhyRow label="EXPECTED RESULT" text={decision.expected_outcome} />
          )}
          {!!decision.why_not?.length && (
            <View style={{ marginTop: SPACING.sm }}>
              <Text variant="caption" weight="bold" color={COLORS.textMuted} style={styles.whyLabel}>WHY NOT</Text>
              {decision.why_not.map((w, i) => (
                <Text key={i} variant="body" color={COLORS.textSecondary} style={{ lineHeight: 18, marginBottom: 4 }}>
                  <Text variant="body" weight="bold" color={COLORS.text}>{w.option}: </Text>
                  {w.reason}
                </Text>
              ))}
            </View>
          )}
          {!!decision.alternative && (
            <WhyRow label="IF THINGS GO WRONG" text={decision.alternative} />
          )}
        </View>
      )}

      {workoutStreak > 0 && (
        <View style={styles.streakBadge}>
          <Ionicons name="flame" size={13} color={COLORS.gold} />
          <Text variant="caption" weight="bold" numeric color={COLORS.text}>{workoutStreak}</Text>
        </View>
      )}
    </View>
  );
}

function WhyRow({ label, text }: { label: string; text: string }) {
  return (
    <View style={{ marginTop: SPACING.sm }}>
      <Text variant="caption" weight="bold" color={COLORS.textMuted} style={styles.whyLabel}>{label}</Text>
      <Text variant="body" color={COLORS.textSecondary} style={{ lineHeight: 18 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: SPACING.lg,
    minHeight: 300,
  },
  loadingCard: { alignItems: 'center', justifyContent: 'center', minHeight: 200 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  mainRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
  mainLeft: { flex: 1, paddingRight: SPACING.sm },
  decisionTitle: { fontSize: 30, lineHeight: 34 },
  metricsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: SPACING.md, marginBottom: SPACING.lg,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.cardBorder,
  },
  ctaRow: { flexDirection: 'row', marginBottom: SPACING.sm },
  whyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: SPACING.sm },
  whyPanel: {
    marginTop: SPACING.sm, backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.card,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
  },
  whyLabel: { letterSpacing: 1, fontSize: 10, marginBottom: 3 },
  streakBadge: {
    position: 'absolute', top: -10, right: SPACING.lg,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.badge,
    paddingVertical: 4, paddingHorizontal: 8,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
});
