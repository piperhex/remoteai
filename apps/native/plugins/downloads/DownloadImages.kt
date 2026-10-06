package com.codexswitch.downloads

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File

/** Only a verified original cached by DownloadEngine can be copied into the photo library. */
internal class DownloadImages(private val context: Context) {
  fun publish(file: File, task: DownloadTask) {
    require(task.source.optString("preview") == "image" && file.length() == task.size)
    require(task.data.getString("mimeType") in listOf("image/png", "image/jpeg", "image/webp", "image/gif"))
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { legacy(file, task); return }
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, "RemoteAI-${task.id}-${task.data.getString("name")}")
      put(MediaStore.Images.Media.MIME_TYPE, task.data.getString("mimeType"))
      put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Remote AI")
      put(MediaStore.Images.Media.IS_PENDING, 1)
    }
    val uri = checkNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
    try {
      checkNotNull(resolver.openOutputStream(uri)).use { output -> file.inputStream().use { it.copyTo(output) } }
      check(resolver.update(uri, ContentValues().apply {
        put(MediaStore.Images.Media.IS_PENDING, 0)
      }, null, null) == 1)
      task.data.put("uri", uri.toString())
    } catch (error: Exception) { resolver.delete(uri, null, null); throw error }
  }

  @Suppress("DEPRECATION") // API 24–28 require runtime permission and a media scan after publication.
  private fun legacy(file: File, task: DownloadTask) {
    val root = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    val output = File(root, "Remote AI/${task.id}/${task.data.getString("name")}")
    check(output.parentFile?.mkdirs() == true || output.parentFile?.isDirectory == true)
    try {
      file.inputStream().use { input -> output.outputStream().use { input.copyTo(it) } }
      MediaScannerConnection.scanFile(context, arrayOf(output.absolutePath),
        arrayOf(task.data.getString("mimeType")), null)
      task.data.put("uri", Uri.fromFile(output).toString())
    } catch (error: Exception) { check(!output.exists() || output.delete()); throw error }
  }
}
