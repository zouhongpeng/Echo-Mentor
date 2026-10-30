package expo.modules.wechatnotification

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WechatNotificationModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("WechatNotification")
    Events(WechatNotificationService.EVENT_NAME)

    OnCreate {
      NotificationBridge.emitter = { name, data -> sendEvent(name, data) }
    }
    OnDestroy {
      NotificationBridge.emitter = null
    }

    // 查询「通知使用权」是否已授予
    AsyncFunction("isListenerEnabled") { promise: Promise ->
      try {
        promise.resolve(isListenerEnabled())
      } catch (e: Exception) {
        promise.reject("CHECK_FAILED", e.message ?: "查询失败", e)
      }
    }

    // 跳转系统「通知使用权」设置页
    Function("openListenerSettings") {
      val ctx = appContext.reactContext ?: return@Function false
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
      true
    }
  }

  private fun isListenerEnabled(): Boolean {
    val ctx = appContext.reactContext ?: return false
    val cn = ComponentName(ctx, WechatNotificationService::class.java)
    val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners")
    if (TextUtils.isEmpty(flat)) return false
    // 不同 Android 版本写入的格式不同（flattenToString / flattenToShortString），两种都比对
    val possible = cn.flattenToString()
    return flat!!.contains(possible) || flat.contains(cn.flattenToShortString())
  }
}
