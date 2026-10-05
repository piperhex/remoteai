package com.codexswitch.downloads

import org.json.JSONObject

/** Local counters contain no additional identifiers or file content. Mutations stay on the engine worker. */
internal fun downloadMeasurement(task: DownloadTask, name: String, value: Double) {
  val stats = task.data.optJSONObject("measurements") ?: JSONObject().also { task.data.put("measurements", it) }
  stats.put(name, stats.optDouble(name, 0.0) + value)
}

internal fun <T> measureDownload(task: DownloadTask, name: String, action: () -> T): T {
  val started = System.nanoTime()
  try { return action() }
  finally { downloadMeasurement(task, name, (System.nanoTime() - started) / 1_000_000.0) }
}
