package dev.noreclient;

import dev.noreclient.api.Platform;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.menu.CosmeticsScreen;
import dev.noreclient.gui.menu.NoreMainMenu;
import dev.noreclient.module.client.ClientSettings;

/**
 * Developer tool for screenshots of the GUI: {@code -Dnoreclient.devScreens=menu,clickgui,settings,wardrobe,hud}
 * opens these screens one after another (first after ~10 s, then every 12 s) so a headless run can be
 * captured from outside. Does nothing without the property.
 */
final class DevScreens {
    private static final String[] LIST;
    private static int ticks, index;

    static {
        String p = System.getProperty("noreclient.devScreens");
        LIST = p == null || p.trim().isEmpty() ? new String[0] : p.split(",");
    }

    private DevScreens() {}

    static void tick() {
        if (LIST.length == 0 || index >= LIST.length) return;
        ticks++;
        if (ticks < 200 + index * 240) return;
        String s = LIST[index++].trim();
        NoreClient c = NoreClient.get();
        if (c != null) {
            ClientSettings cs = c.modules().get(ClientSettings.class);
            if (cs != null) cs.welcomeGuide.set(false);
        }
        dev.noreclient.gui.NoreScreen screen;
        if (s.equals("clickgui")) screen = new ClickGuiScreen(null);
        else if (s.equals("settings")) screen = ClickGuiScreen.forModule(null, c.modules().get(ClientSettings.class));
        else if (s.equals("wardrobe")) screen = new CosmeticsScreen(null);
        else if (s.equals("hud")) screen = new HudEditorScreen(null);
        else if (s.equals("downloads")) screen = ClickGuiScreen.forDownloads(null);
        else if (s.equals("menu")) screen = new NoreMainMenu();
        else if (s.equals("multiplayer")) screen = new dev.noreclient.gui.menu.MultiplayerScreen2(null);
        else if (s.equals("radial")) screen = new dev.noreclient.gui.click.RadialMenuScreen(null);
        else if (s.equals("friends")) screen = new dev.noreclient.gui.menu.FriendsScreen(null);
        else if (s.equals("toast")) {
            dev.noreclient.notification.NotificationManager.push("Zoom", "Moduł włączony", dev.noreclient.notification.NotificationManager.Type.SUCCESS);
            screen = new ClickGuiScreen(null);
        }
        else return;
        Platform.game().openScreen(screen);
    }
}
