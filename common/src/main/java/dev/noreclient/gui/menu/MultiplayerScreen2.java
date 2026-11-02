package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.ServerCard;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.gui.widget.Album;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.util.Motion;
import dev.noreclient.util.ThemeTokens;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.MenuBackground;
import dev.noreclient.util.OfficialServer;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.ServerInfo;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Nore multiplayer: saved servers with icons, country flags, MOTD, players and ping, search,
 * add / edit / remove / reorder, and a direct-connect panel with a live preview of the server.
 * The official Nore MC server is pinned above the player's own servers in a section of its own.
 */
public class MultiplayerScreen2 extends NoreScreen {
    private static final float ROW = 46;
    /** "selected" value for the official server when servers.dat has no entry for it (yet). */
    private static final int OFFICIAL_VIRTUAL = -2;

    private List<String[]> servers = new ArrayList<String[]>();
    private final TextBox search = new TextBox("Szukaj serwera...", 40);
    private final TextBox direct = new TextBox("np. mc.hypixel.net", 64);
    private final TextBox dlgName = new TextBox("Nazwa serwera", 40);
    private final TextBox dlgAddr = new TextBox("Adres (IP lub domena)", 64);
    private final Map<String, Animation> anims = new HashMap<String, Animation>();
    private final Animation scroll = new Animation(0, 14), dialogAnim = new Animation(0, 12);
    private final long opened = System.currentTimeMillis();
    private float scrollTarget, contentH, listY, listH;
    private int selected = -1, dialog, editIndex = -1, lastClicked = -1, dlgPolicy, official = -1;
    private String tooltip;
    private long lastClickAt, deleteArmed, flashAt;
    private String flash, dlgError;
    private int flashColor;
    private boolean scrollToSelected;

    private final List<float[]> hitRects = new ArrayList<float[]>();
    private final List<Runnable> hitActions = new ArrayList<Runnable>();

    public MultiplayerScreen2(Object parent) {
        super(parent);
    }

    @Override
    protected void init() {
        reload();
    }

    /** Re-reads servers.dat: every change goes straight to the file, so the list always shows what is saved. */
    private void reload() {
        try { servers = game().serverList(); } catch (Exception e) { servers = new ArrayList<String[]>(); }
        official = OfficialServer.indexIn(servers);
        if (selected >= servers.size()) selected = servers.size() - 1;
    }

    private boolean isOfficial(int index) {
        return index == OFFICIAL_VIRTUAL || index >= 0 && index < servers.size() && OfficialServer.matches(servers.get(index)[1]);
    }

    /** {name, address} of the official server: the saved entry (keeps its settings) or the defaults. */
    private String[] officialEntry() {
        return official >= 0 && official < servers.size() ? servers.get(official) : new String[]{OfficialServer.NAME, OfficialServer.ADDRESS};
    }

    private void flash(String text) {
        flash(text, Theme.SUCCESS);
    }

    private void flash(String text, int color) {
        flash = text;
        flashColor = color;
        flashAt = System.currentTimeMillis();
    }

    /** "1 serwer", "3 serwery", "12 serwerów". */
    static String serversLabel(int n) {
        int m10 = n % 10, m100 = n % 100;
        if (n == 1) return "1 serwer";
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + " serwery";
        return n + " serwerów";
    }

    private static final String[] POLICY = {"Pytaj", "Włączone", "Wyłączone"};

    /** Moves the selected server one place up or down among the servers currently shown (search aware). */
    private void moveSelected(int dir) {
        List<Integer> vis = visible();
        int k = vis.indexOf(selected);
        if (k < 0 || k + dir < 0 || k + dir >= vis.size()) return;
        int to = vis.get(k + dir);
        game().moveServer(selected, to);
        selected = to;
        reload();
        scrollToSelected = true;
        Sounds.click();
    }

    private void deleteSelected() {
        if (isOfficial(selected)) { flash("Oficjalnego serwera nie można usunąć", Theme.WARNING); return; }
        if (selected < 0 || selected >= servers.size()) return;
        if (System.currentTimeMillis() - deleteArmed < 2500) {
            String name = servers.get(selected)[0];
            game().removeServer(selected);
            deleteArmed = 0;
            reload();
            if (selected >= servers.size()) selected = servers.size() - 1;
            flash("Usunięto: " + name);
        } else deleteArmed = System.currentTimeMillis();
    }

    @Override
    public Background background() { return Background.NONE; }

    private Animation anim(String k) {
        Animation a = anims.get(k);
        if (a == null) anims.put(k, a = new Animation(0, 16));
        return a;
    }

    private void hit(float x, float y, float w, float h, Runnable r) {
        hitRects.add(new float[]{x, y, w, h});
        hitActions.add(r);
    }

    private List<Integer> visible() {
        List<Integer> out = new ArrayList<Integer>();
        String q = search.getText().trim().toLowerCase(Locale.ROOT);
        for (int i = 0; i < servers.size(); i++) {
            String[] s = servers.get(i);
            if (OfficialServer.matches(s[1])) continue; // pinned in its own section
            if (q.isEmpty() || s[0].toLowerCase(Locale.ROOT).contains(q) || s[1].toLowerCase(Locale.ROOT).contains(q)) out.add(i);
        }
        return out;
    }

    private void join(String name, String address) {
        if (address == null || address.trim().isEmpty()) return;
        Sounds.click();
        game().connect(name, address.trim(), this);
    }

    /** Pill button; returns its width. */
    private boolean compact;

    private float button(Gfx g, int mx, int my, float x, float y, String label, int style, boolean active, Runnable action) {
        return button(g, mx, my, x, y, label, style, active, action, null);
    }

    /** As above; a disabled button shows {@code reason} as a tooltip on hover. */
    private float button(Gfx g, int mx, int my, float x, float y, String label, int style, boolean active, Runnable action, String reason) {
        float w = Render2D.textWidth(label) + (compact ? 9 : 18), h = 18;
        if (!active && reason != null && dialog == 0 && Render2D.hovered(mx, my, x, y, w, h)) tooltip = reason;
        boolean hov = active && dialog == 0 && Render2D.hovered(mx, my, x, y, w, h);
        int st = style == 1 ? Album.PRIMARY : style == 2 ? Album.DANGER : Album.SECONDARY;
        Album.button(g, x, y, w, h, label, st, anim("b" + label).target(hov ? 1 : 0).update(), active);
        if (active) hit(x, y, w, h, action);
        return w;
    }

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        CurrentGfx.set(g);
        hitRects.clear();
        hitActions.clear();
        tooltip = null;
        MenuBackground.render(g, width, height, mx, my);
        Render2D.rect(g, 0, 0, width, height, ColorUtil.withAlpha(Theme.page(), 0x9C));
        float in = Motion.screen(opened);
        boolean inputOk = dialog == 0;

        // ------------------------------------------------------------ header
        float pad = 14;
        g.setAlpha(in);
        boolean bh = inputOk && Render2D.hovered(mx, my, pad, 12, 20, 20);
        float ba = anim("back").target(bh ? 1 : 0).update();
        if (ba > 0.02f) Album.sticker(g, pad, 12, 20, 20, 10, Theme.VINYL, ba);
        else Render2D.roundedRect(g, pad, 12, 20, 20, 10, Theme.RAISED_2);
        int bc = ColorUtil.lerp(Theme.TEXT, Theme.VINYL_INK, ba);
        float bby = 12 - ba * Motion.travel();
        Render2D.line(g, pad + 12, bby + 5, pad + 7, bby + 10, 1.6f, bc);
        Render2D.line(g, pad + 7, bby + 10, pad + 12, bby + 15, 1.6f, bc);
        if (inputOk) hit(pad, 12, 20, 20, this::close);
        Album.titleShadow(g, "Multiplayer", pad + 28, 11, Theme.TEXT);
        Render2D.text(g, serversLabel(servers.size()), pad + 28, 30, Theme.TEXT_DIM, true);
        if (flash != null) {
            float fa = 1 - Math.max(0, (System.currentTimeMillis() - flashAt - 1800) / 600f);
            if (fa <= 0) flash = null;
            else {
                float fx = pad + 28 + Render2D.textWidth(serversLabel(servers.size())) + 8;
                g.setAlpha(in * fa);
                Album.dot(g, fx + 2, 34, 2, flashColor);
                Render2D.text(g, flash, fx + 7, 30, Theme.TEXT, true);
                g.setAlpha(in);
            }
        }
        boolean wide = width > 520;
        String addL = wide ? "+ Dodaj serwer" : "+ Dodaj", refL = "Odśwież", clsL = wide ? "Klasyczna lista" : "Klasyczna";
        float bx = width - pad;
        bx -= Render2D.textWidth(addL) + 18;
        button(g, mx, my, bx, 14, addL, 1, true, () -> openDialog(-1));
        bx -= Render2D.textWidth(refL) + 18 + 5;
        button(g, mx, my, bx, 14, refL, 0, true, () -> { for (String[] s : servers) ServerInfo.invalidate(s[1]); Sounds.click(); });
        bx -= Render2D.textWidth(clsL) + 18 + 5;
        if (bx > pad + 28 + Render2D.textWidth("Multiplayer") * 2 + 6) button(g, mx, my, bx, 14, clsL, 0, true, () -> game().openVanillaMultiplayer(this));

        // ------------------------------------------------------------ server list (left)
        float top = 44, lw = Math.max(200, width * 0.58f - pad), lx = pad;
        search.render(g, lx, top, lw, 18, TextBox.SEARCH_ICON);
        if (inputOk) hit(lx, top, lw, 18, () -> focus(search));
        // official server: always on top, not affected by search or scrolling
        float oy = top + 24;
        Render2D.text(g, "Oficjalny serwer", lx + 2, oy - 1, Theme.accentLight(), true);
        oy += 10;
        final String[] off = officialEntry();
        boolean ohov = inputOk && Render2D.hovered(mx, my, lx, oy, lw, ROW);
        float oh = anim("official").target(ohov ? 1 : 0).update();
        // always shown as "Nore MC", also when the player saved it under a name of their own
        ServerCard.row(g, ServerInfo.get(off[1]), OfficialServer.NAME, "oficjalny", lx, oy, lw, ROW, oh, isOfficial(selected));
        if (oh > 0.05f) {
            Render2D.roundedRect(g, lx + 4, oy + 4, ROW - 8, ROW - 8, 4, ColorUtil.withAlpha(0xFF000000, (int) (140 * oh)));
            Icons.play(g, lx + ROW / 2f, oy + ROW / 2f, 14, ColorUtil.withAlpha(0xFFFFFFFF, (int) (255 * oh)));
        }
        if (inputOk) {
            final int oi = official >= 0 ? official : OFFICIAL_VIRTUAL;
            hit(lx, oy, lw, ROW, () -> {
                long now = System.currentTimeMillis();
                if (lastClicked == oi && now - lastClickAt < 350) join(off[0], off[1]);
                else { selected = oi; deleteArmed = 0; Sounds.click(); }
                lastClicked = oi;
                lastClickAt = now;
            });
            hit(lx + 4, oy + 4, ROW - 8, ROW - 8, () -> join(off[0], off[1]));
        }
        oy += ROW + 6;
        Render2D.text(g, "Twoje serwery", lx + 2, oy - 1, Theme.TEXT_DIM, true);
        listY = oy + 8;
        listH = height - listY - 10;
        List<Integer> vis = visible();
        contentH = vis.size() * (ROW + 5);
        if (scrollToSelected) {
            scrollToSelected = false;
            int k = vis.indexOf(selected);
            if (k >= 0) {
                float top0 = k * (ROW + 5), bot0 = top0 + ROW;
                if (top0 < scrollTarget) scrollTarget = top0;
                else if (bot0 > scrollTarget + listH) scrollTarget = bot0 - listH;
            }
        }
        scrollTarget = Math.max(0, Math.min(scrollTarget, contentH - listH));
        float sc = scroll.target(scrollTarget).update();
        g.scissor((int) lx - 6, (int) listY - 2, (int) (lx + lw + 6), (int) (listY + listH));
        if (vis.isEmpty()) {
            Icons.globe(g, lx + lw / 2f, listY + 50, 18, ColorUtil.withAlpha(Theme.accent(), 150));
            boolean none = servers.size() - (official >= 0 ? 1 : 0) <= 0;
            Render2D.centeredText(g, none ? "Nie masz zapisanych serwerów" : "Brak wyników", lx + lw / 2f, listY + 70, Theme.TEXT_MUTED, false);
            if (none) {
                String hint = "Dodaj serwer albo wpisz adres w panelu obok";
                Render2D.scaledText(g, hint, lx + lw / 2f - Render2D.textWidth(hint) * 0.36f, listY + 82, 0.72f, Theme.TEXT_MUTED, false);
            }
        }
        for (int k = 0; k < vis.size(); k++) {
            final int i = vis.get(k);
            String[] s = servers.get(i);
            float y = listY + k * (ROW + 5) - sc;
            if (y + ROW < listY - 2 || y > listY + listH) continue;
            float st = Animation.easeOutCubic((System.currentTimeMillis() - opened - Math.min(k, 12) * 40L) / 380f);
            float x = lx + (1 - Math.max(0, st)) * -20;
            g.setAlpha(in * Math.max(0, Math.min(1, st)));
            boolean hov = inputOk && my >= listY && my <= listY + listH && Render2D.hovered(mx, my, x, y, lw, ROW);
            float h = anim("row" + i).target(hov ? 1 : 0).update();
            ServerInfo.Info info = ServerInfo.get(s[1]);
            ServerCard.row(g, info, s[0], x, y, lw, ROW, h, i == selected);
            // play button over the icon on hover
            if (h > 0.05f) {
                Render2D.roundedRect(g, x + 4, y + 4, ROW - 8, ROW - 8, 4, ColorUtil.withAlpha(0xFF000000, (int) (140 * h)));
                Icons.play(g, x + ROW / 2f, y + ROW / 2f, 14, ColorUtil.withAlpha(0xFFFFFFFF, (int) (255 * h)));
            }
            if (inputOk && my >= listY && my <= listY + listH) {
                hit(x, y, lw, ROW, () -> {
                    long now = System.currentTimeMillis();
                    if (lastClicked == i && now - lastClickAt < 350) join(s[0], s[1]);
                    else { selected = i; deleteArmed = 0; Sounds.click(); }
                    lastClicked = i;
                    lastClickAt = now;
                });
                hit(x + 4, y + 4, ROW - 8, ROW - 8, () -> join(s[0], s[1]));
            }
        }
        g.setAlpha(in);
        g.endScissor();
        if (contentH > listH) {
            float th = Math.max(20, listH * listH / contentH), ty = listY + (listH - th) * (sc / (contentH - listH));
            Render2D.roundedRect(g, lx + lw + 3, ty, 2.5f, th, 1.2f, ColorUtil.withAlpha(Theme.accent(), 140));
        }

        // ------------------------------------------------------------ right panel
        float rx = lx + lw + 12, rw = width - rx - pad, ry = top;
        if (rw > 130) {
            // direct connect
            float dh = 40;
            String typed = direct.getText().trim();
            String settledDirect = ServerInfo.settled(direct, typed);
            ServerInfo.Info pv = settledDirect != null ? ServerInfo.get(settledDirect) : null;
            if (pv != null) dh += 54;
            panel(g, rx, ry, rw, dh, rw > 170 ? "Bezpośrednie połączenie" : "Połącz z adresem");
            float jw = Render2D.textWidth("Dołącz") + 18;
            direct.render(g, rx + 6, ry + 17, rw - jw - 16, 17, null);
            if (inputOk) hit(rx + 6, ry + 17, rw - jw - 16, 17, () -> focus(direct));
            button(g, mx, my, rx + rw - jw - 6, ry + 16.5f, "Dołącz", 1, pv != null, () -> join(typed, typed));
            if (pv != null) {
                ServerCard.row(g, pv, typed, rx + 6, ry + 40, rw - 12, 48, 0.2f, false);
                if (inputOk) hit(rx + 6, ry + 40, rw - 12, 48, () -> join(typed, typed));
            }
            ry += dh + 8;
            // selected server details
            if (isOfficial(selected)) {
                officialPanel(g, mx, my, rx, ry, rw);
            } else if (selected >= 0 && selected < servers.size()) {
                final String[] s = servers.get(selected);
                ServerInfo.Info info = ServerInfo.get(s[1]);
                float dh2 = Math.min(height - ry - 10, 150);
                panel(g, rx, ry, rw, dh2, "Wybrany serwer");
                details(g, info, s, rx + 6, ry + 17, rw - 12, dh2 - 44);
                float by = ry + dh2 - 24;
                float x = rx + 6;
                compact = rw < 210;
                x += button(g, mx, my, x, by, "Dołącz", 1, true, () -> join(s[0], s[1])) + 4;
                x += button(g, mx, my, x, by, "Edytuj", 0, true, () -> openDialog(selected)) + 4;
                boolean armed = System.currentTimeMillis() - deleteArmed < 2500;
                x += button(g, mx, my, x, by, armed ? "Na pewno?" : "Usuń", 2, true, this::deleteSelected) + 4;
                if (x + 40 < rx + rw) {
                    List<Integer> shown = visible();
                    int k = shown.indexOf(selected);
                    x += button(g, mx, my, x, by, "↑", 0, k > 0, () -> moveSelected(-1)) + 4;
                    button(g, mx, my, x, by, "↓", 0, k >= 0 && k < shown.size() - 1, () -> moveSelected(1));
                }
                compact = false;
            } else {
                panel(g, rx, ry, rw, 52, "Wskazówka");
                Render2D.scaledText(g, "Kliknij serwer, aby zobaczyć szczegóły.", rx + 8, ry + 19, 0.7f, Theme.TEXT_DIM, false);
                Render2D.scaledText(g, "Dwuklik albo ikona ▶ – dołącz od razu.", rx + 8, ry + 29, 0.7f, Theme.TEXT_DIM, false);
                Render2D.scaledText(g, "Flaga = kraj, w którym stoi serwer.", rx + 8, ry + 39, 0.7f, Theme.TEXT_DIM, false);
            }
        }
        g.setAlpha(1);
        if (tooltip != null) drawTooltip(g, tooltip, mx, my);

        // ------------------------------------------------------------ add / edit dialog
        float d = dialogAnim.target(dialog != 0 ? 1 : 0).update();
        if (d > 0.01f) renderDialog(g, mx, my, d);
    }

    /** Details of the official server: live status, a short info card, Join and the resource pack choice. */
    private void officialPanel(Gfx g, int mx, int my, float rx, float ry, float rw) {
        final String[] s = officialEntry();
        ServerInfo.Info info = ServerInfo.get(s[1]);
        float dh2 = Math.min(height - ry - 10, 176);
        panel(g, rx, ry, rw, dh2, "Oficjalny serwer");
        ServerCard.badge(g, "partner", rx + 12 + Render2D.textWidth("Oficjalny serwer"), ry + 4);
        // info card: a paper clipping with the tagline and the live state
        float cy = ry + 19;
        Album.clipping(g, rx + 6, cy, rw - 12, 22, 0, 0);
        Render2D.scaledText(g, Render2D.trim(OfficialServer.TAGLINE, (int) ((rw - 34) / 0.7f)), rx + 22, cy + 3.5f, 0.7f, Theme.VINYL_INK, false);
        boolean loading = info == null || info.state == ServerInfo.State.LOADING && info.online < 0;
        boolean down = !loading && info.state == ServerInfo.State.OFFLINE && info.online < 0;
        String state = loading ? "Sprawdzanie statusu..."
                : down ? ("Nieznany adres".equals(info.error) ? "Status: nieznany (adres jeszcze nie działa)" : "Status: offline")
                : "Status: online";
        int stateCol = loading ? ThemeTokens.DOT_WAIT : down ? ThemeTokens.DOT_ERROR : ThemeTokens.DOT_READY;
        Album.dot(g, rx + 14, cy + 11, 2.2f, stateCol);
        Render2D.scaledText(g, Render2D.trim(state, (int) ((rw - 34) / 0.62f)), rx + 22, cy + 12.5f, 0.62f, Theme.VINYL_INK_SOFT, false);
        details(g, info, new String[]{OfficialServer.NAME, s[1]}, rx + 6, cy + 25, rw - 12, dh2 - 25 - 17 - 62);
        float by = ry + dh2 - 24;
        // resource packs sent by the server: stored with the saved entry and used when joining
        if (official >= 0) {
            final int idx = official;
            float py = by - 18;
            Render2D.scaledText(g, "Paczki zasobów serwera", rx + 8, py + 4, 0.7f, Theme.TEXT_MUTED, false);
            int pol = Math.max(0, Math.min(2, game().serverPackPolicy(idx)));
            String label = POLICY[pol];
            float pw = Render2D.textWidth(label) + 16, pxx = rx + rw - 8 - pw;
            boolean ph = dialog == 0 && Render2D.hovered(mx, my, pxx, py, pw, 14);
            int pc = pol == 1 ? ThemeTokens.DOT_READY : pol == 2 ? ThemeTokens.DOT_ERROR : ThemeTokens.DOT_WAIT;
            Album.button(g, pxx, py, pw, 14, label, Album.SECONDARY, anim("opol").target(ph ? 1 : 0).update());
            Album.dot(g, pxx + 1, py + 1, 1.8f, pc);
            if (dialog == 0) hit(pxx, py, pw, 14, () -> {
                game().setServerPackPolicy(idx, (game().serverPackPolicy(idx) + 1) % 3);
                Sounds.click();
            });
        }
        float x = rx + 6;
        compact = rw < 210;
        x += button(g, mx, my, x, by, "Dołącz", 1, true, () -> join(s[0], s[1])) + 4;
        x += button(g, mx, my, x, by, "Edytuj", 0, false, null, OfficialServer.LOCKED) + 4;
        button(g, mx, my, x, by, "Usuń", 2, false, null, OfficialServer.LOCKED);
        compact = false;
    }

    private void drawTooltip(Gfx g, String text, int mx, int my) {
        List<String> lines = ModsScreen.wrap(text, 180);
        float w = 0;
        for (String l : lines) w = Math.max(w, Render2D.textWidth(l) * 0.7f);
        w += 10;
        float h = lines.size() * 8 + 7;
        float x = Math.min(width - w - 4, mx + 8), y = Math.max(4, my - h - 4);
        Album.floating(g, x, y, w, h, ColorUtil.withAlpha(Theme.SLOT, 0xF2));
        Render2D.roundedOutline(g, x, y, w, h, Album.R, 1, Theme.GHOST);
        for (int i = 0; i < lines.size(); i++) Render2D.scaledText(g, lines.get(i), x + 5, y + 4 + i * 8, 0.7f, Theme.TEXT, false);
    }

    private void panel(Gfx g, float x, float y, float w, float h, String title) {
        Album.sheet(g, x, y, w, h);
        Render2D.text(g, title, x + 7, y + 5, Theme.TEXT, false);
    }

    private void details(Gfx g, ServerInfo.Info info, String[] s, float x, float y, float w, float h) {
        ServerCard.icon(g, info, x, y, 32);
        float tx = x + 38;
        Render2D.text(g, Render2D.trim(s[0], (int) (w - 40)), tx, y + 1, Theme.TEXT, true);
        Render2D.scaledText(g, Render2D.trim(s[1], (int) ((w - 40) / 0.7f)), tx, y + 11, 0.7f, Theme.TEXT_MUTED, false);
        if (info != null && info.countryCode != null) {
            ServerInfo.drawFlag(g, info, tx, y + 20, 6.5f);
            String where = info.country + (info.city != null && !info.city.isEmpty() ? ", " + info.city : "");
            Render2D.scaledText(g, Render2D.trim(where, (int) ((w - 54) / 0.7f)), tx + 13, y + 21, 0.7f, Theme.TEXT_DIM, false);
        }
        float ly = y + 38;
        if (info == null) return;
        // "..." while checking, "—" once the server did not answer
        String none = info.state == ServerInfo.State.OFFLINE ? "—" : "...";
        String[][] rows = {
                {"Gracze", info.online >= 0 ? info.online + " / " + info.max : none},
                {"Ping", info.ping >= 0 ? info.ping + " ms" : none},
                {"Wersja", info.version.isEmpty() ? none : info.version.replaceAll("§.", "")},
                {"IP", info.ip == null ? none : info.ip},
                {"Dostawca", info.isp == null ? "—" : info.isp}};
        for (String[] r : rows) {
            if (ly > y + h - 6) break;
            Render2D.scaledText(g, r[0], x + 2, ly, 0.68f, Theme.TEXT_MUTED, false);
            String v = Render2D.trim(r[1], (int) ((w - 60) / 0.72f));
            Render2D.scaledText(g, v, x + w - Render2D.textWidth(v) * 0.72f, ly - 0.3f, 0.72f, Theme.TEXT, false);
            ly += 9.5f;
        }
        if (!info.sample.isEmpty() && ly < y + h - 8) {
            String names = String.join(", ", info.sample);
            Render2D.scaledText(g, Render2D.trim("Online: " + names, (int) ((w - 4) / 0.62f)), x + 2, ly + 2, 0.62f, ColorUtil.brighten(Theme.accent(), 0.3f), false);
        }
    }

    // ------------------------------------------------------------ dialog

    private void openDialog(int index) {
        if (index >= servers.size()) return;
        if (index != -1 && isOfficial(index)) { flash("Oficjalnego serwera nie można edytować", Theme.WARNING); return; }
        dialog = index < 0 ? 1 : 2;
        editIndex = index;
        dlgError = null;
        dlgName.setText(index < 0 ? "" : servers.get(index)[0]);
        dlgAddr.setText(index < 0 ? direct.getText().trim() : servers.get(index)[1]);
        dlgPolicy = index < 0 ? 0 : game().serverPackPolicy(index);
        // the fields read top to bottom: name first (typing a name into the focused address box
        // used to save servers with the name as their address)
        focus(dlgName);
        Sounds.click();
    }

    private void saveDialog() {
        String addr = dlgAddr.getText().trim();
        if (addr.isEmpty()) {
            dlgError = "Wpisz adres serwera";
            focus(dlgAddr);
            return;
        }
        if (addr.contains(" ")) {
            dlgError = "Adres nie może zawierać spacji";
            focus(dlgAddr);
            return;
        }
        if (OfficialServer.matches(addr)) {
            dlgError = "Oficjalny serwer jest już na liście";
            focus(dlgAddr);
            return;
        }
        String name = dlgName.getText().trim().isEmpty() ? addr : dlgName.getText().trim();
        if (dialog == 1) {
            game().addServer(name, addr);
            reload();
            selected = -1;
            for (int i = servers.size() - 1; i >= 0; i--) {
                if (servers.get(i)[1].equals(addr) && servers.get(i)[0].equals(name)) { selected = i; break; }
            }
            if (selected >= 0 && dlgPolicy != 0) game().setServerPackPolicy(selected, dlgPolicy);
            flash(selected >= 0 ? "Zapisano serwer" : "Nie udało się zapisać");
            search.setText("");
        } else {
            if (editIndex >= 0 && editIndex < servers.size()) {
                game().editServer(editIndex, name, addr);
                if (game().serverPackPolicy(editIndex) != dlgPolicy) game().setServerPackPolicy(editIndex, dlgPolicy);
                selected = editIndex;
            }
            flash("Zapisano zmiany");
        }
        dialog = 0;
        reload();
        scrollToSelected = true;
        Sounds.toggle(true);
    }

    private boolean duplicate(String addr) {
        for (int i = 0; i < servers.size(); i++) {
            if (i != editIndex && servers.get(i)[1].equalsIgnoreCase(addr)) return true;
        }
        return false;
    }

    private void renderDialog(Gfx g, int mx, int my, float d) {
        Album.scrim(g, width, height, d);
        float w = Math.min(280, width - 30), h = 172, x = (width - w) / 2f, y = (height - h) / 2f + (1 - d) * 16;
        g.setAlpha(d);
        panel(g, x, y, w, h, dialog == 2 ? "Edytuj serwer" : "Dodaj serwer");
        Render2D.scaledText(g, "Nazwa", x + 8, y + 19, 0.68f, Theme.TEXT_MUTED, false);
        dlgName.render(g, x + 8, y + 26, w - 16, 17, null);
        Render2D.scaledText(g, "Adres", x + 8, y + 48, 0.68f, Theme.TEXT_MUTED, false);
        dlgAddr.render(g, x + 8, y + 55, w - 16, 17, null);
        String addr = dlgAddr.getText().trim();
        String settledAddr = ServerInfo.settled(dlgAddr, addr);
        if (settledAddr != null) {
            ServerCard.row(g, ServerInfo.get(settledAddr), dlgName.getText().trim().isEmpty() ? addr : dlgName.getText().trim(), x + 8, y + 77, w - 16, 44, 0.2f, false);
        } else {
            Render2D.scaledText(g, "Podgląd pojawi się po wpisaniu adresu.", x + 8, y + 92, 0.7f, Theme.TEXT_MUTED, false);
        }
        // resource packs sent by the server (same setting as in the vanilla edit screen)
        float py = y + 126;
        Render2D.scaledText(g, "Paczki zasobów serwera", x + 8, py + 4, 0.7f, Theme.TEXT_MUTED, false);
        String pol = POLICY[Math.max(0, Math.min(2, dlgPolicy))];
        float pw = Render2D.textWidth(pol) + 16, pxx = x + w - 8 - pw;
        boolean ph = Render2D.hovered(mx, my, pxx, py, pw, 14);
        int pc = dlgPolicy == 1 ? Theme.SUCCESS : dlgPolicy == 2 ? Theme.ERROR : Theme.accent();
        Album.button(g, pxx, py, pw, 14, pol, Album.SECONDARY, anim("dpol").target(ph ? 1 : 0).update());
        Album.dot(g, pxx + 1, py + 1, 1.8f, pc);
        String warn = dlgError != null ? dlgError : (addr.isEmpty() ? null : OfficialServer.matches(addr) ? "Oficjalny serwer jest już na liście"
                : duplicate(addr) ? "Ten adres jest już na liście" : null);
        if (warn != null) Render2D.scaledText(g, warn, x + 8, y + h - 18, 0.7f, dlgError != null ? Theme.ERROR : Theme.WARNING, false);
        if (dialog != 0) {
            hitRects.clear();
            hitActions.clear();
            hit(x + 8, y + 26, w - 16, 17, () -> focus(dlgName));
            hit(x + 8, y + 55, w - 16, 17, () -> focus(dlgAddr));
            hit(pxx, py, pw, 14, () -> { dlgPolicy = (dlgPolicy + 1) % 3; Sounds.click(); });
            float bw1 = Render2D.textWidth("Zapisz") + 18, bw2 = Render2D.textWidth("Anuluj") + 18;
            float by = y + h - 24;
            dialogButton(g, mx, my, x + w - 8 - bw1, by, bw1, "Zapisz", true, this::saveDialog);
            dialogButton(g, mx, my, x + w - 12 - bw1 - bw2, by, bw2, "Anuluj", false, () -> dialog = 0);
        }
        g.setAlpha(1);
    }

    private void dialogButton(Gfx g, int mx, int my, float x, float y, float w, String label, boolean primary, Runnable r) {
        boolean hov = Render2D.hovered(mx, my, x, y, w, 18);
        Album.button(g, x, y, w, 18, label, primary ? Album.PRIMARY : Album.SECONDARY, anim("d" + label).target(hov ? 1 : 0).update());
        hit(x, y, w, 18, r);
    }

    // ------------------------------------------------------------ input

    private void focus(TextBox box) {
        search.setFocused(box == search);
        direct.setFocused(box == direct);
        dlgName.setFocused(box == dlgName);
        dlgAddr.setFocused(box == dlgAddr);
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (button != 0) return false;
        for (int i = hitRects.size() - 1; i >= 0; i--) {
            float[] r = hitRects.get(i);
            if (Render2D.hovered(mx, my, r[0], r[1], r[2], r[3])) {
                hitActions.get(i).run();
                return true;
            }
        }
        if (dialog == 0) focus(null);
        return false;
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double amount) {
        if (dialog != 0) return true;
        scrollTarget = (float) Math.max(0, Math.min(contentH - listH, scrollTarget - amount * 30));
        return true;
    }

    @Override
    public boolean charTyped(char c) {
        for (TextBox b : new TextBox[]{search, direct, dlgName, dlgAddr}) if (b.charTyped(c)) return true;
        return false;
    }

    @Override
    public boolean keyPressed(int key, int modifiers) {
        if (dialog != 0) {
            if (key == Keys.ESCAPE) { dialog = 0; return true; }
            if (key == Keys.ENTER || key == Keys.KP_ENTER) {
                if (dlgName.isFocused() && dlgAddr.getText().trim().isEmpty()) focus(dlgAddr);
                else saveDialog();
                return true;
            }
            if (key == Keys.TAB) { focus(dlgName.isFocused() ? dlgAddr : dlgName); return true; }
            if (dlgName.keyPressed(key) || dlgAddr.keyPressed(key)) { dlgError = null; return true; }
            return true;
        }
        if (direct.isFocused() && (key == Keys.ENTER || key == Keys.KP_ENTER)) {
            String t = direct.getText().trim();
            if (ServerInfo.looksLikeAddress(t)) join(t, t);
            return true;
        }
        if (search.keyPressed(key) || direct.keyPressed(key)) return true;
        if (key == Keys.ESCAPE && (search.isFocused() || direct.isFocused())) { focus(null); return true; }
        if ((key == Keys.ENTER || key == Keys.KP_ENTER) && selected >= 0 && selected < servers.size()) {
            join(servers.get(selected)[0], servers.get(selected)[1]);
            return true;
        }
        if (key == Keys.DOWN || key == Keys.UP) {
            List<Integer> vis = visible();
            if (vis.isEmpty()) return true;
            int k = vis.indexOf(selected), dir = key == Keys.DOWN ? 1 : -1;
            if (game().shiftDown() && k >= 0) { moveSelected(dir); return true; }
            k = k < 0 ? (dir > 0 ? 0 : vis.size() - 1) : Math.max(0, Math.min(vis.size() - 1, k + dir));
            selected = vis.get(k);
            deleteArmed = 0;
            scrollToSelected = true;
            return true;
        }
        if (key == Keys.DELETE && selected >= 0) {
            deleteSelected();
            return true;
        }
        return super.keyPressed(key, modifiers);
    }
}
