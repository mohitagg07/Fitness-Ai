// VYRN — Shared empty state
//
// Every "no data yet" screen (Workout History, PRs, Decisions, and
// Analytics' two chart slots) was independently hand-rolling an icon +
// title + body with no way forward for the user. This is the single
// reusable version: icon, title, explanatory body, and one clear CTA
// that gets them unstuck (usually "go start a workout").
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={26} color={COLORS.textMuted} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {!!actionLabel && !!onAction && (
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
    gap: 10,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 280,
  },
  actionBtn: {
    marginTop: 10,
    backgroundColor: COLORS.primaryGreen,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  actionText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
