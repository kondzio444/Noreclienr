package dev.noreclient;

import dev.noreclient.api.Game;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.api.Platform;
import dev.noreclient.config.ConfigManager;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.hud.HudRenderer;
import dev.noreclient.gui.menu.NoreMainMenu;
import dev.noreclient.gui.menu.NorePauseMenu;
import dev.noreclient.module.ModuleManager;
import dev.noreclient.module.client.ClickGuiModule;
import dev.noreclient.module.client.ClientSettings;
import dev.noreclient.module.hud.BasicHuds;
import dev.noreclient.module.hud.InfoHuds;
import dev.noreclient.module.render.CustomCrosshair;
import dev.noreclient.module.render.Zoom;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.util.ClickTracker;
import dev.noreclient.util.CombatTracker;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.KeyState;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;

/**
 * Version independent core. Platforms call {@link #start} once and then forward game events to
 * the static {@code on*} hooks.
 */
public final class NoreClient {
    public static final String NAME = "Nore Client";
    public static final String VERSION = "1.4 Beta";
    public static final Logger LOGGER = Logger.getLogger(NAME);

    private static NoreClient instance;

    private final ModuleManager moduleManager = new ModuleManager();
    private final ConfigManager configManager;
    private final HudRenderer hudRenderer;
    private final List<Runnable> nextTick = new ArrayList<Runnable>();

    private NoreClient() {
        moduleManager.init();
        configManager = new ConfigManager(moduleManager);
        configManager.load();
        hudRenderer = new HudRenderer(moduleManager);
    }

    public static void start(Game game, String platformName, String... features) {
        Platform.init(game, platformName, features);
        instance = new NoreClient();
        LOGGER.info(NAME + " " + VERSION + " (" + platformName + ", Minecraft " + game.minecraftVersion() + ") "
                + instance.moduleManager.getModules().size() + " modules, " + instance.moduleManager.optionCount() + " options");
    }

    public static NoreClient get() { return instance; }

    public ModuleManager modules() { return moduleManager; }

    public ConfigManager config() { return configManager; }

    public HudRenderer hud() { return hudRenderer; }

    public static boolean ready() { return instance != null; }

    /** Runs the task at the start of the next client tick (e.g. to open a screen after a key press). */
    public static void runNextTick(Runnable r) {
        if (instance == null) return;
        synchronized (instance.nextTick) { instance.nextTick.add(r); }
    }

    // ------------------------------------------------------------------ hooks called by platforms

    public static void onTick() {
        if (instance == null) return;
        List<Runnable> run;
        synchronized (instance.nextTick) {
            run = new ArrayList<Runnable>(instance.nextTick);
            instance.nextTick.clear();
        }
        for (Runnable r : run) r.run();
        DevScreens.tick();
        dev.noreclient.module.social.Social.tick();
        instance.moduleManager.onTick();
    }

    /** Draws HUD overlays and notifications; call at the end of the in-game HUD. */
    public static void onRenderHud(Gfx g, float tickDelta) {
        if (instance == null) return;
        CurrentGfx.set(g);
        instance.moduleManager.renderOverlays(g, tickDelta);
        instance.hudRenderer.render(g, tickDelta);
        NotificationManager.render(g);
    }

    /** Custom crosshair; returns true when the vanilla crosshair should be hidden. */
    public static boolean onRenderCrosshair(Gfx g) {
        if (instance == null) return false;
        CustomCrosshair c = instance.moduleManager.get(CustomCrosshair.class);
        if (!c.isActive()) return false;
        CurrentGfx.set(g);
        c.render(g, g.width(), g.height());
        return true;
    }

    /** Raw key event (GLFW code). action: 1 press, 0 release, 2 repeat. inGameNoScreen: no screen open. */
    public static void onKey(int key, int action, boolean inGameNoScreen) {
        if (instance == null) return;
        if (action == 1 || action == 2) KeyState.set(key, true);
        else if (action == 0) KeyState.set(key, false);
        if (action != 1 || !inGameNoScreen) return;
        // developer tool: F7 saves a 360° panorama of the current view (menu backgrounds are made with it)
        if (key == 296 && System.getProperty("noreclient.devPanorama") != null) {
            runNextTick(new Runnable() {
                @Override public void run() { Platform.game().takePanorama(System.getProperty("noreclient.devPanorama")); }
            });
            return;
        }
        ClickGuiModule gui = instance.moduleManager.get(ClickGuiModule.class);
        if (key == gui.hudEditorKey.get()) {
            runNextTick(new Runnable() {
                @Override public void run() { Platform.game().openScreen(new HudEditorScreen(null)); }
            });
            return;
        }
        if (key == gui.getKeybind().get()) {
            runNextTick(new Runnable() {
                @Override public void run() { gui.toggle(); }
            });
            return;
        }
        instance.moduleManager.onKey(key);
    }

    public static void onMouseButton(int button, boolean pressed, boolean inGameNoScreen) {
        if (pressed && inGameNoScreen) ClickTracker.click(button);
        if (pressed && inGameNoScreen && button == 2 && instance != null) {
            final dev.noreclient.module.social.FriendsModule f = instance.moduleManager.get(dev.noreclient.module.social.FriendsModule.class);
            if (f.isActive()) runNextTick(f::onMiddleClick);
        }
    }

    /** Marks in front of a player name: {@link #MARK_FRIEND}, {@link #MARK_NORE}, {@link #MARK_VERIFIED}. */
    public static final int MARK_FRIEND = 1, MARK_NORE = 2, MARK_VERIFIED = 4;

    /**
     * Which marks a player name gets in the tab list (nametag = false) or above the head
     * (nametag = true). Cheap cache reads only: called for every name every frame.
     */
    public static int nameMarks(String name, boolean nametag) {
        if (instance == null || name == null) return 0;
        dev.noreclient.module.social.FriendsModule f = instance.moduleManager.get(dev.noreclient.module.social.FriendsModule.class);
        if (!f.isActive()) return 0;
        int marks = 0;
        if (f.highlight.isOn() && dev.noreclient.util.Friends.isFriend(name)) marks |= MARK_FRIEND;
        if (nametag ? f.noreNametag.isOn() : f.noreTab.isOn()) {
            dev.noreclient.util.NoreHub.Entry e = dev.noreclient.util.NoreHub.get(name);
            if (e != null) marks |= MARK_NORE | (e.verified ? MARK_VERIFIED : 0);
        }
        return marks;
    }

    /** True when an incoming chat line comes from a muted player and should not be shown. */
    public static boolean shouldHideChat(String text) {
        if (instance == null || !dev.noreclient.util.Friends.anyMuted()) return false;
        String sender = dev.noreclient.util.Friends.chatSender(text);
        return sender != null && !sender.equalsIgnoreCase(Platform.game().username()) && dev.noreclient.util.Friends.isMuted(sender);
    }

    // ------------------------------------------------------------------ 1.4 hooks

    /** Replacement for the vanilla multiplayer list. */
    public static NoreScreen multiplayerScreen() {
        return instance == null ? null : new dev.noreclient.gui.menu.MultiplayerScreen2(null);
    }

    /** Frame-rate limit (Dynamic FPS lowers it while the window is in the background). */
    public static int framerateLimit(int limit, boolean focused) {
        if (instance == null) return limit;
        dev.noreclient.module.client.DynamicFps d = instance.moduleManager.get(dev.noreclient.module.client.DynamicFps.class);
        return d.isActive() ? d.limit(limit, focused) : limit;
    }

    public static boolean isFriendHighlighted(String name) {
        if (instance == null) return false;
        dev.noreclient.module.social.FriendsModule f = instance.moduleManager.get(dev.noreclient.module.social.FriendsModule.class);
        return f.isActive() && f.highlight.isOn() && dev.noreclient.util.Friends.isFriend(name);
    }

    public static void onChatMessage(String text) {
        if (instance == null) return;
        dev.noreclient.module.utility.AutoGG gg = instance.moduleManager.get(dev.noreclient.module.utility.AutoGG.class);
        if (gg.isActive()) gg.onChat(text);
        dev.noreclient.module.Hooks.onChat(text);
    }

    private static volatile String connectName, connectAddress;

    public static void onConnecting(String name, String address) {
        connectName = name;
        connectAddress = address;
        dev.noreclient.module.Hooks.onConnecting(name, address);
    }

    /** Server card on the "connecting" screen. */
    public static void renderConnecting(Gfx g, int width, int height) {
        if (instance == null || connectAddress == null) return;
        CurrentGfx.set(g);
        dev.noreclient.gui.menu.ConnectOverlay.render(g, width, height, connectName, connectAddress);
    }

    /** Returns true when the scroll was consumed (zoom). */
    public static boolean onScroll(double amount) {
        return instance != null && (instance.moduleManager.get(Zoom.class).onScroll(amount) || dev.noreclient.module.Hooks.onScroll(amount));
    }

    public static void onAttack(Object entityHandle, double reachDistance) {
        if (instance == null) return;
        CombatTracker.onAttack(entityHandle);
        instance.moduleManager.get(BasicHuds.Combo.class).onHit();
        instance.moduleManager.get(BasicHuds.Reach.class).onHit(reachDistance);
        instance.moduleManager.get(InfoHuds.HitCounter.class).onHit();
        dev.noreclient.module.Hooks.onAttack();
    }

    /** Overlays drawn on top of container screens (inventory, crafting table...). */
    public static void onRenderContainer(Gfx g, int left, int top, int bgWidth, int bgHeight, int mouseX, int mouseY) {
        if (instance == null) return;
        CurrentGfx.set(g);
        instance.moduleManager.get(dev.noreclient.module.player.AutoCraft.class).renderPanel(g, left, top, bgWidth, bgHeight, g.width(), mouseX, mouseY);
    }

    /** Returns true when a client overlay consumed the click on a container screen. */
    public static boolean onContainerClick(double mouseX, double mouseY, int button) {
        return instance != null && instance.moduleManager.get(dev.noreclient.module.player.AutoCraft.class).click(mouseX, mouseY, button);
    }

    /** Replacement for the vanilla title screen (always the Nore menu once the client runs). */
    public static NoreScreen titleScreen() {
        return instance == null ? null : new NoreMainMenu();
    }

    /** Replacement for the vanilla pause menu. */
    public static NoreScreen pauseScreen() {
        return instance == null ? null : new NorePauseMenu();
    }

    /** World time from the server's time packet (about once a second); used for the TPS meter. */
    public static void onServerTime(long worldTime) {
        dev.noreclient.module.hud.ExtraHuds.Tps.onServerTime(worldTime);
        dev.noreclient.module.Hooks.onServerTime();
    }

    public static void onShutdown() {
        dev.noreclient.util.DiscordIpc.stop();
        if (instance != null) instance.configManager.save();
    }

    static int keyUnknown() { return Keys.UNKNOWN; }
}
