package com.codexswitch.selection

import android.graphics.Rect
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.text.ReactTextView
import com.facebook.react.views.text.ReactTextViewManager

/** Retain React Native's text layout and spans while forwarding the selection anchor Android's Editor ignores. */
class ChatTextViewManager : ReactTextViewManager() {
  override fun createViewInstance(context: ThemedReactContext): ReactTextView = ChatTextView(context)
}

private class ChatTextView(context: ThemedReactContext) : ReactTextView(context) {
  private val selectionTouch = ChatSelectionTouch(this) { super.onTouchEvent(it) }

  override fun onTouchEvent(event: MotionEvent): Boolean = selectionTouch.onTouchEvent(event)

  override fun onDetachedFromWindow() {
    selectionTouch.cancel()
    super.onDetachedFromWindow()
  }

  override fun startActionMode(callback: ActionMode.Callback, type: Int): ActionMode? {
    val selection = customSelectionActionModeCallback as? ChatSelectionMenu
    if (selection == null || type != ActionMode.TYPE_FLOATING) return super.startActionMode(callback, type)
    val anchored = object : ActionMode.Callback2() {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu) = callback.onCreateActionMode(mode, menu)
      override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = callback.onPrepareActionMode(mode, menu)
      override fun onActionItemClicked(mode: ActionMode, item: MenuItem) = callback.onActionItemClicked(mode, item)
      override fun onDestroyActionMode(mode: ActionMode) = callback.onDestroyActionMode(mode)
      override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
        if (callback is ActionMode.Callback2) callback.onGetContentRect(mode, view, outRect)
        else super.onGetContentRect(mode, view, outRect)
        selection.anchorContentRect(outRect)
      }
    }
    return super.startActionMode(anchored, type)
  }
}
