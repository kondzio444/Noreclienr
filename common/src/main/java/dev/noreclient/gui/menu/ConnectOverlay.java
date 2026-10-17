package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.gui.widget.ServerCard;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.ServerInfo;
import dev.noreclient.util.Theme;

/** Card with the server the player is connecting to (drawn on Minecraft's connecting screen). */
public final class ConnectOverlay {
    private static final long[] since = {0};
    private static String last;

    private ConnectOverlay() {}

    public static void render(Gfx g, int width, int height, String name, String address) {
        if (!address.equals(last)) { last = address; since[0] = System.currentTimeMillis(); }
        float p = Math.min(1, (System.currentTimeMillis() - since[0]) / 400f);
        p = 1 - (1 - p) * (1 - p) * (1 - p);
        ServerInfo.Info info = ServerInfo.get(address);
        float w = Math.min(300, width - 40), h = 48, x = (width - w) / 2f, y = height / 2f - 30 + (1 - p) * 10;
        g.setAlpha(p);
        Render2D.scaledText(g, "ŁĄCZENIE Z", x + 2, y - 10, 0.7f, ColorUtil.brighten(Theme.accent(), 0.3f), true);
        ServerCard.row(g, info, name == null || name.isEmpty() ? address : name, x, y, w, h, 0.4f, true);
        if (name != null && !name.equals(address)) {
            Render2D.scaledText(g, address, x + w - 4 - Render2D.textWidth(address) * 0.6f, y + h + 3, 0.6f, Theme.TEXT_MUTED, true);
        }
        g.setAlpha(1);
    }
}
