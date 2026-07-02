// VYRN — AchievementCelebration
//
// Fullscreen celebratory modal for the moment an achievement unlocks.
// Deliberately generic (title/subtitle/xp/icon props, not a hard-coded
// "Iron Discipline" string) so it can be triggered from a workout
// completion, a new PR, a nutrition streak, or anywhere else in the app —
// unlike AchievementCard, which only ever renders the dashboard's
// permanent streak tile.

import React, { useEffect, useRef } from 'react';
import { Modal, View, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { Text, Button } from '../ui';
import { SPACING, RADIUS } from '../../theme/spacing';
import AchievementBadge from './AchievementBadge';

interface AchievementCelebrationProps {
  visible: boolean;
  title: string;
  subtitle: string;
  xp?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
  onDismiss: () => void;
  ctaLabel?: string;
}

export default function AchievementCelebration({
  visible,
  title,
  subtitle,
  xp,
  icon = 'flame',
  color = COLORS.gold,
  onDismiss,
  ctaLabel = 'Keep Going',
}: AchievementCelebrationProps) {
  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scale.setValue(0.7);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <Text variant="eyebrow" color={color} style={styles.confetti}>🎉 ACHIEVEMENT UNLOCKED</Text>
          <View style={{ marginVertical: SPACING.lg }}>
            <AchievementBadge icon={icon} color={color} size={96} />
          </View>
          <Text variant="h1" align="center" style={{ marginBottom: SPACING.xs }}>{title}</Text>
          <Text variant="body" color={COLORS.textSecondary} align="center">{subtitle}</Text>
          {typeof xp === 'number' && (
            <Text variant="cardTitle" numeric color={color} style={{ marginTop: SPACING.md }}>+{xp} XP</Text>
          )}
          <Button
            label={ctaLabel}
            onPress={onDismiss}
            accentColor={color}
            fullWidth
            size="lg"
            style={{ marginTop: SPACING.xl }}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: alpha(COLORS.gold, 0.3),
    padding: SPACING.xl,
    alignItems: 'center',
  },
  confetti: { textAlign: 'center' },
});
