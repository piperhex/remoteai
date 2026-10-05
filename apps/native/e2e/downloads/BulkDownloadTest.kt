@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package com.codexswitch.downloads

import android.test.InstrumentationTestCase
import org.json.JSONArray
import org.json.JSONObject
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Real native record decoding, flow control, block verification and crash recovery. */
class BulkDownloadTest : InstrumentationTestCase() {
  private lateinit var storage: DownloadStorage
  private lateinit var blocks: BulkDownloadStorage
  private lateinit var bulk: BulkDownloads
  private val tasks = mutableListOf<DownloadTask>()
  private val requests = mutableListOf<JSONObject>()
  private val key = ByteArray(32) { it.toByte() }
  private val epoch = UUID.randomUUID()
  private var sequence = 0
  private var completed = 0
  private var failed = 0
  private var failureCode = ""

  override fun setUp() {
    super.setUp()
    storage = DownloadStorage(instrumentation.targetContext)
    blocks = BulkDownloadStorage(storage)
    bulk = BulkDownloads(blocks, BulkCallbacks(
      execute = { it() }, request = { if (it.optString("operation") == "bulkRead") requests.add(it) },
      progress = { _, _ -> storage.save(tasks) },
      completed = { completed++; bulk.close(it) }, failed = { _, code -> failed++; failureCode = code },
    ))
  }

  override fun tearDown() {
    tasks.forEach { bulk.close(it); storage.delete(it) }
    super.tearDown()
  }

  private fun content(length: Int) = ByteArray(length) { (it % 251).toByte() }
  private fun open(bytes: ByteArray): DownloadTask {
    val task = DownloadTask.create(JSONObject().put("owner", "test").put("deviceId", "pc")
      .put("scope", "computer").put("path", "native-bulk.bin"))
    task.data.put("size", bytes.size).put("mimeType", "application/octet-stream")
    task.status = "downloading"; tasks.add(task)
    val manifest = manifest(bytes)
    for (page in 0 until (manifest.count + BULK_PAGE_BLOCKS - 1) / BULK_PAGE_BLOCKS) {
      val hashes = JSONArray()
      for (block in page * BULK_PAGE_BLOCKS until minOf((page + 1) * BULK_PAGE_BLOCKS, manifest.count)) {
        hashes.put(hex(sha256(bytes.copyOfRange(block * BULK_BLOCK_BYTES,
          block * BULK_BLOCK_BYTES + manifest.length(block)))))
      }
      blocks.storePage(task, JSONObject().put("manifestId", manifest.id).put("page", page)
        .put("totalPages", (manifest.count + BULK_PAGE_BLOCKS - 1) / BULK_PAGE_BLOCKS)
        .put("hashes", hashes).toString())
    }
    bulk.open(task, JSONObject().put("epoch", epoch.toString()).put("key", hex(key)).put("path", "direct")
      .put("manifest", manifest.data).put("capability", JSONObject().put("recordBytes", 16384)))
    return task
  }

  private fun manifest(bytes: ByteArray): BulkManifest {
    val count = (bytes.size + BULK_BLOCK_BYTES - 1) / BULK_BLOCK_BYTES
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update("remote-ai:file-manifest:v1:sha256\u0000".toByteArray())
    digest.update(ByteBuffer.allocate(16).putLong(bytes.size.toLong()).putInt(BULK_BLOCK_BYTES).putInt(count).array())
    for (block in 0 until count) digest.update(sha256(bytes.copyOfRange(block * BULK_BLOCK_BYTES,
      minOf((block + 1) * BULK_BLOCK_BYTES, bytes.size))))
    digest.update(sha256(bytes))
    return BulkManifest(JSONObject().put("version", 1).put("algorithm", "sha256")
      .put("manifestId", hex(digest.digest())).put("fileHash", hex(sha256(bytes)))
      .put("size", bytes.size).put("blockSize", BULK_BLOCK_BYTES).put("blockCount", count))
  }

  private fun record(request: JSONObject, offset: Int, bytes: ByteArray, recordEpoch: UUID = epoch): ByteArray {
    val header = ByteBuffer.allocate(72).putInt(0x52414231).put(1).put(1).putShort(72)
    for (id in listOf(UUID.fromString(request.getString("taskId")), recordEpoch,
      UUID.fromString(request.getString("requestId")))) header.putLong(id.mostSignificantBits).putLong(id.leastSignificantBits)
    header.putInt(request.getInt("block")).putInt(offset).putInt(bytes.size).putInt(++sequence)
    val cipher = Cipher.getInstance(com.codexswitch.crypto.PacketCipher.TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "ChaCha20"),
      IvParameterSpec(ByteBuffer.allocate(12).putLong(0).putInt(sequence).array()))
    cipher.updateAAD(header.array())
    return header.array() + cipher.doFinal(bytes)
  }

  private fun send(request: JSONObject, bytes: ByteArray, corruptHash: Boolean = false) {
    val start = request.getInt("block") * BULK_BLOCK_BYTES
    val block = bytes.copyOfRange(start, minOf(start + BULK_BLOCK_BYTES, bytes.size))
    if (corruptHash) block[0] = (block[0].toInt() xor 1).toByte()
    var offset = 0
    while (offset < block.size) {
      val length = minOf(16384 - 88, block.size - offset)
      assertTrue(DownloadBulkRouter.receive(ByteBuffer.wrap(record(request, offset, block.copyOfRange(offset, offset + length)))))
      offset += length
    }
  }

  fun testTwoFilesShareWindowAndPublishExactPartialBlockContent() {
    val bytes = content(2 * BULK_BLOCK_BYTES + 37)
    val first = open(bytes); val second = open(bytes)
    bulk.fill()
    assertEquals(2, requests.size)
    assertEquals(setOf(first.id, second.id), requests.map { it.getString("taskId") }.toSet())
    var index = 0
    while (index < requests.size) send(requests[index++], bytes)
    assertEquals(2, completed); assertEquals(0, failed)
    tasks.forEach { blocks.verifyComplete(it) {}; assertTrue(bytes.contentEquals(storage.part(it).readBytes())) }
  }

  fun testSustained32MiBDownloadVerifiesEveryBlockAndTheWholeFile() {
    val bytes = content(32 * BULK_BLOCK_BYTES + 17)
    val task = open(bytes); bulk.fill()
    var index = 0
    while (index < requests.size) send(requests[index++], bytes)
    assertEquals(1, completed); assertEquals(0, failed)
    assertEquals(bytes.size.toLong(), task.received)
    blocks.verifyComplete(task) {}
    assertTrue(sha256(bytes).contentEquals(sha256(storage.part(task).readBytes())))
  }

  fun testHashMismatchRetriesTwiceAndNeverCommitsBadBytes() {
    val bytes = content(31); val task = open(bytes); bulk.fill()
    repeat(3) { send(requests.last(), bytes, true) }
    assertEquals(3, requests.size); assertEquals(1, failed); assertEquals(0, completed)
    assertEquals(0L, task.received)
  }

  fun testAuthenticationFailureIsFatalAndOldEpochOrWrongPathIsIgnored() {
    val bytes = content(31); open(bytes); bulk.fill()
    val packet = requests.single()
    DownloadBulkRouter.receive(ByteBuffer.wrap(record(packet, 0, bytes, UUID.randomUUID())))
    DownloadBulkRouter.receiveRelay(ByteBuffer.wrap(record(packet, 0, bytes)))
    assertEquals(0, completed); assertEquals(0, failed)
    val invalid = record(packet, 0, bytes); invalid[invalid.lastIndex] = (invalid.last().toInt() xor 1).toByte()
    DownloadBulkRouter.receive(ByteBuffer.wrap(invalid))
    assertEquals(1, failed); assertEquals(0, completed)
  }

  fun testRestartRevalidatesOnlyRecordedBlocksAndDropsCorruptData() {
    val bytes = content(3 * BULK_BLOCK_BYTES); val task = open(bytes); bulk.fill()
    send(requests.first(), bytes); bulk.close(task)
    val recovered = storage.load().getValue(task.id)
    assertEquals(setOf(0), blocks.restore(recovered, manifest(bytes)))
    RandomAccessFile(storage.part(task), "rw").use { it.seek(100); it.write(255) }
    assertTrue(blocks.restore(recovered, manifest(bytes)).isEmpty())
    assertEquals(0L, recovered.received)
  }

  fun testChangedSourceInvalidatesTheOldCheckpointBeforeRestart() {
    val bytes = content(BULK_BLOCK_BYTES); val task = open(bytes); bulk.fill()
    send(requests.single(), bytes)
    val changed = bytes.copyOf(); changed[0] = 127
    val next = manifest(changed)
    blocks.storePage(task, JSONObject().put("manifestId", next.id).put("page", 0).put("totalPages", 1)
      .put("hashes", JSONArray().put(hex(sha256(changed)))).toString())
    try { blocks.restore(task, next); fail("accepted changed source") }
    catch (error: BulkDownloadFailure) { assertEquals("SOURCE_CHANGED", error.code) }
    assertEquals(0L, task.received)
    assertTrue(blocks.restore(task, next).isEmpty())
  }

  fun testRejectedBlockRequestClosesTheTransferAndReleasesItsRoute() {
    val task = open(content(31)); bulk.fill()
    assertTrue(bulk.acknowledged(requests.single().getString("requestId"), true, "PATH_UNAVAILABLE"))
    assertEquals(1, failed)
    assertEquals("PATH_UNAVAILABLE", failureCode)
    assertFalse(bulk.contains(task.id))
    assertFalse(bulk.acknowledged(requests.single().getString("requestId"), true))
  }

  fun testStorageFailureDoesNotClaimCorruptedNetworkData() {
    val task = open(content(31)); bulk.fill()
    assertTrue(storage.part(task).delete())
    assertTrue(storage.part(task).mkdir())
    send(requests.single(), content(31))
    assertEquals("STORAGE_FAILED", failureCode)
    assertEquals(0L, task.received)
    assertEquals(0, completed)
  }
}
