package dev.noreclient.gui.menu;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.api.TargetInfo;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.widget.Icons;
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

        Render2D.radial(g, cx(), cy(), Math.max(width, height) * 0.55f, ColorUtil.withAlpha(0xFF120826, (int) (150 * in)), ColorUtil.withAlpha(0xFF04020A, (int) (120 * in)));

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
            float scale = 0.85f + 0.15f * Animation.easeOutBack(Math.min(1, t / 0.32f)) - pa * 0.15f;
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
        // soft glow and track
        Render2D.radial(g, cx(), cy(), r1() * 1.45f, ColorUtil.withAlpha(Theme.accent(), 40), 0);
        for (int i = 0; i < n; i++) {
            Action a = actions.get(i);
            float e = Animation.easeOutCubic((t - 0.03f * i) / 0.26f);
            if (e <= 0) continue;
            boolean on = i == hover || i == focus;
            float lift = a.lift.target(on ? 1 : 0).update();
            float mid = angle(i), half = (span - gap) / 2f * e;
            float rr0 = r0() + lift * 1.5f, rr1 = r1() + lift * 5;
            boolean danger = "mute".equals(a.key) && Friends.isMuted(name) || "friend".equals(a.key) && Friends.isFriend(name);
            int base = danger ? 0xFFFF6B6B : Theme.accent();
            int cIn = ColorUtil.lerp(0xE8140C26, ColorUtil.withAlpha(ColorUtil.lerp(base, 0xFF1A0E36, 0.4f), 240), lift);
            int cOut = ColorUtil.lerp(0xE81E1438, ColorUtil.withAlpha(base, 240), lift * 0.85f);
            arc(g, mid - half, mid + half, rr0, rr1, cIn, cOut);
            int edge = ColorUtil.withAlpha(0xFFE9DEFF, (int) (60 + 160 * lift));
            arc(g, mid - half, mid + half, rr1 - 1.1f, rr1, edge, edge);
            double rad = Math.toRadians(mid);
            float px = cx() + (float) Math.cos(rad) * (rr0 + rr1) / 2f, py = cy() + (float) Math.sin(rad) * (rr0 + rr1) / 2f;
            int col = ColorUtil.withAlpha(ColorUtil.lerp(Theme.TEXT_DIM, 0xFFFFFFFF, lift), (int) (255 * e));
            a.icon.draw(g, px, py - 4, 5.5f, col);
            String l = a.label();
            float ts = 0.5f;
            Render2D.scaledText(g, l, px - Render2D.textWidth(l) * ts / 2f, py + 5, ts, col, false);
            String num = String.valueOf(i + 1);
            float nx = cx() + (float) Math.cos(rad) * (rr1 + 6), ny = cy() + (float) Math.sin(rad) * (rr1 + 6);
            Render2D.scaledText(g, num, nx - Render2D.textWidth(num) * 0.45f / 2f, ny - 2, 0.45f, ColorUtil.withAlpha(Theme.TEXT_MUTED, (int) (200 * e)), false);
        }
        float pa = pointerAlpha.get();
        if (pa > 0.02f) {
            float c = pointer.get();
            arc(g, c - 14, c + 14, r0() - 4, r0() - 2.6f, ColorUtil.withAlpha(Theme.accent2(), (int) (90 * pa)), ColorUtil.withAlpha(Theme.accent2(), (int) (230 * pa)));
        }
    }

    private void hub(Gfx g) {
        float r = hubR();
        Render2D.circle(g, cx(), cy(), r + 2.5f, ColorUtil.withAlpha(Theme.accent(), 70));
        Render2D.radial(g, cx(), cy(), r, 0xF6241444, 0xF60C0718);
        Render2D.ring(g, cx(), cy(), r, 1.1f, 0, 360, ColorUtil.withAlpha(Theme.accent2(), 150));
        float s = 22;
        SocialWidgets.head(g, name, cx() - s / 2f, cy() - s / 2f, s);
        NoreHub.Entry e = NoreHub.get(name);
        if (nore()) SocialWidgets.mark(g, cx() + 6, cy() + 6, 10, e != null && e.verified, e != null);
        if (Friends.isFriend(name)) Icons.star(g, cx() - 11, cy() + 11, 3.4f, 0xFF5BE37D, true);
    }

    /** Name plate under the ring: nick, Nore badge, friend state and what the pointed action does. */
    private void plate(Gfx g, float a) {
        NoreHub.Entry e = NoreHub.get(name);
        boolean friend = Friends.isFriend(name), muted = Friends.isMuted(name);
        float y = cy() + r1() + 14;
        float nameW = Render2D.textWidth(name);
        float badges = 0;
        if (nore()) badges += widthOfBadge(e) + 4;
        if (friend) badges += Render2D.textWidth("★ Znajomy") * 0.62f + 14;
        if (muted) badges += Render2D.textWidth("Wyciszony") * 0.62f + 14;
        float w = Math.max(150, Math.max(nameW + 16, badges + 12));
        Action act = hover >= 0 ? actions.get(hover) : focus >= 0 ? actions.get(focus) : null;
        String hint = act != null ? act.hint() : Social.onServer(name) ? "Na tym serwerze" : "W pobliżu";
        w = Math.max(w, Render2D.textWidth(hint) * 0.62f + 16);
        float h = 44, x = cx() - w / 2f;
        Render2D.shadow(g, x, y, w, h, Theme.radius(), 6, 0x70000000);
        Render2D.roundedRect(g, x, y, w, h, Theme.radius(), 0xE0120E1E);
        Render2D.roundedOutline(g, x, y, w, h, Theme.radius(), 1, 0x26FFFFFF);
        Render2D.quadGradient(g, x + 8, y, w - 16, 1, 0, ColorUtil.withAlpha(Theme.accent(), 150), ColorUtil.withAlpha(Theme.accent(), 150), 0);
        Render2D.centeredText(g, name, cx(), y + 5, Theme.TEXT, true);
        float bx = cx() - badges / 2f + 2;
        if (nore()) bx += SocialWidgets.badge(g, bx, y + 16, e != null && e.verified, e != null, false) + 4;
        if (friend) bx += SocialWidgets.pill(g, bx, y + 16, "★ Znajomy", 0xFF5BE37D) + 4;
        if (muted) SocialWidgets.pill(g, bx, y + 16, "Wyciszony", Theme.TEXT_MUTED);
        if (badges == 0) {
            String s = NoreHub.known(name) ? "Nie używa Nore" : "Sprawdzanie Nore…";
            Render2D.scaledText(g, s, cx() - Render2D.textWidth(s) * 0.62f / 2f, y + 18, 0.62f, Theme.TEXT_MUTED, false);
        }
        Render2D.scaledText(g, hint, cx() - Render2D.textWidth(hint) * 0.62f / 2f, y + 32, 0.62f, act != null ? Theme.accent2() : Theme.TEXT_DIM, false);
        String keys = "1–5 / strzałki + Enter • Esc – zamknij";
        Render2D.scaledText(g, keys, cx() - Render2D.textWidth(keys) * 0.55f / 2f, y + h + 6, 0.55f, ColorUtil.withAlpha(Theme.TEXT_MUTED, (int) (200 * a)), false);
    }

    private static float widthOfBadge(NoreHub.Entry e) {
        String label = e == null ? "Nore" : e.verified ? "Nore ✓" : "Nore";
        return 13 + Render2D.textWidth(label) * 0.62f + 5;
    }

    /** Profile card: head, Nore status, friend state and the wardrobe from Nore Hub. */
    private void card(Gfx g, int mx, int my, float pa) {
        NoreHub.Entry e = NoreHub.get(name);
        List<String[]> wear = wardrobe(e);
        float w = 230, h = 102 + Math.max(1, wear.size()) * 11;
        float x = cx() - w / 2f, y = cy() - h / 2f + (1 - Animation.easeOutCubic(pa)) * 14;
        Render2D.shadow(g, x, y, w, h, Theme.radius(), 8, 0x80000000);
        Render2D.roundedRect(g, x, y, w, h, Theme.radius(), 0xF0120E1E);
        Render2D.roundedOutline(g, x, y, w, h, Theme.radius(), 1, 0x30FFFFFF);
        Render2D.quadGradient(g, x + 8, y, w - 16, 1, 0, ColorUtil.withAlpha(Theme.accent(), 170), ColorUtil.withAlpha(Theme.accent(), 170), 0);
        SocialWidgets.head(g, name, x + 10, y + 10, 36);
        Render2D.scaledText(g, name, x + 54, y + 11, 1.15f, Theme.TEXT, true);
        float by = y + 25;
        float bx = x + 54;
        if (nore()) bx += SocialWidgets.badge(g, bx, by, e != null && e.verified, e != null, true) + 4;
        else {
            String s = NoreHub.known(name) ? "Nie używa Nore" : "Sprawdzanie Nore…";
            Render2D.scaledText(g, s, bx, by + 2, 0.62f, Theme.TEXT_MUTED, false);
            bx += Render2D.textWidth(s) * 0.62f + 6;
        }
        if (Friends.isFriend(name)) SocialWidgets.pill(g, bx, by, "★ Znajomy", 0xFF5BE37D);
        Social.Person p = Social.person(name);
        int st = p.state();
        Render2D.circle(g, x + 57, y + 42, 2.2f, SocialWidgets.stateColor(st));
        Render2D.scaledText(g, Social.status(p) + (e != null && !e.verified ? " • konto bez weryfikacji premium" : ""), x + 62, y + 39.5f, 0.62f, Theme.TEXT_DIM, false);

        float ly = y + 56;
        Render2D.rect(g, x + 10, ly - 4, w - 20, 1, 0x18FFFFFF);
        Render2D.scaledText(g, "SZATNIA", x + 10, ly, 0.6f, Theme.accent2(), false);
        ly += 10;
        if (wear.isEmpty()) {
            Render2D.scaledText(g, e == null ? "Szatnię widać tylko u graczy Nore" : "Nic nie nosi", x + 10, ly, 0.68f, Theme.TEXT_MUTED, false);
            ly += 11;
        }
        for (String[] s : wear) {
            int col = s[2] == null ? 0 : (int) Long.parseLong(s[2]);
            if (s[2] != null) {
                Render2D.roundedRect(g, x + 10, ly, 7, 7, 2, 0xFF000000 | col);
                Render2D.roundedOutline(g, x + 10, ly, 7, 7, 2, 1, 0x40FFFFFF);
            } else Icons.sparkle(g, x + 13.5f, ly + 3.5f, 3, Theme.accent2());
            Render2D.scaledText(g, s[0], x + 21, ly + 0.5f, 0.68f, Theme.TEXT_DIM, false);
            Render2D.scaledText(g, s[1], x + 21 + 74, ly + 0.5f, 0.68f, Theme.TEXT, false);
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
        dev.noreclient.gui.widget.Widgets.glowBox(g, x, y, w, h, Theme.radius(), Theme.accent(), a, i == 1 ? 1f : 0.55f);
        Render2D.centeredText(g, label, x + w / 2f, y + 4, dev.noreclient.gui.widget.Widgets.glowText(Theme.accent(), 0.3f), false);
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
