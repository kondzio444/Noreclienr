package dev.noreclient.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;
import dev.noreclient.api.Keys;
import dev.noreclient.api.Platform;

/** A GLFW key code; {@link Keys#UNKNOWN} means unbound. */
public class KeybindSetting extends Setting<Integer> {
    public KeybindSetting(String name, String description, int key) {
        super(name, description, key);
    }

    public boolean isBound() { return value != Keys.UNKNOWN; }

    public String getKeyName() {
        return keyName(value);
    }

    public static String keyName(int key) {
        if (key == Keys.UNKNOWN) return "None";
        String s = Platform.game() == null ? String.valueOf(key) : Platform.game().keyName(key);
        return s.length() > 12 ? s.substring(0, 12) : s;
    }

    @Override
    public JsonElement toJson() { return new JsonPrimitive(value); }

    @Override
    public void fromJson(JsonElement element) {
        if (element.isJsonPrimitive()) value = element.getAsInt();
    }
}
