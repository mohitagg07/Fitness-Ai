import React, { useEffect, useState } from 'react';
import {
  Alert, Platform, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import PressableScale from '../ui/PressableScale';
import {
  DEFAULT_WELLNESS_REMINDERS,
  loadWellnessReminderSettings,
  requestWellnessNotificationPermission,
  saveWellnessReminderSettings,
  syncWellnessReminders,
  type WellnessReminderSettings,
} from '../../utils/wellnessReminders';

type ReminderKey = 'hydration' | 'protein' | 'sleep';

export default function CoachRemindersCard() {
  const [settings, setSettings] = useState<WellnessReminderSettings>(DEFAULT_WELLNESS_REMINDERS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadWellnessReminderSettings().then(async (saved) => {
      if (cancelled) return;
      setSettings(saved);
      setLoaded(true);
      try {
        await syncWellnessReminders(saved);
      } catch (error) {
        console.warn('[VYRN] Reminder schedules could not be restored', error);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const setReminder = async (key: ReminderKey, enabled: boolean) => {
    if (!loaded || saving) return;
    if (enabled) {
      const granted = await requestWellnessNotificationPermission();
      if (!granted) {
        Alert.alert(
          'Notifications are not enabled',
          'Allow notifications in your device settings, then turn this reminder on again.',
        );
        return;
      }
    }

    const next = { ...settings, [key]: enabled };
    setSaving(true);
    try {
      await saveWellnessReminderSettings(next);
      setSettings(next);
    } catch {
      Alert.alert('Could not update reminders', 'Please try again. Your current settings have been kept.');
    } finally {
      setSaving(false);
    }
  };

  const saveBedtime = async () => {
    if (!loaded || saving) return;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.bedtime)) {
      Alert.alert('Check the time', 'Enter bedtime in 24-hour HH:MM format, for example 22:30.');
      return;
    }
    setSaving(true);
    try {
      await saveWellnessReminderSettings(settings);
    } catch {
      Alert.alert('Could not save bedtime', 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (Platform.OS === 'web') {
    return (
      <View style={styles.card}>
        <View style={styles.heading}>
          <Ionicons name="notifications-outline" size={15} color={COLORS.primaryGreen} />
          <Text style={styles.headingText}>COACH REMINDERS</Text>
        </View>
        <Text style={styles.note}>Scheduled wellness reminders are available in the iOS and Android app.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Ionicons name="notifications-outline" size={15} color={COLORS.primaryGreen} />
        <Text style={styles.headingText}>COACH REMINDERS</Text>
      </View>
      <Text style={styles.description}>
        Turn on only the check-ins you want. These reminders are scheduled on this device and are off by default.
      </Text>

      <ReminderToggle
        title="Hydration check-ins"
        detail="Four gentle prompts during the day; no fixed water-volume target."
        value={settings.hydration}
        disabled={!loaded || saving}
        onChange={(value) => void setReminder('hydration', value)}
      />
      <ReminderToggle
        title="Protein progress"
        detail="Three meal-time prompts to check your goal and update your food log."
        value={settings.protein}
        disabled={!loaded || saving}
        onChange={(value) => void setReminder('protein', value)}
      />
      <ReminderToggle
        title="Sleep wind-down"
        detail="One reminder at the bedtime you choose."
        value={settings.sleep}
        disabled={!loaded || saving}
        onChange={(value) => void setReminder('sleep', value)}
      />

      <View style={styles.bedtimeRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bedtimeTitle}>Preferred bedtime</Text>
          <Text style={styles.note}>24-hour time, for example 22:30</Text>
        </View>
        <TextInput
          value={settings.bedtime}
          onChangeText={(bedtime) => setSettings((current) => ({ ...current, bedtime }))}
          onSubmitEditing={() => void saveBedtime()}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          placeholder="22:30"
          placeholderTextColor={COLORS.textMuted}
          style={styles.timeInput}
          accessibilityLabel="Preferred bedtime in 24-hour format"
        />
        <PressableScale
          style={styles.saveTime}
          onPress={() => void saveBedtime()}
          disabled={saving || !loaded}
          accessibilityRole="button"
        >
          <Text style={styles.saveText}>Save</Text>
        </PressableScale>
      </View>
      <Text style={styles.footer}>You can turn any reminder off here. Reminders stop when you disable their switch.</Text>
    </View>
  );
}

function ReminderToggle({
  title, detail, value, disabled, onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.note}>{detail}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: COLORS.border, true: alpha(COLORS.primaryGreen, 0.55) }}
        thumbColor={value ? COLORS.primaryGreen : COLORS.textMuted}
        accessibilityLabel={title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginHorizontal: 18,
    marginTop: 14,
    gap: 12,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingText: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bold,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  description: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.regular,
    fontSize: 11,
    lineHeight: 17,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  toggleTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 12 },
  note: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15 },
  bedtimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  bedtimeTitle: {
    color: COLORS.text,
    fontFamily: FONTS.semibold,
    fontSize: 11,
    marginBottom: 3,
  },
  timeInput: {
    minWidth: 66,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 9,
    backgroundColor: COLORS.backgroundTop,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
    textAlign: 'center',
    fontFamily: FONTS.numericSemibold,
    fontSize: 12,
  },
  saveTime: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: COLORS.primaryGreen,
  },
  saveText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 10 },
  footer: { color: COLORS.textDim, fontFamily: FONTS.regular, fontSize: 9, lineHeight: 14 },
});
