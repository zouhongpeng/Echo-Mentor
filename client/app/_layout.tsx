import { Stack } from 'expo-router';
import { LogBox } from 'react-native';
import Toast from 'react-native-toast-message';
import { Provider } from '@/components/Provider';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import PinScreen from '@/screens/pin';

import '../global.css';

LogBox.ignoreLogs([
  "TurboModuleRegistry.getEnforcing(...): 'RNMapsAirModule' could not be found",
]);

function LockGate() {
  const { loaded, initialized, isUnlocked } = useAuth();
  // PIN 未就绪前保持空白，避免闪烁
  if (!loaded) return null;
  // 未设置 PIN（可选锁，默认无锁）或已解锁 → 直通
  if (initialized === false || isUnlocked) return null;
  return <PinScreen />;
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Provider>
      <Stack
        screenOptions={{
          animation: 'slide_from_right',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          headerShown: false,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="person" options={{ title: '' }} />
        <Stack.Screen name="analyze" options={{ title: '' }} />
      </Stack>
      <LockGate />
      <Toast />
      </Provider>
    </ThemeProvider>
  );
}