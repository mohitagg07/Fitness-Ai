// VYRN — Shared empty state
//
// Every "no data yet" screen (Workout History, PRs, Decisions, and
// Analytics' two chart slots) was independently hand-rolling an icon +
// title + body with no way forward for the user. This is the single
// reusable version: icon, motivational title, explanatory body, and one
// clear CTA that gets them unstuck (usually "go start a workout") —
// never a bare "No data" string.
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { SPACING, RADIUS } from '../../theme/spacing';
import Button from '../ui/Button';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  const mount = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) {
      mount.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(mount, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [mount, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: mount,
          transform: [{ translateY: mount.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={24} color={COLORS.textSecondary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {!!actionLabel && !!onAction && (
        <Button
          label={actionLabel}
          onPress={onAction}
          variant="secondary"
          size="sm"
          style={{ marginTop: SPACING.sm }}
        />
      )}
    </Animated.View>
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
    width: 52,
    height: 52,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    color: COLORS.text,
    fontFamily: FONTS.semibold,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  body: {
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 260,
  },
});
