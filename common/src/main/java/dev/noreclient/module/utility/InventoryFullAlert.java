package dev.noreclient.module.utility;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/** Tells you when the last free inventory slot fills up (so you stop mining into nothing). */
public class InventoryFullAlert extends Module {
    public final BooleanSetting sound = add(new BooleanSetting("Sound", "Dźwięk", true));
    public final BooleanSetting banner = add(new BooleanSetting("Banner", "Napis nad paskiem przedmiotów", true));

    private boolean full;
    private long fullAt;
    private int timer;

    public InventoryFullAlert() {
        super("Inventory Full Alert", "Ostrzeżenie, gdy ekwipunek się zapełni", Category.UTILITY);
    }

    @Override
    public void onTick() {
        if (!inGame() || timer-- > 0) return;
        timer = 5;
        int free = 0;
        for (ItemInfo i : game().inventory()) if (i == null) free++;
        boolean now = free == 0;
        if (now && !full) {
            fullAt = System.currentTimeMillis();
            NotificationManager.push("Ekwipunek pełny", "Nie zmieścisz już nowych przedmiotów", NotificationManager.Type.WARNING);
            if (sound.isOn()) game().playPing(0.7f);
        }
        full = now;
    }

    @Override
    public void onRenderOverlay(Gfx g, float tickDelta) {
        long age = System.currentTimeMillis() - fullAt;
        if (!banner.isOn() || !full || age > 2600 || game().hudHidden()) return;
        float a = Math.min(1, Math.min(age / 150f, (2600 - age) / 400f));
        String t = "Ekwipunek pełny!";
        float w = Render2D.textWidth(t) + 16, x = (g.width() - w) / 2f, y = g.height() - 74;
        Render2D.roundedRect(g, x, y, w, 14, 7, ColorUtil.withAlpha(0xFF2A1A08, (int) (200 * a)));
        Render2D.roundedOutline(g, x, y, w, 14, 7, 1, ColorUtil.withAlpha(Theme.WARNING, (int) (200 * a)));
        Render2D.centeredText(g, t, g.width() / 2f, y + 3.5f, ColorUtil.withAlpha(Theme.WARNING, (int) (255 * a)), true);
    }
}
