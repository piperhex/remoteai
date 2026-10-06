package com.codexswitch.downloads

import android.os.Process
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.RejectedExecutionException

/** Final MediaStore copies never occupy the network receiver/checkpoint executor. */
internal class DownloadPublisher {
  private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(2), { action ->
    Thread({ Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND); action.run() }, "download-save")
  })

  fun submit(cancelled: AtomicBoolean, action: () -> Unit, done: (Exception?) -> Unit) {
    try {
      worker.execute {
        val error = try { check(!cancelled.get()); action(); null } catch (error: Exception) { error }
        done(error)
      }
    } catch (error: RejectedExecutionException) { done(error) }
  }
  fun shutdown() { worker.shutdown() }
}
