import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing } from 'react-native';

/**
 * 自定义下拉刷新头部（阻尼 + 旋转箭头 + 松手加载 + 完成弹回）
 * - 阻尼：raw 拉动距离映射为 damped = 150 * (1 - 1/(1 + raw/150))，拉 100px 列表约移动 55px，越拉越费劲
 * - damped 过 47（≈ raw 70）箭头翻转朝上 + 文字变「松手刷新」
 * - 松手过阈值：箭头变旋转加载圈 1.2s → 弹回（带回弹弹簧）→ onRefresh()
 */
export function PullHeader({
  pullY,
  onRefresh,
  height,
}: {
  pullY: Animated.Value;
  onRefresh: () => Promise<void> | void;
  height: any;
}) {
  const [ready, setReady] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const id = pullY.addListener((v) => {
      const damped = v.value;
      setReady(damped > 47);
    });
    return () => pullY.removeListener(id);
  }, [pullY]);

  const startSpin = () => {
    setSpinning(true);
    spinLoop.current = Animated.loop(Animated.timing(spin, { toValue: 360, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    spinLoop.current.start();
    setTimeout(() => {
      spinLoop.current?.stop();
      setSpinning(false);
      onRefresh();
    }, 1200);
  };

  const rotation = spin.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={{ height, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden', paddingBottom: 10 }}>
      {spinning ? (
        <Animated.View style={{ transform: [{ rotate: rotation }] }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 3, borderColor: '#E5E5EA', borderTopColor: '#E4572E' }} />
        </Animated.View>
      ) : (
        <Animated.Text
          style={{
            fontSize: 20,
            color: ready ? '#E4572E' : '#9C9CA3',
            fontWeight: '700',
            transform: [{ rotate: spinAngle(pullY) }],
          }}
        >
          ↓
        </Animated.Text>
      )}
      <Text className="text-[11px] mt-1" style={{ color: ready ? '#E4572E' : '#9C9CA3' }}>
        {spinning ? '正在更新…' : ready ? '松手刷新' : '下拉刷新'}
      </Text>
    </Animated.View>
  );
}

function spinAngle(pullY: Animated.Value) {
  // 拉动越深转越多，最多 180°（翻转朝上）
  return pullY.interpolate({ inputRange: [0, 47, 150], outputRange: ['0deg', '150deg', '180deg'], extrapolate: 'clamp' });
}

/** 刷新完成后的高亮横幅：弹入 → 闪一下 → 淡出 */
export function FlashBanner({ visible, text }: { visible: boolean; text: string }) {
  const pop = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (visible) {
      pop.setValue(0);
      fade.setValue(1);
      Animated.sequence([
        Animated.spring(pop, { toValue: 1, friction: 4.5, tension: 120, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 700, delay: 500, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);
  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', top: 8, left: 20, right: 20, zIndex: 50,
        opacity: fade,
        transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }, { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
      }}
    >
      <View className="rounded-full px-4 py-2 items-center" style={{ backgroundColor: 'rgba(52,199,89,0.95)', shadowColor: '#34C759', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}>
        <Text className="text-white text-[12px] font-semibold">✓ {text}</Text>
      </View>
    </Animated.View>
  );
}
