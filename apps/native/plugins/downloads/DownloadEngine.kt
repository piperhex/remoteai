package com.codexswitch.downloads

import android.os.Process
import android.os.SystemClock
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

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
  private val publisher = DownloadPublisher()
  private val saving = mutableMapOf<String, AtomicBoolean>()
  private val deleting = mutableSetOf<String>()
  private var shuttingDown = false
  private val retries = DownloadRetries()
  private val bulkStorage = BulkDownloadStorage(storage)
  private val bulk = BulkDownloads(bulkStorage, BulkCallbacks(
    execute = { worker.execute(it) }, request = { emit("downloadRequest", it.toString()) },
    progress = { task, bytes -> recordProgress(task, bytes.toLong()) }, completed = { complete(it) },
    failed = { task, code -> failTask(task, code) },
  ))
  private val stallTimer = worker.scheduleWithFixedDelay({
    bulk.stalled()
    if (retries.releaseReady(clock())) pump()
    if (uncheckpointedBytes > 0 && clock() - lastCheckpoint >= CHECKPOINT_INTERVAL_MS) checkpoint()
  }, 1, 1, TimeUnit.SECONDS)
  private fun jobs(): LinkedHashMap<String, DownloadTask> = tasks ?: storage.load().also { tasks = it }

  fun manifestPage(id: String, json: String) { bulkStorage.storePage(requireNotNull(jobs()[id]), json) }
  fun failBulk(id: String, epoch: String, code: String) { bulk.failed(id, epoch, code); changed() }
  fun invalidateBulk(owner: String, deviceId: String) {
    jobs().values.filter { key(it.source) == owner + "\n" + deviceId && bulk.contains(it.id) }
      .forEach { failTask(it, "PATH_UNAVAILABLE") }
  }

  fun submit(action: () -> Any?, resolve: (Any?) -> Unit, reject: (Exception) -> Unit) {
    worker.execute { try { resolve(action()) } catch (error: Exception) { reject(error) } }
  }

  fun snapshot(): String = JSONArray().apply { jobs().values.forEach { put(it.data) } }.toString()

  private fun changed(persist: Boolean = true) {
    // A full disk must not hide the in-memory failure state from the download page.
    try { if (persist) checkpoint() }
    finally { emit("downloadTasksChanged", snapshot()) }
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
    if (window == 0) jobs().values.filter {
      key(it.source) == key && it.status in listOf("queued", "preparing", "downloading")
    }
      .forEach { retries.clear(it.id); release(it); it.status = "paused" }
    jobs().values.filter { key(it.source) == key && it.status == "downloading" }.forEach { fill(it) }
    changed(); pump()
  }

  fun pause(id: String) {
    retries.clear(id)
    val task = requireNotNull(jobs()[id])
    if (task.status == "completed") return
    saving[id]?.set(true)
    release(task); task.status = "paused"
    changed(); pump()
  }

  fun resume(id: String) {
    val task = requireNotNull(jobs()[id])
    if (task.status in listOf("completed", "queued", "preparing", "downloading", "verifying", "saving")) return
    retries.clear(id)
    if (task.data.optBoolean("readyToSave") && storage.part(task).length() == task.size) {
      if (saving.containsKey(id)) { task.status = "queued"; changed(); return }
      complete(task); return
    }
    require(windows.containsKey(key(task.source)))
    task.status = "queued"; task.data.put("message", "")
    changed(); pump()
  }

  fun delete(id: String) {
    retries.clear(id)
    val task = jobs()[id] ?: return
    if (saving.containsKey(id)) {
      deleting.add(id); pause(id); return
    }
    release(task); task.status = "paused"
    try { storage.delete(task); jobs().remove(id) }
    finally { changed(); pump() }
  }

  private fun pump() {
    if (shuttingDown) return
    val active = jobs().values.count { it.status in listOf("preparing", "downloading", "verifying", "saving") }
    jobs().values.filter { it.status == "queued" && windows.containsKey(key(it.source)) }
      .filter { !saving.containsKey(it.id) && !retries.waiting(it.id) }
      .take(MAX_ACTIVE - active).forEach {
        if (it.data.optBoolean("readyToSave") && storage.part(it).length() == it.size) complete(it)
        else { it.status = "preparing"; request(it, "open") }
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
    }, if (operation == "open") maxOf(requestTimeout, PREPARE_TIMEOUT_MS) else requestTimeout, TimeUnit.MILLISECONDS)
  }

  private fun fill(task: DownloadTask) {
    if (bulk.contains(task.id)) { bulk.fill(); return }
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
    val failureCode = if (failed && json != null) {
      JSONObject(json).optString("code").takeIf { it.isNotEmpty() }
    } else null
    if (bulk.acknowledged(requestId, failed, failureCode)) return true
    val task = jobs().values.find { it.pending.containsKey(requestId) } ?: return false
    val read = task.pending.remove(requestId) ?: return false
    read.timeout?.cancel(false)
    try {
      if (failureCode != null) throw BulkDownloadFailure(failureCode)
      check(!failed)
      val result = JSONObject(requireNotNull(json))
      if (read.operation == "open") opened(task, result) else received(task, read, result)
      if (task.received == task.size) complete(task) else fill(task)
    } catch (error: Exception) {
      failTask(task, (error as? BulkDownloadFailure)?.code)
    }
    return true
  }

  private fun failTask(task: DownloadTask, code: String?) {
    release(task); task.fail()
    if (code != null) task.data.put("message", bulkFailureMessage(code))
    if (code in listOf("PATH_UNAVAILABLE", "EPOCH_EXPIRED", "CANCELLED")) task.status = "paused"
    if (code in listOf("PATH_UNAVAILABLE", "EPOCH_EXPIRED")
      && windows.containsKey(key(task.source)) && retries.defer(task, clock())) {
      task.status = "queued"; task.data.put("message", "连接暂时中断，正在重试…")
    }
    changed(); pump()
  }

  private fun opened(task: DownloadTask, info: JSONObject) {
    val remoteId = info.getString("id")
    UUID.fromString(remoteId); task.remoteId = remoteId
    val size = info.getLong("size")
    require(size >= 0 && size <= 9_007_199_254_740_991L)
    val name = info.getString("name")
    require(name.isNotEmpty() && name !in listOf(".", "..") && name.length <= 255)
    require(name.none { it == '/' || it == '\\' || it.code < 32 || it.code == 127 })
    task.status = "downloading"
    if (info.has("bulk")) {
      task.data.put("size", size).put("name", name).put("mimeType", info.getString("mimeType"))
        .put("protocol", "bulk").put("message", "")
      bulk.open(task, info.getJSONObject("bulk"))
      task.lastProgress = clock(); task.sampledBytes = task.received
      changed(); return
    }
    if (task.data.optString("protocol") == "bulk") {
      task.received = 0; task.data.remove("manifest"); task.data.remove("checkpoint")
    }
    task.data.put("protocol", "legacy").put("message", "兼容模式")
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
    val before = task.received
    while (true) {
      val next = task.buffered.remove(task.received) ?: break
      storage.append(task, next)
    }
    recordProgress(task, task.received - before)
  }

  private fun recordProgress(task: DownloadTask, bytes: Long) {
    uncheckpointedBytes += bytes
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
    retries.clear(task.id)
    release(task)
    task.status = "verifying"; task.data.put("savedBytes", 0)
    changed(); pump()
    val cancelled = AtomicBoolean(false)
    saving[task.id] = cancelled
    val copy = DownloadTask(JSONObject(task.data.toString()))
    var progressAt = 0L
    publisher.submit(cancelled, {
      val verifying = System.nanoTime()
      bulkStorage.verifyComplete(copy) { check(!cancelled.get()) }
      worker.submit {
        check(!cancelled.get())
        downloadMeasurement(task, "verifyMs", (System.nanoTime() - verifying) / 1_000_000.0)
        task.status = "saving"; task.data.put("readyToSave", true); changed()
      }.get()
      val publishing = System.nanoTime()
      storage.publish(copy, {
        worker.submit {
          task.data.put("uri", copy.data.getString("uri")); checkpoint()
        }.get()
      }, { copied ->
        check(!cancelled.get())
        if (clock() - progressAt >= PROGRESS_INTERVAL_MS || copied == task.size) {
          progressAt = clock()
          worker.execute { if (!cancelled.get()) { task.data.put("savedBytes", copied); changed(false) } }
        }
      })
      worker.execute { downloadMeasurement(task, "saveMs", (System.nanoTime() - publishing) / 1_000_000.0) }
    }, { error -> worker.execute { saved(task, cancelled, error) } })
  }

  private fun saved(task: DownloadTask, cancelled: AtomicBoolean, error: Exception?) {
    saving.remove(task.id)
    try {
      if (deleting.remove(task.id)) { storage.delete(task); jobs().remove(task.id); return }
      if (cancelled.get()) { storage.removePublished(task); return }
      if (error != null) {
        task.status = "failed"
        if (error is BulkDownloadFailure) {
          task.data.put("readyToSave", false).put("message", bulkFailureMessage(error.code))
        } else task.data.put("message", "保存未完成，请检查可用空间和权限后再次保存。")
        return
      }
      task.status = "completed"; task.data.put("message", "已保存到下载文件夹")
      checkpoint(); storage.removePart(task)
    } finally {
      changed(); pump()
      if (shuttingDown && saving.isEmpty()) worker.shutdown()
    }
  }

  private fun release(task: DownloadTask) {
    bulk.close(task)
    if (task.pending.values.any { it.operation == "open" }) {
      emit("downloadRequest", JSONObject().put("operation", "cancelOpen").put("taskId", task.id)
        .put("source", task.source).toString())
    }
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
      shuttingDown = true; stallTimer.cancel(false)
      saving.values.forEach { it.set(true) }; publisher.shutdown()
      jobs().values.filter { it.status in listOf("queued", "preparing", "downloading", "verifying", "saving") }.forEach {
        release(it); it.status = "paused"
      }
      checkpoint()
      if (saving.isEmpty()) worker.shutdown()
    }
  }
}
