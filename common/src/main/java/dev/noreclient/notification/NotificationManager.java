package dev.noreclient.notification;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.gui.widget.Album;
import dev.noreclient.module.client.ClientSettings;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Motion;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Spring;
import dev.noreclient.util.Theme;
import dev.noreclient.util.ThemeTokens;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * Toasts in the "Album" style: a white sticker slapped into the corner (stick spring), a state dot
 * and two lines, the float shadow; leaving, it peels off up and away.
 */
public final class NotificationManager {
    public enum Type {
        INFO(ThemeTokens.DOT_INFO), SUCCESS(ThemeTokens.DOT_READY), ERROR(ThemeTokens.DOT_ERROR), WARNING(ThemeTokens.DOT_WAIT);
        final int color;

        Type(int color) {
            this.color = color;
        }
    }

    private static final long DURATION = 2400;
    private static final List<Notification> ACTIVE = new ArrayList<Notification>();

    private NotificationManager() {}

    public static void push(String title, String message, Type type) {
        NoreClient c = NoreClient.get();
        if (c != null && !c.modules().get(ClientSettings.class).notifications.isOn()) return;
        synchronized (ACTIVE) {
            // replace an existing notification with the same title so spamming a key doesn't stack
            for (Iterator<Notification> it = ACTIVE.iterator(); it.hasNext(); ) if (it.next().title.equals(title)) it.remove();
            ACTIVE.add(new Notification(title, message, type));
            while (ACTIVE.size() > 6) ACTIVE.remove(0);
        }
    }

    public static void render(Gfx ctx) {
        synchronized (ACTIVE) {
            if (ACTIVE.isEmpty()) return;
            NoreClient c = NoreClient.get();
            String side = c == null ? "Bottom Right" : c.modules().get(ClientSettings.class).notificationSide.get();
            boolean top = side.startsWith("Top");
            boolean left = side.endsWith("Left");
            int sw = ctx.width(), sh = ctx.height();
            float h = 26, gap = 5;
            float y = top ? 8 : sh - 8 - h;
            long now = System.currentTimeMillis();
            List<Notification> ordered = new ArrayList<Notification>(ACTIVE);
            if (!top) java.util.Collections.reverse(ordered);
            float base = ctx.getAlpha();
            for (Notification n : ordered) {
                long age = now - n.created;
                boolean leaving = age > DURATION;
                if (leaving && n.leftAt == 0) n.leftAt = now;
                float in = Motion.progress(n.created, 0, ThemeTokens.DUR_OVERLAY, ThemeTokens.EASE_OUT);
                float out = n.leftAt == 0 ? 0 : Motion.progress(n.leftAt, 0, ThemeTokens.DUR_PEEL, ThemeTokens.EASE_PEEL);
                float p = in * (1 - out);
                n.slot.target(1).update();
                float w = Math.max(120, Math.max(Render2D.textWidth(n.title), Render2D.textWidth(n.message)) + 28);
                float x = left ? 8 : sw - 8 - w;
                float k = Motion.stickScale(n.created);
                float dx = out * 10 * Motion.travel(), dy = -out * 8 * Motion.travel();
                ctx.setAlpha(base * p);
                ctx.push();
                ctx.translate(x + w / 2f + dx, y + h / 2f + dy);
                ctx.scale(k, k);
                ctx.translate(-w / 2f, -h / 2f);
                Render2D.shadow(ctx, 0, 3, w, h, Album.R, 6, 0x90000000);
                Album.white(ctx, 0, 0, w, h, 0);
                Album.dot(ctx, 10, 9, 2.5f, n.type.color);
                Render2D.text(ctx, Render2D.trim(n.title, (int) w - 24), 17, 5, Theme.VINYL_INK, false);
                Render2D.text(ctx, Render2D.trim(n.message, (int) w - 24), 17, 15, Theme.VINYL_INK_SOFT, false);
                // exact-length time left
                float progress = 1f - Math.min(1f, age / (float) DURATION);
                Render2D.rect(ctx, 4, h - 2, (w - 8) * progress, 1, ColorUtil.withAlpha(n.type.color, 200));
                ctx.pop();
                float step = (h + gap) * Math.max(0, Math.min(1, n.leftAt == 0 ? 1 : 1 - out));
                y += top ? step : -step;
            }
            ctx.setAlpha(base);
            for (Iterator<Notification> it = ACTIVE.iterator(); it.hasNext(); ) {
                Notification n = it.next();
                if (n.leftAt != 0 && now - n.leftAt > ThemeTokens.DUR_PEEL + 20) it.remove();
            }
        }
    }

    private static final class Notification {
        final String title, message;
        final Type type;
        final long created = System.currentTimeMillis();
        long leftAt;
        final Spring slot = Spring.stick(0);

        Notification(String title, String message, Type type) {
            this.title = title;
            this.message = message;
            this.type = type;
        }
    }
}
