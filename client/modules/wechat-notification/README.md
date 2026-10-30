# wechat-notification 微信通知采集模块（B 层）

只读通知栏文本，不碰微信进程、不模拟点击、不自动回复——不违反微信规则、不封号。

## 原理

```
微信来消息 → 系统通知栏 → NotificationListenerService 抓取文本
          → Expo 事件 onWechatMessage → JS 缓冲（AsyncStorage，上限 300 条）
          → 导入分析页当聊天素材 → 八观/阶段分析
```

## 启用步骤（需要原生构建，Expo Go 不支持）

1. **弹出 android 目录**：
   ```bash
   cd client
   npx expo prebuild -p android
   ```
   本地模块（`modules/` 目录下的 expo-module）会被自动链接进 `settings.gradle`。

2. **检查链接**：`android/settings.gradle` 应出现 `:expo-modules-wechatnotification`（或类似名字）的 include。若没有，手动在 `app.json` 的 `plugins` 里确认。

3. **打包**：
   ```bash
   # 本地打包（推荐，免费）
   cd android && ./gradlew assembleRelease
   # 或 EAS
   eas build -p android --profile preview
   ```

4. **首次使用授权两步**（建议在设置页加入口卡，调 `openListenerSettings()`）：
   - 系统「通知使用权」：设置 → 特殊应用权限 → 通知使用权 → 勾选 Echo-Mentor
   - 电池优化白名单：设置 → 电池 → 无限制（否则国产 ROM 会杀后台服务）
   - 微信 App 内：我 → 设置 → 新消息通知 → 开启「通知显示消息详情」（否则只收到"你收到一条消息"）

## JS 接口（`@/modules/wechat-notification`）

| 接口 | 说明 |
|---|---|
| `isCaptureAvailable()` | 模块存在且已授权 → true |
| `openListenerSettings()` | 跳转系统通知使用权设置页 |
| `startWechatCapture()` | 启动监听（已在 `(tabs)/_layout.tsx` 挂载，重复调用安全） |
| `readCaptureBuffer()` | 读缓冲 CapturedMessage[]（title/text/time） |
| `clearCaptureBuffer()` | 清空缓冲 |
| `bufferToChatText(list)` | 组装成「发送者: 内容」可粘贴文本 |

## 已知限制

- 只能拿到通知摘要文本（一般 ≤ 50 字），不是完整聊天记录；图片/语音只有"[图片]""[语音]"占位
- 用户打开聊天后该条通知会被微信撤下，可能漏抓（补偿：聊天记录以截图识别为主，通知采集当补充素材）
- 撤回的消息如果通知已抓到，反而留了底
- 每次更新代码都需要重新原生打包（不再支持免构建托管预览）

## 下一步（未完成的部分）

- 设置页加「微信消息采集」卡：显示 isCaptureAvailable 状态 + openListenerSettings 按钮
- 分析页加「导入微信通知素材」按钮：bufferToChatText → 填入聊天输入框 → clearCaptureBuffer
