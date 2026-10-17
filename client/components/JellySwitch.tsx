import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, Animated } from 'react-native';

/** 果冻开关：点击时滑块横向拉长到终点再回弹，底色灰→绿（约 350ms 弹簧曲线） */
export default function JellySwitch({ value, onToggle, disabled }: { value: boolean; onToggle: (v: boolean) => void; disabled?: boolean }) {
  const pos = useRef(new Animated.Value(value ? 1 : 0)).current;
  const stretch = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(stretch, { toValue: 1.35, duration: 120, useNativeDriver: true }),
      Animated.spring(stretch, { toValue: 1, friction: 4.5, tension: 90, useNativeDriver: true }),
    ]).start();
    Animated.spring(pos, { toValue: value ? 1 : 0, friction: 5, tension: 70, useNativeDriver: true }).start();
  }, [value]);

  const knobX = pos.interpolate({ inputRange: [0, 1], outputRange: [2, 28] });
  const bg = pos.interpolate({ inputRange: [0, 1], outputRange: ['#E5E0DA', '#34C759'] });

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={() => onToggle(!value)} disabled={disabled}>
      <Animated.View style={{ width: 56, height: 30, borderRadius: 15, backgroundColor: bg, justifyContent: 'center' }}>
        <Animated.View
          style={{
            width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff',
            transform: [{ translateX: knobX }, { scaleX: stretch }],
            shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
          }}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}
