package dev.noreclient.gui.widget;

import dev.noreclient.api.Gfx;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.ServerInfo;
import dev.noreclient.util.Theme;

/** A Minecraft server drawn the Nore way: icon, flag, MOTD, players, ping and version. */
public final class ServerCard {
    private ServerCard() {}

    public static void icon(Gfx g, ServerInfo.Info info, float x, float y, float s) {
        if (info != null && info.favicon != null) {
            Render2D.roundedRect(g, x - 1, y - 1, s + 2, s + 2, 4, 0x40000000);
            Render2D.texture(g, info.favicon, x, y, s, s, 1f);
        } else {
            Render2D.roundedGradient(g, x, y, s, s, s * 0.2f, ColorUtil.withAlpha(Theme.accent2(), 160), ColorUtil.withAlpha(Theme.accent(), 120), true);
            Icons.globe(g, x + s / 2f, y + s / 2f, s * 0.5f, 0xFFFFFFFF);
            if (info != null && info.state == ServerInfo.State.LOADING) {
                float a = (System.currentTimeMillis() % 900) / 900f * 360;
                Render2D.ring(g, x + s / 2f, y + s / 2f, s * 0.36f, 1.4f, a, a + 250, 0xFFFFFFFF);
            }
        }
    }

    /** Compact row (h ≥ 36). */
    public static void row(Gfx g, ServerInfo.Info info, String name, float x, float y, float w, float h, float hover, boolean selected) {
        float r = Theme.radius();
        if (hover > 0.01f || selected) Render2D.shadow(g, x, y, w, h, r, 5, ColorUtil.withAlpha(Theme.accent(), (int) (40 + 40 * Math.max(hover, selected ? 1 : 0))));
        Render2D.roundedRect(g, x, y, w, h, r, ColorUtil.lerp(0xB0160F26, 0xD0201634, hover));
        Render2D.roundedOutline(g, x, y, w, h, r, 1, selected ? ColorUtil.withAlpha(Theme.accent(), 200) : ColorUtil.lerp(0x22FFFFFF, ColorUtil.withAlpha(Theme.accent(), 140), hover));
        float is = h - 8;
        icon(g, info, x + 4, y + 4, is);
        float tx = x + is + 10, right = x + w - 8;
        boolean flag = info != null && info.countryCode != null;
        if (flag) ServerInfo.drawFlag(g, info, tx, y + 5.5f, 6.5f);
        float nx = tx + (flag ? 13 : 0);
        boolean narrow = w < 200;
        float reserve = info != null && info.online >= 0 ? Render2D.textWidth(info.online + "/" + info.max) * 0.75f + 22 : 40;
        Render2D.text(g, Render2D.trim(name, (int) (right - nx - reserve)), nx, y + 5, Theme.TEXT, true);
        // right side: players + ping
        if (info != null && info.state == ServerInfo.State.OFFLINE && info.online < 0) {
            String off = narrow ? "offline" : info.error != null ? info.error : "offline";
            Render2D.scaledText(g, off, right - Render2D.textWidth(off) * 0.7f, y + 6, 0.7f, 0xFFFF7A7A, false);
        } else if (info != null && info.online >= 0) {
            ServerInfo.drawBars(g, info.ping, right - 12, y + 4, 8);
            String pl = info.online + "/" + info.max;
            Render2D.scaledText(g, pl, right - 16 - Render2D.textWidth(pl) * 0.75f, y + 5.5f, 0.75f, Theme.TEXT_DIM, false);
        } else {
            Render2D.scaledText(g, "...", right - 10, y + 5, 0.75f, Theme.TEXT_MUTED, false);
        }
        // MOTD
        if (info != null && !info.motd.isEmpty()) {
            String[] lines = info.motd.split("\\n");
            for (int i = 0; i < Math.min(h > 40 ? 2 : 1, lines.length); i++) {
                Render2D.scaledText(g, Render2D.trim(lines[i].trim(), (int) ((right - tx) / 0.68f)), tx, y + 16 + i * 8, 0.68f, 0xFFD8D2CC, false);
            }
        } else {
            Render2D.scaledText(g, info == null || info.state == ServerInfo.State.LOADING ? "Sprawdzanie..." : "", tx, y + 16, 0.68f, Theme.TEXT_MUTED, false);
        }
        // bottom line: country + version
        if (h >= 44 && info != null) {
            String where = info.country != null ? info.country + (info.city != null && !info.city.isEmpty() ? ", " + info.city : "") : "";
            String ver = info.version.replaceAll("§.", "");
            String line = where + (where.isEmpty() || ver.isEmpty() ? "" : "  •  ") + ver;
            Render2D.scaledText(g, Render2D.trim(line, (int) ((right - tx) / 0.6f)), tx, y + h - 9, 0.6f, Theme.TEXT_MUTED, false);
        }
    }
}
