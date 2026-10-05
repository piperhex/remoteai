package com.codexswitch.downloads

internal class BulkDownloadFailure(val code: String) : IllegalStateException(code)

internal fun bulkFailureMessage(code: String) = when (code) {
  "INVALID_RECORD" -> "下载数据无效，请重新连接后重试。"
  "INVALID_MANIFEST" -> "无法确认文件内容，请重新下载。"
  "SOURCE_CHANGED" -> "源文件已更新，请重新下载。"
  "STORAGE_FAILED" -> "无法保存文件，请检查可用空间和保存权限。"
  "PATH_UNAVAILABLE" -> "下载连接已中断，请重新连接后继续。"
  "EPOCH_EXPIRED" -> "下载连接已切换，请继续下载。"
  "CANCELLED" -> "下载已暂停。"
  "REPLAY", "CREDIT_EXCEEDED" -> "下载连接验证失败，请重新连接。"
  "RESOURCE_LIMIT" -> "下载任务较多，请稍后重试。"
  else -> "文件校验失败，请重试。"
}
