package com.codexswitch.downloads

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.*
import okio.ByteString
import org.json.JSONObject
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Signalling remains JSON; authenticated binary file records are delivered directly to the native engine. */
class DownloadSocketModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private class Slot { @Volatile var socket: WebSocket? = null; @Volatile var closed = false }
  private val client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
  private val sockets = ConcurrentHashMap<String, Slot>()
  override fun getName() = "DownloadChatSocket"

  private fun event(id: String, type: String, data: String = "", code: Int = 0) {
    if (!context.hasActiveReactInstance()) return
    val value = Arguments.createMap().apply {
      putString("id", id); putString("type", type); putString("data", data); putInt("code", code)
    }
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("downloadSocket", value)
  }

  @ReactMethod fun open(id: String, url: String, promise: Promise) {
    var reserved: Slot? = null
    try {
      UUID.fromString(id)
      val request = Request.Builder().url(url).build()
      require(request.url.encodedPath.endsWith("/device-chat") && request.url.query == null)
      val slot = Slot()
      synchronized(sockets) { require(sockets.size < 16 && sockets.putIfAbsent(id, slot) == null) }
      reserved = slot
      val socket = client.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          if (slot.closed) { webSocket.cancel(); return }
          slot.socket = webSocket; event(id, "open")
        }
        override fun onMessage(webSocket: WebSocket, text: String) {
          if (text.length > 65_536) { webSocket.cancel(); return }
          event(id, "message", text)
        }
        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
          try { binary(id, bytes) } catch (error: Exception) { webSocket.cancel() }
        }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          slot.closed = true; sockets.remove(id, slot); event(id, "close", code = code)
        }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
        override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
          slot.closed = true; sockets.remove(id, slot); event(id, "close", code = 1006)
        }
      })
      slot.socket = socket
      if (slot.closed) socket.cancel()
      promise.resolve(null)
    } catch (error: Exception) {
      reserved?.let { it.closed = true; sockets.remove(id, it); it.socket?.cancel() }
      promise.reject("SOCKET_OPEN", "无法连接电脑，请重试。")
    }
  }

  private fun binary(id: String, value: ByteString) {
    require(value.size in 6..20_133)
    val bytes = value.toByteArray(); val length = bytes[4].toInt() and 255
    require(length in 1..128 && 5 + length < bytes.size)
    val session = String(bytes, 5, length, Charsets.US_ASCII)
    require(session.matches(Regex("[a-zA-Z0-9_-]+")))
    val magic = String(bytes, 0, 4, Charsets.US_ASCII)
    if (magic == "CSF1") {
      require(bytes.size - 5 - length <= 16_384)
      DownloadBulkRouter.receiveRelay(ByteBuffer.wrap(bytes, 5 + length, bytes.size - 5 - length)); return
    }
    require(magic == "CSB1")
    event(id, "message", JSONObject().put("type", "relay").put("sessionId", session)
      .put("payload", hex(bytes.copyOfRange(5 + length, bytes.size))).toString())
  }

  @ReactMethod fun send(id: String, text: String, promise: Promise) {
    try {
      require(text.length <= 65_536)
      val slot = requireNotNull(sockets[id]); check(!slot.closed)
      val socket = requireNotNull(slot.socket)
      require(socket.queueSize() + text.length <= 512 * 1024)
      check(socket.send(text)); promise.resolve(null)
    } catch (error: Exception) { promise.reject("SOCKET_SEND", "连接已中断，请重新连接。") }
  }
  @ReactMethod fun close(id: String) {
    sockets.remove(id)?.let { it.closed = true; it.socket?.close(1000, "Closed") }
  }
  override fun invalidate() {
    sockets.values.forEach { it.closed = true; it.socket?.cancel() }; sockets.clear()
    client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
    super.invalidate()
  }
}
