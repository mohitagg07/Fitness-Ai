// VYRN — AI Readiness Hero
//
// A restrained, evidence-led training recommendation. This card prioritizes
// the actual decision and the signals behind it over decorative illustration.
//
// Every number here is real:
//   - The decision and supporting signals come from the deterministic
//     Decision Center. The displayed percentage is signal alignment, not
//     a probability that the recommendation is correct.
//   - The workout label comes from the dashboard's actual session type.
// If the decision hasn't been computed yet (fresh account, first load),
// the card fails quiet and simply doesn't render rather than guessing.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, Easing,
  LayoutAnimation, Platform, UIManager,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { decisionsApi } from '../../utils/api';
import { COLORS } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import { ICON_SIZE } from '../../theme/layout';
import Text from '../ui/Text';
import Button from '../ui/Button';
import MetricChip from '../ui/MetricChip';

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
}


function confidenceColor(pct: number) {
  if (pct >= 80) return COLORS.recoveryHigh;
  if (pct >= 60) return COLORS.recoveryMed;
  return COLORS.recoveryLow;
}

function AIReadinessHero({ workoutType, workoutStreak }: Props) {
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<TodayDecision | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);

  const mount = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    if (loading || failed || !decision) return;
    Animated.timing(mount, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [loading, failed, decision]);

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
    <Animated.View
      style={{
        opacity: mount,
        transform: [{ translateY: mount.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}
    >
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text variant="eyebrow" color={COLORS.textSecondary}>TODAY'S TRAINING</Text>
        <View style={styles.confBlock}>
          <Text variant="cardTitle" numeric weight="bold" color={cc} style={styles.confValue}>
            {decision.confidence_pct}%
          </Text>
          <Text variant="caption" weight="semibold" color={COLORS.textMuted} style={styles.confLabel}>
            SIGNAL ALIGNMENT
          </Text>
          <Text variant="caption" color={COLORS.textDim} style={styles.confHint}>
            tracked inputs supporting this call
          </Text>
        </View>
      </View>

      <View style={styles.mainRow}>
        <View style={styles.mainLeft}>
          {!!workoutType && (
            <Text variant="caption" weight="semibold" color={COLORS.textMuted} style={styles.workoutType}>
              {workoutType}
            </Text>
          )}
          <Text variant="hero" numberOfLines={2} style={styles.decisionTitle}>{decision.decision}</Text>
        </View>
        <View style={styles.decisionMarker}>
          <Ionicons name="barbell-outline" size={22} color={COLORS.primaryGreen} />
        </View>
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
              style={styles.metricChip}
            />
          ))}
        </View>
      )}

      <View style={styles.ctaRow}>
        <Button
          label="Start workout"
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
        <Text variant="caption" weight="semibold" color={COLORS.strainGlow}>Why this recommendation</Text>
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
    </Animated.View>
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
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: SPACING.lg,
    minHeight: 0,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 24,
    elevation: 10,
  },
  loadingCard: { alignItems: 'center', justifyContent: 'center', minHeight: 200 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACING.md },
  confBlock: { alignItems: 'flex-end', maxWidth: 132, gap: 1 },
  confValue: { fontSize: 18, lineHeight: 22 },
  confLabel: { letterSpacing: 1, fontSize: 9, marginTop: 1 },
  confHint: { fontSize: 9, textAlign: 'right', lineHeight: 12 },
  mainRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
  mainLeft: { flex: 1, paddingRight: SPACING.md, gap: 4 },
  workoutType: { textTransform: 'uppercase', letterSpacing: 1, fontSize: 10 },
  decisionTitle: { fontSize: 27, lineHeight: 32 },
  decisionMarker: {
    width: 46, height: 46, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  metricsRow: {
    // Was a single unwrapping row forcing 5 columns into the card width,
    // which is what forced 1-line-ellipsis labels like "BENCH PR…" and
    // "INJURY ST…". Wrapping to ~3 per row gives each chip roughly 50%
    // more width, and MetricChip's 2-line label now has room to use it.
    flexDirection: 'row', flexWrap: 'wrap',
    rowGap: SPACING.md, columnGap: SPACING.sm,
    paddingVertical: SPACING.md, marginBottom: SPACING.lg,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.cardBorder,
  },
  metricChip: { flexGrow: 0, flexShrink: 0, flexBasis: '30%' },
  ctaRow: { flexDirection: 'row', marginBottom: SPACING.sm },
  whyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: SPACING.sm },
  whyPanel: {
    marginTop: SPACING.sm, backgroundColor: COLORS.backgroundTop, borderRadius: 16,
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

export default React.memo(AIReadinessHero);
