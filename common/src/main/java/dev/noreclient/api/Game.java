package dev.noreclient.api;

import dev.noreclient.gui.NoreScreen;

import java.io.File;
import java.util.List;

/**
 * Everything the version independent core needs from Minecraft. Each platform (one per group of
 * Minecraft versions) implements this. Methods must be cheap; most are called every frame.
 * Values that a version does not have return a neutral default (e.g. 1 for cooldown).
 */
public interface Game {
    // ------------------------------------------------------------------ general
    String minecraftVersion();

    String username();

    int fps();

    boolean inWorld();

    boolean screenOpen();

    boolean chatOpen();

    boolean hudHidden();

    boolean debugScreen();

    int scaledWidth();

    int scaledHeight();

    File gameDir();

    long windowHandle();

    // ------------------------------------------------------------------ camera
    /** 0 = first person, 1 = third person back, 2 = third person front. */
    int perspective();

    void setPerspective(int perspective);

    boolean smoothCamera();

    void setSmoothCamera(boolean on);

    // ------------------------------------------------------------------ player
    double x();

    double y();

    double z();

    double prevX();

    double prevY();

    double prevZ();

    float yaw(float tickDelta);

    float pitch();

    void setRotation(float yaw, float pitch);

    double velocityX();

    double velocityY();

    double velocityZ();

    float health();

    float maxHealth();

    float absorption();

    int armorValue();

    int food();

    float saturation();

    int xpLevel();

    float xpProgress();

    int hurtTime();

    boolean dead();

    boolean sneaking();

    boolean sprinting();

    boolean swimming();

    boolean flying();

    boolean fallFlying();

    boolean horizontalCollision();

    /** 0..1, 1 when the attack is ready (always 1 before 1.9). */
    float attackCooldown();

    /** 0..1 bow/crossbow charge, or -1 when not charging. */
    float bowCharge();

    /** "north", "south", "west", "east". */
    String facing();

    // ------------------------------------------------------------------ world
    String biome();

    /** "overworld", "the_nether", "the_end" or a mod dimension path. */
    String dimension();

    long timeOfDay();

    boolean raining();

    boolean thundering();

    /** mode: 0 combined, 1 block, 2 sky. */
    int lightLevel(int mode);

    int entityCount();

    int worldPlayerCount();

    // ------------------------------------------------------------------ server
    boolean singleplayer();

    String serverAddress();

    String serverBrand();

    int ping();

    int tabPlayerCount();

    // ------------------------------------------------------------------ crosshair
    /** Name (or id) of the block under the crosshair, null if none. */
    String lookBlock(boolean asId);

    TargetInfo lookEntity();

    /** Distance to whatever the crosshair hits, or -1. */
    double lookDistance();

    TargetInfo describe(Object entityHandle);

    // ------------------------------------------------------------------ inventory
    int countItem(String id);

    /** Helmet, chestplate, leggings, boots (empty stacks omitted). */
    List<ItemInfo> armor();

    ItemInfo mainHand();

    ItemInfo chestItem();

    List<EffectInfo> effects();

    /** A few effects for the HUD editor preview. */
    List<EffectInfo> previewEffects();

    List<ItemInfo> previewArmor();

    /** The 27 main inventory slots followed by the 9 hotbar slots (null for empty). */
    List<ItemInfo> inventory();

    /** An item stack of the given id for drawing icons, or null if the id is unknown. */
    ItemInfo itemIcon(String id);

    // ------------------------------------------------------------------ crafting
    /** Size of the open crafting grid: 2 (player inventory), 3 (crafting table) or 0. */
    int craftingGrid();

    /** How many times the recipe can be crafted from the inventory and grid (0 if unknown or too big). */
    int craftableCount(String recipeId);

    /**
     * Fills the grid with the recipe: through the recipe book when the recipe is unlocked (all =
     * a full stack), otherwise by placing one set of ingredients with ordinary slot clicks.
     */
    boolean fillRecipe(String recipeId, boolean all);

    boolean craftResultReady();

    /** Shift-clicks the crafting result into the inventory. */
    void takeCraftResult();

    // ------------------------------------------------------------------ input
    /** Logical keys: forward, back, left, right, jump, sneak, sprint, attack, use. */
    boolean keyDown(String logicalKey);

    String keyLabel(String logicalKey);

    String keyName(int glfwKey);

    void setSprintHeld(boolean held);

    boolean shiftDown();

    boolean controlDown();

    String clipboard();

    void setClipboard(String text);

    // ------------------------------------------------------------------ actions
    void openScreen(NoreScreen screen);

    /** Opens the given parent (a NoreScreen, a platform screen object, or null for the game). */
    void openParent(Object parent);

    Object currentScreenHandle();

    void sendChat(String message);

    void playClick(float pitch);

    void openSingleplayer(Object parent);

    /** Entries of the multiplayer server list: {name, address}. */
    List<String[]> serverList();

    /** Joins a server directly (quick join). */
    void connect(String name, String address, Object parent);

    void openMultiplayer(Object parent);

    void openOptions(Object parent);

    void openAdvancements(Object parent);

    void openStats(Object parent);

    void openLan(Object parent);

    boolean canOpenLan();

    void disconnect();

    /** Respawns after death (no-op while alive). */
    void respawn();

    /** Shows a message in the chat that only this player sees. */
    void localChat(String message);

    void quit();

    void openUrl(String url);

    // ------------------------------------------------------------------ resources
    /** Registers a PNG as a texture (render thread); null on failure. */
    TextureRef loadTexture(String key, byte[] png);

    File resourcePackDir();

    /** Datapack folder of the open singleplayer world, or null. */
    File datapackDir();

    void enableResourcePack(String fileName);

    void disableResourcePack(String fileName);

    /** True when the pack from resourcepacks/ is currently enabled. */
    boolean isResourcePackEnabled(String fileName);

    int activeResourcePacks();

    // ------------------------------------------------------------------ 1.4
    /** Minecraft's rotating title-screen panorama, full screen. */
    void renderPanorama(Gfx g, float delta);

    void addServer(String name, String address);

    void editServer(int index, String name, String address);

    void removeServer(int index);

    void moveServer(int from, int to);

    /** Resource pack choice stored with a saved server: 0 ask, 1 enabled, 2 disabled. */
    default int serverPackPolicy(int index) { return 0; }

    default void setServerPackPolicy(int index, int policy) {}

    // ------------------------------------------------------------------ 1.5 modules
    /** The camera this frame: {x, y, z, yaw, pitch} (follows freelook and F5); null outside a world. */
    default double[] camera() { return null; }

    /** Shows or hides the vanilla chunk border lines (F3 + G). */
    default void setChunkBorders(boolean on) {}

    /** Selected hotbar slot, 0..8. */
    default int selectedSlot() { return 0; }

    /** Blocks fallen since the player last stood on the ground. */
    default float fallDistance() { return 0; }

    /** Direction of the last hit relative to where the player looks (vanilla damage tilt, degrees). */
    default float hurtDirection() { return 0; }

    /** Asks the operating system to flash the game window (taskbar) when it is not focused. */
    default void requestAttention() {}

    default boolean windowFocused() { return true; }

    /** A short note-block ping for alerts. */
    default void playPing(float pitch) { playClick(pitch); }

    /** Display name of an item stack in the game language. */
    default String itemName(ItemInfo item) { return item == null ? "" : item.id; }

    /** The original Minecraft server list screen. */
    void openVanillaMultiplayer(Object parent);

    /** Loaded mods: {id, name, version, description, authors, homepage, sources, issues}. */
    List<String[]> mods();

    /** PNG of a mod's icon or null. */
    byte[] modIcon(String id);

    /** Names in the tab list (empty outside a server). */
    List<String> tabPlayerNames();

    void setRenderHitboxes(boolean on);

    /** Cape for the local player (null = the player's own / none). */
    void setLocalCape(TextureRef cape);

    /** Developer tool: writes a 6-face panorama of the current view into dir (no-op where unsupported). */
    default void takePanorama(String dir) {}

    String gpu();

    String cpu();
}
