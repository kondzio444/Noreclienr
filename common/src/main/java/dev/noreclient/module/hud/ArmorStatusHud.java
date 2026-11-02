package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.util.Render2D;

import java.util.ArrayList;
import java.util.List;

public class ArmorStatusHud extends HudModule {
    public final ModeSetting layout = add(new ModeSetting("Layout", "Układ elementów", "Vertical", "Vertical", "Horizontal"));
    public final ModeSetting durability = add(new ModeSetting("Durability", "Format wytrzymałości", "Percent", "Percent", "Value", "None"));
    public final BooleanSetting mainHand = add(new BooleanSetting("Main Hand", "Pokazuj przedmiot w ręce", true));
    public final BooleanSetting colored = add(new BooleanSetting("Colored", "Kolor zależny od wytrzymałości", true));

    public ArmorStatusHud() {
        super("Armor Status", "Zbroja i jej wytrzymałość", 1.0f, 0.7f);
        setEnabled(true);
    }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        List<ItemInfo> items = new ArrayList<ItemInfo>();
        if (inGame()) {
            items.addAll(game().armor());
            ItemInfo hand = game().mainHand();
            if (mainHand.isOn() && hand != null) items.add(hand);
        }
        if (items.isEmpty() && editor) items.addAll(game().previewArmor());
        boolean vertical = layout.is("Vertical");
        float x = 0, y = 0, maxW = 0;
        for (ItemInfo stack : items) {
            g.item(stack, (int) x, (int) y, true);
            String text = durabilityText(stack);
            int tw = text.isEmpty() ? 0 : Render2D.textWidth(text);
            if (!text.isEmpty()) Render2D.text(g, text, x + 19, y + 4.5f, color(stack), true);
            if (vertical) { maxW = Math.max(maxW, 19 + tw); y += 17; }
            else x += 19 + tw + 6;
        }
        width = Math.max(18, vertical ? maxW : x - 6);
        height = Math.max(16, vertical ? y - 1 : 16);
    }

    private String durabilityText(ItemInfo s) {
        if (durability.is("None")) return "";
        if (!s.damageable()) return s.count > 1 ? String.valueOf(s.count) : "";
        int left = s.durabilityLeft();
        return durability.is("Percent") ? (left * 100 / s.maxDamage) + "%" : String.valueOf(left);
    }

    private int color(ItemInfo s) {
        if (!colored.isOn() || !s.damageable()) return 0xFFFFFFFF;
        float f = s.durabilityLeft() / (float) s.maxDamage;
        if (f > 0.6f) return 0xFF55FF77;
        if (f > 0.3f) return 0xFFFFD255;
        return 0xFFFF5555;
    }
}
