import React from 'react';
import { Image } from 'react-native';

const SRC = require('@/assets/avatar-default.jpg');

/** 聊天中「我」的头像：手绘线稿图，微信式方形圆角 */
export default function MeAvatar({ size = 38 }: { size?: number }) {
  return (
    <Image
      source={SRC}
      style={{ width: size, height: size, borderRadius: 6, backgroundColor: '#F2F2F7' }}
      resizeMode="cover"
    />
  );
}
