// VYRN — Quick Tools
//
// Secondary navigation row for the three AI tools that don't have a
// permanent slot in the bottom tab bar: Decisions (past AI calls and how
// they played out), What If? (the recovery/sleep/protein simulator), and
// Form Check (camera-based form analysis). Purely navigational — no data
// fetching of its own — built on GlassCard so it reads as a lighter,
// floating row rather than another full opaque card competing with the
// content sections above it.

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING } from '../../theme/spacing';
import Text from '../ui/Text';
import SectionLabel from '../ui/SectionLabel';
import GlassCard from '../ui/GlassCard';

const TOOLS: Array<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  color: string;
  route: string;
}> = [
  { icon: 'analytics-outline', label: 'Decisions', sub: 'Past calls & outcomes', color: COLORS.strainGlow, route: '/(tabs)/decisions' },
  { icon: 'flask-outline', label: 'What If?', sub: 'Simulate a change', color: COLORS.recoveryMed, route: '/(tabs)/simulate' },
  { icon: 'body-outline', label: 'Form Check', sub: 'Camera feedback', color: COLORS.recoveryLow, route: '/(tabs)/formanalysis' },
];

export default function QuickToolsCard() {
  return (
    <View style={styles.wrap}>
      <SectionLabel label="MORE TOOLS" style={{ marginHorizontal: SPACING.lg }} />
      <View style={styles.row}>
        {TOOLS.map((tool) => (
          <GlassCard key={tool.route} onPress={() => router.push(tool.route as any)} style={styles.tile}>
            <View style={[styles.iconWrap, { backgroundColor: alpha(tool.color, 0.14) }]}>
              <Ionicons name={tool.icon} size={20} color={tool.color} />
            </View>
            <Text variant="caption" weight="bold" color={COLORS.text} style={{ marginTop: SPACING.sm }}>{tool.label}</Text>
            <Text variant="caption" color={COLORS.textMuted} style={styles.sub} numberOfLines={2}>{tool.sub}</Text>
          </GlassCard>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: SPACING.md },
  row: { flexDirection: 'row', marginHorizontal: SPACING.lg, gap: SPACING.sm },
  tile: { flex: 1, alignItems: 'center', padding: SPACING.md },
  iconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  sub: { textAlign: 'center', marginTop: 2, fontSize: 10, lineHeight: 13 },
});
