package com.guardian.rn

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import android.os.UserManager

/**
 * Detects whether the application is running inside an Android managed
 * work profile administered by an MDM (e.g. Microsoft Intune, JAMF,
 * Samsung KNOX).
 *
 * Detection strategy:
 *   1. UserManager.isManagedProfile() — available API 28+, most reliable.
 *   2. DevicePolicyManager.getProfileOwner() — available API 21+, returns
 *      the profile-owner component if one is set for the current user.
 *
 * Per ADR-0019.
 */
class ManagedProfileManager(private val context: Context) {

    private val dpm by lazy {
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    }

    /**
     * Returns true when the calling user is a managed work profile.
     */
    fun isRunningInManagedProfile(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val um = context.getSystemService(Context.USER_SERVICE) as UserManager
            um.isManagedProfile
        } else {
            // Fallback: a profile owner being set implies managed profile
            getProfileOwnerPackage() != null
        }
    }

    /**
     * Returns the package name of the profile owner component, or null if
     * no profile owner is active for the current user.
     */
    fun getProfileOwnerPackage(): String? {
        return try {
            dpm.profileOwnerAsUser?.packageName
        } catch (_: SecurityException) {
            null
        }
    }
}
