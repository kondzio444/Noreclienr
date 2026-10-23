package dev.noreclient.util;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;

/**
 * JSON parsing that works with every Gson the game ships: 2.8.0 on 1.12.2 – 1.16.5 has no
 * JsonParser.parseString, newer ones deprecate the old instance methods.
 */
public final class Json {
    private static final Gson GSON = new Gson();

    private Json() {}

    public static JsonElement parse(String s) {
        JsonElement e = GSON.fromJson(s, JsonElement.class);
        return e == null ? JsonNull.INSTANCE : e;
    }
}
