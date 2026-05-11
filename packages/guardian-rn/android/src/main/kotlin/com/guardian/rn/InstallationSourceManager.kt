package com.guardian.rn

import android.content.Context
import android.content.pm.PackageManager

/**
 * Detects the installer origin of this application.
 *
 * On Android 11+ (API 30) uses PackageManager.getInstallSourceInfo() which
 * returns the initiating install package name. On older APIs falls back to
 * the deprecated getInstallerPackageName().
 *
 * A null or unrecognised installer package indicates sideloading or an
 * unofficial third-party store — flagged as an unofficialStore threat.
 */
class InstallationSourceManager(private val context: Context) {

    /**
     * Returns the installer package name, or null if unavailable / sideloaded.
     * Example values:
     *   "com.android.vending"      — Google Play Store (official)
     *   "com.amazon.venezia"       — Amazon Appstore (official)
     *   null                       — sideloaded APK (unofficial)
     */
    fun getInstallerPackage(): String? {
        val packageName = context.packageName
        return try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                context.packageManager
                    .getInstallSourceInfo(packageName)
                    .initiatingPackageName
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getInstallerPackageName(packageName)
            }
        } catch (_: PackageManager.NameNotFoundException) {
            null
        }
    }
}
