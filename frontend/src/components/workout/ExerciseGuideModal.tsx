import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { workoutApi } from '../../utils/api';
import { COLORS, alpha } from '../../theme/colors';
import { RADIUS, SPACING } from '../../theme/spacing';
import { FONTS } from '../../theme/typography';
import Text from '../ui/Text';
import PressableScale from '../ui/PressableScale';

interface ExerciseDetails {
  exercise_id: string;
  name: string;
  movement_pattern?: string | null;
  primary_group?: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: string[];
  form_view?: string | null;
  form_landmarks: string[];
}

interface Props {
  visible: boolean;
  exerciseName: string;
  onClose: () => void;
}

function ExerciseGuideModal({ visible, exerciseName, onClose }: Props) {
  const [details, setDetails] = useState<ExerciseDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!visible || !exerciseName.trim()) return undefined;
    let alive = true;
    setLoading(true);
    setDetails(null);
    setNotFound(false);
    workoutApi.getExerciseDetails(exerciseName)
      .then((response) => {
        if (alive) setDetails(response.data);
      })
      .catch((error: any) => {
        if (alive) setNotFound(error?.response?.status === 404);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [visible, exerciseName]);

  const renderTags = (items: string[], empty: string) => (
    items.length > 0 ? (
      <View style={styles.tags}>
        {items.map((item) => (
          <View key={item} style={styles.tag}>
            <Text style={styles.tagText}>{item.replace(/_/g, ' ')}</Text>
          </View>
        ))}
      </View>
    ) : <Text style={styles.muted}>{empty}</Text>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>EXERCISE REFERENCE</Text>
              <Text style={styles.title}>{details?.name || exerciseName}</Text>
            </View>
            <PressableScale onPress={onClose} style={styles.close} accessibilityLabel="Close exercise guide">
              <Ionicons name="close" size={19} color={COLORS.textSecondary} />
            </PressableScale>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={COLORS.primaryGreen} />
              <Text style={styles.muted}>Loading verified exercise details…</Text>
            </View>
          ) : notFound || !details ? (
            <View style={styles.loading}>
              <Ionicons name="information-circle-outline" size={24} color={COLORS.textMuted} />
              <Text style={styles.body}>
                This exercise is not in the verified catalogue yet. Its muscle targets and equipment requirements cannot be confirmed by VYRN.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <View style={styles.patternCard}>
                <Text style={styles.label}>MOVEMENT PATTERN</Text>
                <Text style={styles.value}>
                  {(details.movement_pattern || 'Not classified').replace(/_/g, ' ')}
                </Text>
                {!!details.primary_group && (
                  <Text style={styles.group}>{details.primary_group}</Text>
                )}
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>PRIMARY MUSCLES</Text>
                {renderTags(details.primary_muscles || [], 'No primary muscle metadata available.')}
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>SECONDARY MUSCLES</Text>
                {renderTags(details.secondary_muscles || [], 'No secondary muscle metadata available.')}
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>REQUIRED EQUIPMENT</Text>
                {renderTags(details.equipment || [], 'Equipment requirements are not recorded.')}
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>FORM REFERENCE LANDMARKS</Text>
                {renderTags(details.form_landmarks || [], 'No form landmarks are available for this movement.')}
                {!!details.form_view && (
                  <Text style={styles.muted}>Reference view: {details.form_view}</Text>
                )}
              </View>

              <View style={styles.note}>
                <Ionicons name="information-circle-outline" size={15} color={COLORS.recoveryMed} />
                <Text style={styles.noteText}>
                  This is catalogue reference information, not live video analysis, pose estimation or a diagnosis of technique or injury. Use controlled, comfortable movement and stop if you experience sharp or worsening pain.
                </Text>
              </View>
            </ScrollView>
          )}

          <PressableScale onPress={onClose} style={styles.done}>
            <Text style={styles.doneText}>DONE</Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '86%', minHeight: '52%', backgroundColor: COLORS.background, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: COLORS.borderLight, padding: SPACING.lg, paddingBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md, marginBottom: SPACING.lg },
  eyebrow: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.2 },
  title: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 22, lineHeight: 28, marginTop: 4 },
  close: { width: 34, height: 34, borderRadius: RADIUS.button, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  content: { gap: SPACING.lg, paddingBottom: SPACING.md },
  loading: { minHeight: 180, gap: SPACING.md, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  patternCard: { padding: SPACING.md, borderRadius: RADIUS.card, backgroundColor: alpha(COLORS.primaryGreen, 0.08), borderWidth: 1, borderColor: alpha(COLORS.primaryGreen, 0.2), gap: 5 },
  section: { gap: SPACING.sm },
  label: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1 },
  value: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 14, textTransform: 'capitalize' },
  group: { color: COLORS.primaryGreen, fontFamily: FONTS.medium, fontSize: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  tagText: { color: COLORS.textSecondary, fontFamily: FONTS.medium, fontSize: 10, textTransform: 'capitalize' },
  muted: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15 },
  body: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: SPACING.md, borderRadius: RADIUS.card, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  noteText: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 9, lineHeight: 14, flex: 1 },
  done: { minHeight: 46, borderRadius: RADIUS.button, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primaryGreen, marginTop: SPACING.md },
  doneText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.7 },
});

export default React.memo(ExerciseGuideModal);
