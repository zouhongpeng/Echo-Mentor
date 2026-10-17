import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet, Platform } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { useCSSVariable } from 'uniwind';

/**
 * Apple「水滴胶囊」底部导航：
 * - 选中项背后有胶囊色块，切换时前沿先到、后沿慢半拍跟上（中途被拉长、略压扁），弹簧回弹稳住
 * - 新选中图标先缩小再弹回；文字颜色渐变
 * - 整个过程约 400ms
 */

const TABS = [
  { name: '/(tabs)', title: '人物', icon: 'people-group' as const },
  { name: '/report', title: '周报', icon: 'chart-line' as const },
  { name: '/academy', title: '学院', icon: 'graduation-cap' as const },
  { name: '/settings', title: '设置', icon: 'gear' as const },
];

const PILL = 58;

export default function FlowTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [background, muted, accent, border] = useCSSVariable([
    '--color-background',
    '--color-muted',
    '--color-accent',
    '--color-border',
  ]) as string[];

  const activeIndex = Math.max(0, TABS.findIndex((t) => pathname === t.name || pathname.startsWith(t.name + '/')));

  const [barW, setBarW] = useState(0);
  const front = useRef(new Animated.Value(0)).current;   // 胶囊前沿（x）
  const back = useRef(new Animated.Value(0)).current;    // 胶囊后沿（x）
  const squash = useRef(new Animated.Value(0)).current;  // 压扁程度 0-1
  const scales = useRef<Record<string, Animated.Value>>({}).current;
  const colorV = useRef<Record<string, Animated.Value>>({}).current;
  const prevCenter = useRef(0);
  const first = useRef(true);

  TABS.forEach((t) => {
    if (!scales[t.name]) scales[t.name] = new Animated.Value(1);
    if (!colorV[t.name]) colorV[t.name] = new Animated.Value(t.name === TABS[0].name ? 1 : 0);
  });

  const slotW = barW / TABS.length;
  const centerOf = (i: number) => slotW * i + slotW / 2;

  useEffect(() => {
    if (!barW) return;
    const target = centerOf(activeIndex);
    if (first.current) {
      front.setValue(target + PILL / 2);
      back.setValue(target - PILL / 2);
      prevCenter.current = target;
      first.current = false;
      return;
    }
    const moving = Math.abs(target - prevCenter.current) > 1;
    if (moving) {
      const toRight = target > prevCenter.current;
      Animated.parallel([
        toRight
          ? Animated.spring(front, { toValue: target + PILL / 2, friction: 8, tension: 110, useNativeDriver: true })
          : Animated.spring(back, { toValue: target - PILL / 2, friction: 8, tension: 110, useNativeDriver: true }),
        Animated.timing(squash, { toValue: 1, duration: 130, useNativeDriver: true }),
        (toRight
          ? Animated.spring(back, { toValue: target - PILL / 2, friction: 6, tension: 80, useNativeDriver: true, delay: 55 })
          : Animated.spring(front, { toValue: target + PILL / 2, friction: 6, tension: 80, useNativeDriver: true, delay: 55 })),
      ]).start();
      Animated.sequence([
        Animated.spring(squash, { toValue: 1, friction: 8, tension: 120, useNativeDriver: true, delay: 20 }),
        Animated.spring(squash, { toValue: 0, friction: 5, tension: 90, useNativeDriver: true }),
      ]).start();
      prevCenter.current = target;
    }
  }, [activeIndex, barW]);

  // 图标弹跳 + 文字颜色渐变
  useEffect(() => {
    TABS.forEach((t, i) => {
      Animated.timing(colorV[t.name], { toValue: i === activeIndex ? 1 : 0, duration: 220, useNativeDriver: false }).start();
      if (i === activeIndex) {
          Animated.sequence([
            Animated.timing(scales[t.name], { toValue: 0.75, duration: 90, useNativeDriver: true }),
            Animated.spring(scales[t.name], { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }),
          ]).start();
        }
      });
  }, [activeIndex]);

  const pillLeft = back;                                  // 后沿位置
  const pillW = Animated.subtract(front, back);           // 前沿-后沿 = 被拉长的宽度
  const pillHeight = squash.interpolate({ inputRange: [0, 1], outputRange: [38, 30] });

  return (
    <View
      onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
      style={{
        position: 'absolute', left: 12, right: 12, bottom: Math.max(insets.bottom, 8),
        backgroundColor: background, borderRadius: 24,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border,
        shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
        height: 62 + (Platform.OS === 'ios' ? 0 : 0),
        flexDirection: 'row', alignItems: 'center', overflow: 'hidden',
        paddingTop: 4, paddingBottom: insets.bottom > 10 ? 6 : 2,
      }}
    >
      {/* 流动胶囊 */}
      {barW > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: pillLeft,
            width: pillW,
            height: pillHeight,
            borderRadius: 19,
            backgroundColor: accent,
            opacity: 0.16,
          }}
        />
      )}
      {TABS.map((t, i) => {
        const active = i === activeIndex;
        return (
          <TouchableOpacity
            key={t.name}
            activeOpacity={0.8}
            onPress={() => router.navigate(t.name)}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%' }}
          >
            <Animated.View style={{ transform: [{ scale: scales[t.name] }], alignItems: 'center' }}>
              <FontAwesome6 name={t.icon} size={18} color={active ? accent : muted} />
              <Animated.Text
                style={{
                  fontSize: 11, marginTop: 3, fontWeight: active ? '700' : '500',
                  color: colorV[t.name].interpolate({ inputRange: [0, 1], outputRange: [muted, accent] }),
                }}
              >
                {t.title}
              </Animated.Text>
            </Animated.View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
