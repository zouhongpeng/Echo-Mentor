package expo.modules.wechatnotification

import android.os.Bundle

/**
 * 通知事件桥：NotificationListenerService（系统服务，无 React 上下文）
 * 与 Expo Module 实例之间的单例通道。
 */
object NotificationBridge {
  @Volatile
  var emitter: ((String, Bundle) -> Unit)? = null

  fun emit(name: String, data: Bundle) {
    emitter?.invoke(name, data)
  }
}
