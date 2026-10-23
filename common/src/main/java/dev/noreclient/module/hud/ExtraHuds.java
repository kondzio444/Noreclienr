package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.api.Keys;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.StringSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.List;
import java.util.Locale;

/** HUD elements added in 2.1. */
public final class ExtraHuds {
    private ExtraHuds() {}

    /** The main inventory (and optionally the hotbar) drawn on screen. */
    public static final class InventoryHud extends HudModule {
        public final BooleanSetting hotbar = add(new BooleanSetting("Show Hotbar", "Dodatkowy rząd z paskiem szybkiego wyboru", false));
        public final BooleanSetting background = add(new BooleanSetting("Background", "Tło za ekwipunkiem", true));
        public final BooleanSetting slots = add(new BooleanSetting("Slot Frames", "Ramki pól", true));
        public final ColorSetting backgroundColor = add(new ColorSetting("Background Color", "Kolor tła", 0x90160F26));

        public InventoryHud() {
            super("Inventory HUD", "Podgląd ekwipunku na ekranie", 0.5f, 0.02f);
        }

        @Override
        public void render(Gfx g, float tickDelta, boolean editor) {
            int rows = hotbar.isOn() ? 4 : 3;
            width = 9 * 18 + 6;
            height = rows * 18 + 6 + (hotbar.isOn() ? 3 : 0);
            float r = Theme.radius() * 0.8f;
            if (background.isOn()) {
                Render2D.roundedRect(g, 0, 0, width, height, r, backgroundColor.getColor());
                Render2D.roundedOutline(g, 0, 0, width, height, r, 1, ColorUtil.withAlpha(Theme.accent(), 70));
            }
            List<ItemInfo> inv = inGame() ? game().inventory() : null;
            for (int i = 0; i < rows * 9; i++) {
                int row = i / 9, col = i % 9;
                float x = 3 + col * 18, y = 3 + row * 18 + (row == 3 ? 3 : 0);
                if (slots.isOn()) Render2D.roundedRect(g, x + 0.5f, y + 0.5f, 17, 17, 2, 0x30FFFFFF);
                ItemInfo it = inv != null && i < inv.size() ? inv.get(i) : null;
                if (it == null && !inGame() && i % 4 == 0) it = game().itemIcon(i % 8 == 0 ? "minecraft:cobblestone" : "minecraft:oak_log");
                if (it != null) g.item(it, (int) x + 1, (int) y + 1, true);
            }
        }
    }

    /** Stopwatch with its own start/stop and reset keys. */
    public static final class Stopwatch extends TextHudModule {
        public final KeybindSetting startKey = add(new KeybindSetting("Start/Stop Key", "Uruchamia i zatrzymuje stoper", Keys.UNKNOWN));
        public final KeybindSetting resetKey = add(new KeybindSetting("Reset Key", "Zeruje stoper", Keys.UNKNOWN));
        private long started, elapsed;
        private boolean running;

        public Stopwatch() { super("Stopwatch", "Stoper pod klawiszem (np. do speedrunów)", 0.0f, 0.6f); }

        @Override
        public void onKeyPressed(int key) {
            if (startKey.isBound() && key == startKey.get()) {
                if (running) elapsed += System.currentTimeMillis() - started;
                else started = System.currentTimeMillis();
                running = !running;
            } else if (resetKey.isBound() && key == resetKey.get()) {
                running = false;
                elapsed = 0;
            }
        }

        private long millis() { return elapsed + (running ? System.currentTimeMillis() - started : 0); }

        @Override protected String label() { return running ? "⏱" : "Stoper"; }

        @Override protected String value() {
            long ms = millis();
            return String.format(Locale.ROOT, "%02d:%02d.%d", ms / 60000, (ms / 1000) % 60, (ms / 100) % 10);
        }

        @Override protected String previewValue() { return "01:23.4"; }
    }

    /** Coordinates and distance of the last death. */
    public static final class LastDeath extends TextHudModule {
        public final BooleanSetting chat = add(new BooleanSetting("Chat Message", "Napisz w czacie, gdzie zginąłeś", true));
        public final BooleanSetting hideWhenNone = add(new BooleanSetting("Hide When None", "Ukryj, dopóki nie zginiesz", true));
        private boolean wasDead;
        private double dx, dy, dz;
        private String dim;
        private boolean has;

        public LastDeath() { super("Last Death", "Miejsce ostatniej śmierci i odległość do niego", 0.0f, 0.65f); }

        @Override
        public void onTick() {
            if (!inGame()) return;
            boolean dead = game().dead();
            if (dead && !wasDead) {
                dx = game().x();
                dy = game().y();
                dz = game().z();
                dim = game().dimension();
                has = true;
                if (chat.isOn()) game().localChat("§6[Nore] §7Zginąłeś na §f" + (int) Math.floor(dx) + " " + (int) Math.floor(dy) + " " + (int) Math.floor(dz) + " §7(" + dim + ")");
            }
            wasDead = dead;
        }

        @Override public boolean shouldRender() { return has || !hideWhenNone.isOn() || !inGame(); }

        @Override protected String label() { return "Śmierć"; }

        @Override protected String value() {
            if (!has) return "-";
            String pos = (int) Math.floor(dx) + " " + (int) Math.floor(dy) + " " + (int) Math.floor(dz);
            if (!game().dimension().equals(dim)) return pos + " §7(" + dim + ")";
            double dist = Math.sqrt(Math.pow(game().x() - dx, 2) + Math.pow(game().z() - dz, 2));
            return pos + " §7" + (int) dist + "m";
        }

        @Override protected String previewValue() { return "-120 64 355 §742m"; }
    }

    /** Server ticks per second, measured from the server's time updates. */
    public static final class Tps extends TextHudModule {
        private static long lastTime = -1, lastNanos;
        private static float tps = 20;

        public Tps() { super("TPS", "Wydajność serwera (ticki na sekundę)", 1.0f, 0.45f); }

        public static void onServerTime(long worldTime) {
            long now = System.nanoTime();
            if (lastTime >= 0 && worldTime > lastTime) {
                double secs = (now - lastNanos) / 1e9;
                if (secs > 0.2) {
                    float sample = (float) Math.min(20, (worldTime - lastTime) / secs);
                    tps = tps * 0.6f + sample * 0.4f;
                }
            }
            lastTime = worldTime;
            lastNanos = now;
        }

        @Override protected String label() { return "TPS"; }

        @Override protected String value() {
            String c = tps >= 18 ? "§a" : tps >= 14 ? "§e" : "§c";
            return c + String.format(Locale.ROOT, "%.1f", tps);
        }

        @Override protected String previewValue() { return "§a20.0"; }

        @Override protected boolean needsHook() { return true; }
    }

    /** Counter for any item chosen by id. */
    public static final class CustomCounter extends TextHudModule {
        public final StringSetting item = add(new StringSetting("Item", "Id przedmiotu, np. minecraft:diamond", "minecraft:diamond", 64));
        public final StringSetting labelText = add(new StringSetting("Label", "Etykieta", "Diamenty", 24));

        public CustomCounter() { super("Item Counter", "Licznik dowolnego przedmiotu z ekwipunku", 1.0f, 0.5f); }

        private String id() {
            String s = item.get().trim().toLowerCase(Locale.ROOT);
            return s.contains(":") ? s : "minecraft:" + s;
        }

        @Override protected String label() { return labelText.get(); }

        @Override protected String value() { return String.valueOf(game().countItem(id())); }

        @Override protected String previewValue() { return "24"; }
    }
}
