package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.module.HudModule;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.StringSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/** A waypoint with distance and an arrow pointing to it; set it with a key. */
public class WaypointHud extends HudModule {
    public final KeybindSetting setKey = add(new KeybindSetting("Set Key", "Zapisuje punkt w miejscu, w którym stoisz", Keys.UNKNOWN));
    public final StringSetting name = add(new StringSetting("Name", "Nazwa punktu", "Baza", 24));
    public final StringSetting stored = add(new StringSetting("Position", "x y z wymiar (ustawiane klawiszem)", "", 64));

    public WaypointHud() {
        super("Waypoint", "Punkt nawigacyjny ze strzałką i odległością", 0.5f, 0.2f);
    }

    @Override
    public void onKeyPressed(int key) {
        if (setKey.isBound() && key == setKey.get() && inGame()) {
            stored.set((int) Math.floor(game().x()) + " " + (int) Math.floor(game().y()) + " " + (int) Math.floor(game().z()) + " " + game().dimension());
            NotificationManager.push("Waypoint", name.get() + ": " + stored.get(), NotificationManager.Type.SUCCESS);
        }
    }

    private double[] target() {
        String[] p = stored.get().trim().split(" ");
        if (p.length < 3) return null;
        try {
            if (p.length > 3 && inGame() && !p[3].equals(game().dimension())) return null;
            return new double[]{Double.parseDouble(p[0]) + 0.5, Double.parseDouble(p[1]), Double.parseDouble(p[2]) + 0.5};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    @Override
    public boolean shouldRender() { return target() != null; }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        double[] t = target();
        if (t == null) t = new double[]{game().x() + 120, game().y(), game().z() + 40};
        double dx = t[0] - game().x(), dz = t[2] - game().z();
        double dist = Math.sqrt(dx * dx + dz * dz + Math.pow(t[1] - game().y(), 2));
        float yaw = game().yaw(tickDelta);
        double angle = Math.toDegrees(Math.atan2(dz, dx)) - 90 - yaw;
        String label = name.get() + "  " + (int) dist + " m";
        width = Render2D.textWidth(label) + 30;
        height = 20;
        Render2D.roundedRect(g, 0, 0, width, height, Theme.radius() * 0.8f, 0x90160F26);
        Render2D.roundedOutline(g, 0, 0, width, height, Theme.radius() * 0.8f, 1, ColorUtil.withAlpha(Theme.accent(), 80));
        float cx = 11, cy = 10;
        double a = Math.toRadians(angle);
        float sx = (float) Math.sin(a), sy = (float) -Math.cos(a);
        Render2D.line(g, cx - sx * 5, cy - sy * 5, cx + sx * 6, cy + sy * 6, 1.8f, Theme.accent());
        Render2D.circle(g, cx + sx * 6, cy + sy * 6, 2.2f, Theme.accent2());
        Render2D.text(g, label, 22, 6, Theme.TEXT, true);
    }
}
