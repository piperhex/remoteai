package com.codexswitch.selection

import android.view.InputDevice
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.TextView

private const val MIN_LONG_PRESS_MS = 500L

/** Keep taps and scroll gestures out of Android Editor's double-tap selection detector. */
internal class ChatSelectionTouch(
  private val view: TextView,
  private val dispatch: (MotionEvent) -> Boolean,
) {
  private val touchSlop = ViewConfiguration.get(view.context).scaledTouchSlop
  private val longPressDelay = maxOf(MIN_LONG_PRESS_MS, ViewConfiguration.getLongPressTimeout().toLong())
  private var pending: MotionEvent? = null
  private var waiting = false
  private var selecting = false
  private val beginSelection = Runnable {
    val down = pending ?: return@Runnable
    pending = null
    if (view.isAttachedToWindow && view.isEnabled && view.isTextSelectable) {
      selecting = true
      dispatch(down)
      // The delayed down also schedules View's own long press; only run it once.
      view.cancelLongPress()
      view.performLongClick(down.x, down.y)
    }
    down.recycle()
  }

  fun onTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) beginTouch(event)
    if (!waiting) return dispatch(event)
    if (event.actionMasked == MotionEvent.ACTION_MOVE && moved(event)) cancelPending()
    if (event.actionMasked == MotionEvent.ACTION_POINTER_DOWN) cancelPending()
    val forward = selecting
    if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) cancel()
    return if (forward) dispatch(event) else true
  }

  private fun beginTouch(event: MotionEvent) {
    cancel()
    waiting = view.isTextSelectable && !view.hasSelection() && !event.isFromSource(InputDevice.SOURCE_MOUSE)
    if (!waiting) return
    pending = MotionEvent.obtain(event)
    view.postDelayed(beginSelection, longPressDelay)
  }

  private fun moved(event: MotionEvent): Boolean {
    val down = pending ?: return false
    return kotlin.math.hypot(event.x - down.x, event.y - down.y) > touchSlop
  }

  private fun cancelPending() {
    view.removeCallbacks(beginSelection)
    pending?.recycle()
    pending = null
  }

  fun cancel() {
    cancelPending()
    selecting = false
    waiting = false
  }
}
