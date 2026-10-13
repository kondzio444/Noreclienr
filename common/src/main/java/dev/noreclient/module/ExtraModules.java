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
    }

    /** Names of modules added in the current release (shown with a NEW badge). */
    public static boolean isNew(Module module) {
        String n = module.getName();
        return n.equals("Auto Craft") || n.equals("Auto Respawn") || n.equals("Inventory HUD") || n.equals("Stopwatch")
                || n.equals("Last Death") || n.equals("TPS") || n.equals("Item Counter") || n.equals("Durability Alert")
                || n.equals("Low Health Alert") || n.equals("Effect Alert") || n.equals("Break Reminder") || n.equals("Coords Share") || n.equals("Discord RPC");
    }
}
