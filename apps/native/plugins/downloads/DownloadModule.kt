package com.codexswitch.downloads

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

class DownloadModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val engine = DownloadEngine(DownloadStorage(context), { event, data ->
    if (context.hasActiveReactInstance()) {
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, data)
    }
  })
  override fun getName() = "FileDownloads"
  override fun getConstants(): Map<String, Any> = mapOf("bulkBinaryAvailable" to
    runCatching { javax.crypto.Cipher.getInstance(com.codexswitch.crypto.PacketCipher.TRANSFORMATION) }.isSuccess)

  private fun run(promise: Promise, action: () -> Any?) {
    engine.submit(action, { promise.resolve(it) }, {
      promise.reject("DOWNLOAD_FAILED", "暂时无法完成操作，请检查连接和存储空间后重试。")
    })
  }

  @ReactMethod fun list(promise: Promise) = run(promise) { engine.snapshot() }
  @ReactMethod fun enqueue(source: String, promise: Promise) = run(promise) { engine.enqueue(JSONObject(source)) }
  @ReactMethod fun pause(id: String, promise: Promise) = run(promise) { engine.pause(id); null }
  @ReactMethod fun resume(id: String, promise: Promise) = run(promise) { engine.resume(id); null }
  @ReactMethod fun delete(id: String, promise: Promise) = run(promise) { engine.delete(id); null }
  @ReactMethod fun connection(owner: String, deviceId: String, window: Int, promise: Promise) =
    run(promise) { engine.connection(owner, deviceId, window); null }
  @ReactMethod fun accept(requestId: String, result: String?, failed: Boolean, promise: Promise) =
    run(promise) { engine.accept(requestId, result, failed) }
  @ReactMethod fun manifestPage(id: String, page: String, promise: Promise) =
    run(promise) { engine.manifestPage(id, page); null }
  @ReactMethod fun invalidateBulk(owner: String, deviceId: String, promise: Promise) =
    run(promise) { engine.invalidateBulk(owner, deviceId); null }
  @ReactMethod fun failBulk(id: String, epoch: String, code: String, promise: Promise) =
    run(promise) { engine.failBulk(id, epoch, code); null }

  override fun invalidate() { engine.shutdown(); super.invalidate() }
}
