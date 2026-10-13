package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.TextureRef;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Friends;
import dev.noreclient.util.Heads;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Friends list: add by nick, see who is on the same server, remove. */
public class FriendsScreen extends PanelScreen {
    private final TextBox nick = new TextBox("Nick znajomego", 16);
    private long armed;
    private String armedName;

    public FriendsScreen(Object parent) {
        super(parent);
    }

    @Override protected String title() { return "ZNAJOMI"; }

    @Override protected String subtitle() { return Friends.list().size() + " znajomych • widzisz ich w tabie i nad głową, dostajesz powiadomienie gdy są na serwerze"; }

    private void addTyped() {
        String n = nick.getText().trim();
        if (Friends.add(n)) {
            NotificationManager.push("Znajomi", "Dodano " + n, NotificationManager.Type.SUCCESS);
            nick.setText("");
        } else if (!n.isEmpty()) {
            NotificationManager.push("Znajomi", "Niepoprawny nick albo już jest na liście", NotificationManager.Type.WARNING);
        }
    }

    @Override
    protected boolean onEnter(TextBox box, int key) {
        if (box == nick && (key == dev.noreclient.api.Keys.ENTER || key == dev.noreclient.api.Keys.KP_ENTER)) { addTyped(); return true; }
        return false;
    }

    @Override
    protected void content(Gfx g, int mx, int my, float x, float y, float w, float h) {
        float lw = Math.min(w, Math.max(220, w * 0.6f));
        box(nick, g, x, y, lw - 70, 18, null);
        button(g, mx, my, x + lw - 64, y, "Dodaj", 1, true, this::addTyped);
        List<String> list = Friends.list();
        Set<String> online = new HashSet<String>();
        for (String n : game().tabPlayerNames()) online.add(n.toLowerCase(Locale.ROOT));
        float ly = y + 26, row = 30;
        viewH = h - 26;
        contentH = list.size() * (row + 4);
        float sc = scrolled();
        if (list.isEmpty()) {
            Icons.person(g, x + lw / 2f, ly + 40, 18, ColorUtil.withAlpha(Theme.accent(), 150));
            Render2D.centeredText(g, "Nie masz jeszcze znajomych", x + lw / 2f, ly + 58, Theme.TEXT_MUTED, false);
            String hint = "Wpisz nick powyżej albo kliknij gracza środkowym przyciskiem";
            float hs = Math.min(0.75f, (lw - 10) / Math.max(1, Render2D.textWidth(hint)));
            Render2D.scaledText(g, hint, x + lw / 2f - Render2D.textWidth(hint) * hs / 2f, ly + 70, hs, Theme.TEXT_MUTED, false);
        }
        g.scissor((int) x - 4, (int) ly, (int) (x + lw + 4), (int) (ly + viewH));
        for (int i = 0; i < list.size(); i++) {
            final String n = list.get(i);
            float ry = ly + i * (row + 4) - sc;
            if (ry + row < ly || ry > ly + viewH) continue;
            boolean hov = Render2D.hovered(mx, my, x, ry, lw, row);
            float a = anim("f" + n).target(hov ? 1 : 0).update();
            boolean on = online.contains(n.toLowerCase(Locale.ROOT));
            Render2D.roundedRect(g, x, ry, lw, row, Theme.radius(), ColorUtil.lerp(0xA0140F0C, 0xD01C1611, a));
            Render2D.roundedOutline(g, x, ry, lw, row, Theme.radius(), 1, on ? ColorUtil.withAlpha(Theme.SUCCESS, 140) : ColorUtil.lerp(0x18FFFFFF, ColorUtil.withAlpha(Theme.accent(), 120), a));
            TextureRef head = Heads.get(n);
            if (head != null) Render2D.texture(g, head, x + 5, ry + 5, 20, 20, 1f);
            else Render2D.roundedRect(g, x + 5, ry + 5, 20, 20, 3, 0x30FFFFFF);
            Render2D.text(g, n, x + 31, ry + 6, Theme.TEXT, false);
            Render2D.circle(g, x + 34, ry + 21, 2, on ? Theme.SUCCESS : 0x60FFFFFF);
            Render2D.scaledText(g, on ? "Na tym samym serwerze" : "Nie ma go na tym serwerze", x + 39, ry + 19, 0.65f, on ? Theme.SUCCESS : Theme.TEXT_MUTED, false);
            boolean isArmed = n.equals(armedName) && System.currentTimeMillis() - armed < 2500;
            String l = isArmed ? "Na pewno?" : "Usuń";
            button(g, mx, my, x + lw - buttonWidth(l) - 6, ry + 6, l, 2, true, () -> {
                if (n.equals(armedName) && System.currentTimeMillis() - armed < 2500) { Friends.remove(n); armedName = null; }
                else { armedName = n; armed = System.currentTimeMillis(); }
            });
        }
        g.endScissor();
        float ix = x + lw + 12, iw = w - lw - 12;
        if (iw < 120) return;
        String[] tips = {"Gwiazdka ★ przy znajomych w tabie i nad głową", "Powiadomienie, gdy znajomy jest na serwerze", "Środkowy przycisk na graczu – dodaj / usuń",
                "Znajomi z Nore Launchera są tu automatycznie", "Status online w każdym miejscu – wkrótce"};
        List<String> lines = new java.util.ArrayList<String>();
        for (String t : tips) { boolean first = true; for (String l : ModsScreen.wrap(t, (int) ((iw - 22) / 0.68f))) { lines.add((first ? "• " : "  ") + l); first = false; } }
        panel(g, ix, y, iw, 22 + lines.size() * 9, "Jak to działa");
        for (int i = 0; i < lines.size(); i++) Render2D.scaledText(g, lines.get(i), ix + 8, y + 19 + i * 9, 0.68f, Theme.TEXT_DIM, false);
    }
}
