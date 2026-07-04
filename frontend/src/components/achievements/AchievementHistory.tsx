// VYRN — AchievementHistory
//
// Flat list of previously unlocked achievements — for a future
// "Achievements" screen (Profile tab). Kept in this folder rather than
// dashboard/ since it's the reusable achievement system, not something
// that lives permanently on Home.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { Text, Card } from '../ui';
import { SPACING } from '../../theme/spacing';
import AchievementBadge from './AchievementBadge';

export interface AchievementRecord {
  id: string;
  title: string;
  subtitle: string;
  xp: number;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  unlockedAt: string; // ISO date
}

function AchievementHistory({ items }: { items: AchievementRecord[] }) {
  if (!items.length) {
    return (
      <View style={styles.empty}>
        <Ionicons name="trophy-outline" size={32} color={COLORS.textDim} />
        <Text variant="body" color={COLORS.textMuted} style={{ marginTop: SPACING.sm }}>
          No achievements unlocked yet.
        </Text>
      </View>
    );
  }

  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.id}
      estimatedItemSize={72}
      contentContainerStyle={{ padding: SPACING.lg }}
      // FlashList's virtualized layout doesn't honor flexbox `gap` on the
      // container the way a plain FlatList did — a real separator keeps
      // the same spacing without silently collapsing it.
      ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
      renderItem={({ item }) => (
        <Card variant="outlined" padding="sm" style={styles.row}>
          <AchievementBadge icon={item.icon} color={item.color || COLORS.gold} size={44} />
          <View style={{ flex: 1 }}>
            <Text variant="cardTitle">{item.title}</Text>
            <Text variant="caption" color={COLORS.textSecondary}>{item.subtitle}</Text>
          </View>
          <Text variant="caption" numeric color={item.color || COLORS.gold}>+{item.xp} XP</Text>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  empty: { alignItems: 'center', justifyContent: 'center', padding: SPACING.xxl },
});

export default React.memo(AchievementHistory);
