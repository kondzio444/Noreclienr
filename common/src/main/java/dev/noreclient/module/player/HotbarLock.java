package dev.noreclient.module.player;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/**
 * Hotbar scrolling without accidents: the wheel stops at the first and last slot instead of
 * jumping around, and a key locks scrolling completely (e.g. while bridging).
 */
public class HotbarLock extends Module {
    public final BooleanSetting noWrap = add(new BooleanSetting("No Wrap", "Kółko zatrzymuje się na 1. i 9. slocie", true));
    public final KeybindSetting lockKey = add(new KeybindSetting("Lock Key", "Blokuje / odblokowuje przewijanie paska", Keys.UNKNOWN));
    public final BooleanSetting indicator = add(new BooleanSetting("Indicator", "Kłódka nad paskiem, gdy przewijanie jest zablokowane", true));

    private boolean locked;
    private long bumpAt;

    public HotbarLock() {
        super("Hotbar Lock", "Przewijanie paska bez przeskakiwania z 9. na 1. slot i blokada kółka", Category.PLAYER);
    }

    @Override
    protected boolean needsHook() { return true; }

    @Override
    public void onKeyPressed(int key) {
        if (lockKey.isBound() && key == lockKey.get()) {
            locked = !locked;
            NotificationManager.push("Hotbar Lock", locked ? "Przewijanie zablokowane" : "Przewijanie odblokowane", locked ? NotificationManager.Type.WARNING : NotificationManager.Type.SUCCESS);
        }
    }

    @Override
    protected void onDisable() { locked = false; }

    /** True = swallow the scroll. Vanilla: wheel up selects the previous slot. */
    public boolean onScroll(double amount) {
        if (!inGame()) return false;
        if (locked) { bumpAt = System.currentTimeMillis(); return true; }
        if (!noWrap.isOn()) return false;
        int slot = game().selectedSlot();
        if (amount > 0 && slot == 0 || amount < 0 && slot == 8) {
            bumpAt = System.currentTimeMillis();
            return true;
        }
        return false;
    }

    @Override
    public void onRenderOverlay(Gfx g, float tickDelta) {
        if (!inGame() || game().hudHidden()) return;
        long age = System.currentTimeMillis() - bumpAt;
        float bump = age < 300 ? 1 - age / 300f : 0;
        if (!(locked && indicator.isOn()) && bump <= 0) return;
        float cx = g.width() / 2f, y = g.height() - 33;
        if (!locked) {
            // short flash at the edge slot that stopped the wheel
            int slot = game().selectedSlot();
            float sx = cx - 91 + slot * 20 + 1;
            Render2D.roundedOutline(g, sx, g.height() - 22, 22, 22, 2, 1.5f, ColorUtil.withAlpha(Theme.accent(), (int) (255 * bump)));
            return;
        }
        float a = 0.75f + 0.25f * bump;
        float x = cx + 95, ly = g.height() - 17;
        int c = ColorUtil.withAlpha(Theme.accent(), (int) (255 * a));
        Render2D.ring(g, x + 4, ly - 1, 3.2f, 1.4f, 180, 360, c);
        Render2D.roundedRect(g, x - 0.5f, ly - 1, 9, 7, 1.5f, c);
        Render2D.circle(g, x + 4, ly + 2.2f, 1, 0xFF120E1C);
    }

    @Override
    public String getSuffix() { return locked ? "Locked" : null; }
}
