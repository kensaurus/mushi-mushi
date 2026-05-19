package dev.mushimushi.sdk.capture

import android.view.ActionMode
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.SearchEvent
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent

/**
 * Decorator that forwards every [Window.Callback] method to the host's
 * existing callback while also notifying [onTouch] for `dispatchTouchEvent`.
 *
 * Replacing `Window.callback` with this wrapper lets us observe touches
 * without consuming them or interfering with the host's `OnTouchListener`
 * chain on individual views — a much safer surface than calling
 * `setOnTouchListener` on `decorView`.
 */
internal class TouchObservingWindowCallback(
    private val host: Window.Callback?,
    private val onTouch: (MotionEvent) -> Unit,
) : Window.Callback {

    override fun dispatchKeyEvent(event: KeyEvent?): Boolean =
        host?.dispatchKeyEvent(event) ?: false

    override fun dispatchKeyShortcutEvent(event: KeyEvent?): Boolean =
        host?.dispatchKeyShortcutEvent(event) ?: false

    override fun dispatchTouchEvent(event: MotionEvent?): Boolean {
        if (event != null) runCatching { onTouch(event) }
        return host?.dispatchTouchEvent(event) ?: false
    }

    override fun dispatchTrackballEvent(event: MotionEvent?): Boolean =
        host?.dispatchTrackballEvent(event) ?: false

    override fun dispatchGenericMotionEvent(event: MotionEvent?): Boolean =
        host?.dispatchGenericMotionEvent(event) ?: false

    override fun dispatchPopulateAccessibilityEvent(event: AccessibilityEvent?): Boolean =
        host?.dispatchPopulateAccessibilityEvent(event) ?: false

    override fun onCreatePanelView(featureId: Int): View? =
        host?.onCreatePanelView(featureId)

    override fun onCreatePanelMenu(featureId: Int, menu: Menu): Boolean =
        host?.onCreatePanelMenu(featureId, menu) ?: false

    override fun onPreparePanel(featureId: Int, view: View?, menu: Menu): Boolean =
        host?.onPreparePanel(featureId, view, menu) ?: false

    override fun onMenuOpened(featureId: Int, menu: Menu): Boolean =
        host?.onMenuOpened(featureId, menu) ?: false

    override fun onMenuItemSelected(featureId: Int, item: MenuItem): Boolean =
        host?.onMenuItemSelected(featureId, item) ?: false

    override fun onWindowAttributesChanged(attrs: WindowManager.LayoutParams?) {
        host?.onWindowAttributesChanged(attrs)
    }

    override fun onContentChanged() {
        host?.onContentChanged()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        host?.onWindowFocusChanged(hasFocus)
    }

    override fun onAttachedToWindow() {
        host?.onAttachedToWindow()
    }

    override fun onDetachedFromWindow() {
        host?.onDetachedFromWindow()
    }

    override fun onPanelClosed(featureId: Int, menu: Menu) {
        host?.onPanelClosed(featureId, menu)
    }

    override fun onSearchRequested(): Boolean = host?.onSearchRequested() ?: false

    override fun onSearchRequested(searchEvent: SearchEvent?): Boolean =
        host?.onSearchRequested(searchEvent) ?: false

    override fun onWindowStartingActionMode(callback: ActionMode.Callback?): ActionMode? =
        host?.onWindowStartingActionMode(callback)

    override fun onWindowStartingActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? =
        host?.onWindowStartingActionMode(callback, type)

    override fun onActionModeStarted(mode: ActionMode?) {
        host?.onActionModeStarted(mode)
    }

    override fun onActionModeFinished(mode: ActionMode?) {
        host?.onActionModeFinished(mode)
    }
}
