package expo.modules.wechatnotification

import android.app.Notification
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * 微信通知监听服务。
 * 只读取通知栏文本（title/text），不触碰微信进程、不模拟点击、不自动回复——不违反微信规则。
 * 需要用户在系统设置中授予「通知使用权」后才会被系统绑定。
 */
class WechatNotificationService : NotificationListenerService() {

  companion object {
    const val WECHAT_PACKAGE = "com.tencent.mm"
    const val EVENT_NAME = "onWechatMessage"
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val n = sbn ?: return
    if (n.packageName != WECHAT_PACKAGE) return
    val extras = n.notification?.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: return
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: ""
    // 空文本/纯进度条类通知跳过
    if (title.isBlank() && text.isBlank()) return

    val data = Bundle().apply {
      putString("title", title)        // 发送者昵称或群名（如 "xxx: 消息" 则为群聊）
      putString("text", text)          // 消息文本摘要（需微信开启「显示通知详情」）
      putString("time", System.currentTimeMillis().toString())
      putString("pkg", n.packageName)
    }
    NotificationBridge.emit(EVENT_NAME, data)
  }
}
