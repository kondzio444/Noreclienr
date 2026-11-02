package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class CoordinatesHud extends HudModule {
    public final BooleanSetting showDirection = add(new BooleanSetting("Direction", "Pokazuj kierunek patrzenia", true));
    public final BooleanSetting showBiome = add(new BooleanSetting("Biome", "Pokazuj biom", true));
    public final BooleanSetting netherCoords = add(new BooleanSetting("Nether Coords", "Przeliczone koordynaty Netheru/Overworldu", false));
    public final BooleanSetting decimals = add(new BooleanSetting("Decimals", "Dokładne koordynaty", false));
    public final BooleanSetting background = add(new BooleanSetting("Background", "Tło", true));
    public final ColorSetting backgroundColor = add(new ColorSetting("Background Color", "Kolor tła", 0x90160F26));
    public final ColorSetting valueColor = add(new ColorSetting("Value Color", "Kolor wartości", 0xFFFFFFFF));

    public CoordinatesHud() {
        super("Coordinates", "Pozycja XYZ, kierunek i biom", 0.0f, 0.24f);
        setEnabled(true);
    }

    private String fmt(double v) {
        return decimals.isOn() ? String.format(Locale.ROOT, "%.1f", v) : String.valueOf((int) Math.floor(v));
    }

    static String cap(String s) {
        if (s == null || s.isEmpty()) return "";
        s = s.replace('_', ' ');
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        List<String[]> lines = new ArrayList<String[]>();
        if (inGame()) {
            double x = game().x(), y = game().y(), z = game().z();
            lines.add(new String[]{"X", fmt(x)});
            lines.add(new String[]{"Y", fmt(y)});
            lines.add(new String[]{"Z", fmt(z)});
            if (showDirection.isOn()) {
                String d = game().facing();
                String axis = "north".equals(d) ? "-Z" : "south".equals(d) ? "+Z" : "west".equals(d) ? "-X" : "east".equals(d) ? "+X" : "";
                lines.add(new String[]{"Dir", cap(d) + " (" + axis + ")"});
            }
            if (showBiome.isOn()) lines.add(new String[]{"Biome", cap(game().biome())});
            if (netherCoords.isOn()) {
                boolean nether = "the_nether".equals(game().dimension());
                double f = nether ? 8 : 0.125;
                lines.add(new String[]{nether ? "OW" : "Nether", fmt(x * f) + ", " + fmt(z * f)});
            }
        } else {
            lines.add(new String[]{"X", "128"});
            lines.add(new String[]{"Y", "64"});
            lines.add(new String[]{"Z", "-256"});
            if (showDirection.isOn()) lines.add(new String[]{"Dir", "North (-Z)"});
            if (showBiome.isOn()) lines.add(new String[]{"Biome", "Plains"});
        }
        int labelW = 0, valueW = 0;
        for (String[] l : lines) {
            labelW = Math.max(labelW, Render2D.textWidth(l[0]));
            valueW = Math.max(valueW, Render2D.textWidth(l[1]));
        }
        width = labelW + valueW + 16;
        height = lines.size() * 10 + 6;
        if (background.isOn()) Render2D.roundedRect(g, 0, 0, width, height, Theme.radius() * 0.6f, backgroundColor.getColor());
        float yy = 4;
        int i = 0;
        for (String[] l : lines) {
            Render2D.text(g, l[0], 5, yy, Theme.accent(-i * 120L), true);
            Render2D.text(g, l[1], 5 + labelW + 6, yy, valueColor.getColor(), true);
            yy += 10;
            i++;
        }
    }
}
