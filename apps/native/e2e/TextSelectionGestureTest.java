package dev.codexswitch.testing;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import com.android.uiautomator.core.UiDevice;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

/** Run against the separately installed TextSelectionFixture, with real touchscreen events. */
public final class TextSelectionGestureTest extends UiAutomatorTestCase {
    private UiAutomation automation;
    private static final String MESSAGE = "Long press this message";

    public void testTouchSelection() throws Exception {
        automation = automation();
        AccessibilityServiceInfo info = automation.getServiceInfo();
        info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        automation.setServiceInfo(info);
        assertNotNull("Selection fixture is open", awaitNode("文字选择验证"));
        tap("Blank space dismisses selection");
        Rect bounds = bounds(MESSAGE);
        int x = bounds.left + 160;
        int y = bounds.top + 30;
        for (int index = 0; index < 3; index++) {
            hold(x, y, 45);
            SystemClock.sleep(70);
        }
        assertUnselected("Quick repeated taps");
        hold(x, y, 250);
        assertUnselected("Short hold");
        hold(x, y, 750);
        assertNotNull("Long hold opens selection menu", awaitNode("引用"));
        AccessibilityNodeInfo selected = find(MESSAGE);
        assertTrue("Long hold selects characters", selected.getTextSelectionEnd() > selected.getTextSelectionStart());
        tap("全选");
        tap("引用");
        assertNotNull("Selected text can be quoted", awaitNode("Quotes: Long press this message"));
        hold(x, y, 750);
        assertNotNull("Selection can be opened again", awaitNode("复制"));
        tap("复制");
        assertUnselected("Copy closes selection");
        Rect link = bounds("Open inline link");
        hold(link.left + 80, link.centerY(), 45);
        assertNotNull("Inline link still handles a tap", awaitNode("Links opened: 1"));
        checkFormula();
        getUiDevice().swipe(x, y, x, y - 350, 35);
        SystemClock.sleep(250);
        assertUnselected("Scrolling does not select");
        Rect moved = bounds(MESSAGE);
        assertTrue("Message list scrolls", moved.top < bounds.top);
    }

    private void checkFormula() throws Exception {
        Rect bounds = bounds("Formula selection");
        int x = bounds.left + 100;
        int y = bounds.centerY();
        hold(x, y, 45);
        hold(x, y, 45);
        assertNull("Formula quick taps do not select", find("Copy"));
        hold(x, y, 850);
        assertNotNull("Formula long press keeps the native menu", awaitNode("Copy"));
        tap("Copy");
    }

    private void hold(int x, int y, long duration) {
        long down = SystemClock.uptimeMillis();
        inject(MotionEvent.ACTION_DOWN, down, x, y);
        SystemClock.sleep(duration);
        inject(MotionEvent.ACTION_UP, down, x, y);
        SystemClock.sleep(30);
    }

    private void inject(int action, long down, int x, int y) {
        MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0);
        event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        assertTrue("Touch event is delivered", automation.injectInputEvent(event, true));
        event.recycle();
    }

    private void assertUnselected(String reason) {
        SystemClock.sleep(250);
        AccessibilityNodeInfo node = find(MESSAGE);
        assertNotNull(reason + ": message exists", node);
        assertTrue(reason + ": no selected range", node.getTextSelectionEnd() <= node.getTextSelectionStart());
        assertNull(reason + ": no toolbar", find("引用"));
    }

    private void tap(String label) throws Exception {
        Rect bounds = bounds(label);
        hold(bounds.centerX(), bounds.centerY(), 45);
        SystemClock.sleep(150);
    }

    private Rect bounds(String label) throws Exception {
        AccessibilityNodeInfo node = awaitNode(label);
        assertNotNull("Visible text: " + label, node);
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        return bounds;
    }

    private AccessibilityNodeInfo awaitNode(String label) {
        for (int attempt = 0; attempt < 30; attempt++) {
            AccessibilityNodeInfo node = find(label);
            if (node != null) return node;
            SystemClock.sleep(100);
        }
        return null;
    }

    private AccessibilityNodeInfo find(String label) {
        for (AccessibilityWindowInfo window : automation.getWindows()) {
            AccessibilityNodeInfo node = find(window.getRoot(), label);
            if (node != null) return node;
        }
        return null;
    }

    private AccessibilityNodeInfo find(AccessibilityNodeInfo node, String label) {
        if (node == null) return null;
        if (node.isVisibleToUser() && String.valueOf(node.getText()).startsWith(label)) return node;
        for (int index = 0; index < node.getChildCount(); index++) {
            AccessibilityNodeInfo child = find(node.getChild(index), label);
            if (child != null) return child;
        }
        return null;
    }

    private UiAutomation automation() throws Exception {
        // The legacy shell runner exposes UiAutomation through its internal bridge only.
        Method method = UiDevice.class.getDeclaredMethod("getAutomatorBridge");
        method.setAccessible(true);
        Object bridge = method.invoke(getUiDevice());
        for (Class<?> type = bridge.getClass(); type != null; type = type.getSuperclass()) {
            for (Field field : type.getDeclaredFields()) {
                if (!UiAutomation.class.isAssignableFrom(field.getType())) continue;
                field.setAccessible(true);
                return (UiAutomation) field.get(bridge);
            }
        }
        throw new IllegalStateException("UiAutomation is unavailable");
    }
}
