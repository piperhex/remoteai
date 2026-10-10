package com.codexswitch.update

import android.os.SystemClock
import android.util.Base64
import com.codexswitch.connectivity.NativeConnectivity
import org.json.JSONObject
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.ExecutorCompletionService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Native workers write disjoint file ranges; no APK buffers cross the React Native bridge. */
internal class UpdatePeerDownload(private val files: UpdateFiles, private val input: JSONObject) {
  private val owner = "update-${UUID.randomUUID()}"
  private val cancelled = AtomicBoolean(false)
  private val started = SystemClock.elapsedRealtime()
  private val size = input.getLong("size")
  private val target = files.target(input.getString("path"))

  fun download(): String {
    val configs = input.getJSONArray("configs")
    require(configs.length() in 1..3 && size in configs.length().toLong()..MAX_UPDATE_BYTES)
    require(files.artifact(input) == input.getString("artifact"))
    val executor = Executors.newFixedThreadPool(configs.length())
    val tasks = ExecutorCompletionService<Unit>(executor)
    var complete = false
    try {
      RandomAccessFile(target, "rw").use { it.setLength(size) }
      for (index in 0 until configs.length()) {
        tasks.submit(java.util.concurrent.Callable { transfer(configs.getJSONObject(index), index, configs.length()) })
      }
      repeat(configs.length()) { tasks.take().get() }
      check(files.verify(input))
      complete = true
      return target.path
    } finally {
      cancelled.set(true)
      executor.shutdownNow()
      while (!executor.awaitTermination(1, java.util.concurrent.TimeUnit.SECONDS)) { /* native workers only */ }
      // Every pending open has now finished, so an old worker cannot create a handle after reset.
      call(JSONObject().put("operation", "reset"))
      if (!complete) target.delete()
    }
  }

  private fun checkActive() {
    check(!cancelled.get() && !Thread.currentThread().isInterrupted)
    check(SystemClock.elapsedRealtime() - started < 20 * 60_000)
    if (input.optBoolean("wifiOnly")) check(files.wifiAvailable())
  }

  private fun call(request: JSONObject): Any? {
    val result = JSONObject(NativeConnectivity.call(request.put("owner", owner).toString()))
    check(!result.has("error"))
    return result.opt("data").takeUnless { it == JSONObject.NULL }
  }

  private fun send(id: String, frame: JSONObject) {
    call(JSONObject().put("operation", "send").put("id", id).put("text", frame.toString()))
  }

  private fun event(id: String): JSONObject? {
    checkActive()
    return call(JSONObject().put("operation", "poll").put("id", id)) as? JSONObject
  }

  private fun awaitOpen(id: String) {
    val deadline = SystemClock.elapsedRealtime() + 12_000
    var opened = false
    while (SystemClock.elapsedRealtime() < deadline) {
      val event = event(id) ?: continue
      when (event.optString("type")) {
        "open" -> opened = true
        "closed", "data" -> error("Update connection unavailable")
        "status" -> if (opened && event.getJSONObject("route").optBoolean("direct")) {
          if (input.optBoolean("wifiOnly")) check(files.wifiRoute(event.getJSONObject("route")))
          return
        }
      }
    }
    error("Update connection timed out")
  }

  private fun frame(id: String): JSONObject {
    val deadline = SystemClock.elapsedRealtime() + 8_000
    while (SystemClock.elapsedRealtime() < deadline) {
      val event = event(id) ?: continue
      when (event.optString("type")) {
        "data" -> return JSONObject(event.getString("text"))
        "closed", "open" -> error("Update connection interrupted")
        "status" -> {
          val route = event.getJSONObject("route")
          check(route.optBoolean("direct"))
          if (input.optBoolean("wifiOnly")) check(files.wifiRoute(route))
        }
      }
    }
    error("Update transfer timed out")
  }

  private fun transfer(config: JSONObject, index: Int, count: Int) {
    require(!config.getBoolean("desktop") && config.getString("sessionId").startsWith("update-"))
    checkActive()
    val id = call(JSONObject().put("operation", "open").put("config", config)) as String
    try {
      awaitOpen(id)
      val request = JSONObject().put("type", "get").put("artifact", input.getString("artifact"))
      if (count > 1) request.put("part", JSONObject().put("index", index).put("count", count))
      send(id, request)
      val start = size * index / count
      val end = size * (index + 1) / count
      val header = frame(id)
      check(header.getString("type") == "header" && header.getLong("size") == size)
      check(header.optLong("offset", 0) == start && header.optLong("length", size) == end - start)
      receiveRange(id, start, end)
    } finally { call(JSONObject().put("operation", "close").put("id", id)) }
  }

  private fun receiveRange(id: String, start: Long, end: Long) {
    var offset = start
    var rateAt = SystemClock.elapsedRealtime()
    var rateOffset = start
    RandomAccessFile(target, "rw").use { file ->
      file.seek(start)
      while (true) {
        val frame = frame(id)
        if (frame.getString("type") == "complete") {
          check(offset == end)
          send(id, JSONObject().put("type", "received"))
          return
        }
        val bytes = decodeChunk(frame, offset, end)
        file.write(bytes); offset += bytes.size
        val elapsed = SystemClock.elapsedRealtime() - rateAt
        if (elapsed >= 15_000) {
          check((offset - rateOffset) * 1000 / elapsed >= 64 * 1024)
          rateAt = SystemClock.elapsedRealtime(); rateOffset = offset
        }
      }
    }
  }
}

internal fun decodeChunk(frame: JSONObject, offset: Long, end: Long): ByteArray {
  require(frame.getString("type") == "chunk" && frame.getLong("offset") == offset)
  val encoded = frame.getString("data")
  require(encoded.length in 1..87_384)
  val bytes = Base64.decode(encoded, Base64.NO_WRAP)
  require(bytes.size in 1..65_536 && offset + bytes.size <= end)
  require(Base64.encodeToString(bytes, Base64.NO_WRAP) == encoded)
  return bytes
}
