package dev.noreclient.module;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.module.hud.LagDetectorHud;
import dev.noreclient.module.hud.TotemPopHud;
import dev.noreclient.module.player.HotbarLock;
import dev.noreclient.module.render.HitMarker;
import dev.noreclient.module.utility.AfkAlert;
import dev.noreclient.module.utility.AutoReconnect;
import dev.noreclient.module.utility.ChatMentions;
import dev.noreclient.util.CurrentGfx;

/**
 * Game events for the 1.5 modules. Platforms (mixins) and {@link NoreClient} forward to these, so
 * the modules stay in one place and the hooks stay one line each.
 */
public final class Hooks {
    private Hooks() {}

    /** Vertical field of view of the last rendered frame (after zoom), for world markers. */
    public static volatile float fov = 70;

    private static ModuleManager modules() {
        NoreClient c = NoreClient.get();
        return c == null ? null : c.modules();
    }

    /** Entity event from the server (35 = totem used, 3 = death). Main thread. */
    public static void onEntityStatus(Object entity, int status) {
        ModuleManager m = modules();
        if (m == null || entity == null) return;
        TotemPopHud t = m.get(TotemPopHud.class);
        if (t.isActive()) t.onStatus(entity, status);
    }

    /** Drawn over the vanilla "disconnected" screen. */
    public static void renderDisconnected(Gfx g, int width, int height) {
        ModuleManager m = modules();
        if (m == null) return;
        CurrentGfx.set(g);
        m.get(AutoReconnect.class).renderScreen(g, width, height);
    }

    public static void onConnecting(String name, String address) {
        ModuleManager m = modules();
        if (m != null) m.get(AutoReconnect.class).onConnecting(name, address);
    }

    public static void onChat(String text) {
        ModuleManager m = modules();
        if (m == null) return;
        ChatMentions c = m.get(ChatMentions.class);
        if (c.isMention(text)) c.onMention(text);
        AfkAlert a = m.get(AfkAlert.class);
        if (a.isActive()) a.onChat(text, c.isMentionOfMe(text));
    }

    public static void onAttack() {
        ModuleManager m = modules();
        if (m == null) return;
        HitMarker h = m.get(HitMarker.class);
        if (h.isActive()) h.onHit();
        m.get(AfkAlert.class).onActivity();
    }

    /** Returns true when the scroll was consumed. */
    public static boolean onScroll(double amount) {
        ModuleManager m = modules();
        if (m == null) return false;
        m.get(AfkAlert.class).onActivity();
        HotbarLock h = m.get(HotbarLock.class);
        return h.isActive() && h.onScroll(amount);
    }

    public static void onServerTime() {
        LagDetectorHud.onServerPacket();
    }
}
