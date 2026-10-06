@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
package com.codexswitch.connectivity

import android.test.InstrumentationTestCase
import com.codexswitch.downloads.DownloadBulkRouter
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONArray
import org.json.JSONObject

/** Requires the explicitly started loopback android_binary_bridge_fixture (see crate README). */
class NativeBulkDeviceTest : InstrumentationTestCase() {
    fun testRawMeshRecordsReachTheNativeDownloadRouterWithoutJson() {
        val owner = UUID.randomUUID().toString()
        val scope = DownloadBulkRouter.Scope(UUID(0, 1).toString(), UUID(0, 2).toString(), "direct")
        val received = AtomicInteger(0)
        val failure = AtomicReference<String>()
        val done = CountDownLatch(1)
        val receiver = NativeBulkReceiver(owner)
        DownloadBulkRouter.register(scope, { bytes, release ->
            try {
                val sequence = received.incrementAndGet()
                val valid = bytes.size == 16384 && ByteBuffer.wrap(bytes).getInt(68) == sequence &&
                    (72 until bytes.size).all { bytes[it] == (sequence % 251).toByte() }
                if (!valid) failure.set("Native record changed or arrived out of order")
                if (sequence == 256) done.countDown()
            } finally { release() }
        }, { failure.set("Download router exceeded its budget"); done.countDown() })
        try {
            val id = open(owner)
            assertNull(NativeConnectivity.receiveBulk("another-owner", id))
            receiver.start(id)
            var advertised = false
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45)
            while (System.nanoTime() < deadline && done.count > 0) {
                val reply = JSONObject(call(owner, "poll").put("id", id).let { NativeConnectivity.call(it.toString()) })
                assertFalse(reply.has("error"))
                val event = reply.optJSONObject("data") ?: continue
                assertFalse("Binary records must not become JSON data events", event.optString("type") == "data")
                if (event.optString("type") == "bulk" && event.optLong("generation") > 0) advertised = true
            }
            assertTrue("Binary readiness was not advertised", advertised)
            assertTrue("Native records did not arrive", done.await(1, TimeUnit.SECONDS))
            assertNull(failure.get())
            assertEquals(256, received.get())
            NativeConnectivity.call(call(owner, "close").put("id", id).toString())
            assertNull(NativeConnectivity.receiveBulk(owner, id))
        } finally {
            NativeConnectivity.call(call(owner, "reset").toString())
            receiver.shutdown(); DownloadBulkRouter.remove(scope.id)
        }
    }

    private fun call(owner: String, operation: String) = JSONObject().put("owner", owner).put("operation", operation)
    private fun open(owner: String): String {
        val config = JSONObject().put("sessionId", "native-bulk-android").put("secret", "ab".repeat(32))
            .put("servers", JSONArray().put("tcp://127.0.0.1:18779")).put("stunServers", JSONArray())
            .put("desktop", false).put("expiresAt", System.currentTimeMillis() + 120_000)
        val reply = NativeConnectivity.call(call(owner, "open").put("config", config).put("bulk", true).toString())
        return JSONObject(reply).getString("data")
    }
}
