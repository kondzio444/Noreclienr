package dev.noreclient.cosmetic;

/** Where a wardrobe item is worn. One item per slot; the id is the key in the Nore Hub cosmetics JSON. */
public enum Slot {
    CAPE("cape", "Peleryny", "Peleryna"),
    WINGS("wings", "Skrzydła", "Skrzydła"),
    HAT("hat", "Czapki", "Czapka"),
    EARS("ears", "Uszy", "Uszy"),
    TAIL("tail", "Ogony", "Ogon"),
    AURA("aura", "Aura", "Aura");

    public final String id, title, single;

    Slot(String id, String title, String single) {
        this.id = id;
        this.title = title;
        this.single = single;
    }

    public static Slot byId(String id) {
        for (Slot s : values()) if (s.id.equals(id)) return s;
        return null;
    }
}
