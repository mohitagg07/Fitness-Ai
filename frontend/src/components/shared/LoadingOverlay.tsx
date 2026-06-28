/**
 * LoadingOverlay — semi-transparent loading state shown during async ops.
 * Use for blocking operations (logSet, coach call, session create).
 * For screen-level loading use ActivityIndicator or SkeletonCard directly.
 */
import React from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Modal,
} from 'react-native';
import { COLORS } from '../../theme/colors';

interface Props {
  visible: boolean;
  message?: string;
}

export default function LoadingOverlay({ visible, message = 'Loading…' }: Props) {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <ActivityIndicator color={COLORS.primaryGreen} size="large" />
          {message ? <Text style={styles.text}>{message}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

/**
 * SkeletonCard — placeholder card shown while data loads.
 * Use in place of a spinner for list-style content (dashboard, progress).
 */
export function SkeletonCard({ height = 80 }: { height?: number }) {
  return <View style={[styles.skeleton, { height }]} />;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    backgroundColor: '#1C1C1C',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    minWidth: 140,
  },
  text: {
    color: '#AAA',
    fontSize: 13,
    textAlign: 'center',
  },
  skeleton: {
    backgroundColor: '#1C1C1C',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#222',
    opacity: 0.6,
  },
});
