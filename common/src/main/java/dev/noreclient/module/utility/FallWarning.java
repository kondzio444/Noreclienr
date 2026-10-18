package dev.noreclient.module.utility;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;

import java.util.Locale;

/** While falling: how much damage landing right now would do, red when it would kill you. */
public class FallWarning extends Module {
    public final NumberSetting minHearts = add(new NumberSetting("Min Damage", "Pokazuj od tylu serduszek obrażeń", 1, 0.5, 10, 0.5, " ❤"));
    public final BooleanSetting sound = add(new BooleanSetting("Lethal Sound", "Dźwięk, gdy upadek byłby śmiertelny", true));

    private boolean lethalWarned;

    public FallWarning() {
        super("Fall Warning", "Pokazuje obrażenia od upadku, zanim uderzysz o ziemię", Category.UTILITY);
    }

    /** Damage in half hearts for landing now (no armour enchantments or effects counted). */
    private float damage() {
        if (!inGame() || game().invulnerable() || game().flying() || game().fallFlying() || game().swimming() || game().velocityY() > -0.1) return 0;
        return (float) Math.max(0, Math.ceil(game().fallDistance() - 3));
    }

    @Override
    public void onTick() {
        float d = damage();
        boolean lethal = d > 0 && d >= game().health() + game().absorption();
        if (lethal && !lethalWarned && sound.isOn()) game().playPing(0.5f);
        lethalWarned = lethal;
    }

    @Override
    public void onRenderOverlay(Gfx g, float tickDelta) {
        float d = damage();
        if (d < minHearts.get() * 2 || game().hudHidden() || game().dead()) return;
        boolean lethal = d >= game().health() + game().absorption();
        String t = lethal ? "Śmiertelny upadek!" : "Upadek: -" + String.format(Locale.ROOT, d % 2 == 0 ? "%.0f" : "%.1f", d / 2) + " ❤";
        float pulse = lethal ? 0.6f + 0.4f * (float) Math.abs(Math.sin(System.currentTimeMillis() / 120.0)) : 1;
        int c = lethal ? 0xFFFF4040 : d >= (game().health() + game().absorption()) * 0.5f ? 0xFFFF9944 : 0xFFFFD255;
        float cx = g.width() / 2f, y = g.height() / 2f + 14;
        float w = Render2D.textWidth(t) + 12;
        Render2D.roundedRect(g, cx - w / 2, y - 2, w, 12, 6, ColorUtil.withAlpha(0xFF000000, (int) (110 * pulse)));
        Render2D.centeredText(g, t, cx, y, ColorUtil.withAlpha(c, (int) (255 * pulse)), true);
    }
}
