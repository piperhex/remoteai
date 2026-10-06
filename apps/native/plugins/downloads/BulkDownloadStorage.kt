package com.codexswitch.downloads

import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest

internal class BulkDownloadStorage(private val storage: DownloadStorage) {
  private fun folder(task: DownloadTask) = File(storage.part(task).parentFile, "${task.id}.hashes")
  private fun pageFile(task: DownloadTask, page: Int): File {
    require(page in 0 until BULK_MAX_BLOCKS / BULK_PAGE_BLOCKS)
    return File(folder(task), "$page.json")
  }
  fun storePage(task: DownloadTask, json: String) {
    require(json.length <= 20_000)
    val page = JSONObject(json); val file = pageFile(task, page.getInt("page"))
    check(file.parentFile?.mkdirs() == true || file.parentFile?.isDirectory == true)
    val atomic = AtomicFile(file); val output = atomic.startWrite()
    try { output.write(json.toByteArray(Charsets.UTF_8)); atomic.finishWrite(output) }
    catch (error: Exception) { atomic.failWrite(output); throw error }
  }
  fun page(task: DownloadTask, page: Int): JSONObject =
    JSONObject(AtomicFile(pageFile(task, page)).openRead().bufferedReader().use { it.readText() })

  fun hash(task: DownloadTask, manifest: BulkManifest, block: Int): String {
    val index = block / BULK_PAGE_BLOCKS; val page = page(task, index)
    manifest.validate(page, index)
    return page.getJSONArray("hashes").getString(block % BULK_PAGE_BLOCKS)
  }

  fun restore(task: DownloadTask, manifest: BulkManifest): MutableSet<Int> {
    manifest.authenticate { page(task, it) }
    val previous = task.data.optJSONObject("manifest")
    if (previous != null && previous.optString("manifestId") != manifest.id) {
      task.received = 0; task.data.remove("checkpoint")
      task.data.put("manifest", manifest.data).put("readyToSave", false)
      storage.prepare(task)
      throw BulkDownloadFailure("SOURCE_CHANGED")
    }
    val checkpoint = task.data.optJSONObject("checkpoint")
    val committed = mutableSetOf<Int>()
    RandomAccessFile(storage.part(task), "rw").use { file ->
      val indices = restoreCandidates(task, manifest, file)
      for (index in 0 until indices.length()) {
        val block = indices.getInt(index)
        if (block !in 0 until manifest.count) continue
        val offset = block.toLong() * BULK_BLOCK_BYTES; val length = manifest.length(block)
        if (file.length() < offset + length) continue
        val bytes = ByteArray(length); file.seek(offset); file.readFully(bytes)
        if (hex(sha256(bytes)) == hash(task, manifest, block)) committed.add(block)
      }
      if (file.length() > manifest.size) file.setLength(manifest.size)
    }
    task.data.put("manifest", manifest.data).put("readyToSave", false)
    task.data.put("checkpoint", JSONObject().put("version", 1).put("manifestId", manifest.id)
      .put("size", manifest.size).put("blockSize", BULK_BLOCK_BYTES).put("temporaryId", task.id)
      .put("sequence", (checkpoint?.optLong("sequence") ?: 0) + 1).put("committed", JSONArray(committed.sorted())))
    task.received = committed.sumOf { manifest.length(it).toLong() }
    return committed
  }

  private fun restoreCandidates(task: DownloadTask, manifest: BulkManifest, file: RandomAccessFile): JSONArray {
    val checkpoint = task.data.optJSONObject("checkpoint")
    val matching = checkpoint?.optInt("version") == 1 && checkpoint.optString("manifestId") == manifest.id
      && checkpoint.optString("temporaryId") == task.id && checkpoint.optLong("size") == manifest.size
      && checkpoint.optInt("blockSize") == BULK_BLOCK_BYTES
    if (matching) return (checkpoint?.optJSONArray("committed") ?: JSONArray()).also {
      require(it.length() <= manifest.count)
    }
    // Legacy offsets describe a contiguous prefix. Authenticate full blocks before importing it;
    // never infer a bulk bitmap from a byte count once a manifest already exists.
    if (task.data.optJSONObject("manifest") != null || task.received <= 0) {
      file.setLength(0); return JSONArray()
    }
    val indices = JSONArray()
    val prefix = minOf(task.received, file.length(), manifest.size)
    for (block in 0 until manifest.count) {
      if (block.toLong() * BULK_BLOCK_BYTES + manifest.length(block) > prefix) break
      indices.put(block)
    }
    return indices
  }

  fun write(task: DownloadTask, block: Int, bytes: ByteArray, committed: MutableSet<Int>) {
    storage.writeAt(task, block.toLong() * BULK_BLOCK_BYTES, bytes)
    committed.add(block)
    task.data.getJSONObject("checkpoint").put("committed", JSONArray(committed.sorted()))
    task.received += bytes.size
  }
  fun verifyComplete(task: DownloadTask, progress: () -> Unit) {
    val data = task.data.optJSONObject("manifest") ?: return
    val manifest = BulkManifest(data)
    if (storage.part(task).length() != manifest.size) throw BulkDownloadFailure("INTEGRITY_FAILED")
    val digest = MessageDigest.getInstance("SHA-256")
    storage.part(task).inputStream().use { input ->
      val bytes = ByteArray(CHUNK_BYTES)
      while (true) {
        progress(); val length = input.read(bytes)
        if (length < 0) break
        digest.update(bytes, 0, length)
      }
    }
    if (hex(digest.digest()) != manifest.hash) throw BulkDownloadFailure("INTEGRITY_FAILED")
  }
  fun delete(task: DownloadTask) {
    val root = folder(task)
    for (file in root.listFiles().orEmpty()) check(file.isFile && file.delete())
    check(!root.exists() || root.delete())
  }
}
