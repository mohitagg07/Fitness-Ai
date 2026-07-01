// VYRN — cross-platform confirm dialog
//
// react-native-web does not implement Alert.alert's multi-button form —
// title/message alone fall back to window.alert(), but a button array
// with onPress callbacks (Alert.alert('Finish Workout?', '...', [
//   { text: 'Cancel', style: 'cancel' },
//   { text: 'Finish', onPress: ... },
// ])) renders NOTHING and never calls onPress on web. Every "Finish
// Workout", "Log Out", "Remove" confirm dialog in this app used that
// pattern, so on web (including this Expo web build) tapping those
// buttons appeared to do nothing at all.
//
// confirmAsync() gives the same call site a single awaitable boolean:
// native platforms still get the real Alert UI, web gets window.confirm.
import { Alert, Platform } from 'react-native';

export function confirmAsync(
  title: string,
  message?: string,
  confirmText: string = 'OK',
  cancelText: string = 'Cancel'
): Promise<boolean> {
  if (Platform.OS === 'web') {
    // window.confirm renders both title+message together; a return of
    // false means Cancel (or the dialog was dismissed) either way.
    const result = typeof window !== 'undefined'
      ? window.confirm(message ? `${title}\n\n${message}` : title)
      : false;
    return Promise.resolve(result);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}