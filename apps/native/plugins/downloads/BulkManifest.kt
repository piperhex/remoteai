package com.codexswitch.downloads

import org.json.JSONObject
import java.nio.ByteBuffer
import java.security.MessageDigest

internal const val BULK_BLOCK_BYTES = 1024 * 1024
internal const val BULK_PAGE_BLOCKS = 256
internal const val BULK_MAX_BLOCKS = 65_536
internal fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)
internal fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }

internal class BulkManifest(val data: JSONObject) {
  val id = data.getString("manifestId")
  val size = data.getLong("size")
  val count = data.getInt("blockCount")
  val hash = data.getString("fileHash")
  init {
    require(data.getInt("version") == 1 && data.getString("algorithm") == "sha256")
    require(data.getInt("blockSize") == BULK_BLOCK_BYTES)
    require(size >= 0 && count in 0..BULK_MAX_BLOCKS && count.toLong() == (size + BULK_BLOCK_BYTES - 1) / BULK_BLOCK_BYTES)
    require(id.matches(Regex("[a-f0-9]{64}")) && hash.matches(Regex("[a-f0-9]{64}")))
  }
  fun length(block: Int): Int {
    require(block in 0 until count)
    return minOf(BULK_BLOCK_BYTES.toLong(), size - block.toLong() * BULK_BLOCK_BYTES).toInt()
  }
  fun authenticate(read: (Int) -> JSONObject) {
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update("remote-ai:file-manifest:v1:sha256\u0000".toByteArray(Charsets.UTF_8))
    digest.update(ByteBuffer.allocate(16).putLong(size).putInt(BULK_BLOCK_BYTES).putInt(count).array())
    for (index in 0 until (count + BULK_PAGE_BLOCKS - 1) / BULK_PAGE_BLOCKS) {
      val page = read(index); validate(page, index)
      val hashes = page.getJSONArray("hashes")
      for (block in 0 until hashes.length()) digest.update(com.codexswitch.crypto.PacketCipher.fromHex(hashes.getString(block)))
    }
    digest.update(com.codexswitch.crypto.PacketCipher.fromHex(hash))
    check(hex(digest.digest()) == id)
  }
  fun validate(page: JSONObject, index: Int) {
    require(index >= 0 && page.getString("manifestId") == id && page.getInt("page") == index)
    require(page.getInt("totalPages") == (count + BULK_PAGE_BLOCKS - 1) / BULK_PAGE_BLOCKS)
    val hashes = page.getJSONArray("hashes")
    require(hashes.length() == minOf(BULK_PAGE_BLOCKS, count - index * BULK_PAGE_BLOCKS))
    for (block in 0 until hashes.length()) require(hashes.getString(block).matches(Regex("[a-f0-9]{64}")))
  }
}
