package dev.noreclient.gui.widget;

import dev.noreclient.api.Gfx;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.ServerInfo;
import dev.noreclient.util.Motion;
import dev.noreclient.util.Theme;
import dev.noreclient.util.ThemeTokens;

/** A Minecraft server drawn the Nore way: icon, flag, MOTD, players, ping and version. */
public final class ServerCard {
    private ServerCard() {}

    public static void icon(Gfx g, ServerInfo.Info info, float x, float y, float s) {
        if (info != null && info.favicon != null) {
            Render2D.roundedRect(g, x - 1, y - 1, s + 2, s + 2, 3, Theme.VINYL);
            Render2D.texture(g, info.favicon, x, y, s, s, 1f);
        } else {
            // no icon yet: a ghost slot with the globe silhouette
            Album.slot(g, x, y, s, s, 3);
            Icons.globe(g, x + s / 2f, y + s / 2f, s * 0.45f, Theme.GHOST);
            if (info != null && info.state == ServerInfo.State.LOADING) {
                float a = (System.currentTimeMillis() % 900) / 900f * 360;
                Render2D.ring(g, x + s / 2f, y + s / 2f, s * 0.36f, 1.4f, a, a + 250, Theme.accent());
            }
        }
    }

    /** Compact row (h ≥ 36). */
    public static void row(Gfx g, ServerInfo.Info info, String name, float x, float y, float w, float h, float hover, boolean selected) {
        row(g, info, name, null, x, y, w, h, hover, selected);
    }

    /** Vinyl label sticker after a server name ("oficjalny"); returns its width. */
    public static float badge(Gfx g, String text, float x, float y) {
        return Album.label(g, text, x, y, Theme.VINYL, Theme.VINYL_INK);
    }

    /** Compact row (h ≥ 36) with an optional badge after the name. */
    public static void row(Gfx g, ServerInfo.Info info, String name, String badge, float x, float y, float w, float h, float hover, boolean selected) {
        float r = Album.R;
        // Album: rows are sheets; the official server is an accent-deep sticker; the selected row gets the vinyl rim
        boolean official = badge != null;
        int face = official ? Theme.accentDeep() : ColorUtil.lerp(ColorUtil.withAlpha(Theme.raised(), 0xE6), Theme.RAISED_2, hover);
        if (official || selected) Album.sticker(g, x, y, w, h, r, face, hover);
        else {
            if (hover > 0.01f) Render2D.shadow(g, x, y + 2 - hover, w, h, r, 4, ColorUtil.withAlpha(0xFF000000, (int) (110 * hover)));
            Render2D.roundedRect(g, x, y - hover * Motion.travel(), w, h, r, face);
        }
        y -= hover * Motion.travel();
        float is = h - 8;
        icon(g, info, x + 4, y + 4, is);
        float tx = x + is + 10, right = x + w - 8;
        boolean flag = info != null && info.countryCode != null;
        if (flag) ServerInfo.drawFlag(g, info, tx, y + 5.5f, 6.5f);
        float nx = tx + (flag ? 13 : 0);
        boolean narrow = w < 200;
        float reserve = info != null && info.online >= 0 ? Render2D.textWidth(info.online + "/" + info.max) * 0.75f + 22 : 40;
        float badgeW = badge == null ? 0 : Album.labelWidth(badge) + 8;
        String shown = Render2D.trim(name, (int) (right - nx - reserve - badgeW));
        Render2D.text(g, shown, nx, y + 5, official ? 0xFFFFFFFF : Theme.TEXT, false);
        if (badge != null) badge(g, badge, nx + Render2D.textWidth(shown) + 5, y + 4);
        int soft = official ? 0xFFE9E2F5 : Theme.TEXT_DIM;
        // right side: state dot + players + ping
        if (info != null && info.state == ServerInfo.State.OFFLINE && info.online < 0) {
            String off = narrow ? "offline" : info.error != null ? info.error : "offline";
            float ow = Render2D.textWidth(off);
            Render2D.text(g, off, right - ow, y + 5, soft, false);
            Album.dot(g, right - ow - 5, y + 9, 2, ThemeTokens.DOT_ERROR);
        } else if (info != null && info.online >= 0) {
            ServerInfo.drawBars(g, info.ping, right - 12, y + 4, 8);
            String pl = info.online + "/" + info.max;
            float pw = Render2D.textWidth(pl);
            Render2D.text(g, pl, right - 16 - pw, y + 5, soft, false);
            Album.dot(g, right - 21 - pw, y + 9, 2, ThemeTokens.DOT_READY);
        } else {
            Album.dot(g, right - 3, y + 9, 2, ThemeTokens.DOT_WAIT);
        }
        // MOTD
        if (info != null && !info.motd.isEmpty()) {
            String[] lines = info.motd.split("\\n");
            for (int i = 0; i < Math.min(h > 40 ? 2 : 1, lines.length); i++) {
                Render2D.scaledText(g, Render2D.trim(lines[i].trim(), (int) ((right - tx) / 0.68f)), tx, y + 16 + i * 8, 0.68f, official ? 0xFFF3EFE9 : 0xFFD8D2CC, false);
            }
        } else {
            Render2D.scaledText(g, info == null || info.state == ServerInfo.State.LOADING ? "Sprawdzanie..." : "", tx, y + 16, 0.68f, Theme.TEXT_MUTED, false);
        }
        // bottom line: country + version
        if (h >= 44 && info != null) {
            String where = info.country != null ? info.country + (info.city != null && !info.city.isEmpty() ? ", " + info.city : "") : "";
            String ver = info.version.replaceAll("§.", "");
            String line = where + (where.isEmpty() || ver.isEmpty() ? "" : "  •  ") + ver;
            Render2D.scaledText(g, Render2D.trim(line, (int) ((right - tx) / 0.6f)), tx, y + h - 9, 0.6f, official ? 0xFFC6A3FF : Theme.TEXT_MUTED, false);
        }
    }
}
