package com.codexswitch.systembars

import android.os.Build
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/** A window-scoped owner: nested dialogs never change each other's system-bar icons. */
class ModalSystemBarsView(context: ThemedReactContext) : View(context) {
  var darkIcons = false
    set(value) {
      field = value
      applyAppearance()
    }
  private val updateAppearance = Runnable { applyAppearance() }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    // RN copies the Activity appearance after Dialog.show(); apply after that synchronous copy.
    post(updateAppearance)
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (hasWindowFocus) post(updateAppearance)
  }

  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    applyAppearance()
    return super.onApplyWindowInsets(insets)
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(updateAppearance)
    super.onDetachedFromWindow()
  }

  private fun applyAppearance() {
    if (!isAttachedToWindow) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val controller = windowInsetsController ?: return
      val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
      val appearance = if (darkIcons) mask else 0
      if (controller.systemBarsAppearance and mask != appearance) {
        controller.setSystemBarsAppearance(appearance, mask)
      }
    } else {
      applyLegacyAppearance()
    }
  }

  @Suppress("DEPRECATION") // Android 7–10 expose status-bar appearance through the decor view flags.
  private fun applyLegacyAppearance() {
    val flag = SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else 0)
    val flags = rootView.systemUiVisibility
    val updated = if (darkIcons) flags or flag else flags and flag.inv()
    if (flags != updated) rootView.systemUiVisibility = updated
  }
}

class ModalSystemBarsManager : SimpleViewManager<ModalSystemBarsView>() {
  override fun getName() = "ModalSystemBars"
  override fun createViewInstance(context: ThemedReactContext) = ModalSystemBarsView(context)

  @ReactProp(name = "darkIcons")
  fun setDarkIcons(view: ModalSystemBarsView, darkIcons: Boolean) {
    view.darkIcons = darkIcons
  }
}
