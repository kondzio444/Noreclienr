package dev.noreclient.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

/** Free text value (e.g. a chat macro). */
public class StringSetting extends Setting<String> {
    private final int maxLength;

    public StringSetting(String name, String description, String defaultValue, int maxLength) {
        super(name, description, defaultValue);
        this.maxLength = maxLength;
    }

    public int getMaxLength() { return maxLength; }

    @Override
    public void set(String value) {
        super.set(value == null ? "" : value.length() > maxLength ? value.substring(0, maxLength) : value);
    }

    @Override
    public JsonElement toJson() { return new JsonPrimitive(value); }

    @Override
    public void fromJson(JsonElement element) {
        if (element.isJsonPrimitive()) set(element.getAsString());
    }
}
