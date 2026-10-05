package com.codexswitch.downloads

import org.json.JSONObject
import java.io.IOException
import java.util.UUID

internal data class BulkCallbacks(
  val execute: (() -> Unit) -> Unit,
  val request: (JSONObject) -> Unit,
  val progress: (DownloadTask, Int) -> Unit,
  val completed: (DownloadTask) -> Unit,
  val failed: (DownloadTask, String) -> Unit,
)
private class BlockAssembly(val block: Int, val hash: String, length: Int) {
  val bytes = ByteArray(length)
  var received = 0
}
private class Receiving(
  val task: DownloadTask, val manifest: BulkManifest, val info: JSONObject, val committed: MutableSet<Int>,
) {
  val epoch = info.getString("epoch")
  val cipher = BulkRecordCipher(info.getString("key"), UUID.fromString(task.id), UUID.fromString(epoch))
  val requests = linkedMapOf<String, BlockAssembly>()
  var granted = 0L
  var requestNumber = 0L
  val retries = mutableMapOf<Int, Int>()
  var next = 0
  var lastProgress = System.nanoTime()
  val peer get() = task.source.getString("owner") + "\n" + task.source.getString("deviceId")
}

/** All mutations run on DownloadEngine's executor; native callbacks only enqueue bounded byte arrays. */
internal class BulkDownloads(private val storage: BulkDownloadStorage, private val callbacks: BulkCallbacks) {
  private val active = linkedMapOf<String, Receiving>()
  fun contains(id: String) = active.containsKey(id)

  fun open(task: DownloadTask, info: JSONObject) {
    require(active.size < MAX_ACTIVE)
    val manifest = BulkManifest(info.getJSONObject("manifest"))
    require(manifest.size == task.size)
    val state = Receiving(task, manifest, info, measureDownload(task, "restoreMs") { storage.restore(task, manifest) })
    active[task.id] = state
    DownloadBulkRouter.register(DownloadBulkRouter.Scope(task.id, state.epoch, info.getString("path")), { bytes, release ->
      callbacks.execute { try { receive(state, bytes) } finally { release() } }
    }, { callbacks.execute { fail(state) } })
  }

  fun fill() {
    // A block is the scheduling quantum. Rotate files before granting another block to a single file.
    repeat(2) {
      for (state in active.values.toList()) {
        if (state.task.status != "downloading") continue
        val outstanding = active.values.filter { it.peer == state.peer }
          .sumOf { it.requests.values.sumOf { block -> block.bytes.size.toLong() } }
        if (outstanding >= 2L * BULK_BLOCK_BYTES) continue
        while (state.next in state.committed) state.next++
        if (state.next >= state.manifest.count) continue
        request(state, state.next++)
      }
    }
  }

  private fun request(state: Receiving, block: Int) {
    val length = state.manifest.length(block)
    val requestId = UUID.randomUUID().toString()
    state.requests[requestId] = BlockAssembly(block, storage.hash(state.task, state.manifest, block), length)
    state.granted += length
    callbacks.request(JSONObject().put("operation", "bulkRead").put("requestId", requestId)
      .put("taskId", state.task.id).put("source", state.task.source).put("remoteId", state.task.remoteId)
      .put("transferId", state.task.id).put("epoch", state.epoch).put("manifestId", state.manifest.id)
      .put("requestNumber", ++state.requestNumber)
      .put("block", block).put("granted", state.granted))
  }

  private fun receive(state: Receiving, record: ByteArray) {
    if (active[state.task.id] !== state) return
    try {
      require(record.size <= state.info.getJSONObject("capability").getInt("recordBytes"))
      downloadMeasurement(state.task, "wireBytes", record.size.toDouble())
      val fragment = measureDownload(state.task, "decryptMs") { state.cipher.decrypt(record) }
      val assembly = requireNotNull(state.requests[fragment.requestId])
      require(fragment.block == assembly.block && fragment.offset == assembly.received)
      require(assembly.received + fragment.bytes.size <= assembly.bytes.size)
      fragment.bytes.copyInto(assembly.bytes, assembly.received); assembly.received += fragment.bytes.size
      state.lastProgress = System.nanoTime()
      if (assembly.received != assembly.bytes.size) return
      if (!measureDownload(state.task, "verifyMs") { hex(sha256(assembly.bytes)) == assembly.hash }) {
        state.requests.remove(fragment.requestId)
        val attempts = (state.retries[assembly.block] ?: 0) + 1
        check(attempts <= 2)
        state.retries[assembly.block] = attempts
        request(state, assembly.block); return
      }
      measureDownload(state.task, "storageMs") { storage.write(state.task, assembly.block, assembly.bytes, state.committed) }
      downloadMeasurement(state.task, "usefulBytes", assembly.bytes.size.toDouble())
      state.requests.remove(fragment.requestId)
      state.retries.remove(assembly.block)
      callbacks.progress(state.task, assembly.bytes.size)
      if (state.committed.size == state.manifest.count) callbacks.completed(state.task)
      fill()
    } catch (error: Exception) {
      fail(state, if (error is IOException || error is SecurityException) "STORAGE_FAILED" else "INTEGRITY_FAILED")
    }
  }

  fun acknowledged(requestId: String, failed: Boolean, code: String? = null): Boolean {
    val state = active.values.firstOrNull { it.requests.containsKey(requestId) } ?: return false
    if (failed) fail(state, code ?: "PATH_UNAVAILABLE")
    return true
  }
  fun failed(id: String, epoch: String, code: String) {
    val state = active[id] ?: return
    if (state.epoch != epoch) return
    fail(state, code)
  }
  fun stalled() {
    val now = System.nanoTime()
    active.values.toList().filter { it.requests.isNotEmpty() && now - it.lastProgress > 30_000_000_000L }
      .forEach { fail(it, "PATH_UNAVAILABLE") }
  }
  private fun fail(state: Receiving, code: String = "INTEGRITY_FAILED") {
    close(state.task); callbacks.failed(state.task, code)
  }
  fun close(task: DownloadTask) {
    val state = active.remove(task.id) ?: return
    DownloadBulkRouter.remove(task.id); state.cipher.close(); state.requests.clear()
    callbacks.request(JSONObject().put("operation", "bulkCancel").put("taskId", task.id)
      .put("source", task.source).put("epoch", state.epoch))
  }
}
