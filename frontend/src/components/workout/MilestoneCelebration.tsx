/**
 * VYRN — Milestone Celebration
 *
 * The "motivation" moment the app was missing after Finish Workout: a
 * distinct, animated card that fires when a session pushes the user's
 * workout_streak or protein_streak past a milestone threshold (3, 7, 14,
 * 30... days — see computeMilestone() in WorkoutHUD.tsx).
 *
 * Deliberately separate from WorkoutSummaryCard rather than crammed into
 * it — a streak milestone is a rarer, bigger moment than "session saved",
 * so it gets its own beat: the summary card closes first, then this one
 * animates in a moment later. Reuses the same no-new-dependency approach
 * as ConfettiBurst/CountUpNumber (RN's own Animated API only).
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import CountUpNumber from '../shared/CountUpNumber';
import ConfettiBurst from './ConfettiBurst';
import type { MilestoneInfo } from './WorkoutHUD';

interface Props {
  visible: boolean;
  data: MilestoneInfo | null;
  onClose: () => void;
}

export default function MilestoneCelebration({ visible, data, onClose }: Props) {
  const scaleIn = useRef(new Animated.Value(0.85)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;
  const [confettiActive, setConfettiActive] = React.useState(false);

  useEffect(() => {
    if (!visible || !data) return;
    scaleIn.setValue(0.85);
    Animated.spring(scaleIn, { toValue: 1, useNativeDriver: true, friction: 6, tension: 65 }).start();

    // Slow ambient glow pulse behind the streak number — keeps the card
    // feeling alive without being distracting.
    glowPulse.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowPulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const t = setTimeout(() => setConfettiActive(true), 150);
    return () => { loop.stop(); clearTimeout(t); };
  }, [visible, data]);

  if (!data) return null;

  const glowScale = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const glowOpacity = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.6] });
  const accent = data.kind === 'workout' ? COLORS.primaryGreen : COLORS.recoveryMed;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <ConfettiBurst active={confettiActive} />
        <Animated.View style={[styles.card, { transform: [{ scale: scaleIn }] }]}>
          <View style={styles.glowWrap}>
            <Animated.View
              style={[
                styles.glow,
                { backgroundColor: alpha(accent, 0.25), transform: [{ scale: glowScale }], opacity: glowOpacity },
              ]}
            />
            <View style={[styles.iconRing, { borderColor: accent }]}>
              <Ionicons name={data.kind === 'workout' ? 'flame' : 'nutrition'} size={30} color={accent} />
            </View>
          </View>

          <Text style={styles.eyebrow}>MILESTONE UNLOCKED</Text>
          <View style={styles.streakRow}>
            <CountUpNumber value={data.streak} style={[styles.streakNum, { color: accent }]} />
            <Text style={[styles.streakUnit, { color: accent }]}>days</Text>
          </View>
          <Text style={styles.title}>{data.title}</Text>
          <Text style={styles.message}>{data.message}</Text>

          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: accent }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onClose();
            }}
          >
            <Text style={styles.closeBtnText}>Keep Going</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: '#141414', borderRadius: 28,
    borderWidth: 1, borderColor: '#242424', padding: 32, alignItems: 'center',
  },
  glowWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  glow: { position: 'absolute', width: 96, height: 96, borderRadius: 48 },
  iconRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D0D0D',
  },
  eyebrow: {
    color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 11,
    letterSpacing: 1.6, marginBottom: 10,
  },
  streakRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 4 },
  streakNum: { fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 52, lineHeight: 56 },
  streakUnit: { fontFamily: FONTS.semibold, fontSize: 16, marginBottom: 8 },
  title: { color: '#FFF', fontFamily: FONTS.extrabold, fontSize: 20, marginBottom: 10, textAlign: 'center' },
  message: { color: '#AAA', fontFamily: FONTS.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 26 },
  closeBtn: { width: '100%', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  closeBtnText: { color: '#000', fontFamily: FONTS.extrabold, fontSize: 15, letterSpacing: 0.5 },
});