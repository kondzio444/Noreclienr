package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** A small "F3 lite" panel: the handful of debug values people actually look at, in one box. */
public class InfoPanelHud extends HudModule {
    public final BooleanSetting coords = add(new BooleanSetting("Coordinates", "XYZ", true));
    public final BooleanSetting direction = add(new BooleanSetting("Direction", "Kierunek i kąt", true));
    public final BooleanSetting biome = add(new BooleanSetting("Biome", "Biom", true));
    public final BooleanSetting light = add(new BooleanSetting("Light", "Światło bloków / nieba", true));
    public final BooleanSetting chunk = add(new BooleanSetting("Chunk", "Chunk i pozycja w nim", false));
    public final BooleanSetting fps = add(new BooleanSetting("FPS", "Klatki na sekundę", true));
    public final BooleanSetting ping = add(new BooleanSetting("Ping", "Opóźnienie (w trybie wieloosobowym)", true));
    public final BooleanSetting time = add(new BooleanSetting("Day Time", "Dzień i godzina w świecie", false));

    private final List<String[]> rows = new ArrayList<String[]>();

    public InfoPanelHud() {
        super("Info Panel", "Najważniejsze dane z F3 w jednym, małym panelu", 0.0f, 0.3f);
    }

    private static String facing(String f, float yaw) {
        String pl = "north".equals(f) ? "Północ" : "south".equals(f) ? "Południe" : "west".equals(f) ? "Zachód" : "east".equals(f) ? "Wschód" : f;
        String axis = "north".equals(f) ? "-Z" : "south".equals(f) ? "+Z" : "west".equals(f) ? "-X" : "+X";
        float y = ((yaw % 360) + 540) % 360 - 180;
        return pl + " " + axis + " (" + String.format(Locale.ROOT, "%.0f", y) + "°)";
    }

    private void collect(boolean live) {
        rows.clear();
        if (coords.isOn()) rows.add(new String[]{"XYZ", live ? String.format(Locale.ROOT, "%.1f %.1f %.1f", game().x(), game().y(), game().z()) : "128.5 64.0 -310.5"});
        if (direction.isOn()) rows.add(new String[]{"Kierunek", live ? facing(game().facing(), game().yaw(1)) : "Północ -Z (178°)"});
        if (biome.isOn()) rows.add(new String[]{"Biom", live ? CoordinatesHud.cap(game().biome()) : "Plains"});
        if (light.isOn()) rows.add(new String[]{"Światło", live ? game().lightLevel(1) + " blok · " + game().lightLevel(2) + " niebo" : "12 blok · 15 niebo"});
        if (chunk.isOn()) {
            int x = (int) Math.floor(game().x()), z = (int) Math.floor(game().z());
            rows.add(new String[]{"Chunk", live ? (x >> 4) + " " + (z >> 4) + " [" + (x & 15) + " " + (z & 15) + "]" : "8 -20 [0 2]"});
        }
        if (fps.isOn()) rows.add(new String[]{"FPS", String.valueOf(game().fps())});
        if (ping.isOn() && (!live || !game().singleplayer())) rows.add(new String[]{"Ping", live ? game().ping() + " ms" : "24 ms"});
        if (time.isOn()) {
            long t = live ? game().timeOfDay() : 30000;
            long d = t % 24000;
            int h = (int) ((d / 1000 + 6) % 24), m = (int) (d % 1000 * 60 / 1000);
            rows.add(new String[]{"Czas", "dzień " + (t / 24000) + ", " + String.format(Locale.ROOT, "%02d:%02d", h, m)});
        }
    }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        collect(inGame());
        float lw = 0, vw = 0;
        for (String[] r : rows) {
            lw = Math.max(lw, Render2D.textWidth(r[0]) * 0.8f);
            vw = Math.max(vw, Render2D.textWidth(r[1]));
        }
        width = Math.max(60, lw + vw + 18);
        height = rows.size() * 10 + 7;
        if (rows.isEmpty()) { height = 12; return; }
        Render2D.roundedRect(g, 0, 0, width, height, Theme.radius() * 0.8f, 0x90160F26);
        Render2D.roundedRect(g, 0, 3, 2, height - 6, 1, Theme.accent());
        float y = 4;
        for (String[] r : rows) {
            Render2D.scaledText(g, r[0], 6, y + 1, 0.8f, Theme.accent(), false);
            Render2D.text(g, r[1], width - 5 - Render2D.textWidth(r[1]), y, 0xFFFFFFFF, true);
            y += 10;
        }
    }
}
