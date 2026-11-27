import React, { Suspense, lazy, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import Text from '../../src/components/ui/Text';
import { COLORS } from '../../src/theme/colors';

const ThreeMuscleScene = lazy(() => import('../../src/components/progress/ThreeMuscleScene'));
const QA_ENABLED = process.env.EXPO_PUBLIC_VYRN_3D_QA === '1';

const MUSCLE_PALETTE = {
  Chest: COLORS.recoveryHigh,
  Back: COLORS.strain,
  Shoulders: COLORS.recoveryMed,
  Arms: COLORS.coachPurple,
  Core: COLORS.primaryGreen,
  Legs: COLORS.recoveryLow,
};

export default function ThreeDimensionalRuntimeCheck() {
  const [status, setStatus] = useState('3D_RENDER_STARTING');

  // This route is available only in the internal emulator QA build.
  if (!QA_ENABLED) return <Redirect href="/login" />;

  return (
    <View style={styles.container}>
      <Text variant="h2" color={COLORS.text}>VYRN 3D runtime check</Text>
      <Text variant="caption" color={COLORS.textMuted}>
        Native OpenGL context and gesture interaction verification
      </Text>
      <Suspense
        fallback={
          <View style={styles.loading}>
            <ActivityIndicator color={COLORS.primaryGreen} />
            <Text variant="caption" color={COLORS.textMuted}>Loading native 3D scene…</Text>
          </View>
        }
      >
        <ThreeMuscleScene
          selectedMuscle="Chest"
          musclePalette={MUSCLE_PALETTE}
          autoRotate={false}
          onReady={() => setStatus('3D_RENDER_READY')}
          onFailure={() => setStatus('3D_RENDER_FAILED')}
        />
      </Suspense>
      <Text
        testID="qa-three-d-status"
        accessibilityLabel={`QA_${status}`}
        variant="caption"
        color={status === '3D_RENDER_READY' ? COLORS.recoveryHigh : COLORS.warning}
      >
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: 44,
    paddingHorizontal: 16,
    gap: 12,
  },
  loading: {
    height: 374,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 22,
    backgroundColor: COLORS.card,
  },
});
