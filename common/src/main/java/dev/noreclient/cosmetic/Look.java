package dev.noreclient.cosmetic;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.noreclient.util.Json;

import java.util.EnumMap;
import java.util.Map;

/**
 * Everything one player wears: at most one item per slot. Serialises to the Nore Hub cosmetics JSON
 * ({"v":1,"slots":{"wings":{"id":"bat_wings","color":…,"variant":…,"opts":{…}}}}) and parses it
 * back, skipping unknown slots, items, variants and options. Immutable.
 */
public final class Look {
    public static final Look EMPTY = new Look(new EnumMap<Slot, Worn>(Slot.class));

    private final EnumMap<Slot, Worn> slots;
    private String json;

    private Look(EnumMap<Slot, Worn> slots) { this.slots = slots; }

    public Worn get(Slot s) { return slots.get(s); }

    public boolean isEmpty() { return slots.isEmpty(); }

    public Map<Slot, Worn> slots() { return java.util.Collections.unmodifiableMap(slots); }

    /** Copy with the slot set (null removes it). */
    public Look with(Slot s, Worn w) {
        EnumMap<Slot, Worn> m = new EnumMap<Slot, Worn>(Slot.class);
        m.putAll(slots);
        if (w == null) m.remove(s); else m.put(s, w);
        return new Look(m);
    }

    public JsonObject toJson() {
        JsonObject root = new JsonObject();
        root.addProperty("v", 1);
        JsonObject o = new JsonObject();
        for (Map.Entry<Slot, Worn> e : slots.entrySet()) o.add(e.getKey().id, e.getValue().toJson());
        root.add("slots", o);
        return root;
    }

    /** Compact JSON string (cached). */
    public String json() {
        if (json == null) json = toJson().toString();
        return json;
    }

    public static Look parse(String s) {
        if (s == null || s.trim().isEmpty()) return EMPTY;
        try {
            JsonElement e = Json.parse(s);
            return e.isJsonObject() ? parse(e.getAsJsonObject()) : EMPTY;
        } catch (Exception ex) {
            return EMPTY;
        }
    }

    /** Reads a cosmetics object; never throws, anything unknown is ignored. */
    public static Look parse(JsonObject root) {
        if (root == null) return EMPTY;
        try {
            // "v" > 1 would be a newer format: still read what we understand
            JsonElement se = root.get("slots");
            if (se == null || !se.isJsonObject()) return EMPTY;
            EnumMap<Slot, Worn> m = new EnumMap<Slot, Worn>(Slot.class);
            for (Map.Entry<String, JsonElement> e : se.getAsJsonObject().entrySet()) {
                Slot slot = Slot.byId(e.getKey());
                if (slot == null || !e.getValue().isJsonObject()) continue;
                JsonObject o = e.getValue().getAsJsonObject();
                JsonElement id = o.get("id");
                if (id == null || !id.isJsonPrimitive()) continue;
                Item item = Items.get(id.getAsString());
                if (item == null || item.slot != slot) continue;
                m.put(slot, Worn.fromJson(item, o));
            }
            return new Look(m);
        } catch (Exception ex) {
            return EMPTY;
        }
    }

    @Override
    public boolean equals(Object o) { return o instanceof Look && ((Look) o).slots.equals(slots); }

    @Override
    public int hashCode() { return slots.hashCode(); }
}
