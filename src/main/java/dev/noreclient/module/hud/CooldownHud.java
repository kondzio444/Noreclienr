package dev.noreclient.module.hud;

import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.item.BowItem;
import net.minecraft.item.CrossbowItem;

/** Attack cooldown and bow/crossbow charge as a smooth bar. */
public class CooldownHud extends HudModule {
    public final ModeSetting style = add(new ModeSetting("Style", "Pasek lub okrąg", "Bar", "Bar", "Ring"));
    public final NumberSetting barWidth = add(new NumberSetting("Bar Width", "Szerokość paska", 60, 30, 160, 2, "px")).visibleWhen(() -> style.is("Bar"));
    public final BooleanSetting attack = add(new BooleanSetting("Attack Cooldown", "Pokazuj odnowienie ataku", true));
    public final BooleanSetting bow = add(new BooleanSetting("Bow Charge", "Pokazuj naciągnięcie łuku", true));
    public final BooleanSetting percent = add(new BooleanSetting("Percent", "Pokazuj procent", false));
    public final BooleanSetting hideWhenFull = add(new BooleanSetting("Hide When Ready", "Ukryj gdy w pełni naładowane", true));

    private final Animation fade = new Animation(0, 12);

    public CooldownHud() {
        super("Cooldown Indicator", "Odnowienie ataku i naciągnięcie łuku", 0.5f, 0.6f);
    }

    private float progress() {
        if (mc.player == null) return 0.6f;
        if (bow.isOn() && mc.player.isUsingItem()) {
            var item = mc.player.getActiveItem().getItem();
            if (item instanceof BowItem) return BowItem.getPullProgress(mc.player.getItemUseTime());
            if (item instanceof CrossbowItem) return Math.min(1, mc.player.getItemUseTime() / 25f);
        }
        return attack.isOn() ? mc.player.getAttackCooldownProgress(0) : 1;
    }

    @Override
    public void render(DrawContext ctx, float tickDelta, boolean editor) {
        float p = progress();
        boolean visible = editor || !hideWhenFull.isOn() || p < 0.999f;
        float a = fade.target(visible ? 1 : 0).update();
        int col = ColorUtil.lerp(0xFFFF5C5C, Theme.accent(), p);
        if (p >= 0.999f) col = 0xFF3DDC97;
        if (style.is("Ring")) {
            width = 22;
            height = 22;
            if (a < 0.02f) return;
            Render2D.ring(ctx, 11, 11, 10, 2.5f, 0, 360, ColorUtil.fade(0x50FFFFFF, a));
            Render2D.ring(ctx, 11, 11, 10, 2.5f, -90, -90 + 360 * p, ColorUtil.fade(col, a));
            if (percent.isOn()) Render2D.scaledText(ctx, String.valueOf(Math.round(p * 100)), 11 - Render2D.textWidth(String.valueOf(Math.round(p * 100))) * 0.35f, 8.5f, 0.7f, ColorUtil.fade(0xFFFFFFFF, a), false);
            return;
        }
        width = barWidth.floatValue();
        height = percent.isOn() ? 12 : 5;
        if (a < 0.02f) return;
        float y = height - 5;
        Render2D.roundedRect(ctx, 0, y, width, 5, 2.5f, ColorUtil.fade(0x70000000, a));
        Render2D.roundedRect(ctx, 0, y, Math.max(5, width * p), 5, 2.5f, ColorUtil.fade(col, a));
        if (percent.isOn()) Render2D.centeredText(ctx, Math.round(p * 100) + "%", width / 2f, -1, ColorUtil.fade(0xFFFFFFFF, a), true);
    }
}
