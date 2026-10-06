package com.codexswitch.connectivity

import com.facebook.react.bridge.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.RejectedExecutionException
import java.util.UUID
import org.json.JSONObject

/** Rust owns bounded sessions and networking. Poll calls stay off the React Native/UI threads. */
class ChatConnectivityModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val workers = Executors.newFixedThreadPool(4)
    private val owner = UUID.randomUUID().toString()
    private val bulk = NativeBulkReceiver(owner)
    override fun getName() = "ChatConnectivity"
    override fun getConstants(): Map<String, Any> = mapOf("bulkBinaryAvailable" to true)

    @ReactMethod
    fun call(request: String, promise: Promise) {
        try {
            workers.execute {
                try {
                    val input = JSONObject(request)
                    val reply = NativeConnectivity.call(input.put("owner", owner).toString())
                    val id = JSONObject(reply).optString("data")
                    if (input.optString("operation") == "open" && input.optBoolean("bulk") && id.isNotEmpty()) {
                        bulk.start(id)
                    }
                    promise.resolve(reply)
                }
                catch (_: Exception) { promise.reject("CONNECTION_UNAVAILABLE", "暂时无法直连，请稍后重试。") }
            }
        } catch (_: RejectedExecutionException) { promise.reject("CONNECTION_CLOSED", "连接已关闭。") }
    }

    private fun owned(request: String) = JSONObject(request).put("owner", owner).toString()

    override fun invalidate() {
        workers.shutdown()
        Thread {
            // All queued opens must finish before their owner's handles are released.
            while (!workers.awaitTermination(1, TimeUnit.SECONDS)) { /* waits off the UI thread */ }
            NativeConnectivity.call(owned("{\"operation\":\"reset\"}"))
            bulk.shutdown()
        }.start()
        super.invalidate()
    }
}
