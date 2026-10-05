package com.codexswitch.downloads

import android.os.Process
import android.os.SystemClock
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Scheduling, validation, base64 decoding, disk I/O and checkpoints stay off the UI and JS threads.
 * The bridge forwards bounded RPC packets through the existing authenticated/encrypted chat connection.
 */
internal class DownloadEngine(
  private val storage: DownloadStorage,
  private val emit: (String, String) -> Unit,
  private val requestTimeout: Long = REQUEST_TIMEOUT_MS,
  private val clock: () -> Long = SystemClock::elapsedRealtime,
) {
  private val worker = ScheduledThreadPoolExecutor(1) { action ->
    Thread({ Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND); action.run() }, "file-downloads")
  }.apply { removeOnCancelPolicy = true }
  private var tasks: LinkedHashMap<String, DownloadTask>? = null
  private val windows = mutableMapOf<String, Int>()
  private var lastCheckpoint = 0L
  private var uncheckpointedBytes = 0L
  private fun jobs(): LinkedHashMap<String, DownloadTask> = tasks ?: storage.load().also { tasks = it }

  fun submit(action: () -> Any?, resolve: (Any?) -> Unit, reject: (Exception) -> Unit) {
    worker.execute { try { resolve(action()) } catch (error: Exception) { reject(error) } }
  }

  fun snapshot(): String = JSONArray().apply { jobs().values.forEach { put(it.data) } }.toString()

  private fun changed(persist: Boolean = true) {
    if (persist) checkpoint()
    emit("downloadTasksChanged", snapshot())
  }

  private fun checkpoint() {
    storage.save(jobs().values)
    lastCheckpoint = clock()
    uncheckpointedBytes = 0
  }

  fun enqueue(source: JSONObject): String {
    val existing = jobs().values.find { it.source.toString() == source.toString() && it.status != "completed" }
    if (existing != null) return existing.id
    require(jobs().size < 500)
    val task = DownloadTask.create(source)
    jobs()[task.id] = task
    changed(); pump()
    return task.id
  }

  private fun key(source: JSONObject) = source.getString("owner") + "\n" + source.getString("deviceId")

  fun connection(owner: String, deviceId: String, window: Int) {
    require(window in 0..MAX_READ_AHEAD)
    val key = owner + "\n" + deviceId
    if (window > 0) windows[key] = window else windows.remove(key)
    if (window == 0) jobs().values.filter { key(it.source) == key && it.status in listOf("queued", "downloading") }
      .forEach { release(it); it.status = "paused" }
    jobs().values.filter { key(it.source) == key && it.status == "downloading" }.forEach { fill(it) }
    changed(); pump()
  }

  fun pause(id: String) {
    val task = requireNotNull(jobs()[id])
    if (task.status == "completed") return
    release(task); task.status = "paused"
    changed(); pump()
  }

  fun resume(id: String) {
    val task = requireNotNull(jobs()[id])
    if (task.status in listOf("completed", "queued", "downloading")) return
    require(windows.containsKey(key(task.source)))
    task.status = "queued"; task.data.put("message", "")
    changed(); pump()
  }

  fun delete(id: String) {
    val task = jobs()[id] ?: return
    release(task); task.status = "paused"
    try { storage.delete(task); jobs().remove(id) }
    finally { changed(); pump() }
  }

  private fun pump() {
    val active = jobs().values.count { it.status == "downloading" }
    jobs().values.filter { it.status == "queued" && windows.containsKey(key(it.source)) }
      .take(MAX_ACTIVE - active).forEach {
        it.status = "downloading"
        request(it, "open")
      }
    changed()
  }

  private fun request(task: DownloadTask, operation: String, offset: Long = task.received) {
    val requestId = UUID.randomUUID().toString()
    val read = DownloadRead(operation, offset, minOf(CHUNK_BYTES.toLong(), task.size - offset).toInt())
    task.pending[requestId] = read
    val packet = JSONObject().put("requestId", requestId).put("taskId", task.id).put("source", task.source)
      .put("operation", operation).put("remoteId", task.remoteId).put("offset", offset).put("length", read.length)
    emit("downloadRequest", packet.toString())
    read.timeout = worker.schedule({
      if (task.pending.containsKey(requestId)) { release(task); task.fail(); changed(); pump() }
    }, requestTimeout, TimeUnit.MILLISECONDS)
  }

  private fun fill(task: DownloadTask) {
    if (task.remoteId.isEmpty()) return
    val window = windows[key(task.source)] ?: return
    // Completed replies also occupy the window until their predecessors have been written.
    while (task.pending.size + task.buffered.size < window && task.nextOffset < task.size) {
      val offset = task.nextOffset
      task.nextOffset += minOf(CHUNK_BYTES.toLong(), task.size - offset)
      request(task, "read", offset)
    }
  }

  fun accept(requestId: String, json: String?, failed: Boolean): Boolean {
    val task = jobs().values.find { it.pending.containsKey(requestId) } ?: return false
    val read = task.pending.remove(requestId) ?: return false
    read.timeout?.cancel(false)
    try {
      check(!failed)
      val result = JSONObject(requireNotNull(json))
      if (read.operation == "open") opened(task, result) else received(task, read, result)
      if (task.received == task.size) complete(task) else fill(task)
    } catch (_: Exception) { release(task); task.fail(); changed(); pump() }
    return true
  }

  private fun opened(task: DownloadTask, info: JSONObject) {
    val remoteId = info.getString("id")
    UUID.fromString(remoteId); task.remoteId = remoteId
    val size = info.getLong("size")
    require(size >= 0 && size <= 9_007_199_254_740_991L)
    val name = info.getString("name")
    require(name.isNotEmpty() && name !in listOf(".", "..") && name.length <= 255)
    require(name.none { it == '/' || it == '\\' || it.code < 32 || it.code == 127 })
    val revision = info.optString("revision")
    if (task.received > 0 && (revision.isEmpty() || revision != task.data.optString("revision") || task.size != size)) {
      task.received = 0; task.data.put("message", "文件已更新，已从头下载。")
    }
    task.received = minOf(task.received, storage.part(task).length(), size)
    task.data.put("size", size).put("name", name).put("revision", revision)
      .put("mimeType", info.getString("mimeType"))
    task.lastProgress = clock(); task.sampledBytes = task.received
    task.nextOffset = task.received
    storage.prepare(task); changed()
  }

  private fun received(task: DownloadTask, read: DownloadRead, result: JSONObject) {
    val length = read.length
    require(result.getLong("offset") == read.offset)
    val encoded = result.getString("data")
    require(encoded.length == ((length + 2) / 3) * 4)
    require(encoded.matches(Regex("[A-Za-z0-9+/]*={0,2}")))
    val bytes = Base64.decode(encoded, Base64.NO_WRAP)
    require(bytes.size == length)
    task.buffered[read.offset] = bytes
    while (true) {
      val next = task.buffered.remove(task.received) ?: break
      storage.append(task, next)
      uncheckpointedBytes += next.size
    }
    val now = clock()
    if (uncheckpointedBytes > 0 && (now - lastCheckpoint >= CHECKPOINT_INTERVAL_MS
        || uncheckpointedBytes >= CHECKPOINT_BYTES)) checkpoint()
    val elapsed = now - task.lastProgress
    if (elapsed >= PROGRESS_INTERVAL_MS) {
      task.data.put("bytesPerSecond", (task.received - task.sampledBytes) * 1000 / elapsed)
      task.lastProgress = now; task.sampledBytes = task.received; changed(false)
    }
  }

  private fun complete(task: DownloadTask) {
    release(task)
    storage.publish(task) { checkpoint() }
    task.status = "completed"; task.data.put("message", "已保存到下载文件夹")
    changed()
    storage.removePart(task)
    pump()
  }

  private fun release(task: DownloadTask) {
    task.data.put("bytesPerSecond", 0)
    task.pending.values.forEach { it.timeout?.cancel(false) }
    task.pending.clear(); task.buffered.clear()
    if (task.remoteId.isNotEmpty()) {
      emit("downloadRequest", JSONObject().put("operation", "close").put("taskId", task.id)
        .put("source", task.source).put("remoteId", task.remoteId).toString())
      task.remoteId = ""
    }
  }

  fun shutdown() {
    worker.execute {
      jobs().values.filter { it.status in listOf("queued", "downloading") }.forEach {
        release(it); it.status = "paused"
      }
      checkpoint()
    }
    worker.shutdown()
  }
}
