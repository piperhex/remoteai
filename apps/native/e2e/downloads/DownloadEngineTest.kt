// Android's platform runner avoids adding a test framework dependency to the app.
@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package com.codexswitch.downloads

import android.net.Uri
import android.test.InstrumentationTestCase
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Exercises the real Android executor, decoder, fsync checkpoints and publication without a network. */
class DownloadEngineTest : InstrumentationTestCase() {
  private lateinit var storage: DownloadStorage
  private lateinit var engine: DownloadEngine
  private val packets = mutableListOf<JSONObject>()
  private var taskId = ""
  private var tick = 10_000L
  private val source = JSONObject().put("owner", "download-test").put("deviceId", "pc")
    .put("scope", "computer").put("path", "test.bin")

  override fun setUp() {
    super.setUp()
    storage = DownloadStorage(instrumentation.targetContext)
    engine = DownloadEngine(storage, { event, data ->
      if (event == "downloadRequest") packets.add(JSONObject(data))
    }, clock = { tick })
    run { engine.connection("download-test", "pc", 5) }
  }

  override fun tearDown() {
    try {
      run {
        val tasks = JSONArray(engine.snapshot())
        for (index in 0 until tasks.length()) engine.delete(tasks.getJSONObject(index).getString("id"))
      }
    } finally { engine.shutdown(); super.tearDown() }
  }

  private fun run(action: () -> Any?): Any? {
    val done = CompletableFuture<Any?>()
    engine.submit(action, { done.complete(it) }, { done.completeExceptionally(it) })
    return done.get(10, TimeUnit.SECONDS)
  }

  private fun snapshot(): JSONObject = JSONObject(run {
    val tasks = JSONArray(engine.snapshot())
    (0 until tasks.length()).map { tasks.getJSONObject(it) }.first { it.getString("id") == taskId }.toString()
  } as String)

  private fun requests(operation: String = "read"): List<JSONObject> {
    val result = mutableListOf<JSONObject>()
    run { result.addAll(packets.filter { it.optString("operation") == operation }) }
    return result
  }

  private fun open(size: Long, revision: String = "first") {
    if (taskId.isEmpty()) taskId = run { engine.enqueue(source) } as String
    val packet = requests("open").last()
    val info = JSONObject().put("id", UUID.randomUUID().toString()).put("size", size)
      .put("name", "test.bin").put("mimeType", "application/octet-stream").put("revision", revision)
    assertEquals(true, run { engine.accept(packet.getString("requestId"), info.toString(), false) })
  }

  private fun bytes(offset: Long, length: Int) = ByteArray(length) { ((offset + it) % 251).toByte() }

  private fun accept(packet: JSONObject, corrupt: Boolean = false): Boolean {
    val offset = packet.getLong("offset")
    val data = Base64.encodeToString(bytes(offset, packet.getInt("length")), Base64.NO_WRAP)
    val chunk = JSONObject().put("offset", if (corrupt) offset + 1 else offset).put("data", data)
    return run { engine.accept(packet.getString("requestId"), chunk.toString(), false) } as Boolean
  }

  fun testSlidesBeforeOtherResponsesArriveAndBoundsReorderedReplies() {
    open(CHUNK_BYTES * 12L)
    assertEquals(5, requests().size)
    accept(requests()[0])
    assertEquals(6, requests().size)
    assertEquals(CHUNK_BYTES.toLong(), snapshot().getLong("received"))
    for (index in listOf(5, 4, 3, 2)) accept(requests()[index])
    assertEquals(6, requests().size)
    assertEquals(CHUNK_BYTES.toLong(), snapshot().getLong("received"))
    accept(requests()[1])
    assertEquals(11, requests().size)
    assertEquals(CHUNK_BYTES * 6L, snapshot().getLong("received"))
    val task = DownloadTask(snapshot())
    assertTrue(bytes(0, CHUNK_BYTES * 6).contentEquals(storage.part(task).readBytes()))
  }

  fun testShrinksAndGrowsAnActiveWindowWithoutRestarting() {
    open(CHUNK_BYTES * 12L)
    run { engine.connection("download-test", "pc", 1) }
    for (index in 0..3) accept(requests()[index])
    assertEquals(5, requests().size)
    accept(requests()[4])
    assertEquals(6, requests().size)
    run { engine.connection("download-test", "pc", 5) }
    assertEquals(10, requests().size)
  }

  fun testPausePersistsOnlyWrittenBytesAndDiscardsLateReplies() {
    open(CHUNK_BYTES * 12L)
    accept(requests()[0]); accept(requests()[2])
    val late = requests()[1]
    run { engine.pause(taskId) }
    assertFalse(accept(late))
    val saved = storage.load().getValue(taskId)
    assertEquals(CHUNK_BYTES.toLong(), saved.received)
    assertEquals("paused", saved.status)
    run { engine.resume(taskId) }
    open(CHUNK_BYTES * 12L)
    assertEquals(CHUNK_BYTES.toLong(), requests().takeLast(5).first().getLong("offset"))
  }

  fun testCheckpointsAreBatchedAndResumeTruncatesUncheckpointedTail() {
    open(CHUNK_BYTES * 12L)
    accept(requests()[0])
    val saved = storage.load().getValue(taskId)
    // A fast first block is visible in memory, while the checkpoint still precedes it.
    assertEquals(0L, saved.received)
    assertEquals(CHUNK_BYTES.toLong(), storage.part(saved).length())
    storage.prepare(saved)
    assertEquals(0L, storage.part(saved).length())
  }

  fun testCorruptReplyFailsAndClearsAllInFlightRequests() {
    open(CHUNK_BYTES * 8L)
    accept(requests()[2], corrupt = true)
    assertEquals("failed", snapshot().getString("status"))
    assertEquals(0L, snapshot().getLong("received"))
    assertFalse(accept(requests()[0]))
    assertEquals(1, requests("close").size)
  }

  fun testPeriodicCheckpointFlushesProgressAndDisconnectFlushesTheTail() {
    open(CHUNK_BYTES * 12L)
    accept(requests()[0])
    tick += CHECKPOINT_INTERVAL_MS
    accept(requests()[1])
    assertEquals(CHUNK_BYTES * 2L, storage.load().getValue(taskId).received)
    accept(requests()[2])
    run { engine.connection("download-test", "pc", 0) }
    assertEquals("paused", snapshot().getString("status"))
    assertEquals(CHUNK_BYTES * 3L, storage.load().getValue(taskId).received)
  }

  fun testRevisionChangeRestartsAtZero() {
    open(CHUNK_BYTES * 8L)
    accept(requests()[0])
    run { engine.pause(taskId); engine.resume(taskId) }
    open(CHUNK_BYTES * 8L, "second")
    assertEquals(0L, requests().takeLast(5).first().getLong("offset"))
    assertEquals(0L, snapshot().getLong("received"))
  }

  fun testPublishesExactHashWithReorderedChunksAndPartialFinalBlock() {
    val size = CHUNK_BYTES * 5 + 17
    open(size.toLong())
    for (index in listOf(4, 3, 2, 1, 0)) accept(requests()[index])
    accept(requests()[5])
    val completed = snapshot()
    assertEquals("completed", completed.getString("status"))
    val uri = Uri.parse(completed.getString("uri"))
    val actual = instrumentation.targetContext.contentResolver.openInputStream(uri)!!.use { it.readBytes() }
    val hash = MessageDigest.getInstance("SHA-256")
    assertTrue(hash.digest(bytes(0, size)).contentEquals(hash.digest(actual)))
  }

  fun testEmptyFileCompletesWithoutReads() {
    open(0)
    assertEquals("completed", snapshot().getString("status"))
    assertTrue(requests().isEmpty())
  }
}
