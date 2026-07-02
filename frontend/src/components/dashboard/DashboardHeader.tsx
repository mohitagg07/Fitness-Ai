// VYRN — DashboardHeader
//
// Answers question 1 of the brief: "Am I ready today?" — at a glance,
// before reading anything else. Logo + greeting + one AI-generated
// sentence on the left, notification/profile on the right, and the
// Readiness ring (score + status + a real day-over-day delta) pinned to
// the top-right. Every value here comes straight from the same
// dashboard-summary payload the rest of the screen uses — this file adds
// no new network calls of its own except the optional trend delta.

import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { decisionsApi } from '../../utils/api';
import { COLORS, alpha, recoveryColor } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import { ICON_SIZE } from '../../theme/layout';
import Text from '../ui/Text';
import CircularProgress from '../ui/CircularProgress';
import Logo from '../shared/Logo';

interface Props {
  firstName: string;
  aiSentence: string;
  recoveryScore0to10: number; // 0-10, same scale as summary.recovery.score
  avatarUrl?: string | null;
}

export default function DashboardHeader({ firstName, aiSentence, recoveryScore0to10, avatarUrl }: Props) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const score100 = Math.round(recoveryScore0to10 * 10);
  const ringColor = recoveryColor(score100);
  const status = score100 >= 67 ? 'READY TO PERFORM' : score100 >= 34 ? 'TAKE IT STEADY' : 'PRIORITIZE RECOVERY';

  // Real day-over-day delta — reads the last two persisted AI decisions
  // (same rows TodaysDecisionCard/decisions history use) and diffs their
  // confidence_pct. No fabricated "weekly trend" — if there isn't a
  // decision from yesterday yet, the arrow is simply omitted.
  const [delta, setDelta] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await decisionsApi.list(2);
        const rows = res.data?.decisions || [];
        if (rows.length >= 2 && !cancelled) {
          setDelta(rows[0].confidence_pct - rows[1].confidence_pct);
        }
      } catch {
        // Fails quiet — header still works without the delta.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <View style={styles.left}>
          <Logo size="sm" />
        </View>
        <View style={styles.right}>
          <TouchableOpacity hitSlop={10} onPress={() => router.push('/(tabs)/coach')} style={styles.iconBtn}>
            <Ionicons name="notifications-outline" size={ICON_SIZE.md} color={COLORS.text} />
            <View style={styles.notifDot} />
          </TouchableOpacity>
          <TouchableOpacity hitSlop={10} onPress={() => router.push('/(tabs)/profile')}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Ionicons name="person" size={16} color={COLORS.textSecondary} />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.bodyRow}>
        <View style={styles.greetingCol}>
          <Text variant="body" color={COLORS.textSecondary}>{greeting},</Text>
          <Text variant="hero" style={styles.name} numberOfLines={1}>{firstName} 👋</Text>
          <Text variant="body" color={COLORS.textSecondary} numberOfLines={2} style={styles.sentence}>
            {aiSentence}
          </Text>
        </View>

        <View style={styles.ringCol}>
          <CircularProgress
            progress={score100}
            size={92}
            strokeWidth={7}
            color={ringColor}
            center={
              <View style={{ alignItems: 'center' }}>
                <Text variant="h1" numeric color={COLORS.text}>{score100}</Text>
                <Text variant="caption" color={COLORS.textMuted} style={{ fontSize: 9 }}>/100</Text>
              </View>
            }
          />
          <Text variant="caption" weight="bold" color={ringColor} style={styles.statusText} numberOfLines={1}>
            {status}
          </Text>
          {delta !== null && (
            <View style={styles.deltaRow}>
              <Ionicons name={delta >= 0 ? 'arrow-up' : 'arrow-down'} size={11} color={delta >= 0 ? COLORS.recoveryHigh : COLORS.recoveryLow} />
              <Text variant="caption" color={delta >= 0 ? COLORS.recoveryHigh : COLORS.recoveryLow} style={{ fontSize: 11 }}>
                {Math.abs(delta)} vs yesterday
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SPACING.lg, paddingTop: 54, paddingBottom: SPACING.lg },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
  left: { flexDirection: 'row', alignItems: 'center' },
  right: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  iconBtn: { position: 'relative' },
  notifDot: {
    position: 'absolute', top: -1, right: -1, width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: COLORS.primaryGreen, borderWidth: 1.5, borderColor: COLORS.background,
  },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: COLORS.borderLight },
  avatarFallback: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.cardElevated,
    borderWidth: 1, borderColor: COLORS.borderLight, alignItems: 'center', justifyContent: 'center',
  },
  bodyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  greetingCol: { flex: 1, paddingRight: SPACING.md, justifyContent: 'center' },
  name: { fontSize: 30, marginTop: 2, marginBottom: SPACING.xs },
  sentence: { lineHeight: 19 },
  ringCol: { alignItems: 'center' },
  statusText: { marginTop: SPACING.sm, letterSpacing: 0.5, fontSize: 10 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
});
