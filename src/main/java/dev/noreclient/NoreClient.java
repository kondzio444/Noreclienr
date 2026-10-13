package dev.noreclient;

import dev.noreclient.config.ConfigManager;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.hud.HudRenderer;
import dev.noreclient.module.ModuleManager;
import dev.noreclient.module.hud.ComboHud;
import dev.noreclient.module.hud.ReachHud;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.util.CombatTracker;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import net.minecraft.util.ActionResult;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class NoreClient implements ClientModInitializer {
    public static final String MOD_ID = "noreclient";
    public static final String NAME = "Nore Client";
    public static final String VERSION = "1.0.0";
    public static final Logger LOGGER = LoggerFactory.getLogger(NAME);

    private static NoreClient instance;

    private ModuleManager moduleManager;
    private ConfigManager configManager;
    private HudRenderer hudRenderer;

    public static KeyBinding zoomKey;
    public static KeyBinding freelookKey;
    private static KeyBinding hudEditorKey;

    @Override
    public void onInitializeClient() {
        instance = this;
        moduleManager = new ModuleManager();
        moduleManager.init();
        configManager = new ConfigManager(moduleManager);
        configManager.load();
        hudRenderer = new HudRenderer(moduleManager);

        String cat = "category.noreclient";
        zoomKey = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.noreclient.zoom", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_C, cat));
        freelookKey = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.noreclient.freelook", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_LEFT_ALT, cat));
        hudEditorKey = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.noreclient.hudeditor", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_H, cat));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            moduleManager.onTick();
            while (hudEditorKey.wasPressed()) {
                if (client.currentScreen == null) client.setScreen(new HudEditorScreen(null));
            }
            CombatTracker.tick();
        });

        HudRenderCallback.EVENT.register((context, tickCounter) -> {
            hudRenderer.render(context, tickCounter.getTickDelta(true));
            NotificationManager.render(context);
        });

        AttackEntityCallback.EVENT.register((player, world, hand, entity, hitResult) -> {
            if (world.isClient && player == MinecraftClient.getInstance().player) {
                CombatTracker.onAttack(entity);
                moduleManager.get(ComboHud.class).onHit(entity);
                moduleManager.get(ReachHud.class).onHit(player, entity);
            }
            return ActionResult.PASS;
        });

        ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
            if (screen instanceof GameMenuScreen) {
                Screens.getButtons(screen).add(ButtonWidget.builder(Text.literal("✦ " + NAME),
                                b -> client.setScreen(new ClickGuiScreen(screen)))
                        .dimensions(4, 4, 98, 20).build());
            } else if (screen instanceof TitleScreen) {
                Screens.getButtons(screen).add(ButtonWidget.builder(Text.literal("\u2726 " + NAME),
                                b -> client.setScreen(new ClickGuiScreen(screen)))
                        .dimensions(4, 4, 98, 20).build());
            }
        });

        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> configManager.save());

        LOGGER.info("{} {} initialised with {} modules", NAME, VERSION, moduleManager.getModules().size());
    }

    public static NoreClient get() { return instance; }
    public ModuleManager modules() { return moduleManager; }
    public ConfigManager config() { return configManager; }
    public HudRenderer hud() { return hudRenderer; }
}
