import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import FlowTabBar from '@/components/FlowTabBar';
import { startWechatCapture } from '@/modules/wechat-notification';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  // 微信通知采集（B 层）：prebuild 后生效；Expo Go 里自动降级为空操作
  useEffect(() => {
    startWechatCapture();
  }, []);

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
