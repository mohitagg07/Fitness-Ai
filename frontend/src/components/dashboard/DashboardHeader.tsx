// VYRN — DashboardHeader
//
// Top of Home: brand mark + greeting + motivational quote on the left,
// bell + avatar on the right, and the Readiness Score ring card pinned
// top-right beneath them — matches the reference layout exactly (a
// two-row header with the score card breaking into its own row).

import React from 'react';
import { View, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS, alpha } from '../../theme/colors';
import { Text, CircularProgress } from '../ui';
import { SPACING, RADIUS } from '../../theme/spacing';
import Logo from '../shared/Logo';

interface DashboardHeaderProps {
  firstName: string;
  quote?: string;
  avatarUrl?: string | null;
  hasNotification?: boolean;
  readinessScore: number; // 0-100
  readinessDelta?: number; // e.g. +6 from yesterday
}

export default function DashboardHeader({
  firstName,
  quote = 'Discipline today, dominance tomorrow.',
  avatarUrl,
  hasNotification = true,
  readinessScore,
  readinessDelta,
}: DashboardHeaderProps) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const improving = (readinessDelta ?? 0) >= 0;

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <View style={styles.identityRow}>
          <Logo size="sm" />
          <View style={styles.iconsRow}>
            <TouchableOpacity hitSlop={10} onPress={() => router.push('/(tabs)/coach')} style={styles.bellWrap}>
              <Ionicons name="notifications-outline" size={22} color={COLORS.text} />
              {hasNotification && <View style={styles.notifDot} />}
            </TouchableOpacity>
            <TouchableOpacity hitSlop={6} onPress={() => router.push('/(tabs)/profile')}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="person" size={18} color={COLORS.textSecondary} />
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <Text variant="caption" color={COLORS.textSecondary} style={{ marginTop: SPACING.md }}>
          {greeting},
        </Text>
        <Text variant="hero" style={styles.name}>{firstName} 👋</Text>
        <Text variant="body" color={COLORS.textSecondary} style={styles.quote} numberOfLines={2}>
          "{quote}"
        </Text>
      </View>

      <View style={styles.scoreCard}>
        <View style={styles.scoreLabelRow}>
          <Text variant="eyebrow" color={COLORS.textSecondary} style={{ fontSize: 9 }} numberOfLines={1}>
            READINESS SCORE
          </Text>
          <Ionicons name="information-circle-outline" size={12} color={COLORS.textMuted} />
        </View>
        <View style={styles.scoreBody}>
          <View>
            <Text variant="h1" numeric color={COLORS.primaryGreen} style={styles.scoreValue}>
              {Math.round(readinessScore)}
              <Text variant="caption" color={COLORS.textMuted}>/100</Text>
            </Text>
          </View>
          <CircularProgress
            progress={readinessScore}
            size={54}
            strokeWidth={6}
            color={COLORS.primaryGreen}
            center={<Ionicons name="arrow-up" size={16} color={COLORS.primaryGreen} />}
          />
        </View>
        {typeof readinessDelta === 'number' && (
          <View style={styles.deltaRow}>
            <Ionicons
              name={improving ? 'arrow-up' : 'arrow-down'}
              size={11}
              color={improving ? COLORS.primaryGreen : COLORS.recoveryLow}
            />
            <Text variant="caption" color={improving ? COLORS.primaryGreen : COLORS.recoveryLow} style={{ fontSize: 11 }}>
              {Math.abs(readinessDelta)} from yesterday
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  left: { flex: 1 },
  identityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconsRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  bellWrap: { position: 'relative' },
  notifDot: {
    position: 'absolute', top: -1, right: -1,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: COLORS.recoveryMed,
    borderWidth: 1.5, borderColor: COLORS.background,
  },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: COLORS.primaryGreen },
  avatarFallback: { backgroundColor: COLORS.cardElevated, alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: 2 },
  quote: { marginTop: SPACING.sm, fontStyle: 'italic', maxWidth: 220 },

  scoreCard: {
    width: 150,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: SPACING.md,
    marginTop: SPACING.xs,
  },
  scoreLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: SPACING.sm },
  scoreBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreValue: { fontSize: 30, lineHeight: 34 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: SPACING.sm },
});
