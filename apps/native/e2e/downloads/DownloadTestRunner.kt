// Use the built-in runner in an isolated package, without starting React Native or a Metro connection.
@file:Suppress("DEPRECATION")

package com.codexswitch.downloads

import android.app.Application
import android.content.Context
import android.test.InstrumentationTestRunner

class DownloadTestRunner : InstrumentationTestRunner() {
  override fun newApplication(loader: ClassLoader, className: String, context: Context): Application =
    super.newApplication(loader, Application::class.java.name, context)
}
