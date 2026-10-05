package com.codexswitch.downloads

import com.codexswitch.crypto.PacketCipher
import java.nio.ByteBuffer
import java.util.UUID

internal data class BulkFragment(val requestId: String, val block: Int, val offset: Int, val bytes: ByteArray)

internal class BulkRecordCipher(key: String, private val transfer: UUID, private val epoch: UUID) {
  private val cipher = PacketCipher(PacketCipher.fromHex(key), byteArrayOf())
  private var sequence = 0L
  fun decrypt(record: ByteArray): BulkFragment {
    require(record.size in 89..16384)
    val buffer = ByteBuffer.wrap(record)
    require(buffer.int == 0x52414231 && buffer.get().toInt() == 1 && buffer.get().toInt() == 1)
    require(buffer.short.toInt() == 72)
    require(UUID(buffer.long, buffer.long) == transfer && UUID(buffer.long, buffer.long) == epoch)
    val request = UUID(buffer.long, buffer.long).toString()
    val block = buffer.int; val offset = buffer.int; val length = buffer.int
    val next = buffer.int.toLong() and 0xffffffffL
    require(next > sequence && block >= 0 && offset >= 0 && length > 0 && offset.toLong() + length <= BULK_BLOCK_BYTES)
    require(record.size == length + 88)
    val nonce = ByteBuffer.allocate(12).putLong(0).putInt(next.toInt()).array()
    val plain = cipher.decryptBytes(record.copyOfRange(72, record.size), nonce, record.copyOfRange(0, 72))
    sequence = next
    return BulkFragment(request, block, offset, plain)
  }
  fun close() { cipher.destroy() }
}
