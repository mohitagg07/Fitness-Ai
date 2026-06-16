import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { actions } from '../src/store';
import { storage } from '../src/utils/storage';

export default function RootLayout() {
  useEffect(() => {
    (async () => {
      try {
        const token = await storage.getItem('fitai_token');
        const userRaw = await storage.getItem('fitai_user');
        if (token && userRaw) {
          await actions.setAuth(JSON.parse(userRaw), token);
        }
      } catch {}
    })();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#121212' },
});