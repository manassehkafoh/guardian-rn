package com.guardian.rn

import org.json.JSONArray
import org.json.JSONObject

/**
 * RFC 8785 JSON Canonicalisation Scheme (JCS).
 * Must produce identical output to the TypeScript and Swift implementations.
 * Test vectors in CanonicalJsonSerializerTest.kt (48 RFC 8785 appendix vectors).
 */
object CanonicalJsonSerializer {

    fun canonicalize(value: Any?): String = when (value) {
        null         -> "null"
        is Boolean   -> if (value) "true" else "false"
        is Number    -> canonicalizeNumber(value)
        is String    -> encodeString(value)
        is JSONObject -> canonicalizeObject(value)
        is JSONArray  -> canonicalizeArray(value)
        is Map<*, *> -> canonicalizeMap(value)
        is List<*>   -> canonicalizeList(value)
        else         -> throw IllegalArgumentException("CanonicalJson: unsupported type ${value::class.java}")
    }

    private fun canonicalizeNumber(n: Number): String {
        val d = n.toDouble()
        if (!d.isFinite()) throw IllegalArgumentException("CanonicalJson: non-finite number")
        return if (d == kotlin.math.floor(d) && !d.isInfinite() && d in Long.MIN_VALUE.toDouble()..Long.MAX_VALUE.toDouble()) {
            d.toLong().toString()
        } else {
            d.toBigDecimal().stripTrailingZeros().toPlainString()
        }
    }

    private fun canonicalizeObject(obj: JSONObject): String {
        val sorted = obj.keys().asSequence().sorted()
        return "{" + sorted.joinToString(",") { key ->
            encodeString(key) + ":" + canonicalize(obj.get(key))
        } + "}"
    }

    private fun canonicalizeArray(arr: JSONArray): String {
        val items = (0 until arr.length()).map { canonicalize(arr.get(it)) }
        return "[" + items.joinToString(",") + "]"
    }

    private fun canonicalizeMap(map: Map<*, *>): String {
        val sorted = map.keys.map { it.toString() }.sorted()
        return "{" + sorted.joinToString(",") { key ->
            encodeString(key) + ":" + canonicalize(map[key])
        } + "}"
    }

    private fun canonicalizeList(list: List<*>): String =
        "[" + list.joinToString(",") { canonicalize(it) } + "]"

    private fun encodeString(s: String): String {
        val sb = StringBuilder("\"")
        for (ch in s) {
            when (ch) {
                '\b' -> sb.append("\\b")
                '\t' -> sb.append("\\t")
                '\n' -> sb.append("\\n")
                '' -> sb.append("\\f")
                '\r' -> sb.append("\\r")
                '"'  -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                else -> if (ch.code < 0x20) {
                    sb.append("\\u${ch.code.toString(16).padStart(4, '0')}")
                } else {
                    sb.append(ch)
                }
            }
        }
        sb.append("\"")
        return sb.toString()
    }
}
