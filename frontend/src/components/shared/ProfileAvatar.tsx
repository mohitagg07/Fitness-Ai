import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useStore } from '../../store';
import { COLORS, alpha } from '../../theme/colors';

interface ProfileAvatarProps {
  size?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Shared signed-in identity used consistently across every primary screen. */
export default function ProfileAvatar({
  size = 40,
  onPress,
  accessibilityLabel = 'Open profile',
  style,
}: ProfileAvatarProps) {
  const { avatarUrl, fullName } = useStore((state) => ({
    avatarUrl: state.profile?.avatar_url || state.user?.avatar_url || null,
    fullName: state.profile?.full_name || state.user?.full_name || 'Athlete',
  }));

  const initials = String(fullName)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'A';

  const avatar = (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }, style]}>
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          contentFit="cover"
          cachePolicy="disk"
          transition={180}
          accessibilityLabel={`${fullName}'s profile photo`}
        />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.initials, { fontSize: Math.max(12, size * 0.34) }]}>{initials}</Text>
        </View>
      )}
      <View style={[styles.ring, { borderRadius: size / 2 }]} />
    </View>
  );

  if (!onPress) return avatar;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {avatar}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1,
    borderColor: alpha(COLORS.primaryGreen, 0.24),
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.cardElevated,
  },
  initials: {
    color: COLORS.primaryGreen,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: alpha(COLORS.text, 0.10),
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
});
