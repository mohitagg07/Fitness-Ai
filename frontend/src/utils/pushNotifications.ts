// Push Notifications — VYRN
//
// The device-side half of real push delivery. The backend
// (services/push.py, wired into the nightly scheduler job) has real
// content to send — recovery %, protein gap, PR opportunity, CNS deload —
// but needs an Expo push token on file to send it to. This file gets that
// token and keeps it registered.
//
// Runs on a physical device or a real emulator with Google Play services;
// Expo push tokens are not available on iOS Simulator or plain web, so
// both are treated as a no-op rather than an error.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { storage } from './storage';
import { notificationsApi } from './api';
import { COLORS } from '../theme/colors';

// Lazy imports — expo-notifications/expo-device pull in native modules that
// don't exist in a plain web build, so importing them at module scope would
// break `expo start --web`. Requiring them only when actually registering
// (a native/device code path) keeps web builds working untouched.
async function loadNativeModules() {
  const Notifications = await import('expo-notifications');
  const Device = await import('expo-device');
  return { Notifications, Device };
}

const LAST_REGISTERED_TOKEN_KEY = 'vyrn_push_token';

/**
 * Requests notification permission and registers this device's Expo push
 * token with the backend. Call once per app session after auth is
 * confirmed (see (tabs)/_layout.tsx) — it's a cheap upsert server-side, so
 * calling it on every app open just keeps the token fresh if Expo ever
 * rotates it.
 */
export async function registerForPushNotificationsAsync(): Promise<void> {
  if (Platform.OS === 'web') return; // Expo push tokens aren't issued on web

  try {
    const { Notifications, Device } = await loadNativeModules();

    if (!Device.isDevice) {
      // Simulators/emulators without push capability — nothing to register,
      // but not an error either.
      return;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'VYRN Coach',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 150, 200],
        lightColor: COLORS.primaryGreen,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    // Ask only on the first decision. Re-opening the app after a denial must
    // not turn a helpful coach into a repeated permission nag.
    if (existingStatus === 'undetermined') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      // User declined — respect it, don't nag every session. The in-app
      // notification centre (GET /notifications) still works regardless.
      return;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResponse.data;

    const lastRegistered = await storage.getItem(LAST_REGISTERED_TOKEN_KEY);
    if (lastRegistered === token) return; // already registered this exact token this install

    await notificationsApi.registerPushToken(token, Platform.OS);
    await storage.setItem(LAST_REGISTERED_TOKEN_KEY, token);
  } catch (e) {
    // Never let push registration break app startup — the rest of the app
    // (including the in-app notification list) works fine without it.
    console.warn('[VYRN] push registration failed (non-fatal):', e);
  }
}

/**
 * Rebuilds weekly local training-window reminders from the athlete's saved
 * training preference and approved plan. The reminder marks the opening of
 * a broad preferred window; it is not represented as an exact appointment.
 * Existing reminders are replaced so edits to the plan cannot leave stale
 * workout alerts behind.
 */
export async function syncTrainingWindowReminders(
  preference: string | null | undefined,
  schedule: Record<string, string> | null | undefined,
): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const { Notifications } = await loadNativeModules();
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    const managed = existing.filter(
      (item) => item.content.data?.reminder_kind === 'training_window',
    );
    await Promise.all(
      managed.map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
    );

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const windows: Record<string, { hour: number; minute: number }> = {
      morning: { hour: 6, minute: 0 },
      afternoon: { hour: 12, minute: 0 },
      evening: { hour: 17, minute: 0 },
    };
    const selectedWindow = windows[String(preference || '').toLowerCase()];
    if (!selectedWindow || !schedule || typeof schedule !== 'object') return;

    // Expo weekly weekday values are 1=Sunday through 7=Saturday.
    const weekdayNumbers: Record<string, number> = {
      sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6, sat: 7,
    };
    const trainingDays = Object.entries(schedule).filter(([day, workout]) => (
      weekdayNumbers[day.toLowerCase()] !== undefined
      && typeof workout === 'string'
      && workout.toLowerCase() !== 'rest'
    ));

    await Promise.all(trainingDays.map(([day, workout]) => {
      const dayName = day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
      const workoutName = String(workout).replace(/_/g, ' ');
      return Notifications.scheduleNotificationAsync({
        content: {
          title: 'Your training window is open',
          body: `Your preferred ${preference} window has started for your ${workoutName} day. Check today's plan and readiness in Coach.`,
          data: {
            reminder_kind: 'training_window',
            cta: '/(tabs)/coach',
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: weekdayNumbers[day.toLowerCase()],
          hour: selectedWindow.hour,
          minute: selectedWindow.minute,
          ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
        },
      });
    }));
  } catch (error) {
    console.warn('[VYRN] training window reminders could not be synced (non-fatal):', error);
  }
}

/** Unregisters the current device's push token — call on logout so a
 * signed-out device doesn't keep receiving the previous user's pushes. */
export async function unregisterPushNotificationsAsync(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const token = await storage.getItem(LAST_REGISTERED_TOKEN_KEY);
    if (!token) return;
    await notificationsApi.unregisterPushToken(token);
    await storage.deleteItem(LAST_REGISTERED_TOKEN_KEY);
  } catch (e) {
    console.warn('[VYRN] push unregistration failed (non-fatal):', e);
  }
}

/**
 * Wires tap-to-deep-link: backend/services/push.py sends each notification's
 * `cta` route (e.g. "/workout", "/recovery") in the data payload, so tapping
 * a push while the app is backgrounded/closed lands the user directly on
 * the relevant screen instead of just opening to the dashboard.
 * Call once from (tabs)/_layout.tsx; returns a cleanup function for unmount.
 */
export function attachNotificationResponseHandler(): () => void {
  if (Platform.OS === 'web') return () => {};

  let subscription: { remove: () => void } | null = null;

  loadNativeModules().then(({ Notifications }) => {
    // Foreground behavior: still show an alert/banner even while the app
    // is open, since these are timely (recovery window, PR opportunity).
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const cta = response?.notification?.request?.content?.data?.cta;
      if (cta && typeof cta === 'string') {
        router.push(cta as any);
      }
    });
  });

  return () => subscription?.remove();
}
