package dev.noreclient.cosmetic;

import dev.noreclient.util.Capes;

import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Every wardrobe item by id, in display order. */
public final class Items {
    private static final Map<String, Item> BY_ID = new LinkedHashMap<String, Item>();

    /** A Nore cape: drawn by the game's own cape renderer, the item only carries its id and name. */
    public static final class CapeItem extends Item {
        public final String capeName;

        CapeItem(String capeName) {
            super(Capes.capeId(capeName), capeName, Slot.CAPE, Capes.tagline(capeName).isEmpty() ? "Peleryna Nore Client" : Capes.tagline(capeName));
            this.capeName = capeName;
            colorOption = false;
            speedOption = false;
            scaleOption = false;
            animOption = Capes.isAnimated(capeName);
            texW = texH = 1;
        }

        @Override protected BufferedImage paint(int color, String variant) { return new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB); }

        @Override protected void build(Item.Build b) {}
    }

    static {
        for (int i = 1; i < Capes.NAMES.length; i++) add(new CapeItem(Capes.NAMES[i]));
        add(new BatWings());
        add(new AngelWings());
        add(new FairyWings());
        add(new WitchHat());
        add(new WinterHat());
        add(new Crown());
        add(Ears.fox());
        add(Ears.cat());
        add(Tails.devil());
        add(Tails.fox());
        add(Tails.cat());
        add(new Halo());
        add(new StarOrbit());
    }

    private Items() {}

    private static void add(Item i) { BY_ID.put(i.id, i); }

    public static Item get(String id) { return id == null ? null : BY_ID.get(id); }

    public static List<Item> all() { return Collections.unmodifiableList(new ArrayList<Item>(BY_ID.values())); }

    public static List<Item> of(Slot slot) {
        List<Item> out = new ArrayList<Item>();
        for (Item i : BY_ID.values()) if (i.slot == slot) out.add(i);
        return out;
    }
}
