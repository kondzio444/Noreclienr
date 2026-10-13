package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.ServerCard;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.MenuBackground;
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
 */
public class MultiplayerScreen2 extends NoreScreen {
    private static final float ROW = 46;

    private List<String[]> servers = new ArrayList<String[]>();
    private final TextBox search = new TextBox("Szukaj serwera...", 40);
    private final TextBox direct = new TextBox("np. mc.hypixel.net", 64);
    private final TextBox dlgName = new TextBox("Nazwa serwera", 40);
    private final TextBox dlgAddr = new TextBox("Adres (IP lub domena)", 64);
    private final Map<String, Animation> anims = new HashMap<String, Animation>();
    private final Animation scroll = new Animation(0, 14), dialogAnim = new Animation(0, 12);
    private final long opened = System.currentTimeMillis();
    private float scrollTarget, contentH, listY, listH;
    private int selected = -1, dialog, editIndex = -1, lastClicked = -1;
    private long lastClickAt, deleteArmed;

    private final List<float[]> hitRects = new ArrayList<float[]>();
    private final List<Runnable> hitActions = new ArrayList<Runnable>();

    public MultiplayerScreen2(Object parent) {
        super(parent);
    }

    @Override
    protected void init() {
        reload();
    }

    private void reload() {
        try { servers = game().serverList(); } catch (Exception e) { servers = new ArrayList<String[]>(); }
        if (selected >= servers.size()) selected = servers.size() - 1;
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
        float w = Render2D.textWidth(label) + (compact ? 9 : 18), h = 18;
        boolean hov = active && dialog == 0 && Render2D.hovered(mx, my, x, y, w, h);
        int col = style == 2 ? 0xFFFF5C5C : Theme.accent();
        Widgets.glowBox(g, x, y, w, h, Theme.radius(), col, anim("b" + label).target(hov ? 1 : 0).update(), active ? (style == 1 ? 1f : 0.55f) : 0.25f);
        Render2D.centeredText(g, label, x + w / 2f, y + 5, active ? Widgets.glowText(col, 0.3f) : Theme.TEXT_MUTED, false);
        if (active) hit(x, y, w, h, action);
        return w;
    }

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        CurrentGfx.set(g);
        hitRects.clear();
        hitActions.clear();
        MenuBackground.render(g, width, height, mx, my);
        Render2D.rect(g, 0, 0, width, height, 0x70080605);
        float in = Animation.easeOutCubic((System.currentTimeMillis() - opened) / 450f);
        boolean inputOk = dialog == 0;

        // ------------------------------------------------------------ header
        float pad = 14;
        g.setAlpha(in);
        boolean bh = inputOk && Render2D.hovered(mx, my, pad, 12, 20, 20);
        float ba = anim("back").target(bh ? 1 : 0).update();
        Render2D.circle(g, pad + 10, 22, 10, ColorUtil.withAlpha(Theme.accent(), (int) (40 + 60 * ba)));
        Render2D.line(g, pad + 12, 17, pad + 7, 22, 1.6f, 0xFFFFFFFF);
        Render2D.line(g, pad + 7, 22, pad + 12, 27, 1.6f, 0xFFFFFFFF);
        if (inputOk) hit(pad, 12, 20, 20, this::close);
        Render2D.gradientText(g, "MULTIPLAYER", pad + 28, 13, 1.5f, Theme.accent2(), Theme.accent(), true);
        Render2D.scaledText(g, servers.size() + " serwerów", pad + 28, 28, 0.7f, Theme.TEXT_MUTED, false);
        boolean wide = width > 520;
        String addL = wide ? "+ Dodaj serwer" : "+ Dodaj", refL = "Odśwież", clsL = wide ? "Klasyczna lista" : "Klasyczna";
        float bx = width - pad;
        bx -= Render2D.textWidth(addL) + 18;
        button(g, mx, my, bx, 14, addL, 1, true, () -> openDialog(-1));
        bx -= Render2D.textWidth(refL) + 18 + 5;
        button(g, mx, my, bx, 14, refL, 0, true, () -> { for (String[] s : servers) ServerInfo.invalidate(s[1]); Sounds.click(); });
        bx -= Render2D.textWidth(clsL) + 18 + 5;
        if (bx > pad + 28 + Render2D.textWidth("MULTIPLAYER") * 1.5f + 6) button(g, mx, my, bx, 14, clsL, 0, true, () -> game().openVanillaMultiplayer(parent));

        // ------------------------------------------------------------ server list (left)
        float top = 44, lw = Math.max(200, width * 0.58f - pad), lx = pad;
        search.render(g, lx, top, lw, 18, TextBox.SEARCH_ICON);
        if (inputOk) hit(lx, top, lw, 18, () -> focus(search));
        listY = top + 24;
        listH = height - listY - 10;
        List<Integer> vis = visible();
        contentH = vis.size() * (ROW + 5);
        scrollTarget = Math.max(0, Math.min(scrollTarget, contentH - listH));
        float sc = scroll.target(scrollTarget).update();
        g.scissor((int) lx - 6, (int) listY - 2, (int) (lx + lw + 6), (int) (listY + listH));
        if (vis.isEmpty()) {
            Icons.globe(g, lx + lw / 2f, listY + 50, 18, ColorUtil.withAlpha(Theme.accent(), 150));
            Render2D.centeredText(g, servers.isEmpty() ? "Nie masz zapisanych serwerów" : "Brak wyników", lx + lw / 2f, listY + 70, Theme.TEXT_MUTED, false);
            if (servers.isEmpty()) {
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
            if (selected >= 0 && selected < servers.size()) {
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
                x += button(g, mx, my, x, by, armed ? "Na pewno?" : "Usuń", 2, true, () -> {
                    if (System.currentTimeMillis() - deleteArmed < 2500) { game().removeServer(selected); deleteArmed = 0; reload(); }
                    else deleteArmed = System.currentTimeMillis();
                }) + 4;
                if (x + 40 < rx + rw) {
                    x += button(g, mx, my, x, by, "↑", 0, selected > 0, () -> { game().moveServer(selected, selected - 1); selected--; reload(); }) + 4;
                    button(g, mx, my, x, by, "↓", 0, selected < servers.size() - 1, () -> { game().moveServer(selected, selected + 1); selected++; reload(); });
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

        // ------------------------------------------------------------ add / edit dialog
        float d = dialogAnim.target(dialog != 0 ? 1 : 0).update();
        if (d > 0.01f) renderDialog(g, mx, my, d);
    }

    private void panel(Gfx g, float x, float y, float w, float h, String title) {
        float r = Theme.radius();
        Render2D.shadow(g, x, y, w, h, r, 6, 0x70000000);
        Render2D.roundedRect(g, x, y, w, h, r, 0xC8120E0B);
        Render2D.roundedOutline(g, x, y, w, h, r, 1, 0x26FFFFFF);
        Render2D.quadGradient(g, x + 8, y, w - 16, 1, 0, ColorUtil.withAlpha(Theme.accent(), 150), ColorUtil.withAlpha(Theme.accent(), 150), 0);
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
        String[][] rows = {
                {"Gracze", info.online >= 0 ? info.online + " / " + info.max : "..."},
                {"Ping", info.ping >= 0 ? info.ping + " ms" : "..."},
                {"Wersja", info.version.isEmpty() ? "..." : info.version.replaceAll("§.", "")},
                {"IP", info.ip == null ? "..." : info.ip},
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
        dialog = index < 0 ? 1 : 2;
        editIndex = index;
        dlgName.setText(index < 0 ? "" : servers.get(index)[0]);
        dlgAddr.setText(index < 0 ? direct.getText().trim() : servers.get(index)[1]);
        focus(index < 0 ? dlgAddr : dlgName);
        Sounds.click();
    }

    private void saveDialog() {
        String addr = dlgAddr.getText().trim();
        if (addr.isEmpty()) return;
        String name = dlgName.getText().trim().isEmpty() ? addr : dlgName.getText().trim();
        if (dialog == 1) { game().addServer(name, addr); reload(); selected = servers.size() - 1; }
        else game().editServer(editIndex, name, addr);
        dialog = 0;
        reload();
        Sounds.toggle(true);
    }

    private void renderDialog(Gfx g, int mx, int my, float d) {
        Render2D.rect(g, 0, 0, width, height, ColorUtil.withAlpha(0xFF000000, (int) (150 * d)));
        float w = Math.min(280, width - 30), h = 150, x = (width - w) / 2f, y = (height - h) / 2f + (1 - d) * 16;
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
        if (dialog != 0) {
            hitRects.clear();
            hitActions.clear();
            hit(x + 8, y + 26, w - 16, 17, () -> focus(dlgName));
            hit(x + 8, y + 55, w - 16, 17, () -> focus(dlgAddr));
            float bw1 = Render2D.textWidth("Zapisz") + 18, bw2 = Render2D.textWidth("Anuluj") + 18;
            float by = y + h - 24;
            dialogButton(g, mx, my, x + w - 8 - bw1, by, bw1, "Zapisz", true, this::saveDialog);
            dialogButton(g, mx, my, x + w - 12 - bw1 - bw2, by, bw2, "Anuluj", false, () -> dialog = 0);
        }
        g.setAlpha(1);
    }

    private void dialogButton(Gfx g, int mx, int my, float x, float y, float w, String label, boolean primary, Runnable r) {
        boolean hov = Render2D.hovered(mx, my, x, y, w, 18);
        Widgets.glowBox(g, x, y, w, 18, Theme.radius(), Theme.accent(), anim("d" + label).target(hov ? 1 : 0).update(), primary ? 1f : 0.5f);
        Render2D.centeredText(g, label, x + w / 2f, y + 5, Widgets.glowText(Theme.accent(), 0.3f), false);
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
            if (key == Keys.ENTER || key == Keys.KP_ENTER) { saveDialog(); return true; }
            if (key == Keys.TAB) { focus(dlgName.isFocused() ? dlgAddr : dlgName); return true; }
            if (dlgName.keyPressed(key) || dlgAddr.keyPressed(key)) return true;
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
        if (key == Keys.DOWN && selected < servers.size() - 1) { selected++; return true; }
        if (key == Keys.UP && selected > 0) { selected--; return true; }
        if (key == Keys.DELETE && selected >= 0) {
            if (System.currentTimeMillis() - deleteArmed < 2500) { game().removeServer(selected); deleteArmed = 0; reload(); }
            else deleteArmed = System.currentTimeMillis();
            return true;
        }
        return super.keyPressed(key, modifiers);
    }
}
