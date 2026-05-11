package com.guardian.rn

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Android implementation of EncryptedStoragePort backed by EncryptedSharedPreferences.
 * MasterKey is AES-256-GCM backed by AndroidKeyStore — survives app restarts.
 */
class EncryptedStorageManager(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "guardian_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun set(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    fun get(key: String): String? = prefs.getString(key, null)

    fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
