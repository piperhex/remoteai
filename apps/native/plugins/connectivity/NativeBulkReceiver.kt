package com.codexswitch.connectivity

import com.codexswitch.downloads.DownloadBulkRouter
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Raw Rust/JNI records go straight to the bounded download router, without React Native events. */
internal class NativeBulkReceiver(private val owner: String) {
    private val handles = ConcurrentHashMap.newKeySet<String>()
    private val workers = Executors.newFixedThreadPool(8)

    fun start(id: String) {
        if (!handles.add(id)) return
        workers.execute {
            try {
                while (true) {
                    val bytes = NativeConnectivity.receiveBulk(owner, id) ?: break
                    if (bytes.isNotEmpty()) check(DownloadBulkRouter.receive(ByteBuffer.wrap(bytes)))
                }
            } finally { handles.remove(id) }
        }
    }

    // Parent reset closes every native receive before the workers exit.
    fun shutdown() { workers.shutdown() }
}
