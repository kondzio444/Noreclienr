package dev.noreclient.notification;

import dev.noreclient.NoreClient;
import dev.noreclient.module.client.ClientSettings;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/** Small animated toasts in the corner of the screen. */
public final class NotificationManager {
    public enum Type {
        INFO(0xFF60A5FA, "i"), SUCCESS(Theme.SUCCESS, "✔"), ERROR(Theme.ERROR, "✖"), WARNING(Theme.WARNING, "!");
        final int color;
        final String icon;

        Type(int color, String icon) {
            this.color = color;
            this.icon = icon;
        }
    }

    private static final long DURATION = 2200;
    private static final List<Notification> ACTIVE = new ArrayList<>();

    private NotificationManager() {}

    public static void push(String title, String message, Type type) {
        NoreClient c = NoreClient.get();
        if (c != null && !c.modules().get(ClientSettings.class).notifications.isOn()) return;
        synchronized (ACTIVE) {
            // replace an existing notification with the same title so spamming a key doesn't stack
            ACTIVE.removeIf(n -> n.title.equals(title));
            ACTIVE.add(new Notification(title, message, type));
            while (ACTIVE.size() > 6) ACTIVE.remove(0);
        }
    }

    public static void render(DrawContext ctx) {
        synchronized (ACTIVE) {
            if (ACTIVE.isEmpty()) return;
            NoreClient c = NoreClient.get();
            String side = c == null ? "Bottom Right" : c.modules().get(ClientSettings.class).notificationSide.get();
            boolean top = side.startsWith("Top");
            boolean left = side.endsWith("Left");
            int sw = ctx.getScaledWindowWidth(), sh = ctx.getScaledWindowHeight();
            float h = 30, gap = 4;
            float y = top ? 6 : sh - 6 - h;
            long now = System.currentTimeMillis();
            Iterator<Notification> it = ACTIVE.iterator();
            List<Notification> ordered = new ArrayList<>(ACTIVE);
            if (!top) java.util.Collections.reverse(ordered);
            for (Notification n : ordered) {
                long age = now - n.created;
                boolean leaving = age > DURATION;
                n.slide.target(leaving ? 0 : 1);
                float p = n.slide.update();
                float w = Math.max(120, Math.max(Render2D.textWidth(n.title), Render2D.textWidth(n.message)) + 40);
                float x = left ? 6 - (1 - p) * (w + 12) : sw - 6 - w + (1 - p) * (w + 12);
                float r = Theme.radius();
                Render2D.shadow(ctx, x, y, w, h, r, 4, ColorUtil.fade(0x70000000, p));
                Render2D.roundedRect(ctx, x, y, w, h, r, ColorUtil.fade(0xF0121320, p));
                Render2D.roundedRect(ctx, x + 6, y + 7, 16, 16, 8, ColorUtil.fade(ColorUtil.withAlpha(n.type.color, 60), p));
                Render2D.centeredText(ctx, n.type.icon, x + 14, y + 11, ColorUtil.fade(n.type.color, p), false);
                Render2D.text(ctx, n.title, x + 28, y + 6, ColorUtil.fade(Theme.TEXT, p), false);
                Render2D.text(ctx, n.message, x + 28, y + 17, ColorUtil.fade(Theme.TEXT_DIM, p), false);
                float progress = 1f - Math.min(1f, age / (float) DURATION);
                Render2D.roundedRect(ctx, x + 4, y + h - 2.5f, (w - 8) * progress, 1.5f, 0.75f, ColorUtil.fade(n.type.color, p));
                y += top ? (h + gap) * p : -(h + gap) * p;
            }
            while (it.hasNext()) {
                Notification n = it.next();
                if (now - n.created > DURATION && n.slide.get() < 0.02f) it.remove();
            }
        }
    }

    private static final class Notification {
        final String title, message;
        final Type type;
        final long created = System.currentTimeMillis();
        final Animation slide = new Animation(0, 12);

        Notification(String title, String message, Type type) {
            this.title = title;
            this.message = message;
            this.type = type;
        }
    }
}
