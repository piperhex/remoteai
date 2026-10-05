package com.codexswitch.downloads

import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean

/** Invoked directly by the WebRTC observer or native relay socket; bulk never becomes a JS string. */
@androidx.annotation.Keep
object DownloadBulkRouter {
  internal data class Scope(val id: String, val epoch: String, val path: String)
  private data class Route(val epoch: UUID, val path: String,
    val accept: (ByteArray, () -> Unit) -> Unit, val failed: () -> Unit)
  private val routes = ConcurrentHashMap<UUID, Route>()
  private val queued = AtomicInteger(0)
  private const val MAX_QUEUED_BYTES = 4 * 1024 * 1024

  internal fun register(scope: Scope, accept: (ByteArray, () -> Unit) -> Unit, failed: () -> Unit) {
    require(routes.size < MAX_ACTIVE)
    require(scope.path in listOf("direct", "relay"))
    check(routes.putIfAbsent(UUID.fromString(scope.id), Route(UUID.fromString(scope.epoch), scope.path, accept, failed)) == null)
  }
  internal fun remove(id: String) { routes.remove(UUID.fromString(id)) }

  @JvmStatic
  fun receive(input: ByteBuffer): Boolean = receiveOnPath(input, "direct")
  internal fun receiveRelay(input: ByteBuffer) = receiveOnPath(input, "relay")
  private fun receiveOnPath(input: ByteBuffer, path: String): Boolean {
    val buffer = input.duplicate()
    if (buffer.remaining() < 4 || buffer.int != 0x52414231) return false
    if (input.remaining() !in 89..16384) return true
    buffer.position(input.position() + 8)
    val route = routes[UUID(buffer.long, buffer.long)] ?: return true
    if (route.path != path) return true
    if (UUID(buffer.long, buffer.long) != route.epoch) return true
    val length = input.remaining()
    if (queued.addAndGet(length) > MAX_QUEUED_BYTES) {
      queued.addAndGet(-length); route.failed(); return true
    }
    val bytes = ByteArray(length); input.duplicate().get(bytes)
    val released = AtomicBoolean(false)
    val release = { if (released.compareAndSet(false, true)) queued.addAndGet(-length); Unit }
    try { route.accept(bytes, release) }
    catch (error: Exception) { release(); route.failed() }
    return true
  }
}
