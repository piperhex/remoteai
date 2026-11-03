package com.codexswitch.ssh

import com.facebook.react.bridge.*
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/** Socket, authentication and SFTP work never blocks React Native or Android's UI thread. */
class DirectSshModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val workers = ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(64))
    private val owner = UUID.randomUUID().toString()
    override fun getName() = "DirectSsh"

    @ReactMethod
    fun call(request: String, promise: Promise) {
        if (request.length > 8 * 1024 * 1024) {
            promise.reject("SSH_INVALID", "client.ssh.invalid"); return
        }
        try {
            workers.execute {
                try {
                    promise.resolve(NativeSsh.call(JSONObject(request).put("owner", owner).toString()))
                } catch (_: Exception) { promise.reject("SSH_FAILED", "client.ssh.connectionFailed") }
            }
        } catch (_: RejectedExecutionException) { promise.reject("SSH_CLOSED", "client.ssh.closed") }
    }

    override fun invalidate() {
        workers.shutdown()
        Thread {
            // Drain pending opens before releasing this bridge's sessions on reload or shutdown.
            while (!workers.awaitTermination(1, TimeUnit.SECONDS)) { /* off the UI thread */ }
            NativeSsh.call(JSONObject().put("owner", owner).put("reset", true).toString())
        }.start()
        super.invalidate()
    }
}
