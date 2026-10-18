package dev.noreclient.module.utility;

import dev.noreclient.api.Gfx;
import dev.noreclient.gui.menu.MultiplayerScreen2;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/** Joins the last server again after a kick or a lost connection, with a visible countdown. */
public class AutoReconnect extends Module {
    public final NumberSetting delay = add(new NumberSetting("Delay", "Ile sekund czekać przed ponownym połączeniem", 5, 2, 60, 1, " s"));
    public final NumberSetting attempts = add(new NumberSetting("Attempts", "Najwięcej prób z rzędu", 5, 1, 20, 1));

    private volatile String name, address;
    private volatile long screenSeen;
    private long countdownStart, inWorldSince;
    private int tries;

    public AutoReconnect() {
        super("Auto Reconnect", "Ponowne łączenie z serwerem po wyrzuceniu lub zerwaniu połączenia", Category.UTILITY);
    }

    @Override
    protected boolean needsHook() { return true; }

    public void onConnecting(String name, String address) {
        this.name = name;
        this.address = address;
    }

    private boolean onScreen() {
        return System.currentTimeMillis() - screenSeen < 400;
    }

    @Override
    public void onTick() {
        long now = System.currentTimeMillis();
        if (inGame()) {
            if (inWorldSince == 0) inWorldSince = now;
            if (now - inWorldSince > 15000) tries = 0; // stayed connected: next disconnect starts fresh
            countdownStart = 0;
            return;
        }
        inWorldSince = 0;
        if (!onScreen() || address == null) { countdownStart = 0; return; }
        if (tries >= attempts.intValue()) return;
        if (countdownStart == 0) countdownStart = now;
        if (now - countdownStart >= delay.get() * 1000) {
            countdownStart = 0;
            tries++;
            game().connect(name == null ? address : name, address, new MultiplayerScreen2(null));
        }
    }

    /** Called every frame while the vanilla "disconnected" screen is open. */
    public void renderScreen(Gfx g, int width, int height) {
        screenSeen = System.currentTimeMillis();
        if (!isActive() || address == null) return;
        String title, sub;
        float progress;
        if (tries >= attempts.intValue()) {
            title = "Nie udało się połączyć ponownie";
            sub = "Próby: " + tries + " / " + attempts.intValue();
            progress = 1;
        } else {
            float left = countdownStart == 0 ? delay.floatValue() : (float) Math.max(0, delay.get() - (screenSeen - countdownStart) / 1000.0);
            title = "Ponowne łączenie za " + (int) Math.ceil(left) + " s";
            sub = (name != null && !name.equals(address) ? name + " · " : "") + address + " · próba " + (tries + 1) + "/" + attempts.intValue();
            progress = 1 - left / delay.floatValue();
        }
        float w = Math.max(Render2D.textWidth(title), Render2D.textWidth(sub) * 0.75f) + 28, h = 34;
        float x = (width - w) / 2f, y = 10;
        Render2D.shadow(g, x, y, w, h, Theme.radius(), 6, 0x60000000);
        Render2D.roundedRect(g, x, y, w, h, Theme.radius(), 0xE0120E1C);
        Render2D.roundedOutline(g, x, y, w, h, Theme.radius(), 1, ColorUtil.withAlpha(Theme.accent(), 90));
        Render2D.centeredText(g, title, width / 2f, y + 6, 0xFFFFFFFF, true);
        Render2D.scaledText(g, sub, width / 2f - Render2D.textWidth(sub) * 0.375f, y + 17, 0.75f, Theme.TEXT_DIM, false);
        Render2D.roundedRect(g, x + 8, y + h - 5, w - 16, 2, 1, 0x30FFFFFF);
        Render2D.roundedRect(g, x + 8, y + h - 5, (w - 16) * Math.max(0, Math.min(1, progress)), 2, 1, Theme.accent());
    }
}
