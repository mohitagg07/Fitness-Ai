// VYRN — Header primitive
//
// The single app-bar component. Dashboard, Coach, Workout, Progress, and
// Profile all render this same component at the same top offset with the
// same padding and the same bottom border — that's the fix for "every
// screen looks like it belongs to a different app." Screens differ only
// through the `right` slot (an icon button, a Badge, both) and whether
// they pass `title` (sub-screens like PRs) or leave the brand lockup as
// the only left-side content (the five tab roots).

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { SPACING } from '../../theme/spacing';
import { LAYOUT, ICON_SIZE, ELEVATION } from '../../theme/layout';
import Logo from '../shared/Logo';

interface HeaderProps {
  /** Renders a back chevron + Logo(sm, wordmark off) instead of the full lockup. */
  onBack?: () => void;
  /** Right-aligned slot — pass a <Badge/>, an icon TouchableOpacity, or both wrapped in a row. */
  right?: React.ReactNode;
  /** Suppresses the bottom border — only for screens with a hero image directly under it. */
  bordered?: boolean;
}

export default function Header({ onBack, right, bordered = true }: HeaderProps) {
  return (
    <View style={[styles.wrap, bordered && styles.bordered]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {onBack ? (
            <TouchableOpacity onPress={onBack} activeOpacity={0.6} style={styles.backBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={ICON_SIZE.md} color={COLORS.text} />
            </TouchableOpacity>
          ) : null}
          <Logo size="sm" />
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

/** Standard icon-only header action (settings, memory, hamburger, search...). */
export function HeaderIconButton({
  icon,
  onPress,
  color = COLORS.text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  color?: string;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.iconBtn} hitSlop={8}>
      <Ionicons name={icon} size={ICON_SIZE.md} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: LAYOUT.headerPaddingTop,
    paddingBottom: LAYOUT.headerPaddingBottom,
    paddingHorizontal: LAYOUT.screenMargin,
    backgroundColor: COLORS.background,
  },
  bordered: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: LAYOUT.headerHeight,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  right: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  backBtn: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1, borderColor: COLORS.border,
  },
  iconBtn: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1, borderColor: COLORS.border,
  },
});
