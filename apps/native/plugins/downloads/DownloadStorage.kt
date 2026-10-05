package com.codexswitch.downloads

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.AtomicFile
import org.json.JSONArray
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID

/** Only the download executor accesses storage. Persisted IDs never act as arbitrary filesystem paths. */
internal class DownloadStorage(private val context: Context) {
  private val dirty = mutableSetOf<String>()
  private val folder get() = File(context.filesDir, "managed-downloads").apply { mkdirs() }
  private val index get() = AtomicFile(File(folder, "tasks.json"))

  fun part(task: DownloadTask): File {
    UUID.fromString(task.id)
    return File(folder, "${task.id}.part")
  }

  fun load(): LinkedHashMap<String, DownloadTask> {
    val result = linkedMapOf<String, DownloadTask>()
    if (!index.baseFile.exists()) return result
    val entries = JSONArray(index.openRead().bufferedReader().use { it.readText() })
    for (i in 0 until entries.length()) {
      val task = DownloadTask(entries.getJSONObject(i))
      UUID.fromString(task.id)
      if (task.status != "completed") {
        task.status = "paused"
        task.received = minOf(task.received, part(task).length())
      }
      result[task.id] = task
    }
    return result
  }

  fun save(tasks: Collection<DownloadTask>) {
    // The index must never acknowledge bytes that have not reached durable storage.
    // Batch fsync with checkpoints, instead of paying for two syncs per 256 KiB reply.
    tasks.filter { it.id in dirty }.forEach { task ->
      RandomAccessFile(part(task), "rw").use { it.fd.sync() }
      dirty.remove(task.id)
    }
    val json = JSONArray().apply { tasks.forEach { put(it.data) } }.toString()
    val output = index.startWrite()
    try { output.write(json.toByteArray(Charsets.UTF_8)); index.finishWrite(output) }
    catch (error: Exception) { index.failWrite(output); throw error }
  }

  fun prepare(task: DownloadTask) {
    RandomAccessFile(part(task), "rw").use { it.setLength(task.received) }
    dirty.add(task.id)
  }

  fun append(task: DownloadTask, bytes: ByteArray) {
    RandomAccessFile(part(task), "rw").use {
      require(it.length() == task.received)
      it.seek(task.received); it.write(bytes)
    }
    task.received += bytes.size
    dirty.add(task.id)
  }

  fun publish(task: DownloadTask, checkpoint: () -> Unit) {
    require(part(task).length() == task.size)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) publishMedia(task, checkpoint)
    else publishLegacy(task, checkpoint)
  }

  private fun publishMedia(task: DownloadTask, checkpoint: () -> Unit) {
    val resolver = context.contentResolver
    // Save the pending URI before copying so a failed or interrupted publication can be removed on retry.
    removePublished(task)
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, task.data.getString("name"))
      put(MediaStore.Downloads.MIME_TYPE, task.data.getString("mimeType"))
      put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Remote AI")
      put(MediaStore.Downloads.IS_PENDING, 1)
    }
    val uri = checkNotNull(resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
    task.data.put("uri", uri.toString()); checkpoint()
    checkNotNull(resolver.openOutputStream(uri)).use { output -> part(task).inputStream().use { it.copyTo(output) } }
    check(resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null) == 1)
  }

  @Suppress("DEPRECATION") // API 24–28 require the legacy Downloads directory and runtime storage permission.
  private fun publishLegacy(task: DownloadTask, checkpoint: () -> Unit) {
    val root = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    val destination = File(root, "Remote AI/${task.id}/${task.data.getString("name")}")
    check(destination.parentFile?.mkdirs() == true || destination.parentFile?.isDirectory == true)
    task.data.put("uri", Uri.fromFile(destination).toString()); checkpoint()
    part(task).copyTo(destination, overwrite = true)
  }

  fun removePublished(task: DownloadTask) {
    val value = task.data.optString("uri")
    if (value.isEmpty()) return
    val uri = Uri.parse(value)
    if (uri.scheme == "content") {
      require(uri.authority == MediaStore.AUTHORITY && uri.path?.startsWith("/external/downloads/") == true)
      context.contentResolver.delete(uri, null, null)
    } else {
      val file = File(requireNotNull(uri.path))
      @Suppress("DEPRECATION")
      val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
      // Existing task records may still point to downloads created before the rename.
      val roots = listOf("Remote AI", "Codex Remote", "Codex Switch")
      require(roots.any { file.canonicalFile.parentFile == File(File(downloads, it), task.id).canonicalFile })
      check(!file.exists() || file.delete())
    }
    task.data.remove("uri")
  }

  fun removePart(task: DownloadTask) {
    val file = part(task)
    check(!file.exists() || file.delete())
    dirty.remove(task.id)
  }
  fun delete(task: DownloadTask) { removePublished(task); removePart(task) }
}
