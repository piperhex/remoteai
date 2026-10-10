package com.codexswitch.update

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.SystemClock
import org.json.JSONObject

internal fun downloadOfficial(context: Context, files: UpdateFiles, input: JSONObject): String {
  val url = input.getString("url")
  require(officialUrl(url))
  val target = files.target(input.getString("path"))
  if (target.exists()) check(target.delete())
  val request = DownloadManager.Request(Uri.parse(url))
    .setDestinationUri(Uri.fromFile(target))
    .setTitle("Remote AI ${input.getString("version")}")
    .setMimeType("application/vnd.android.package-archive")
    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
  if (input.optBoolean("wifiOnly")) {
    request.setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI)
      .setAllowedOverMetered(false).setAllowedOverRoaming(false)
  }
  val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
  val id = manager.enqueue(request)
  val deadline = SystemClock.elapsedRealtime() + 30 * 60_000
  while (SystemClock.elapsedRealtime() < deadline) {
    manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
      check(cursor.moveToFirst())
      when (cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
        DownloadManager.STATUS_SUCCESSFUL -> return target.path
        DownloadManager.STATUS_FAILED -> error("Update download failed")
      }
    }
    Thread.sleep(1_000)
  }
  manager.remove(id)
  error("Update download timed out")
}
