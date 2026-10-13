package dev.noreclient.module.hud;

import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;

import java.util.ArrayList;
import java.util.List;

public class CoordinatesHud extends HudModule {
    public final BooleanSetting showDirection = add(new BooleanSetting("Direction", "Pokazuj kierunek patrzenia", true));
    public final BooleanSetting showBiome = add(new BooleanSetting("Biome", "Pokazuj biom", true));
    public final BooleanSetting netherCoords = add(new BooleanSetting("Nether Coords", "Przeliczone koordynaty Netheru/Overworldu", false));
    public final BooleanSetting decimals = add(new BooleanSetting("Decimals", "Dokładne koordynaty", false));
    public final BooleanSetting background = add(new BooleanSetting("Background", "Tło", true));
    public final ColorSetting backgroundColor = add(new ColorSetting("Background Color", "Kolor tła", 0x90101018));
    public final ColorSetting valueColor = add(new ColorSetting("Value Color", "Kolor wartości", 0xFFFFFFFF));

    public CoordinatesHud() {
        super("Coordinates", "Pozycja XYZ, kierunek i biom", 0.0f, 0.24f);
        setEnabled(true);
    }

    private String fmt(double v) {
        return decimals.isOn() ? String.format("%.1f", v) : String.valueOf((int) Math.floor(v));
    }

    @Override
    public void render(DrawContext ctx, float tickDelta, boolean editor) {
        List<String[]> lines = new ArrayList<>();
        if (mc.player != null && mc.world != null) {
            double x = mc.player.getX(), y = mc.player.getY(), z = mc.player.getZ();
            lines.add(new String[]{"X", fmt(x)});
            lines.add(new String[]{"Y", fmt(y)});
            lines.add(new String[]{"Z", fmt(z)});
            if (showDirection.isOn()) {
                Direction d = mc.player.getHorizontalFacing();
                String axis = switch (d) {
                    case NORTH -> "-Z"; case SOUTH -> "+Z"; case WEST -> "-X"; case EAST -> "+X"; default -> "";
                };
                lines.add(new String[]{"Dir", capitalize(d.asString()) + " (" + axis + ")"});
            }
            if (showBiome.isOn()) {
                BlockPos pos = mc.player.getBlockPos();
                String biome = mc.world.getBiome(pos).getKey().map(k -> k.getValue().getPath()).orElse("unknown");
                lines.add(new String[]{"Biome", capitalize(biome.replace('_', ' '))});
            }
            if (netherCoords.isOn()) {
                boolean nether = mc.world.getRegistryKey().getValue().getPath().equals("the_nether");
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
        if (background.isOn()) Render2D.roundedRect(ctx, 0, 0, width, height, Theme.radius() * 0.6f, backgroundColor.getColor());
        float y = 4;
        int i = 0;
        for (String[] l : lines) {
            Render2D.text(ctx, l[0], 5, y, Theme.accent(-i * 120L), true);
            Render2D.text(ctx, l[1], 5 + labelW + 6, y, valueColor.getColor(), true);
            y += 10;
            i++;
        }
    }

    private static String capitalize(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
