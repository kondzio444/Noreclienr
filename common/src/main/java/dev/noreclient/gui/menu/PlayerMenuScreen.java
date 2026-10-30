package dev.noreclient.gui.menu;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.api.TargetInfo;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.widget.Album;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.util.Motion;
import dev.noreclient.util.ThemeTokens;
import dev.noreclient.module.social.Social;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Friends;
import dev.noreclient.util.LauncherChat;
import dev.noreclient.util.NoreHub;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Player menu (middle click on a player): a compact ring in the style of the Nore menu around the
 * player's head – write, add / remove friend, profile, copy nick, mute. Mouse (point and click) or
 * keyboard (1–5, arrows + Enter); Esc, a click outside or the player walking away closes it.
 * "Profil" turns the ring into a small card with the Nore status and the wardrobe.
 */
public class PlayerMenuScreen extends NoreScreen {
    private interface Icon { void draw(Gfx g, float cx, float cy, float s, int color); }

    private final class Action {
        final String key;
        final Icon icon;
        final Animation lift = new Animation(0, 18);

        Action(String key, Icon icon) { this.key = key; this.icon = icon; }

        String label() {
            if ("friend".equals(key)) return Friends.isFriend(name) ? "Usuń" : "Dodaj";
            if ("mute".equals(key)) return Friends.isMuted(name) ? "Odcisz" : "Wycisz";
            if ("write".equals(key)) return "Napisz";
            if ("profile".equals(key)) return "Profil";
            return "Kopiuj nick";
        }

        String hint() {
            if ("friend".equals(key)) return Friends.isFriend(name) ? "Usuń ze znajomych" : nore() && LauncherChat.available() ? "Dodaj do znajomych i do czatu Nore" : "Dodaj do znajomych";
            if ("mute".equals(key)) return Friends.isMuted(name) ? "Pokaż znowu jego wiadomości na czacie" : "Ukryj jego wiadomości na czacie (tylko u Ciebie)";
            if ("write".equals(key)) return nore() && LauncherChat.available() ? "Otwórz czat Nore z " + name : "Prywatna wiadomość: /msg " + name;
            if ("profile".equals(key)) return "Status Nore i to, co nosi";
            return "Skopiuj „" + name + "” do schowka";
        }
    }

    private final String name;
    private final Object handle;
    private final List<Action> actions = new ArrayList<Action>();
    private final long opened = System.currentTimeMillis();
    private final Animation pointer = new Animation(-90, 18), pointerAlpha = new Animation(0, 10);
    private final Animation profile = new Animation(0, 10), closing = new Animation(0, 14);
    private int hover = -1, focus = -1;
    private boolean profileOpen, closeRequested;
    private Runnable afterClose;
    private long lastCheck;

    public PlayerMenuScreen(TargetInfo target) {
        super(null);
        this.name = target.name;
        this.handle = target.handle;
        actions.add(new Action("write", PlayerMenuScreen::chatIcon));
        actions.add(new Action("friend", (g, cx, cy, s, c) -> friendIcon(g, cx, cy, s, c, Friends.isFriend(name))));
        actions.add(new Action("profile", PlayerMenuScreen::cardIcon));
        actions.add(new Action("copy", PlayerMenuScreen::copyIcon));
        actions.add(new Action("mute", (g, cx, cy, s, c) -> muteIcon(g, cx, cy, s, c, Friends.isMuted(name))));
        NoreHub.request(name);
    }

    @Override
    public Background background() { return Background.NONE; }

    private boolean nore() { return NoreHub.get(name) != null || Social.contactFor(name) != null; }

    // ------------------------------------------------------------------ geometry

    private float cx() { return width / 2f; }
    private float cy() { return height / 2f; }
    private float hubR() { return 21; }
    private float r0() { return 26; }
    private float r1() { return 58; }
    private float angle(int i) { return -90 + i * 360f / actions.size(); }

    private static float wrapDeg(float a) {
        a %= 360;
        if (a < -180) a += 360;
        if (a >= 180) a -= 360;
        return a;
    }

    // ------------------------------------------------------------------ render

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        long now = System.currentTimeMillis();
        if (now - lastCheck > 200) {
            lastCheck = now;
            TargetInfo t = game().describe(handle);
            if ((t == null || t.distance > 12) && !closeRequested) { profileOpen = false; closeThen(null); }
        }
        float t = (now - opened) / 1000f;
        float out = closing.target(closeRequested ? 1 : 0).update();
        if (closeRequested && out > 0.97f) { finishClose(); return; }
        float in = Animation.easeOutCubic(t / 0.28f) * (1 - out);
        float pa = profile.target(profileOpen ? 1 : 0).update();

        Render2D.radial(g, cx(), cy(), Math.max(width, height) * 0.55f, ColorUtil.withAlpha(Theme.page(), (int) (150 * in)), ColorUtil.withAlpha(0xFF0A090C, (int) (110 * in)));

        float dx = mx - cx(), dy = my - cy();
        float dist = (float) Math.hypot(dx, dy), ang = (float) Math.toDegrees(Math.atan2(dy, dx));
        hover = -1;
        if (!profileOpen && dist >= r0() * 0.75f && dist < r1() + 14 && t > 0.12f) {
            hover = Math.floorMod(Math.round(wrapDeg(ang + 90) / (360f / actions.size())), actions.size());
        }
        if (dist > hubR()) pointer.target(pointer.get() + wrapDeg(ang - pointer.get()));
        pointer.update();
        pointerAlpha.target(!profileOpen && dist > hubR() && dist < r1() + 30 ? 1 : 0).update();

        float ringA = in * (1 - pa);
        if (ringA > 0.01f) {
            g.setAlpha(ringA);
            // the ring sticks in (spring.stick sampled) and peels away into the profile card
            float scale = (Motion.level() == Motion.FULL ? Motion.stickScale(opened) : 1f) - pa * 0.15f * Motion.travel();
            g.push();
            g.translate(cx(), cy());
            g.scale(scale, scale);
            g.translate(-cx(), -cy());
            ring(g, t);
            hub(g);
            g.pop();
            plate(g, ringA);
            g.setAlpha(1);
        }
        if (pa > 0.01f) {
            g.setAlpha(pa * (1 - out));
            card(g, mx, my, pa);
            g.setAlpha(1);
        }
    }

    private void ring(Gfx g, float t) {
        int n = actions.size();
        float span = 360f / n, gap = 3.2f;
        for (int i = 0; i < n; i++) {
            Action a = actions.get(i);
            float e = Animation.easeOutCubic((t - 0.03f * i) / 0.26f);
            if (e <= 0) continue;
            boolean on = i == hover || i == focus;
            float lift = a.lift.target(on ? 1 : 0).update();
            float mid = angle(i), half = (span - gap) / 2f * e;
            float rr0 = r0() + lift * 1.5f, rr1 = r1() + lift * 5;
            boolean danger = "mute".equals(a.key) && Friends.isMuted(name) || "friend".equals(a.key) && Friends.isFriend(name);
            // Album: segments are sheets on the page; the pointed one becomes a white sticker with a vinyl rim
            int face = ColorUtil.lerp(ColorUtil.withAlpha(Theme.raised(), 0xF0), danger ? 0xFFFFE9E6 : Theme.VINYL, lift);
            if (lift > 0.02f) arc(g, mid - half - 0.8f, mid + half + 0.8f, rr0 - 1, rr1 + 1, ColorUtil.withAlpha(Theme.VINYL, (int) (255 * lift)), ColorUtil.withAlpha(Theme.VINYL, (int) (255 * lift)));
            arc(g, mid - half, mid + half, rr0, rr1, face, face);
            double rad = Math.toRadians(mid);
            float px = cx() + (float) Math.cos(rad) * (rr0 + rr1) / 2f, py = cy() + (float) Math.sin(rad) * (rr0 + rr1) / 2f;
            int col = ColorUtil.withAlpha(ColorUtil.lerp(Theme.TEXT_DIM, danger ? 0xFFB3261E : Theme.accent(), lift), (int) (255 * e));
            a.icon.draw(g, px, py - 4, 5.5f, col);
            String l = a.label();
            float ts = 0.5f;
            int lc = ColorUtil.withAlpha(ColorUtil.lerp(Theme.TEXT_DIM, Theme.VINYL_INK, lift), (int) (255 * e));
            Render2D.scaledText(g, l, px - Render2D.textWidth(l) * ts / 2f, py + 5, ts, lc, false);
            String num = String.valueOf(i + 1);
            float nx = cx() + (float) Math.cos(rad) * (rr1 + 6), ny = cy() + (float) Math.sin(rad) * (rr1 + 6);
            Render2D.scaledText(g, num, nx - Render2D.textWidth(num) * 0.45f / 2f, ny - 2, 0.45f, ColorUtil.withAlpha(Theme.TEXT_MUTED, (int) (200 * e)), false);
        }
        float pa = pointerAlpha.get();
        if (pa > 0.02f) {
            float c = pointer.get();
            arc(g, c - 12, c + 12, r0() - 4, r0() - 2.6f, ColorUtil.withAlpha(Theme.accent(), (int) (230 * pa)), ColorUtil.withAlpha(Theme.accent(), (int) (230 * pa)));
        }
    }

    private void hub(Gfx g) {
        float r = hubR();
        Render2D.circle(g, cx(), cy(), r + 1, Theme.VINYL);
        Render2D.circle(g, cx(), cy(), r, Theme.page());
        float s = 22;
        SocialWidgets.head(g, name, cx() - s / 2f, cy() - s / 2f, s);
        NoreHub.Entry e = NoreHub.get(name);
        if (nore()) SocialWidgets.mark(g, cx() + 6, cy() + 6, 10, e != null && e.verified, e != null);
        if (Friends.isFriend(name)) Album.dot(g, cx() - 11, cy() + 11, 2.5f, ThemeTokens.DOT_READY);
    }

    /** Name plate under the ring: nick, Nore badge, friend state and what the pointed action does. */
    private void plate(Gfx g, float a) {
        NoreHub.Entry e = NoreHub.get(name);
        boolean friend = Friends.isFriend(name), muted = Friends.isMuted(name);
        float y = cy() + r1() + 14;
        float nameW = Render2D.textWidth(name);
        float badges = 0;
        if (nore()) badges += widthOfBadge(e) + 4;
        if (friend) badges += Album.labelWidth("Znajomy") + 4;
        if (muted) badges += Album.labelWidth("Wyciszony") + 4;
        float w = Math.max(150, Math.max(nameW + 16, badges + 12));
        Action act = hover >= 0 ? actions.get(hover) : focus >= 0 ? actions.get(focus) : null;
        String hint = act != null ? act.hint() : Social.onServer(name) ? "Na tym serwerze" : "W pobliżu";
        w = Math.max(w, Render2D.textWidth(hint) + 16);
        float h = 46, x = cx() - w / 2f;
        Album.floating(g, x, y, w, h, ColorUtil.withAlpha(Theme.page(), 0xF0));
        Render2D.centeredText(g, name, cx(), y + 5, Theme.TEXT, false);
        float bx = cx() - badges / 2f + 2;
        if (nore()) bx += SocialWidgets.badge(g, bx, y + 16, e != null && e.verified, e != null, false) + 4;
        if (friend) bx += SocialWidgets.pill(g, bx, y + 16, "Znajomy", ThemeTokens.DOT_READY) + 4;
        if (muted) SocialWidgets.pill(g, bx, y + 16, "Wyciszony", ThemeTokens.DOT_OFF);
        if (badges == 0) {
            String s = NoreHub.known(name) ? "Nie używa Nore" : "Sprawdzanie Nore…";
            Render2D.centeredText(g, s, cx(), y + 17, Theme.TEXT_MUTED, false);
        }
        Render2D.centeredText(g, hint, cx(), y + 32, act != null ? Theme.accentLight() : Theme.TEXT_DIM, false);
        // keycaps: 1–5, Enter, Esc
        float kw = Album.keycapWidth("1–5") + Album.keycapWidth("Enter") + Album.keycapWidth("Esc") + Render2D.textWidth("wybierz") + Render2D.textWidth("zamknij") + 24;
        float kx = cx() - kw / 2f, ky = y + h + 6;
        kx += Album.keycap(g, "1–5", kx, ky) + 3;
        kx += Album.keycap(g, "Enter", kx, ky) + 4;
        Render2D.text(g, "wybierz", kx, ky + 1, Theme.TEXT_DIM, true);
        kx += Render2D.textWidth("wybierz") + 10;
        kx += Album.keycap(g, "Esc", kx, ky) + 4;
        Render2D.text(g, "zamknij", kx, ky + 1, Theme.TEXT_DIM, true);
    }

    private static float widthOfBadge(NoreHub.Entry e) {
        String label = e == null ? "Nore" : e.verified ? "Nore ✓" : "Nore";
        return Album.labelWidth(label) + (e != null ? 3 : 0);
    }

    /** Profile card: head, Nore status, friend state and the wardrobe from Nore Hub. */
    private void card(Gfx g, int mx, int my, float pa) {
        NoreHub.Entry e = NoreHub.get(name);
        List<String[]> wear = wardrobe(e);
        float w = 240, h = 104 + Math.max(1, wear.size()) * 11;
        float x = cx() - w / 2f, y = cy() - h / 2f + (1 - Animation.easeOutCubic(pa)) * 6 * Motion.travel();
        Album.floating(g, x, y, w, h, Theme.raised());
        Render2D.roundedRect(g, x + 9, y + 9, 38, 38, 3, Theme.VINYL);
        SocialWidgets.head(g, name, x + 10, y + 10, 36);
        Album.title(g, Render2D.trim(name, (int) (w - 64) / 2), x + 54, y + 9, Theme.TEXT);
        float by = y + 25;
        float bx = x + 54;
        if (nore()) bx += SocialWidgets.badge(g, bx, by, e != null && e.verified, e != null, true) + 4;
        else {
            String s = NoreHub.known(name) ? "Nie używa Nore" : "Sprawdzanie Nore…";
            Render2D.text(g, s, bx, by + 1, Theme.TEXT_MUTED, false);
            bx += Render2D.textWidth(s) + 6;
        }
        if (Friends.isFriend(name)) SocialWidgets.pill(g, bx, by, "Znajomy", ThemeTokens.DOT_READY);
        Social.Person p = Social.person(name);
        int st = p.state();
        Album.dot(g, x + 57, y + 42, 2, SocialWidgets.stateColor(st));
        Render2D.text(g, Render2D.trim(Social.status(p) + (e != null && !e.verified ? " · bez weryfikacji premium" : ""), (int) w - 72), x + 62, y + 38, Theme.TEXT_DIM, false);

        float ly = y + 56;
        Render2D.text(g, "Szatnia", x + 10, ly, Theme.TEXT, false);
        ly += 12;
        if (wear.isEmpty()) {
            Render2D.text(g, e == null ? "Szatnię widać tylko u graczy Nore" : "Nic nie nosi", x + 10, ly, Theme.TEXT_MUTED, false);
            ly += 11;
        }
        for (String[] s : wear) {
            int col = s[2] == null ? 0 : (int) Long.parseLong(s[2]);
            if (s[2] != null) Album.dot(g, x + 13.5f, ly + 4, 2.5f, 0xFF000000 | col);
            else Icons.sparkle(g, x + 13.5f, ly + 4, 3, Theme.accentLight());
            Render2D.text(g, Render2D.trim(s[0], 70), x + 21, ly, Theme.TEXT_DIM, false);
            Render2D.text(g, Render2D.trim(s[1], (int) w - 110), x + 21 + 76, ly, Theme.TEXT, false);
            ly += 11;
        }
        // buttons
        float bw = 70, bh = 16, gy = y + h - bh - 8;
        cardButton(g, mx, my, x + 10, gy, bw, bh, "‹ Wróć", 0);
        cardButton(g, mx, my, x + w - bw - 10, gy, bw, bh, "Napisz", 1);
    }

    private final Animation[] cardHover = {new Animation(0, 16), new Animation(0, 16)};
    private final float[][] cardRects = new float[2][];

    private void cardButton(Gfx g, int mx, int my, float x, float y, float w, float h, String label, int i) {
        boolean hov = Render2D.hovered(mx, my, x, y, w, h);
        float a = cardHover[i].target(hov ? 1 : 0).update();
        Album.button(g, x, y, w, h, label, i == 1 ? Album.PRIMARY : Album.SECONDARY, a);
        cardRects[i] = new float[]{x, y, w, h};
    }

    /** {slot name, item name, colour or null} for every slot the player wears. */
    private static List<String[]> wardrobe(NoreHub.Entry e) {
        List<String[]> out = new ArrayList<String[]>();
        if (e == null || !e.cosmetics.has("slots") || !e.cosmetics.get("slots").isJsonObject()) return out;
        for (Map.Entry<String, JsonElement> s : e.cosmetics.getAsJsonObject("slots").entrySet()) {
            if (!s.getValue().isJsonObject() || out.size() >= 10) continue;
            JsonObject o = s.getValue().getAsJsonObject();
            String id = o.has("id") && o.get("id").isJsonPrimitive() ? o.get("id").getAsString() : "";
            if (id.isEmpty()) continue;
            String variant = o.has("variant") && o.get("variant").isJsonPrimitive() ? o.get("variant").getAsString() : "";
            String color = o.has("color") && o.get("color").isJsonPrimitive() ? String.valueOf(o.get("color").getAsLong() & 0xFFFFFF) : null;
            out.add(new String[]{Social.slotName(s.getKey()), Social.pretty(id) + (variant.isEmpty() ? "" : " • " + Social.pretty(variant)), color});
        }
        return out;
    }

    /** Ring segment from angle a0 to a1 (degrees), radii r0..r1, inner→outer colour. */
    private void arc(Gfx g, float a0, float a1, float r0, float r1, int inner, int outer) {
        if (a1 <= a0) return;
        int steps = Math.max(2, (int) ((a1 - a0) / 4f));
        float[] xy = new float[(steps + 1) * 4];
        int[] col = new int[(steps + 1) * 2];
        for (int k = 0; k <= steps; k++) {
            double a = Math.toRadians(a0 + (a1 - a0) * k / steps);
            float c = (float) Math.cos(a), s = (float) Math.sin(a);
            xy[k * 4] = cx() + c * r0; xy[k * 4 + 1] = cy() + s * r0; xy[k * 4 + 2] = cx() + c * r1; xy[k * 4 + 3] = cy() + s * r1;
            col[k * 2] = inner; col[k * 2 + 1] = outer;
        }
        g.mesh(Gfx.TRIANGLE_STRIP, xy, col, (steps + 1) * 2);
    }

    // ------------------------------------------------------------------ icons

    private static void chatIcon(Gfx g, float cx, float cy, float s, int c) {
        Render2D.roundedOutline(g, cx - s, cy - s * 0.75f, s * 2, s * 1.35f, s * 0.35f, 1, c);
        Render2D.line(g, cx - s * 0.45f, cy + s * 0.6f, cx - s * 0.75f, cy + s, 1, c);
        Render2D.line(g, cx - s * 0.5f, cy - s * 0.15f, cx + s * 0.5f, cy - s * 0.15f, 1, c);
    }

    private static void friendIcon(Gfx g, float cx, float cy, float s, int c, boolean remove) {
        Icons.person(g, cx - s * 0.25f, cy, s * 0.95f, c);
        float px = cx + s * 0.75f, py = cy - s * 0.35f;
        Render2D.line(g, px - s * 0.35f, py, px + s * 0.35f, py, 1.2f, c);
        if (!remove) Render2D.line(g, px, py - s * 0.35f, px, py + s * 0.35f, 1.2f, c);
    }

    private static void cardIcon(Gfx g, float cx, float cy, float s, int c) {
        Render2D.roundedOutline(g, cx - s, cy - s * 0.7f, s * 2, s * 1.4f, 1.5f, 1, c);
        Render2D.circle(g, cx - s * 0.45f, cy - s * 0.12f, s * 0.28f, c);
        Render2D.line(g, cx, cy - s * 0.25f, cx + s * 0.65f, cy - s * 0.25f, 1, c);
        Render2D.line(g, cx, cy + s * 0.2f, cx + s * 0.65f, cy + s * 0.2f, 1, c);
    }

    private static void copyIcon(Gfx g, float cx, float cy, float s, int c) {
        Render2D.roundedOutline(g, cx - s * 0.85f, cy - s * 0.85f, s * 1.2f, s * 1.3f, 1.2f, 1, ColorUtil.withAlpha(c, ColorUtil.alpha(c) * 2 / 3));
        Render2D.roundedOutline(g, cx - s * 0.35f, cy - s * 0.45f, s * 1.2f, s * 1.3f, 1.2f, 1, c);
    }

    private static void muteIcon(Gfx g, float cx, float cy, float s, int c, boolean muted) {
        float x = cx - s * 0.6f;
        Render2D.rect(g, x - s * 0.35f, cy - s * 0.3f, s * 0.4f, s * 0.6f, c);
        g.mesh(Gfx.TRIANGLES, new float[]{x, cy - s * 0.3f, x + s * 0.55f, cy - s * 0.75f, x + s * 0.55f, cy + s * 0.75f,
                x, cy - s * 0.3f, x + s * 0.55f, cy + s * 0.75f, x, cy + s * 0.3f}, new int[]{c, c, c, c, c, c}, 6);
        if (muted) {
            Render2D.line(g, cx + s * 0.2f, cy - s * 0.4f, cx + s, cy + s * 0.4f, 1.1f, c);
            Render2D.line(g, cx + s * 0.2f, cy + s * 0.4f, cx + s, cy - s * 0.4f, 1.1f, c);
        } else {
            Render2D.ring(g, cx + s * 0.05f, cy, s * 0.55f, 1, -50, 50, c);
            Render2D.ring(g, cx + s * 0.05f, cy, s * 0.95f, 1, -50, 50, c);
        }
    }

    // ------------------------------------------------------------------ actions / input

    private void run(int i) {
        if (i < 0 || i >= actions.size()) return;
        Sounds.click();
        String k = actions.get(i).key;
        if ("write".equals(k)) {
            final boolean noreChat = Social.contactFor(name) != null || NoreHub.get(name) != null && LauncherChat.available();
            closeThen(() -> Social.message(name, null));
            if (!noreChat) finishClose(); // the game chat opens right away
        } else if ("friend".equals(k)) {
            Social.toggleFriend(name);
        } else if ("profile".equals(k)) {
            profileOpen = true;
            NoreHub.request(name);
        } else if ("copy".equals(k)) {
            Social.copyName(name);
            closeThen(null);
        } else if ("mute".equals(k)) {
            Social.toggleMute(name);
        }
    }

    private void closeThen(Runnable r) {
        afterClose = r;
        closeRequested = true;
    }

    private void finishClose() {
        Runnable r = afterClose;
        afterClose = null;
        closeRequested = true;
        game().openParent(null);
        // next tick: the character of the key that triggered the action must not reach the new screen
        if (r != null) dev.noreclient.NoreClient.runNextTick(r);
    }

    @Override
    public void close() {
        if (profileOpen) { profileOpen = false; return; }
        closeThen(null);
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (closeRequested) return true;
        if (button == 2) { closeThen(null); return true; }
        if (profileOpen) {
            if (button == 0 && cardRects[0] != null && Render2D.hovered(mx, my, cardRects[0][0], cardRects[0][1], cardRects[0][2], cardRects[0][3])) { Sounds.click(); profileOpen = false; return true; }
            if (button == 0 && cardRects[1] != null && Render2D.hovered(mx, my, cardRects[1][0], cardRects[1][1], cardRects[1][2], cardRects[1][3])) { profileOpen = false; run(0); return true; }
            if (button == 1) profileOpen = false;
            return true;
        }
        if (button == 1) { closeThen(null); return true; }
        if (hover >= 0) { run(hover); return true; }
        float dist = (float) Math.hypot(mx - cx(), my - cy());
        if (dist > r1() + 14 && !(my > cy() + r1() + 10 && my < cy() + r1() + 62 && Math.abs(mx - cx()) < 110)) closeThen(null);
        return true;
    }

    @Override
    public boolean keyPressed(int key, int modifiers) {
        if (closeRequested) return true;
        if (key == Keys.ESCAPE) { close(); return true; }
        if (profileOpen) {
            if (key == Keys.BACKSPACE || key == Keys.LEFT) { profileOpen = false; return true; }
            if (key == Keys.ENTER || key == Keys.KP_ENTER) { profileOpen = false; run(0); return true; }
            return true;
        }
        if (key >= Keys.N0 + 1 && key <= Keys.N0 + actions.size()) { run(key - Keys.N0 - 1); return true; }
        if (key == Keys.RIGHT || key == Keys.DOWN || key == Keys.TAB) { focus = (focus + 1) % actions.size(); Sounds.click(); return true; }
        if (key == Keys.LEFT || key == Keys.UP) { focus = focus <= 0 ? actions.size() - 1 : focus - 1; Sounds.click(); return true; }
        if ((key == Keys.ENTER || key == Keys.KP_ENTER || key == Keys.SPACE) && focus >= 0) { run(focus); return true; }
        return true;
    }
}
