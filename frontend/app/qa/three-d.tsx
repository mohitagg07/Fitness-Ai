import React, { useState } from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import ThreeMuscleScene from '../../src/components/progress/ThreeMuscleScene';
import { COLORS } from '../../src/theme/colors';

const MUSCLE_PALETTE = {
  Chest: COLORS.recoveryHigh,
  Back: COLORS.recoveryMed,
  Shoulders: COLORS.recoveryLow,
  Arms: COLORS.recoveryHigh,
  Core: COLORS.recoveryMed,
  Legs: COLORS.recoveryLow,
} as const;

/**
 * CI-only, native 3D runtime route. The feature flag is embedded at bundle
 * time and is false for preview/production app profiles. It contains no
 * account data and does not call the backend.
 */
export default function ThreeDimensionalSmokeScreen() {
  const [status, setStatus] = useState('WAITING_FOR_3D_FRAME');

  if (process.env.EXPO_PUBLIC_VYRN_QA_BUILD !== 'true') {
    return <Redirect href="/login" />;
  }

  return (
    <View style={styles.screen}>
      <Text accessibilityLabel={status} testID="vyrn-qa-3d-status" style={styles.status}>
        {status}
      </Text>
      <Text style={styles.heading}>Native recovery scene test</Text>
      <ThreeMuscleScene
        selectedMuscle="Chest"
        musclePalette={MUSCLE_PALETTE}
        onFailure={() => setStatus('3D_CANVAS_FAILED')}
        onReady={() => setStatus((current) => current === 'WAITING_FOR_3D_FRAME' ? '3D_CANVAS_READY' : current)}
        onInteraction={() => setStatus('3D_DRAG_CONFIRMED')}
      />
      <Text style={styles.note}>
        CI checks first rendered frame, horizontal drag handling, and native launch
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 42,
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
    backgroundColor: COLORS.background,
  },
  status: {
    color: COLORS.primaryGreen,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  heading: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '700',
  },
  note: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
});
