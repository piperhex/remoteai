package com.codexswitch.update

import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Environment
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.UUID

internal const val MAX_UPDATE_BYTES = 512L * 1024 * 1024

internal class UpdateFiles(private val context: Context) {
  private val root get() = File(checkNotNull(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)), "updates")

  fun createPath(version: String): String {
    require(version.length <= 80 && version.matches(Regex("[0-9A-Za-z.-]+")))
    check(root.mkdirs() || root.isDirectory)
    root.listFiles()?.filter { it.isFile && it.name.startsWith("CodexSwitch-update-") && it.extension == "apk" }
      ?.sortedByDescending { it.lastModified() }?.drop(1)?.forEach { check(it.delete()) }
    return File(root, "CodexSwitch-update-$version-${UUID.randomUUID()}.apk").absolutePath
  }

  fun target(path: String): File {
    val file = File(path)
    require(file.canonicalFile.parentFile == root.canonicalFile
      && file.name.startsWith("CodexSwitch-update-") && file.extension == "apk")
    return file
  }

  fun wifiAvailable(): Boolean {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
    return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
      && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
      && !manager.isActiveNetworkMetered
  }

  fun wifiRoute(route: JSONObject): Boolean {
    if (!wifiAvailable()) return false
    val host = route.optJSONObject("localEndpoint")?.optString("host") ?: return false
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val addresses = manager.getLinkProperties(manager.activeNetwork)?.linkAddresses ?: return false
    val endpoint = java.net.InetAddress.getByName(host.substringBefore('%')).address
    return addresses.any { it.address.address.contentEquals(endpoint) }
  }

  fun artifact(input: JSONObject): String {
    val digest = input.getString("sha256")
    val url = input.getString("url")
    require(digest.matches(Regex("[0-9a-f]{64}")) && officialUrl(url))
    require(input.getLong("size") in 1..MAX_UPDATE_BYTES)
    val hash = MessageDigest.getInstance("SHA-256")
    for (value in listOf("sha256:$digest", input.getString("version"), "android", url)) {
      val bytes = value.toByteArray(Charsets.UTF_8)
      hash.update(ByteBuffer.allocate(8).putLong(bytes.size.toLong()).array())
      hash.update(bytes)
    }
    return hex(hash.digest())
  }

  fun verify(input: JSONObject): Boolean {
    val file = File(input.getString("path"))
    // Recovery supports old DownloadManager destinations, but new writes use the private directory.
    require(file.isAbsolute && file.name.startsWith("CodexSwitch-update-") && file.extension == "apk")
    if (!file.isFile || file.length() <= 0) return false
    val size = input.optLong("size")
    if (size > 0 && file.length() != size) return false
    val expected = input.optString("sha256")
    if (expected.isNotEmpty()) {
      if (!expected.matches(Regex("[0-9a-f]{64}"))) return false
      val hash = MessageDigest.getInstance("SHA-256")
      file.inputStream().buffered().use { stream ->
        val buffer = ByteArray(64 * 1024)
        var length = stream.read(buffer)
        while (length >= 0) { hash.update(buffer, 0, length); length = stream.read(buffer) }
      }
      if (hex(hash.digest()) != expected) return false
    }
    return signedByInstalledApp(file)
  }

  @Suppress("DEPRECATION") // API 24–27 use the original signature API.
  private fun signedByInstalledApp(file: File): Boolean {
    val manager = context.packageManager
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES
      else PackageManager.GET_SIGNATURES
    val candidate = manager.getPackageArchiveInfo(file.path, flags) ?: return false
    val installed = manager.getPackageInfo(context.packageName, flags)
    if (candidate.packageName != context.packageName) return false
    val candidateVersion = if (Build.VERSION.SDK_INT >= 28) candidate.longVersionCode else candidate.versionCode.toLong()
    val installedVersion = if (Build.VERSION.SDK_INT >= 28) installed.longVersionCode else installed.versionCode.toLong()
    if (candidateVersion <= installedVersion) return false
    val offered = if (Build.VERSION.SDK_INT >= 28) candidate.signingInfo?.apkContentsSigners else candidate.signatures
    val trusted = if (Build.VERSION.SDK_INT >= 28) installed.signingInfo?.apkContentsSigners else installed.signatures
    return !offered.isNullOrEmpty() && !trusted.isNullOrEmpty() && offered.toSet() == trusted.toSet()
  }
}

internal fun officialUrl(value: String): Boolean = try {
  val uri = URI(value)
  uri.scheme == "https" && uri.host == "github.com" && uri.port == -1 && uri.userInfo == null
    && uri.query == null && uri.fragment == null
    && uri.path.startsWith("/piperhex/remoteai/releases/download/") && uri.path.endsWith(".apk")
} catch (_: Exception) { false }

internal fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
