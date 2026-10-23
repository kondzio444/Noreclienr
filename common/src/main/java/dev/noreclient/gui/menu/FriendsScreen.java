package dev.noreclient.gui.menu;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.module.social.Social;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Friends;
import dev.noreclient.util.LauncherChat;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * "Znajomi": one list of people – nick friends (friends.json, shared with the launcher) and Nore
 * chat contacts (launcher bridge), matched by name – with their state (on this server / online in
 * Nore / offline), the Nore badge, unread messages and the last message. Selecting a Nore contact
 * opens the conversation on the right; chat invitations wait at the top of the list.
 */
public class FriendsScreen extends PanelScreen {
    /** Pass as the selection to reopen the last person with the message box focused (Y key). */
    public static final String LAST = "\u0000last";

    private static volatile boolean open;
    private static String lastKey;

    private final TextBox nick = new TextBox("Dodaj po nicku…", 16);
    private final TextBox input = new TextBox("Napisz wiadomość… (Enter – wyślij)", 200);
    private final SimpleDateFormat time = new SimpleDateFormat("HH:mm");
    private final Animation listScroll = new Animation(0, 14), detail = new Animation(0, 12);
    private float listTarget, listContent, listView, listX, listW;
    private String key = lastKey;
    /** Nore ID we are waiting for (invitation just sent: the contact appears after the bridge call). */
    private String waitHex;
    private int lastCount = -1;
    private long armed;
    private String armedKey;
    private List<Social.Person> people = new ArrayList<Social.Person>();

    public FriendsScreen(Object parent) {
        this(parent, null);
    }

    /** Opens on the conversation with this Nore ID (or {@link #LAST}) with the message box focused. */
    public FriendsScreen(Object parent, String hex) {
        super(parent);
        open = true;
        if (hex != null && !LAST.equals(hex)) { key = "c:" + hex; waitHex = hex; }
        if (hex != null) input.setFocused(true);
        scrollTarget = Float.MAX_VALUE;
        LauncherChat.start();
    }

    public static boolean isOpen() { return open; }

    @Override
    public void removed() {
        open = false;
        super.removed();
    }

    @Override protected String title() { return "ZNAJOMI"; }

    @Override
    protected String subtitle() {
        people = Social.people(); // the header is drawn before the content: refresh the list here
        int server = 0, nore = 0;
        for (Social.Person p : people) { if (p.onServer) server++; else if (p.onlineInNore()) nore++; }
        String s = people.size() + " osób • " + server + " na tym serwerze • " + nore + " online w Nore";
        if (!LauncherChat.available()) return s + " • czat działa z Nore Launcherem";
        if (!LauncherChat.connected()) return s + " • łączenie z Nore Launcherem…";
        return s + " • Twój Nore ID: " + LauncherChat.myId();
    }

    private Social.Person selected() {
        for (Social.Person p : people) if (p.key().equals(key)) return p;
        // a nick friend that just became a chat contact keeps the selection
        if (key != null && key.startsWith("n:")) for (Social.Person p : people) if (("n:" + p.name.toLowerCase()).equals(key)) return p;
        return null;
    }

    private void select(Social.Person p) {
        if (p.key().equals(key)) return;
        key = p.key();
        lastKey = key;
        waitHex = null;
        lastCount = -1;
        scrollTarget = Float.MAX_VALUE;
        detail.set(0);
        if (p.contact != null && p.contact.unread > 0) LauncherChat.markRead(p.contact.hex);
    }

    private void addTyped() {
        String n = nick.getText().trim();
        if (n.isEmpty()) return;
        if (!n.matches("[A-Za-z0-9_]{2,16}")) {
            NotificationManager.push("Znajomi", "To nie jest poprawny nick Minecraft", NotificationManager.Type.WARNING);
            return;
        }
        if (Friends.isFriend(n)) {
            NotificationManager.push("Znajomi", n + " już jest na liście", NotificationManager.Type.INFO);
            return;
        }
        Social.addFriend(n);
        NotificationManager.push("Znajomi", "Dodano " + n + (LauncherChat.available() ? " • jeśli gra z Nore, dostanie zaproszenie do czatu" : ""), NotificationManager.Type.SUCCESS);
        nick.setText("");
        key = "n:" + n.toLowerCase();
        lastKey = key;
        detail.set(0);
    }

    private void send() {
        Social.Person p = selected();
        if (p == null || p.contact == null || input.getText().trim().isEmpty()) return;
        LauncherChat.send(p.contact.hex, input.getText());
        input.setText("");
        scrollTarget = Float.MAX_VALUE;
    }

    @Override
    protected boolean onEnter(TextBox box, int key) {
        if (key != Keys.ENTER && key != Keys.KP_ENTER) return false;
        if (box == nick) { addTyped(); return true; }
        if (box == input) { send(); return true; }
        return false;
    }

    private boolean armedFor(String k) {
        return k.equals(armedKey) && System.currentTimeMillis() - armed < 2500;
    }

    private void arm(String k) { armedKey = k; armed = System.currentTimeMillis(); }

    private static void toastLater(final String err, final String ok) {
        NoreClient.runNextTick(() -> {
            if (err != null) NotificationManager.push("Czat Nore", err, NotificationManager.Type.WARNING);
            else if (ok != null) NotificationManager.push("Czat Nore", ok, NotificationManager.Type.SUCCESS);
        });
    }

    // ------------------------------------------------------------------ render

    @Override
    protected void content(Gfx g, int mx, int my, float x, float y, float w, float h) {
        if (waitHex != null) {
            for (Social.Person p : people) if (p.contact != null && p.contact.hex.equals(waitHex)) { key = p.key(); lastKey = key; waitHex = null; break; }
        }
        Social.Person sel = selected();
        if (sel == null && waitHex == null && !people.isEmpty() && (key == null || !key.startsWith("n:"))) { select(people.get(0)); sel = people.get(0); }
        float lw = Math.max(150, Math.min(220, w * 0.36f));
        list(g, mx, my, x, y, lw, h);
        float cx = x + lw + 10, cw = w - lw - 10;
        float a = Animation.easeOutCubic(detail.target(1).update());
        g.setAlpha(g.getAlpha() * (0.35f + 0.65f * a));
        g.push();
        g.translate((1 - a) * 10, 0);
        if (sel != null) person(g, mx - (int) ((1 - a) * 10), my, sel, cx, y, cw, h);
        else if (waitHex != null) waiting(g, cx, y, cw, h);
        else emptyDetail(g, cx, y, cw, h);
        g.pop();
        g.setAlpha(intro(0));
    }

    private void list(Gfx g, int mx, int my, float x, float y, float lw, float h) {
        box(nick, g, x, y, lw - 48, 18, null);
        button(g, mx, my, x + lw - 44, y, "Dodaj", 1, !nick.getText().trim().isEmpty(), this::addTyped);
        float ly = y + 24;
        List<LauncherChat.Request> reqs = LauncherChat.requests();
        // ---- chat invitations
        if (!reqs.isEmpty()) {
            Render2D.scaledText(g, "ZAPROSZENIA DO CZATU • " + reqs.size(), x + 2, ly, 0.6f, Theme.accent2(), false);
            ly += 9;
            for (int i = 0; i < Math.min(3, reqs.size()); i++) {
                final LauncherChat.Request r = reqs.get(i);
                Render2D.roundedRect(g, x, ly, lw, 24, Theme.radius(), ColorUtil.withAlpha(Theme.accent(), 38));
                Render2D.roundedOutline(g, x, ly, lw, 24, Theme.radius(), 1, ColorUtil.withAlpha(Theme.accent(), 110));
                SocialWidgets.head(g, r.name, x + 4, ly + 4, 16);
                Render2D.text(g, Render2D.trim(r.name, (int) (lw - 80)), x + 24, ly + 3, Theme.TEXT, false);
                String sub = r.text.isEmpty() ? "chce pisać z Tobą" : r.text;
                Render2D.scaledText(g, Render2D.trim(sub, (int) ((lw - 80) / 0.6f)), x + 24, ly + 14, 0.6f, Theme.TEXT_DIM, false);
                iconButton(g, mx, my, x + lw - 40, ly + 4, "✓", Theme.SUCCESS, () -> LauncherChat.acceptRequest(r, err -> toastLater(err, "Dodano " + r.name + " do czatu")));
                iconButton(g, mx, my, x + lw - 20, ly + 4, "✕", Theme.ERROR, () -> LauncherChat.declineRequest(r, err -> toastLater(err, null)));
                ly += 27;
            }
            if (reqs.size() > 3) { Render2D.scaledText(g, "+" + (reqs.size() - 3) + " w Nore Launcherze", x + 4, ly, 0.6f, Theme.TEXT_MUTED, false); ly += 9; }
            ly += 3;
        }
        // ---- people
        float row = 30;
        listX = x;
        listW = lw;
        listView = y + h - ly;
        listContent = people.size() * (row + 3);
        listTarget = Math.max(0, Math.min(listTarget, listContent - listView));
        float sc = listScroll.target(listTarget).update();
        if (people.isEmpty()) {
            Icons.person(g, x + lw / 2f, ly + 40, 18, ColorUtil.withAlpha(Theme.accent(), 150));
            Render2D.centeredText(g, "Nie masz jeszcze znajomych", x + lw / 2f, ly + 58, Theme.TEXT_MUTED, false);
            List<String> l = ModsScreen.wrap("Wpisz nick powyżej albo kliknij gracza środkowym przyciskiem myszy.", (int) ((lw - 10) / 0.68f));
            for (int i = 0; i < l.size(); i++) Render2D.scaledText(g, l.get(i), x + lw / 2f - Render2D.textWidth(l.get(i)) * 0.68f / 2f, ly + 70 + i * 9, 0.68f, Theme.TEXT_MUTED, false);
            return;
        }
        g.scissor((int) x - 4, (int) ly, (int) (x + lw + 4), (int) (ly + listView));
        int lastState = -1;
        for (int i = 0; i < people.size(); i++) {
            final Social.Person p = people.get(i);
            float ry = ly + i * (row + 3) - sc;
            if (ry + row < ly || ry > ly + listView) { lastState = p.state(); continue; }
            boolean sel = p.key().equals(key);
            boolean hov = my >= ly && my <= ly + listView && Render2D.hovered(mx, my, x, ry, lw, row);
            float a = anim("p" + p.key()).target(sel ? 1 : hov ? 0.5f : 0).update();
            float e = Animation.easeOutCubic((System.currentTimeMillis() - opened - i * 35L) / 320f);
            float rx = x + (1 - e) * 14;
            Render2D.roundedRect(g, rx, ry, lw, row, Theme.radius(), ColorUtil.lerp(0xA0160F26, ColorUtil.withAlpha(Theme.accent(), 64), a));
            if (sel) Render2D.roundedOutline(g, rx, ry, lw, row, Theme.radius(), 1, ColorUtil.withAlpha(Theme.accent(), 170));
            int st = p.state();
            if (st != lastState && i > 0) Render2D.rect(g, rx + 8, ry - 2, lw - 16, 1, 0x18FFFFFF);
            lastState = st;
            SocialWidgets.head(g, p.name, rx + 5, ry + 5, 20);
            Render2D.circle(g, rx + 24, ry + 24, 3.2f, 0xFF120C1E);
            Render2D.circle(g, rx + 24, ry + 24, 2.4f, SocialWidgets.stateColor(st));
            float nx = rx + 30;
            int unread = p.unread();
            float right = rx + lw - 5 - (unread > 0 ? 18 : 0);
            String name = Render2D.trim(p.name, (int) (right - nx - (p.nore() ? 12 : 0) - (p.friend ? 9 : 0)));
            Render2D.text(g, name, nx, ry + 5, Theme.TEXT, false);
            float bx = nx + Render2D.textWidth(name) + 3;
            if (p.nore()) { SocialWidgets.mark(g, bx, ry + 4.5f, 8, p.hub != null && p.hub.verified, p.hub != null); bx += 10; }
            if (p.friend) Icons.star(g, bx + 3, ry + 8.5f, 3, 0xFF5BE37D, true);
            String sub;
            int subCol;
            if (p.contact != null && !p.contact.last.isEmpty() && st != 2) { sub = p.contact.last; subCol = unread > 0 ? Theme.TEXT : Theme.TEXT_DIM; }
            else { sub = Social.status(p); subCol = st == 2 ? Theme.SUCCESS : st == 1 ? Theme.accent2() : Theme.TEXT_MUTED; }
            if (Friends.isMuted(p.name)) sub = "Wyciszony • " + sub;
            Render2D.scaledText(g, Render2D.trim(sub, (int) ((right - nx) / 0.64f)), nx, ry + 18, 0.64f, subCol, false);
            if (unread > 0) {
                String n = unread > 99 ? "99+" : String.valueOf(unread);
                float bw = Math.max(11, Render2D.textWidth(n) * 0.7f + 7);
                Render2D.roundedRect(g, rx + lw - bw - 5, ry + 10, bw, 10, 5, Theme.accent());
                Render2D.scaledText(g, n, rx + lw - bw / 2f - 5 - Render2D.textWidth(n) * 0.35f, ry + 11.5f, 0.7f, 0xFF1A1008, false);
            }
            if (my >= ly && my <= ly + listView) hit(x, ry, lw, row, () -> select(p));
        }
        g.endScissor();
        if (listContent > listView) {
            float bh = Math.max(16, listView * listView / listContent);
            float by = ly + (listView - bh) * (sc / Math.max(1, listContent - listView));
            Render2D.roundedRect(g, x + lw + 2, by, 2, bh, 1, 0x50FFFFFF);
        }
    }

    private void iconButton(Gfx g, int mx, int my, float x, float y, String label, int col, Runnable r) {
        boolean hov = Render2D.hovered(mx, my, x, y, 16, 16);
        float a = anim("ib" + label + y).target(hov ? 1 : 0).update();
        Render2D.circle(g, x + 8, y + 8, 8, ColorUtil.withAlpha(col, (int) (50 + 120 * a)));
        Render2D.centeredText(g, label, x + 8, y + 4, hov ? 0xFFFFFFFF : ColorUtil.lerp(col, 0xFFFFFFFF, 0.4f), false);
        hit(x, y, 16, 16, () -> { dev.noreclient.util.Sounds.click(); r.run(); });
    }

    private void emptyDetail(Gfx g, float cx, float y, float cw, float h) {
        panel(g, cx, y, cw, h, null);
        Icons.person(g, cx + cw / 2f, y + h / 2f - 24, 20, ColorUtil.withAlpha(Theme.accent(), 160));
        Render2D.centeredText(g, "Wybierz osobę z listy", cx + cw / 2f, y + h / 2f - 2, Theme.TEXT, false);
        String hint = "Gracze Nore mają znak Nore – z nimi porozmawiasz tutaj";
        Render2D.scaledText(g, hint, cx + cw / 2f - Render2D.textWidth(hint) * 0.7f / 2f, y + h / 2f + 12, 0.7f, Theme.TEXT_MUTED, false);
    }

    private void waiting(Gfx g, float cx, float y, float cw, float h) {
        panel(g, cx, y, cw, h, null);
        float t = (System.currentTimeMillis() % 1200) / 1200f;
        Render2D.ring(g, cx + cw / 2f, y + h / 2f - 22, 10, 2, t * 360, t * 360 + 250, Theme.accent());
        Render2D.centeredText(g, "Wysyłanie zaproszenia do czatu…", cx + cw / 2f, y + h / 2f - 2, Theme.TEXT, false);
        String hint = "Rozmowa pojawi się tutaj, gdy Nore Launcher doda kontakt";
        Render2D.scaledText(g, hint, cx + cw / 2f - Render2D.textWidth(hint) * 0.7f / 2f, y + h / 2f + 12, 0.7f, Theme.TEXT_MUTED, false);
    }

    private void person(Gfx g, int mx, int my, final Social.Person p, float cx, float y, float cw, float h) {
        panel(g, cx, y, cw, h, null);
        // ---- header: head, name, badges, status, actions
        final String k = p.key();
        boolean muted = Friends.isMuted(p.name);
        // the buttons on the right decide how much room the name and the badges get
        float buttons = 0;
        if (p.contact != null && !p.friend) buttons += buttonWidth(armedFor(k + "rm") ? "Na pewno?" : "Usuń z czatu");
        else if (p.friend) buttons += buttonWidth(armedFor(k + "rm") ? "Na pewno?" : "Usuń");
        if (!p.friend) buttons += buttonWidth("Dodaj do znajomych") + 4;
        boolean muteButton = cw > 330 || p.friend;
        if (muteButton) buttons += buttonWidth(muted ? "Odcisz" : "Wycisz") + 4;
        float limit = cx + cw - 8 - buttons - 6;

        SocialWidgets.head(g, p.name, cx + 8, y + 7, 24);
        String shown = Render2D.trim(p.name, (int) (limit - cx - 38));
        Render2D.text(g, shown, cx + 38, y + 8, Theme.TEXT, false);
        float bx = cx + 38 + Render2D.textWidth(shown) + 5;
        boolean verified = p.hub != null && p.hub.verified;
        String badgeLabel = p.hub == null ? "Nore" : verified ? "Nore ✓" : "Nore";
        if (p.nore() && bx + 18 + Render2D.textWidth(badgeLabel) * 0.62f <= limit) bx += SocialWidgets.badge(g, bx, y + 7, verified, p.hub != null, false) + 3;
        if (p.friend && bx + 10 + Render2D.textWidth("★ Znajomy") * 0.62f <= limit) bx += SocialWidgets.pill(g, bx, y + 7, "★ Znajomy", 0xFF5BE37D) + 3;
        if (muted && bx + 10 + Render2D.textWidth("Wyciszony") * 0.62f <= limit) SocialWidgets.pill(g, bx, y + 7, "Wyciszony", Theme.TEXT_MUTED);
        int st = p.state();
        Render2D.circle(g, cx + 40, y + 24, 2.2f, SocialWidgets.stateColor(st));
        String status = Social.status(p) + (muted ? " • wyciszony na czacie" : "");
        Render2D.scaledText(g, Render2D.trim(status, (int) ((limit - cx - 45) / 0.68f)), cx + 45, y + 21.5f, 0.68f, st == 2 ? Theme.SUCCESS : st == 1 ? Theme.accent2() : Theme.TEXT_MUTED, false);

        float ax = cx + cw - 8;
        if (p.contact != null && !p.friend) {
            String l = armedFor(k + "rm") ? "Na pewno?" : "Usuń z czatu";
            ax -= buttonWidth(l);
            button(g, mx, my, ax, y + 9, l, 2, true, () -> {
                if (armedFor(k + "rm")) { armedKey = null; LauncherChat.removeContact(p.contact.hex, err -> toastLater(err, "Usunięto " + p.name + " z czatu")); }
                else arm(k + "rm");
            });
        } else if (p.friend) {
            String l = armedFor(k + "rm") ? "Na pewno?" : "Usuń";
            ax -= buttonWidth(l);
            button(g, mx, my, ax, y + 9, l, 2, true, () -> {
                if (armedFor(k + "rm")) { armedKey = null; Social.removeFriend(p.name); NotificationManager.push("Znajomi", "Usunięto " + p.name, NotificationManager.Type.INFO); }
                else arm(k + "rm");
            });
        }
        if (!p.friend) {
            ax -= buttonWidth("Dodaj do znajomych") + 4;
            button(g, mx, my, ax, y + 9, "Dodaj do znajomych", 3, true, () -> Social.toggleFriend(p.name));
        }
        String ml = muted ? "Odcisz" : "Wycisz";
        if (muteButton) {
            ax -= buttonWidth(ml) + 4;
            button(g, mx, my, ax, y + 9, ml, 0, true, () -> Social.toggleMute(p.name));
        }

        float by = y + 36;
        Render2D.rect(g, cx + 8, by - 2, cw - 16, 1, 0x18FFFFFF);
        if (p.contact != null) chat(g, mx, my, p, cx, by, cw, y + h - by);
        else noChat(g, mx, my, p, cx, by, cw, y + h - by);
    }

    private void noChat(Gfx g, int mx, int my, final Social.Person p, float cx, float y, float cw, float h) {
        float mid = y + h / 2f - 20;
        String title, hint;
        if (p.hub != null) {
            title = p.name + " gra z Nore";
            hint = LauncherChat.available() ? "Zaproś go do czatu Nore – napiszecie do siebie z gry i z launchera, na każdym serwerze."
                    : "Czat Nore działa, gdy grasz z Nore Launchera.";
        } else {
            title = "Znajomy z gry";
            hint = p.onServer ? "Nie używa Nore – możesz napisać do niego prywatną wiadomością na serwerze."
                    : "Zobaczysz go z gwiazdką w tabie i nad głową, a gdy wejdzie na Twój serwer, dostaniesz powiadomienie.";
        }
        if (p.hub != null) SocialWidgets.mark(g, cx + cw / 2f - 10, mid - 26, 20, p.hub.verified, true);
        else Icons.person(g, cx + cw / 2f, mid - 16, 14, ColorUtil.withAlpha(Theme.accent(), 170));
        Render2D.centeredText(g, title, cx + cw / 2f, mid, Theme.TEXT, false);
        List<String> lines = ModsScreen.wrap(hint, (int) ((cw - 40) / 0.72f));
        for (int i = 0; i < lines.size(); i++) Render2D.scaledText(g, lines.get(i), cx + cw / 2f - Render2D.textWidth(lines.get(i)) * 0.72f / 2f, mid + 13 + i * 9, 0.72f, Theme.TEXT_MUTED, false);
        float by = mid + 18 + lines.size() * 9;
        if (p.hub != null && LauncherChat.available() && !p.hub.hex.isEmpty()) {
            String l = "Zaproś do czatu";
            button(g, mx, my, cx + cw / 2f - buttonWidth(l) / 2f, by, l, 1, true, () -> {
                waitHex = p.hub.hex;
                LauncherChat.addContact(p.hub.hex, p.hub.name, err -> { toastLater(err, "Zaproszenie wysłane do " + p.name); if (err != null) waitHex = null; });
            });
        } else if (p.onServer) {
            String l = "Napisz /msg";
            button(g, mx, my, cx + cw / 2f - buttonWidth(l) / 2f, by, l, 1, true, () -> game().openChat("/msg " + p.name + " "));
        }
    }

    private void chat(Gfx g, int mx, int my, Social.Person p, float cx, float y, float cw, float h) {
        LauncherChat.Contact c = p.contact;
        if (!LauncherChat.connected()) {
            String t = LauncherChat.available() ? "Łączenie z Nore Launcherem…" : "Czat działa, gdy grasz z Nore Launchera";
            Render2D.centeredText(g, t, cx + cw / 2f, y + h / 2f - 4, Theme.TEXT_MUTED, false);
            return;
        }
        float logY = y + 2, logH = h - 30;
        List<LauncherChat.Message> msgs = LauncherChat.history(c.hex);
        if (msgs.size() != lastCount) {
            if (lastCount >= 0 && msgs.size() > lastCount) scrollTarget = Float.MAX_VALUE;
            if (c.unread > 0) LauncherChat.markRead(c.hex);
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
            Render2D.roundedRect(g, bx, by, bw, bh, 5, m.mine ? ColorUtil.withAlpha(Theme.accent(), 215) : 0xE02A2040);
            int tc = m.mine ? 0xFF1A1008 : Theme.TEXT;
            for (int k = 0; k < lines.get(i).size(); k++) Render2D.scaledText(g, lines.get(i).get(k), bx + 6, by + 4 + k * 8.5f, 0.8f, tc, false);
            Render2D.scaledText(g, meta, bx + bw - Render2D.textWidth(meta) * 0.6f - 5, by + bh - 7.5f, 0.6f, m.mine ? 0xB01A1008 : Theme.TEXT_MUTED, false);
        }
        g.endScissor();
        box(input, g, cx + 6, y + h - 24, cw - 12 - 52, 18, null);
        button(g, mx, my, cx + cw - 54, y + h - 24, "Wyślij", 1, !input.getText().trim().isEmpty(), this::send);
    }

    // ------------------------------------------------------------------ input

    @Override
    public boolean mouseScrolled(double mx, double my, double amount) {
        if (mx >= listX && mx <= listX + listW + 6) {
            listTarget = (float) Math.max(0, Math.min(listContent - listView, listTarget - amount * 30));
            return true;
        }
        return super.mouseScrolled(mx, my, amount);
    }

    @Override
    public boolean keyPressed(int k, int modifiers) {
        boolean typing = nick.isFocused() || input.isFocused();
        if (!typing && (k == Keys.UP || k == Keys.DOWN) && !people.isEmpty()) {
            int i = 0;
            for (int j = 0; j < people.size(); j++) if (people.get(j).key().equals(key)) i = j;
            i = Math.max(0, Math.min(people.size() - 1, i + (k == Keys.DOWN ? 1 : -1)));
            select(people.get(i));
            return true;
        }
        if (!typing && (k == Keys.ENTER || k == Keys.KP_ENTER)) {
            Social.Person p = selected();
            if (p != null && p.contact != null) { for (TextBox b : boxes) b.setFocused(b == input); return true; }
        }
        return super.keyPressed(k, modifiers);
    }
}
