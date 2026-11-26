import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';

/**
 * Form analysis is intentionally gated until there is a real camera/video
 * capture path and a validated pose-estimation backend. Do not render
 * illustrative skeleton frames or invented technique scores as analysis.
 */
export default function FormAnalysisScreen() {
  const insets = useSafeAreaInsets();
  const responsive = useResponsiveLayout();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Math.max(insets.top, 20) + 20,
          paddingBottom: Math.max(insets.bottom, 28) + 20,
          width: '100%',
          maxWidth: responsive.pageMaxWidth,
          alignSelf: 'center',
        },
      ]}
    >
      <Text style={styles.eyebrow}>VYRN PERFORMANCE LAB</Text>
      <Text style={styles.title}>Form Analysis</Text>
      <Text style={styles.subtitle}>
        Technique feedback from your own workout footage.
      </Text>

      <View style={styles.panel}>
        <View style={styles.iconWrap}>
          <Ionicons name="scan-outline" size={30} color={COLORS.primaryGreen} />
        </View>
        <Text style={styles.status}>IN DEVELOPMENT</Text>
        <Text style={styles.panelTitle}>Real movement analysis is not connected yet</Text>
        <Text style={styles.body}>
          Camera capture, pose estimation, and exercise-specific validation are
          not wired to this screen. VYRN will not show a form score until those
          systems can analyse real footage.
        </Text>
        <View style={styles.divider} />
        <View style={styles.checkRow}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.recoveryHigh} />
          <Text style={styles.checkText}>No fabricated scores or simulated rep feedback</Text>
        </View>
        <View style={styles.checkRow}>
          <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
          <Text style={styles.checkText}>Awaiting camera pipeline and validated pose model</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingHorizontal: 20, paddingTop: 24, gap: 12 },
  eyebrow: {
    fontFamily: FONTS.semibold, fontSize: 10, letterSpacing: 1.5,
    color: COLORS.primaryGreen, textTransform: 'uppercase',
  },
  title: {
    fontFamily: FONTS.numericBold, fontSize: 28, fontWeight: '700',
    color: COLORS.text, marginBottom: 2,
  },
  subtitle: {
    fontFamily: FONTS.regular, fontSize: 14, lineHeight: 21,
    color: COLORS.textSecondary, marginBottom: 12,
  },
  panel: {
    borderRadius: 18, backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: COLORS.cardBorder,
    padding: 20, gap: 12,
  },
  iconWrap: {
    width: 58, height: 58, borderRadius: 17,
    backgroundColor: COLORS.cardElevated, borderWidth: 1,
    borderColor: COLORS.cardBorder, alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    alignSelf: 'flex-start', color: COLORS.recoveryMed,
    fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.2,
  },
  panelTitle: {
    color: COLORS.text, fontFamily: FONTS.semibold,
    fontSize: 19, lineHeight: 25,
  },
  body: {
    color: COLORS.textSecondary, fontFamily: FONTS.regular,
    fontSize: 13, lineHeight: 20,
  },
  divider: { height: 1, backgroundColor: COLORS.cardBorder, marginVertical: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  checkText: {
    flex: 1, color: COLORS.textSecondary, fontFamily: FONTS.medium,
    fontSize: 12, lineHeight: 18,
  },
});
