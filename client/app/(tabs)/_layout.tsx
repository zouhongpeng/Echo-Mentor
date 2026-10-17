import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import FlowTabBar from '@/components/FlowTabBar';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="report" />
        <Tabs.Screen name="academy" />
        <Tabs.Screen name="settings" />
      </Tabs>

      {/* Apple 水滴胶囊导航 */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom }}>
        <FlowTabBar />
      </View>
    </View>
  );
}
