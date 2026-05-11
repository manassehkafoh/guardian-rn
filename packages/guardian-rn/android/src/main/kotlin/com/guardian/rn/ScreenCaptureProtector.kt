package com.guardian.rn

import android.app.Activity
import android.app.Application
import android.os.Build
import android.os.Bundle
import android.view.WindowManager

/**
 * Registers FLAG_SECURE on every Activity in the host app so screenshots
 * and screen recording are blocked at the OS level.
 *
 * On Android 14+ (API 34) the Activity.registerScreenCaptureCallback() API
 * additionally fires a callback when a capture is attempted, which we use
 * to emit a screenCapture threat event.
 */
class ScreenCaptureProtector(
    private val app: Application,
    private val onCaptureDetected: () -> Unit,
) : Application.ActivityLifecycleCallbacks {

    fun start() {
        app.registerActivityLifecycleCallbacks(this)
    }

    fun stop() {
        app.unregisterActivityLifecycleCallbacks(this)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            activity.registerScreenCaptureCallback(activity.mainExecutor) {
                onCaptureDetected()
            }
        }
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
