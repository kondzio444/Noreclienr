package dev.noreclient.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;
import net.minecraft.client.util.InputUtil;
import org.lwjgl.glfw.GLFW;

/** A raw GLFW key code; {@link GLFW#GLFW_KEY_UNKNOWN} means unbound. */
public class KeybindSetting extends Setting<Integer> {
    public KeybindSetting(String name, String description, int key) {
        super(name, description, key);
    }

    public boolean isBound() { return value != GLFW.GLFW_KEY_UNKNOWN; }

    public String getKeyName() {
        return keyName(value);
    }

    public static String keyName(int key) {
        if (key == GLFW.GLFW_KEY_UNKNOWN) return "None";
        String s = InputUtil.Type.KEYSYM.createFromCode(key).getLocalizedText().getString();
        return s.length() > 12 ? s.substring(0, 12) : s;
    }

    @Override
    public JsonElement toJson() { return new JsonPrimitive(value); }

    @Override
    public void fromJson(JsonElement element) {
        if (element.isJsonPrimitive()) value = element.getAsInt();
    }
}
