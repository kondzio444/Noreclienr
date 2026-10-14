package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.api.TextureRef;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Heads;
import dev.noreclient.util.LauncherChat;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/** Friends chat from Nore Launcher: friends with their status on the left, the conversation on the right. */
public class FriendsChatScreen extends PanelScreen {
    private static volatile boolean open;
    private static String lastHex;
    private final TextBox input = new TextBox("Napisz wiadomość… (Enter – wyślij)", 200);
    private String hex = lastHex;
    private int lastCount = -1;
    private final SimpleDateFormat time = new SimpleDateFormat("HH:mm");

    public FriendsChatScreen(Object parent) {
        super(parent);
        open = true;
        scrollTarget = Float.MAX_VALUE;
        input.setFocused(true);
    }

    public static boolean isOpen() { return open; }

    @Override
    public void removed() {
        open = false;
        super.removed();
    }

    @Override protected String title() { return "CZAT ZNAJOMYCH"; }

    @Override protected String subtitle() {
        if (!LauncherChat.available()) return "Uruchom grę z Nore Launchera, aby pisać ze znajomymi";
        if (!LauncherChat.connected()) return "Łączenie z Nore Launcherem…";
        int on = 0;
        for (LauncherChat.Contact c : LauncherChat.contacts()) if (c.online) on++;
        return LauncherChat.contacts().size() + " znajomych • " + on + " online • Twój Nore ID: " + LauncherChat.myId();
    }

    private LauncherChat.Contact selected() {
        for (LauncherChat.Contact c : LauncherChat.contacts()) if (c.hex.equals(hex)) return c;
        return null;
    }

    private void send() {
        if (hex == null || input.getText().trim().isEmpty()) return;
        LauncherChat.send(hex, input.getText());
        input.setText("");
        scrollTarget = Float.MAX_VALUE;
    }

    @Override
    protected boolean onEnter(TextBox box, int key) {
        if (box == input && (key == Keys.ENTER || key == Keys.KP_ENTER)) { send(); return true; }
        return false;
    }

    private static String status(LauncherChat.Contact c) {
        if (!c.online) return "Offline";
        if ("game".equals(c.status)) return c.detail.isEmpty() ? "W grze" : "Gra: " + c.detail;
        return "Online w launcherze";
    }

    @Override
    protected void content(Gfx g, int mx, int my, float x, float y, float w, float h) {
        LauncherChat.start();
        if (!LauncherChat.available() || !LauncherChat.connected()) {
            Icons.person(g, x + w / 2f, y + h / 2f - 26, 20, ColorUtil.withAlpha(Theme.accent(), 160));
            Render2D.centeredText(g, LauncherChat.available() ? "Łączenie z Nore Launcherem…" : "Czat działa, gdy grasz z Nore Launchera", x + w / 2f, y + h / 2f - 2, Theme.TEXT, false);
            String hint = LauncherChat.available() ? "Launcher musi być uruchomiony w tle" : "Znajomych dodasz w launcherze: Czat i głos → Nore ID";
            float hs = 0.75f;
            Render2D.scaledText(g, hint, x + w / 2f - Render2D.textWidth(hint) * hs / 2f, y + h / 2f + 12, hs, Theme.TEXT_MUTED, false);
            return;
        }
        List<LauncherChat.Contact> list = LauncherChat.contacts();
        if (hex == null && !list.isEmpty()) hex = list.get(0).hex;
        float lw = Math.max(120, Math.min(170, w * 0.32f));

        // ---- friends
        float ry = y;
        if (list.isEmpty()) {
            List<String> l = ModsScreen.wrap("Nie masz znajomych w czacie. Wyślij swój Nore ID (u góry) znajomemu albo dodaj jego ID w launcherze.", (int) ((lw - 12) / 0.68f));
            panel(g, x, y, lw, 20 + l.size() * 9, "Znajomi");
            for (int i = 0; i < l.size(); i++) Render2D.scaledText(g, l.get(i), x + 6, y + 18 + i * 9, 0.68f, Theme.TEXT_DIM, false);
        }
        for (final LauncherChat.Contact c : list) {
            if (ry + 28 > y + h) break;
            boolean sel = c.hex.equals(hex);
            boolean hov = Render2D.hovered(mx, my, x, ry, lw, 26);
            float a = anim("c" + c.hex).target(sel ? 1 : hov ? 0.5f : 0).update();
            Render2D.roundedRect(g, x, ry, lw, 26, Theme.radius(), ColorUtil.lerp(0xA0140F0C, ColorUtil.withAlpha(Theme.accent(), 70), a));
            if (sel) Render2D.roundedOutline(g, x, ry, lw, 26, Theme.radius(), 1, ColorUtil.withAlpha(Theme.accent(), 170));
            TextureRef head = Heads.get(c.name);
            if (head != null) Render2D.texture(g, head, x + 4, ry + 4, 18, 18, 1f);
            else Render2D.roundedRect(g, x + 4, ry + 4, 18, 18, 3, 0x30FFFFFF);
            Render2D.circle(g, x + 21, ry + 21, 2.6f, c.online ? ("game".equals(c.status) ? Theme.accent() : Theme.SUCCESS) : 0xFF606060);
            Render2D.text(g, Render2D.trim(c.name, (int) (lw - 50)), x + 27, ry + 4, Theme.TEXT, false);
            String sub = c.last.isEmpty() ? status(c) : c.last;
            Render2D.scaledText(g, Render2D.trim(sub, (int) ((lw - 32) / 0.62f)), x + 27, ry + 15, 0.62f, c.online ? Theme.TEXT_DIM : Theme.TEXT_MUTED, false);
            if (c.unread > 0) {
                String n = String.valueOf(c.unread);
                float bw = Render2D.textWidth(n) * 0.7f + 7;
                Render2D.roundedRect(g, x + lw - bw - 4, ry + 8, bw, 10, 5, Theme.accent());
                Render2D.scaledText(g, n, x + lw - bw - 0.5f, ry + 9.5f, 0.7f, 0xFF1A1008, false);
            }
            hit(x, ry, lw, 26, () -> { hex = c.hex; lastHex = c.hex; lastCount = -1; scrollTarget = Float.MAX_VALUE; LauncherChat.markRead(c.hex); });
            ry += 29;
        }

        // ---- conversation
        LauncherChat.Contact c = selected();
        float cx = x + lw + 10, cw = w - lw - 10;
        if (c == null) return;
        lastHex = c.hex;
        panel(g, cx, y, cw, h, null);
        Render2D.text(g, c.name, cx + 8, y + 6, Theme.TEXT, false);
        Render2D.scaledText(g, status(c), cx + 10 + Render2D.textWidth(c.name), y + 7.5f, 0.68f, c.online ? Theme.SUCCESS : Theme.TEXT_MUTED, false);
        float logY = y + 20, logH = h - 20 - 26;
        List<LauncherChat.Message> msgs = LauncherChat.history(c.hex);
        if (msgs.size() != lastCount) {
            if (lastCount >= 0 && msgs.size() > lastCount) { scrollTarget = Float.MAX_VALUE; if (c.unread > 0) LauncherChat.markRead(c.hex); }
            lastCount = msgs.size();
        }
        float maxBubble = cw * 0.72f;
        List<float[]> boxes = new ArrayList<float[]>();
        List<List<String>> lines = new ArrayList<List<String>>();
        float total = 4;
        for (LauncherChat.Message m : msgs) {
            List<String> l = ModsScreen.wrap(m.text, (int) ((maxBubble - 12) / 0.8f));
            lines.add(l);
            float bh = 8 + l.size() * 8.5f + 7;
            boxes.add(new float[]{total, bh});
            total += bh + 4;
        }
        viewH = logH;
        contentH = total;
        float sc = scrolled();
        g.scissor((int) cx + 2, (int) logY, (int) (cx + cw - 2), (int) (logY + logH));
        if (msgs.isEmpty()) {
            String t = LauncherChat.loading(c.hex) ? "Wczytywanie…" : "Początek rozmowy z " + c.name;
            Render2D.centeredText(g, t, cx + cw / 2f, logY + logH / 2f - 4, Theme.TEXT_MUTED, false);
        }
        for (int i = 0; i < msgs.size(); i++) {
            LauncherChat.Message m = msgs.get(i);
            float by = logY + boxes.get(i)[0] - sc, bh = boxes.get(i)[1];
            if (by + bh < logY || by > logY + logH) continue;
            float tw = 0;
            for (String s : lines.get(i)) tw = Math.max(tw, Render2D.textWidth(s) * 0.8f);
            String meta = time.format(new Date(m.ts)) + (m.mine ? ("delivered".equals(m.state) ? " ✓✓" : "pending".equals(m.state) ? " …" : " ✓") : "");
            tw = Math.max(tw, Render2D.textWidth(meta) * 0.6f);
            float bw = tw + 12;
            float bx = m.mine ? cx + cw - bw - 8 : cx + 8;
            Render2D.roundedRect(g, bx, by, bw, bh, 5, m.mine ? ColorUtil.withAlpha(Theme.accent(), 215) : 0xE0262019);
            int tc = m.mine ? 0xFF1A1008 : Theme.TEXT;
            for (int k = 0; k < lines.get(i).size(); k++) Render2D.scaledText(g, lines.get(i).get(k), bx + 6, by + 4 + k * 8.5f, 0.8f, tc, false);
            Render2D.scaledText(g, meta, bx + bw - Render2D.textWidth(meta) * 0.6f - 5, by + bh - 7.5f, 0.6f, m.mine ? 0xB01A1008 : Theme.TEXT_MUTED, false);
        }
        g.endScissor();
        box(input, g, cx + 6, y + h - 22, cw - 12 - 52, 18, null);
        button(g, mx, my, cx + cw - 54, y + h - 22, "Wyślij", 1, !input.getText().trim().isEmpty(), this::send);
    }
}
