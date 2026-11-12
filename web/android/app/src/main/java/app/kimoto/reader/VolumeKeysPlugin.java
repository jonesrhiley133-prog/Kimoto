package app.kimoto.reader;

import android.view.KeyEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the reader turn pages with the hardware volume buttons.
 *
 * Android WebViews don't deliver volume keys to JavaScript, so MainActivity forwards key events
 * here. While the reader has enabled it, volume up/down are consumed (the volume doesn't change)
 * and reported to JS as a "volume" event.
 */
@CapacitorPlugin(name = "VolumeKeys")
public class VolumeKeysPlugin extends Plugin {
    private static VolumeKeysPlugin instance;
    private static volatile boolean enabled = false;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void enable(PluginCall call) {
        enabled = true;
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        enabled = false;
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        // Never hijack the volume buttons while the app is in the background.
        enabled = false;
    }

    /** @return true when the event was consumed. */
    static boolean handle(KeyEvent event) {
        if (!enabled || instance == null) return false;
        int code = event.getKeyCode();
        if (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN) return false;
        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            JSObject data = new JSObject();
            data.put("direction", code == KeyEvent.KEYCODE_VOLUME_DOWN ? "down" : "up");
            instance.notifyListeners("volume", data);
        }
        return true; // consume both press and release
    }
}
