import React, { useMemo, useRef, useState } from 'react';
import { View, Text, Animated, Easing, PanResponder } from 'react-native';

/**
 * 左滑删除行：
 * - 行内容跟手左移，右侧露出红色「删除」按钮
 * - 拖过 80px 松手 → 吸附在露出位置；不足 → 弹回原位
 * - 拖过行宽一半 → 松手直接删除：左滑淡出 + 高度收缩到 0（约 300ms ease-out），下方行平滑补位
 */
export default function SwipeRow({ children, onDelete, disabled }: { children: React.ReactNode; onDelete: () => void; disabled?: boolean }) {
  const pan = useRef(new Animated.Value(0)).current;
  const [rowW, setRowW] = useState(0);
  const [rowH, setRowH] = useState(0);
  const [closing, setClosing] = useState(false);
  const [removed, setRemoved] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const heightF = useRef(new Animated.Value(1)).current;
  const lastX = useRef(0);
  const REVEAL = 84;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => !disabled && !closing && g.dx < -8 && Math.abs(g.dy) < 12,
        onPanResponderMove: (_, g) => {
          const x = Math.max(-rowW * 0.75, Math.min(0, g.dx));
          lastX.current = x;
          pan.setValue(x);
        },
        onPanResponderRelease: () => {
          const dx = lastX.current;
          if (rowW > 0 && dx < -rowW * 0.5) {
            removeRow();
          } else if (dx < -80) {
            Animated.spring(pan, { toValue: -REVEAL, friction: 7, tension: 70, useNativeDriver: false }).start();
          } else {
            Animated.spring(pan, { toValue: 0, friction: 7, tension: 70, useNativeDriver: false }).start();
          }
        },
      }),
    [rowW, disabled, closing],
  );

  const removeRow = () => {
    setClosing(true);
    Animated.parallel([
      Animated.timing(pan, { toValue: -rowW, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(opacity, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(heightF, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start(() => {
      setRemoved(true);
      onDelete();
    });
  };

  return (
    <Animated.View
      style={{
        height: removed ? 0 : heightF.interpolate({ inputRange: [0, 1], outputRange: [0, rowH] }),
        opacity,
        overflow: 'hidden',
      }}
    >
      <View style={{ position: 'relative' }} {...panResponder.panHandlers}>
        <View
          pointerEvents={closing ? 'none' : 'auto'}
          style={{
            position: 'absolute', right: 0, top: 0, bottom: 12, width: REVEAL,
            backgroundColor: '#FF3B30', borderRadius: 12, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>删除</Text>
        </View>
        <Animated.View
          onLayout={(e) => {
            if (!rowH) setRowH(e.nativeEvent.layout.height);
            if (!rowW) setRowW(e.nativeEvent.layout.width);
          }}
          style={{ transform: [{ translateX: pan }], opacity }}
        >
          {children}
        </Animated.View>
      </View>
    </Animated.View>
  );
}
