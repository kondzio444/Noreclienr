package dev.noreclient.module.social;

import dev.noreclient.cosmetic.Items;
import dev.noreclient.cosmetic.Look;
import dev.noreclient.cosmetic.Slot;
import dev.noreclient.cosmetic.Wardrobe;
import dev.noreclient.cosmetic.Worn;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.StringSetting;
import dev.noreclient.util.Capes;

/**
 * The wardrobe ("Szatnia") of the local player: Nore capes (also on the elytra), wings, hats, ears,
 * tails and auras. The whole look is stored as the Nore Hub cosmetics JSON in a hidden setting.
 */
public class Cosmetics extends Module {
    public final ModeSetting cape = add(new ModeSetting("Cape", "Peleryna Nore", "Nova 1.4", Capes.NAMES));
    public final BooleanSetting animated = add(new BooleanSetting("Animation", "Animowane peleryny z kolekcji Historia Nore i Halloween", true));
    /** The look ({"v":1,"slots":{…}}); edited in the wardrobe screen. */
    public final StringSetting look = add(new StringSetting("Look", "Szatnia (JSON)", "", 4096)).visibleWhen(() -> false);
    /** Found the hidden cat-ears button (unlocks the fox and cat ears and tails). */
    public final BooleanSetting secret = add(new BooleanSetting("Secret", "Sekret", false)).visibleWhen(() -> false);
    // settings of 1.4 Beta before the wardrobe rebuild, only read once to migrate them into the look
    private final ModeSetting oldWings = add(new ModeSetting("Wings", "Skrzydła (Szatnia)", "Brak", "Brak", "Skrzydła Nietoperza")).visibleWhen(() -> false);
    private final ModeSetting oldHat = add(new ModeSetting("Hat", "Czapka (Szatnia)", "Brak", "Brak", "Kapelusz Wiedźmy")).visibleWhen(() -> false);
    private String applied;
    private int ticks;
    private boolean published;

    public Cosmetics() {
        super("Cosmetics", "Szatnia: peleryny, skrzydła, czapki, uszy, ogony i aury Nore Client", Category.CLIENT);
        setEnabled(true);
    }

    /** Reads the saved look, migrating the old wings / hat / cape settings the first time. */
    public Look loadLook() {
        String s = look.get();
        if (s != null && !s.trim().isEmpty()) {
            Look l = Look.parse(s);
            // keep the cape setting (also shown in the module list) as the source of truth for the cape
            String c = cape.get();
            Worn w = l.get(Slot.CAPE);
            String inLook = w == null ? Capes.NAMES[0] : Capes.byId(w.id);
            if (inLook == null) inLook = Capes.NAMES[0];
            if (!inLook.equals(c)) l = l.with(Slot.CAPE, capeWorn(c, w));
            return l;
        }
        Look l = Look.EMPTY;
        if ("Skrzydła Nietoperza".equals(oldWings.get())) l = l.with(Slot.WINGS, Worn.of(Items.get("bat_wings")));
        if ("Kapelusz Wiedźmy".equals(oldHat.get())) l = l.with(Slot.HAT, Worn.of(Items.get("witch_hat")));
        l = l.with(Slot.CAPE, capeWorn(cape.get(), null));
        oldWings.set("Brak");
        oldHat.set("Brak");
        look.set(l.json());
        return l;
    }

    private Worn capeWorn(String name, Worn old) {
        if (name == null || name.equals(Capes.NAMES[0]) || Items.get(Capes.capeId(name)) == null) return null;
        Worn w = Worn.of(Items.get(Capes.capeId(name)));
        return w.withAnim(old != null ? old.anim : animated.isOn());
    }

    /** Writes the look and mirrors its cape into the cape settings. */
    public void storeLook(Look l) {
        look.set(l.json());
        Worn w = l.get(Slot.CAPE);
        String name = w == null ? null : Capes.byId(w.id);
        cape.set(name == null ? Capes.NAMES[0] : name);
        if (w != null) animated.set(w.anim);
    }

    @Override
    public void onTick() {
        if (!published) {
            published = true;
            Wardrobe.publish();
        }
        String name = isEnabled() ? cape.get() : Capes.NAMES[0];
        int frame = animated.isOn() && Capes.isAnimated(name) ? ++ticks / 3 % Capes.FRAMES : 0;
        String want = name + "#" + frame;
        if (want.equals(applied)) return;
        applied = want;
        game().setLocalCape(Capes.texture(name, frame));
    }

    @Override
    protected void onEnable() {
        Wardrobe.publish();
    }

    @Override
    protected void onDisable() {
        applied = null;
        game().setLocalCape(null);
        Wardrobe.publish();
    }
}
