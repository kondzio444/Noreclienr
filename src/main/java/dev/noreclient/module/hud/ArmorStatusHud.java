package dev.noreclient.module.hud;

import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.util.Render2D;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;

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
    public void render(DrawContext ctx, float tickDelta, boolean editor) {
        List<ItemStack> items = new ArrayList<>();
        if (mc.player != null) {
            for (int i = 3; i >= 0; i--) {
                ItemStack s = mc.player.getInventory().getArmorStack(i);
                if (!s.isEmpty()) items.add(s);
            }
            if (mainHand.isOn() && !mc.player.getMainHandStack().isEmpty()) items.add(mc.player.getMainHandStack());
        }
        if (items.isEmpty() && editor) {
            items.add(new ItemStack(Items.DIAMOND_HELMET));
            items.add(new ItemStack(Items.DIAMOND_CHESTPLATE));
            items.add(new ItemStack(Items.DIAMOND_LEGGINGS));
            items.add(new ItemStack(Items.DIAMOND_BOOTS));
        }
        boolean vertical = layout.is("Vertical");
        float x = 0, y = 0, maxW = 0;
        for (ItemStack stack : items) {
            ctx.drawItem(stack, (int) x, (int) y);
            ctx.drawItemInSlot(mc.textRenderer, stack, (int) x, (int) y);
            String text = durabilityText(stack);
            int tw = text.isEmpty() ? 0 : Render2D.textWidth(text);
            if (!text.isEmpty()) {
                Render2D.text(ctx, text, x + 19, y + 4.5f, color(stack), true);
            }
            if (vertical) {
                maxW = Math.max(maxW, 19 + tw);
                y += 17;
            } else {
                x += 19 + tw + 6;
            }
        }
        width = Math.max(18, vertical ? maxW : x - 6);
        height = Math.max(16, vertical ? y - 1 : 16);
    }

    private String durabilityText(ItemStack s) {
        if (durability.is("None")) return "";
        if (!s.isDamageable()) return s.getCount() > 1 ? String.valueOf(s.getCount()) : "";
        int left = s.getMaxDamage() - s.getDamage();
        return durability.is("Percent") ? (left * 100 / s.getMaxDamage()) + "%" : String.valueOf(left);
    }

    private int color(ItemStack s) {
        if (!colored.isOn() || !s.isDamageable()) return 0xFFFFFFFF;
        float f = (s.getMaxDamage() - s.getDamage()) / (float) s.getMaxDamage();
        if (f > 0.6f) return 0xFF55FF77;
        if (f > 0.3f) return 0xFFFFD255;
        return 0xFFFF5555;
    }
}
