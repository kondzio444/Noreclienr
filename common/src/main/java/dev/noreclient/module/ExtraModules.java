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
        m.add(new dev.noreclient.module.social.FriendsChat());
        m.add(new dev.noreclient.module.social.Cosmetics());
        m.add(new dev.noreclient.module.render.Hitboxes());
        m.add(new dev.noreclient.module.utility.AutoGG());
        m.add(new dev.noreclient.module.client.DynamicFps());
        m.add(new dev.noreclient.module.hud.WaypointHud());
        // 1.5
        m.add(new dev.noreclient.module.utility.Waypoints());
        m.add(new dev.noreclient.module.render.HitMarker());
        m.add(new dev.noreclient.module.hud.SpeedometerHud());
        m.add(new dev.noreclient.module.render.ChunkBorders());
        m.add(new dev.noreclient.module.hud.TotemPopHud());
        m.add(new dev.noreclient.module.utility.AfkAlert());
        m.add(new dev.noreclient.module.utility.ChatMentions());
        m.add(new dev.noreclient.module.hud.InfoPanelHud());
        m.add(new dev.noreclient.module.hud.NetherCoordsHud());
        m.add(new dev.noreclient.module.hud.LagDetectorHud());
        m.add(new dev.noreclient.module.player.HotbarLock());
        m.add(new dev.noreclient.module.utility.FallWarning());
        m.add(new dev.noreclient.module.render.DamageDirection());
        m.add(new dev.noreclient.module.hud.PickupLogHud());
        m.add(new dev.noreclient.module.utility.AutoReconnect());
        m.add(new dev.noreclient.module.utility.InventoryFullAlert());
        m.add(new dev.noreclient.module.hud.PingGraphHud());
    }

    private static final java.util.Set<String> NEW = new java.util.HashSet<String>(java.util.Arrays.asList(
            "Waypoints", "Hit Marker", "Speedometer", "Chunk Borders", "Totem Pops", "AFK Alert", "Chat Mentions", "Info Panel",
            "Nether Coords", "Lag Detector", "Hotbar Lock", "Fall Warning", "Damage Direction", "Pickup Log", "Auto Reconnect",
            "Inventory Full Alert", "Ping Graph"));

    /** Names of modules added in the current release (shown with a NEW badge). */
    public static boolean isNew(Module module) {
        String n = module.getName();
        return NEW.contains(n);
    }
}
