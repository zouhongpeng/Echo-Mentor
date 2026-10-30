/**
 * 微信通知采集（B 层：半自动素材进软件）
 *
 * 原生模块 wechat-notification 需 prebuild 后才存在：
 *   1. npx expo prebuild -p android
 *   2. 检查 app.json 已把 ./modules/wechat-notification 加入 plugins（本地 expo-module 自动链接）
 *   3. eas build 或 ./android/gradlew assembleRelease 本地打包
 * Expo Go 里本模块不存在，所有接口安全降级返回 null/false，不崩溃。
 */
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BUFFER_KEY = "wechat_capture_buffer";
const BUFFER_MAX = 300;

type WechatMessageEvent = { title: string; text: string; time: string; pkg: string };

type NativeModuleShape = {
  isListenerEnabled: () => Promise<boolean>;
  openListenerSettings: () => Promise<boolean>;
  addListener?: (name: string, cb: (e: WechatMessageEvent) => void) => { remove: () => void };
};

function getNative(): NativeModuleShape | null {
  try {
    // Expo Go / 未 prebuild 时抛错 → 返回 null
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require("expo-modules-core");
    return requireNativeModule("WechatNotification") as NativeModuleShape;
  } catch {
    return null;
  }
}

/** 是否具备采集条件（原生模块存在 + 用户已授予通知使用权） */
export async function isCaptureAvailable(): Promise<boolean> {
  const mod = getNative();
  if (!mod) return false;
  try {
    return await mod.isListenerEnabled();
  } catch {
    return false;
  }
}

/** 跳转系统「通知使用权」设置页（模块不存在时返回 false） */
export async function openListenerSettings(): Promise<boolean> {
  const mod = getNative();
  if (!mod) return false;
  try {
    return await mod.openListenerSettings();
  } catch {
    return false;
  }
}

export interface CapturedMessage {
  title: string; // 发送者昵称/群名
  text: string; // 消息文本
  time: string; // ISO 时间
}

/** 读取已采集的微信消息缓冲 */
export async function readCaptureBuffer(): Promise<CapturedMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(BUFFER_KEY);
    return raw ? (JSON.parse(raw) as CapturedMessage[]) : [];
  } catch {
    return [];
  }
}

/** 清空缓冲（导入到分析后调用） */
export async function clearCaptureBuffer(): Promise<void> {
  try {
    await AsyncStorage.removeItem(BUFFER_KEY);
  } catch { /* ignore */ }
}

async function appendBuffer(msg: CapturedMessage): Promise<void> {
  try {
    const list = await readCaptureBuffer();
    list.push(msg);
    const trimmed = list.slice(-BUFFER_MAX);
    await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

let started = false;

/**
 * 启动采集：订阅原生事件 → 写入本地缓冲。
 * 需在 App 根组件 useEffect 里调用一次；重复调用自动跳过。
 * App 切到后台时继续采集（服务在原生层运行，此处只保证 JS 侧监听存在）。
 */
export function startWechatCapture(): void {
  if (started) return;
  const mod = getNative();
  if (!mod?.addListener) return;
  try {
    mod.addListener("onWechatMessage", (e) => {
      if (!e?.text) return;
      void appendBuffer({
        title: String(e.title ?? ""),
        text: String(e.text ?? ""),
        time: new Date(Number(e.time) || Date.now()).toISOString(),
      });
    });
    started = true;
  } catch { /* ignore */ }
}

/** 组装缓冲为可粘贴的聊天记录文本（按时间排序，「发送者: 内容」行） */
export function bufferToChatText(list: CapturedMessage[]): string {
  return [...list]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((m) => `${m.title}: ${m.text}`)
    .join("\n");
}
