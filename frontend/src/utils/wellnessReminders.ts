import { Platform } from 'react-native';
import { storage } from './storage';

export type WellnessReminderSettings = {
  hydration: boolean;
  protein: boolean;
  sleep: boolean;
  bedtime: string;
};

const STORAGE_KEY = 'vyrn_wellness_reminders_v1';
export const DEFAULT_WELLNESS_REMINDERS: WellnessReminderSettings = {
  hydration: false,
  protein: false,
  sleep: false,
  bedtime: '22:00',
};

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function loadWellnessReminderSettings(): Promise<WellnessReminderSettings> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WELLNESS_REMINDERS;
    const parsed = JSON.parse(raw);
    return {
      hydration: parsed?.hydration === true,
      protein: parsed?.protein === true,
      sleep: parsed?.sleep === true,
      bedtime: validTime(parsed?.bedtime) ? parsed.bedtime : DEFAULT_WELLNESS_REMINDERS.bedtime,
    };
  } catch {
    return DEFAULT_WELLNESS_REMINDERS;
  }
}

async function loadNotifications() {
  return import('expo-notifications');
}

/** Ask for OS permission only in response to an explicit enable action. */
export async function requestWellnessNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const Notifications = await loadNotifications();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('wellness', {
        name: 'Wellness reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 120],
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'granted') return true;
    if (current.status !== 'undetermined') return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.status === 'granted';
  } catch (error) {
    console.warn('[VYRN] Wellness notification permission failed', error);
    return false;
  }
}

export async function syncWellnessReminders(settings: WellnessReminderSettings): Promise<void> {
  if (Platform.OS === 'web') return;
  const Notifications = await loadNotifications();
  const managedKinds = new Set([
    'wellness_hydration',
    'wellness_protein',
    'wellness_sleep',
  ]);
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(existing
    .filter((item) => managedKinds.has(String(item.content.data?.reminder_kind || '')))
    .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));

  if (!settings.hydration && !settings.protein && !settings.sleep) return;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') return;

  const scheduleDaily = (
    kind: string,
    title: string,
    body: string,
    hour: number,
    minute: number,
    cta: string,
  ) => Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { reminder_kind: kind, cta },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      ...(Platform.OS === 'android' ? { channelId: 'wellness' } : {}),
    },
  });

  const jobs: Promise<string>[] = [];
  if (settings.hydration) {
    // Gentle check-ins during ordinary waking hours. No fixed fluid-volume
    // prescription; clinician-set fluid limits always take precedence.
    for (const [hour, minute] of [[10, 0], [13, 0], [16, 0], [19, 0]]) {
      jobs.push(scheduleDaily(
        'wellness_hydration',
        'Hydration check-in',
        'Pause for a hydration check. Drink to thirst and follow any fluid limits from your clinician.',
        hour,
        minute,
        '/(tabs)/nutrition',
      ));
    }
  }
  if (settings.protein) {
    // These prompts ask the athlete to check and update the actual food log.
    // They do not invent grams or imply that a target is personalised.
    for (const [hour, minute] of [[12, 30], [16, 30], [20, 0]]) {
      jobs.push(scheduleDaily(
        'wellness_protein',
        'Protein progress',
        'Check your protein goal in Nutrition and log your next meal so today’s total stays accurate.',
        hour,
        minute,
        '/(tabs)/nutrition',
      ));
    }
  }
  if (settings.sleep && validTime(settings.bedtime)) {
    const [hour, minute] = settings.bedtime.split(':').map(Number);
    jobs.push(scheduleDaily(
      'wellness_sleep',
      'Sleep wind-down',
      'Start winding down and make room for a consistent night of sleep.',
      hour,
      minute,
      '/(tabs)/coach',
    ));
  }
  await Promise.all(jobs);
}

export async function saveWellnessReminderSettings(
  settings: WellnessReminderSettings,
): Promise<void> {
  const safe: WellnessReminderSettings = {
    hydration: settings.hydration === true,
    protein: settings.protein === true,
    sleep: settings.sleep === true,
    bedtime: validTime(settings.bedtime) ? settings.bedtime : DEFAULT_WELLNESS_REMINDERS.bedtime,
  };
  await storage.setItem(STORAGE_KEY, JSON.stringify(safe));
  await syncWellnessReminders(safe);
}
