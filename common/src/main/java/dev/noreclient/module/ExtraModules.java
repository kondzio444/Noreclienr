package dev.noreclient.module;

import dev.noreclient.module.hud.ExtraHuds;
import dev.noreclient.module.player.AutoCraft;
import dev.noreclient.module.utility.Alerts;

/** Registration hook for additional modules (keeps ModuleManager readable). */
public final class ExtraModules {
    private ExtraModules() {}

    static void register(ModuleManager m) {
        m.add(new AutoCraft());
        m.add(new dev.noreclient.module.client.DiscordRpc());
        m.add(new Alerts.AutoRespawn());
        m.add(new ExtraHuds.InventoryHud());
        m.add(new ExtraHuds.Stopwatch());
        m.add(new ExtraHuds.LastDeath());
        m.add(new ExtraHuds.Tps());
        m.add(new ExtraHuds.CustomCounter());
        m.add(new Alerts.DurabilityAlert());
        m.add(new Alerts.LowHealthAlert());
        m.add(new Alerts.EffectAlert());
        m.add(new Alerts.BreakReminder());
        m.add(new Alerts.CoordsShare());
        m.add(new dev.noreclient.module.utility.Screenshots());
        m.add(new dev.noreclient.module.hud.ServerInfoHud());
        m.add(new dev.noreclient.module.social.FriendsModule());
        m.add(new dev.noreclient.module.social.Cosmetics());
        m.add(new dev.noreclient.module.render.Hitboxes());
        m.add(new dev.noreclient.module.utility.AutoGG());
        m.add(new dev.noreclient.module.client.DynamicFps());
        m.add(new dev.noreclient.module.hud.WaypointHud());
    }

    /** Names of modules added in the current release (shown with a NEW badge). */
    public static boolean isNew(Module module) {
        String n = module.getName();
        return n.equals("Screenshots") || n.equals("Server Info") || n.equals("Friends") || n.equals("Cosmetics") || n.equals("Hitboxes")
                || n.equals("Auto GG") || n.equals("Dynamic FPS") || n.equals("Waypoint");
    }
}
