package dev.noreclient.platform;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.NativeImage;
import dev.noreclient.api.EffectInfo;
import dev.noreclient.api.Game;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.api.TargetInfo;
import dev.noreclient.api.TextureRef;
import dev.noreclient.gui.NoreScreen;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.SharedConstants;
import net.minecraft.util.Util;
import net.minecraft.client.CameraType;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.achievement.StatsScreen;
import net.minecraft.client.gui.screens.advancements.AdvancementsScreen;
import net.minecraft.client.gui.screens.inventory.CraftingScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractCraftingMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.BowItem;
import net.minecraft.world.item.CrossbowItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.display.RecipeDisplayEntry;
import net.minecraft.world.level.LightLayer;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.List;

/** Game facade for Minecraft 1.21 – 1.21.1 (Fabric, yarn mappings). */
public final class GameImpl implements Game {
    private static Minecraft mc() { return Minecraft.getInstance(); }

    private static Player p() { return mc().player; }

    // ------------------------------------------------------------------ general
    @Override public String minecraftVersion() { return SharedConstants.getCurrentVersion().name(); }
    @Override public String username() { return mc().getUser().getName(); }
    @Override public int fps() { return mc().getFps(); }
    @Override public boolean inWorld() { return mc().player != null && mc().level != null; }
    @Override public boolean screenOpen() { return mc().gui.screen() != null; }
    @Override public boolean chatOpen() { return mc().gui.screen() instanceof net.minecraft.client.gui.screens.ChatScreen; }
    @Override public boolean hudHidden() { return mc().gui.hud.isHidden(); }
    @Override public boolean debugScreen() { return mc().getDebugOverlay().showDebugScreen(); }
    @Override public int scaledWidth() { return mc().getWindow().getGuiScaledWidth(); }
    @Override public int scaledHeight() { return mc().getWindow().getGuiScaledHeight(); }
    @Override public File gameDir() { return FabricLoader.getInstance().getGameDir().toFile(); }
    @Override public long windowHandle() { return mc().getWindow().handle(); }

    // ------------------------------------------------------------------ camera
    @Override
    public int perspective() {
        CameraType p = mc().options.getCameraType();
        return p == CameraType.FIRST_PERSON ? 0 : p == CameraType.THIRD_PERSON_BACK ? 1 : 2;
    }

    @Override
    public void setPerspective(int p) {
        mc().options.setCameraType(p == 0 ? CameraType.FIRST_PERSON : p == 1 ? CameraType.THIRD_PERSON_BACK : CameraType.THIRD_PERSON_FRONT);
    }

    @Override public boolean smoothCamera() { return mc().options.smoothCamera; }
    @Override public void setSmoothCamera(boolean on) { mc().options.smoothCamera = on; }

    private static final net.minecraft.world.entity.EquipmentSlot[] ARMOR = {
            net.minecraft.world.entity.EquipmentSlot.FEET, net.minecraft.world.entity.EquipmentSlot.LEGS,
            net.minecraft.world.entity.EquipmentSlot.CHEST, net.minecraft.world.entity.EquipmentSlot.HEAD};

    // ------------------------------------------------------------------ player
    @Override public double x() { return p() == null ? 0 : p().getX(); }
    @Override public double y() { return p() == null ? 0 : p().getY(); }
    @Override public double z() { return p() == null ? 0 : p().getZ(); }
    @Override public double prevX() { return p() == null ? 0 : p().xo; }
    @Override public double prevY() { return p() == null ? 0 : p().yo; }
    @Override public double prevZ() { return p() == null ? 0 : p().zo; }
    @Override public float yaw(float d) { return p() == null ? 0 : p().getViewYRot(d); }
    @Override public float pitch() { return p() == null ? 0 : p().getXRot(); }

    @Override
    public void setRotation(float yaw, float pitch) {
        if (p() == null) return;
        p().setYRot(yaw);
        p().setXRot(pitch);
    }

    @Override public double velocityX() { return p() == null ? 0 : p().getDeltaMovement().x; }
    @Override public double velocityY() { return p() == null ? 0 : p().getDeltaMovement().y; }
    @Override public double velocityZ() { return p() == null ? 0 : p().getDeltaMovement().z; }
    @Override public float health() { return p() == null ? 20 : p().getHealth(); }
    @Override public float maxHealth() { return p() == null ? 20 : p().getMaxHealth(); }
    @Override public float absorption() { return p() == null ? 0 : p().getAbsorptionAmount(); }
    @Override public int armorValue() { return p() == null ? 0 : p().getArmorValue(); }
    @Override public int food() { return p() == null ? 20 : p().getFoodData().getFoodLevel(); }
    @Override public float saturation() { return p() == null ? 5 : p().getFoodData().getSaturationLevel(); }
    @Override public int xpLevel() { return p() == null ? 0 : p().experienceLevel; }
    @Override public float xpProgress() { return p() == null ? 0 : p().experienceProgress; }
    @Override public int hurtTime() { return p() == null ? 0 : p().hurtTime; }
    @Override public boolean dead() { return p() != null && p().isDeadOrDying(); }
    @Override public boolean sneaking() { return p() != null && p().isShiftKeyDown(); }
    @Override public boolean sprinting() { return p() != null && p().isSprinting(); }
    @Override public boolean swimming() { return p() != null && p().isSwimming(); }
    @Override public boolean flying() { return p() != null && p().getAbilities().flying; }
    @Override public boolean fallFlying() { return p() != null && p().isFallFlying(); }
    @Override public boolean horizontalCollision() { return p() != null && p().horizontalCollision; }
    @Override public float attackCooldown() { return p() == null ? 1 : p().getAttackStrengthScale(0); }

    @Override
    public float bowCharge() {
        if (p() == null || !p().isUsingItem()) return -1;
        if (p().getUseItem().getItem() instanceof BowItem) return BowItem.getPowerForTime(p().getTicksUsingItem());
        if (p().getUseItem().getItem() instanceof CrossbowItem) return Math.min(1, p().getTicksUsingItem() / 25f);
        return -1;
    }

    @Override public String facing() { return p() == null ? "north" : p().getDirection().getSerializedName(); }

    // ------------------------------------------------------------------ world
    @Override
    public String biome() {
        if (!inWorld()) return "plains";
        return mc().level.getBiome(p().blockPosition()).unwrapKey().map(k -> k.identifier().getPath()).orElse("unknown");
    }

    @Override public String dimension() { return mc().level == null ? "overworld" : mc().level.dimension().identifier().getPath(); }
    @Override public long timeOfDay() { return mc().level == null ? 6000 : mc().level.getDefaultClockTime(); }
    @Override public boolean raining() { return mc().level != null && mc().level.isRaining(); }
    @Override public boolean thundering() { return mc().level != null && mc().level.isThundering(); }

    @Override
    public int lightLevel(int mode) {
        if (!inWorld()) return 15;
        BlockPos pos = p().blockPosition();
        if (mode == 1) return mc().level.getBrightness(LightLayer.BLOCK, pos);
        if (mode == 2) return mc().level.getBrightness(LightLayer.SKY, pos);
        return mc().level.getMaxLocalRawBrightness(pos);
    }

    @Override public int entityCount() { return mc().level == null ? 0 : mc().level.getEntityCount(); }
    @Override public int worldPlayerCount() { return mc().level == null ? 0 : mc().level.players().size(); }

    // ------------------------------------------------------------------ server
    @Override public boolean singleplayer() { return mc().isLocalServer(); }

    @Override
    public String serverAddress() {
        ServerData s = mc().getCurrentServer();
        return s == null ? null : s.ip;
    }

    @Override public String serverBrand() { return mc().getConnection() == null ? null : mc().getConnection().serverBrand(); }

    @Override
    public int ping() {
        if (mc().getConnection() == null || p() == null) return 0;
        PlayerInfo e = mc().getConnection().getPlayerInfo(p().getUUID());
        return e == null ? 0 : e.getLatency();
    }

    @Override public int tabPlayerCount() { return mc().getConnection() == null ? 1 : mc().getConnection().getOnlinePlayers().size(); }

    // ------------------------------------------------------------------ crosshair
    @Override
    public String lookBlock(boolean asId) {
        if (mc().level == null || !(mc().hitResult instanceof BlockHitResult) || mc().hitResult.getType() != HitResult.Type.BLOCK) return null;
        BlockState st = mc().level.getBlockState(((BlockHitResult) mc().hitResult).getBlockPos());
        return asId ? BuiltInRegistries.BLOCK.getKey(st.getBlock()).getPath() : st.getBlock().getName().getString();
    }

    @Override
    public TargetInfo lookEntity() {
        if (mc().hitResult instanceof EntityHitResult) return describe(((EntityHitResult) mc().hitResult).getEntity());
        return null;
    }

    @Override
    public double lookDistance() {
        HitResult h = mc().hitResult;
        if (p() == null || h == null || h.getType() == HitResult.Type.MISS) return -1;
        if (h instanceof EntityHitResult) return p().getEyePosition().distanceTo(((EntityHitResult) h).getEntity().position());
        return p().getEyePosition().distanceTo(h.getLocation());
    }

    @Override
    public TargetInfo describe(Object handle) {
        if (!(handle instanceof LivingEntity)) return null;
        LivingEntity e = (LivingEntity) handle;
        if (e.isRemoved()) return null;
        double d = p() == null ? 0 : p().distanceTo(e);
        return new TargetInfo(e, e.getName().getString(), e.getHealth(), e.getMaxHealth(), e.getArmorValue(), d, e instanceof Player);
    }

    // ------------------------------------------------------------------ inventory
    private static ItemInfo info(ItemStack s) {
        if (s == null || s.isEmpty()) return null;
        return new ItemInfo(s, BuiltInRegistries.ITEM.getKey(s.getItem()).toString(), s.getCount(),
                s.isDamageableItem() ? s.getDamageValue() : 0, s.isDamageableItem() ? s.getMaxDamage() : 0);
    }

    @Override
    public List<ItemInfo> inventory() {
        List<ItemInfo> out = new ArrayList<>();
        if (p() == null) return out;
        var main = p().getInventory().getNonEquipmentItems();
        for (int i = 9; i < 36; i++) out.add(info(main.get(i)));
        for (int i = 0; i < 9; i++) out.add(info(main.get(i)));
        return out;
    }

    private final Map<String, ItemInfo> icons = new HashMap<>();

    @Override
    public ItemInfo itemIcon(String id) {
        return icons.computeIfAbsent(id, k -> {
            Identifier ident = Identifier.tryParse(k);
            if (ident == null || !BuiltInRegistries.ITEM.containsKey(ident)) return null;
            return info(new ItemStack(BuiltInRegistries.ITEM.getValue(ident)));
        });
    }

    // ------------------------------------------------------------------ crafting
    // Since 1.21.2 the client only knows the recipes of its recipe book (sent by the server,
    // without their ids), so recipes are found by their result item and placed with the book.
    private AbstractCraftingMenu recipeHandler() {
        if (p() == null || !(mc().gui.screen() instanceof InventoryScreen || mc().gui.screen() instanceof CraftingScreen)) return null;
        return p().containerMenu instanceof AbstractCraftingMenu h ? h : null;
    }

    /** Recipe book entries that make the item of a recipe id ("oak_planks", "stick_from_bamboo_item"). */
    private List<RecipeDisplayEntry> recipes(String id, AbstractCraftingMenu h) {
        List<RecipeDisplayEntry> out = new ArrayList<>();
        if (mc().level == null) return out;
        String path = id.contains(":") ? id.substring(id.indexOf(':') + 1) : id;
        String from = null;
        int cut = path.indexOf("_from_");
        if (cut > 0) { from = path.substring(cut + 6).replace("_item", ""); path = path.substring(0, cut); }
        Identifier want = Identifier.withDefaultNamespace(path);
        net.minecraft.util.context.ContextMap params = net.minecraft.world.item.crafting.display.SlotDisplayContext.fromLevel(mc().level);
        for (net.minecraft.client.gui.screens.recipebook.RecipeCollection col : mc().player.getRecipeBook().getCollections()) {
            for (RecipeDisplayEntry e : col.getRecipes()) {
                if (e.craftingRequirements().isEmpty() || !fits(e.display(), h)) continue;
                List<ItemStack> res = e.resultItems(params);
                if (res.isEmpty() || !BuiltInRegistries.ITEM.getKey(res.get(0).getItem()).equals(want)) continue;
                if (from != null && !uses(e, from)) continue;
                out.add(e);
            }
        }
        return out;
    }

    private static boolean fits(net.minecraft.world.item.crafting.display.RecipeDisplay d, AbstractCraftingMenu h) {
        if (d instanceof net.minecraft.world.item.crafting.display.ShapedCraftingRecipeDisplay s) return s.width() <= h.getGridWidth() && s.height() <= h.getGridHeight();
        if (d instanceof net.minecraft.world.item.crafting.display.ShapelessCraftingRecipeDisplay s) return s.ingredients().size() <= h.getGridWidth() * h.getGridHeight();
        return false;
    }

    private static boolean uses(RecipeDisplayEntry e, String item) {
        Item it = BuiltInRegistries.ITEM.getValue(Identifier.withDefaultNamespace(item));
        for (Ingredient ing : e.craftingRequirements().get()) if (ing.test(new ItemStack(it))) return true;
        return false;
    }

    private int crafts(RecipeDisplayEntry e, AbstractCraftingMenu h) {
        net.minecraft.world.entity.player.StackedContents<Holder<Item>> m = new net.minecraft.world.entity.player.StackedContents<>();
        for (ItemStack st : p().getInventory().getNonEquipmentItems()) if (!st.isEmpty()) m.account(st.typeHolder(), st.getCount());
        for (Slot sl : h.getInputGridSlots()) if (sl.hasItem()) m.account(sl.getItem().typeHolder(), sl.getItem().getCount());
        return m.tryPickAll(e.craftingRequirements().get(), 64, null);
    }

    private RecipeDisplayEntry best(String id, AbstractCraftingMenu h) {
        RecipeDisplayEntry best = null;
        int most = 0;
        for (RecipeDisplayEntry e : recipes(id, h)) {
            int c = crafts(e, h);
            if (c > most) { most = c; best = e; }
        }
        return best;
    }

    @Override
    public int craftingGrid() {
        AbstractCraftingMenu h = recipeHandler();
        return h == null ? 0 : h.getGridWidth();
    }

    @Override
    public int craftableCount(String recipeId) {
        AbstractCraftingMenu h = recipeHandler();
        if (h == null) return 0;
        RecipeDisplayEntry e = best(recipeId, h);
        return e == null ? 0 : crafts(e, h);
    }

    @Override
    public boolean fillRecipe(String recipeId, boolean all) {
        AbstractCraftingMenu h = recipeHandler();
        if (h == null || !h.getCarried().isEmpty()) return false;
        RecipeDisplayEntry e = best(recipeId, h);
        if (e == null) return false;
        mc().gameMode.handlePlaceRecipe(h.containerId, e.id(), all);
        return true;
    }

    private void click(AbstractCraftingMenu h, int slot, int button, ContainerInput type) {
        mc().gameMode.handleContainerInput(h.containerId, slot, button, type, p());
    }

    @Override
    public boolean craftResultReady() {
        AbstractCraftingMenu h = recipeHandler();
        return h != null && h.getResultSlot().hasItem();
    }

    @Override
    public void takeCraftResult() {
        AbstractCraftingMenu h = recipeHandler();
        if (h != null) click(h, h.getResultSlot().index, 0, ContainerInput.QUICK_MOVE);
    }

    @Override
    public int countItem(String id) {
        if (p() == null) return 0;
        int n = 0;
        var inv = p().getInventory();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack s = inv.getItem(i);
            if (!s.isEmpty() && BuiltInRegistries.ITEM.getKey(s.getItem()).toString().equals(id)) n += s.getCount();
        }
        return n;
    }

    @Override
    public List<ItemInfo> armor() {
        List<ItemInfo> out = new ArrayList<>();
        if (p() == null) return out;
        for (int i = 3; i >= 0; i--) {
            ItemInfo it = info(p().getItemBySlot(ARMOR[i]));
            if (it != null) out.add(it);
        }
        return out;
    }

    @Override public ItemInfo mainHand() { return p() == null ? null : info(p().getMainHandItem()); }
    @Override public ItemInfo chestItem() { return p() == null ? null : info(p().getItemBySlot(EquipmentSlot.CHEST)); }

    private static EffectInfo effect(MobEffectInstance e) {
        return new EffectInfo(e, e.getEffect().value().getDisplayName().getString(), e.getAmplifier(), e.getDuration(), e.isInfiniteDuration(), e.getEffect().value().getColor());
    }

    @Override
    public List<EffectInfo> effects() {
        List<EffectInfo> out = new ArrayList<>();
        if (p() != null) for (MobEffectInstance e : p().getActiveEffects()) out.add(effect(e));
        return out;
    }

    @Override
    public List<EffectInfo> previewEffects() {
        return Arrays.asList(effect(new MobEffectInstance(MobEffects.SPEED, 20 * 95, 1)), effect(new MobEffectInstance(MobEffects.FIRE_RESISTANCE, 20 * 300, 0)));
    }

    @Override
    public List<ItemInfo> previewArmor() {
        return Arrays.asList(info(new ItemStack(Items.DIAMOND_HELMET)), info(new ItemStack(Items.DIAMOND_CHESTPLATE)),
                info(new ItemStack(Items.DIAMOND_LEGGINGS)), info(new ItemStack(Items.DIAMOND_BOOTS)));
    }

    // ------------------------------------------------------------------ input
    private KeyMapping binding(String key) {
        var o = mc().options;
        switch (key) {
            case "forward": return o.keyUp;
            case "back": return o.keyDown;
            case "left": return o.keyLeft;
            case "right": return o.keyRight;
            case "jump": return o.keyJump;
            case "sneak": return o.keyShift;
            case "sprint": return o.keySprint;
            case "attack": return o.keyAttack;
            default: return o.keyUse;
        }
    }

    @Override public boolean keyDown(String key) { return binding(key).isDown(); }
    @Override public String keyLabel(String key) { return binding(key).getTranslatedKeyMessage().getString(); }
    @Override public String keyName(int glfw) { return InputConstants.Type.KEYBOARD.getOrCreate(KeyCodes.toSdl(glfw)).getDisplayName().getString(); }
    @Override public void setSprintHeld(boolean held) { mc().options.keySprint.setDown(held); }
    @Override public boolean shiftDown() { return mc().hasShiftDown(); }
    @Override public boolean controlDown() { return mc().hasControlDown(); }
    @Override public String clipboard() { return mc().keyboardHandler.getClipboard(); }

    @Override public void setClipboard(String text) { mc().keyboardHandler.setClipboard(text); }

    // ------------------------------------------------------------------ actions
    public static Screen toScreen(Object parent) {
        if (parent instanceof NoreScreen) return new ScreenAdapter((NoreScreen) parent);
        if (parent instanceof Screen) return (Screen) parent;
        return null;
    }

    @Override public void openScreen(NoreScreen screen) { mc().gui.setScreen(new ScreenAdapter(screen)); }

    @Override
    public void openParent(Object parent) {
        Screen s = toScreen(parent);
        if (s == null && mc().level == null) s = new TitleScreen();
        mc().gui.setScreen(s);
    }

    @Override
    public Object currentScreenHandle() {
        Screen s = mc().gui.screen();
        return s instanceof ScreenAdapter ? ((ScreenAdapter) s).screen : s;
    }

    @Override
    public void sendChat(String message) {
        if (p() == null) return;
        if (message.startsWith("/")) mc().player.connection.sendCommand(message.substring(1));
        else mc().player.connection.sendChat(message);
    }

    @Override
    public void playClick(float pitch) {
        mc().getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK.value(), pitch, 0.35f));
    }

    @Override
    public List<String[]> serverList() {
        List<String[]> out = new ArrayList<>();
        net.minecraft.client.multiplayer.ServerList list = new net.minecraft.client.multiplayer.ServerList(mc());
        list.load();
        for (int i = 0; i < list.size(); i++) out.add(new String[]{list.get(i).name, list.get(i).ip});
        return out;
    }

    @Override
    public void connect(String name, String address, Object parent) {
        // the saved entry, not a fresh one: keeps its resource pack choice (vanilla also replaces the
        // saved entry with the one used for the connection after joining)
        net.minecraft.client.multiplayer.ServerList list = servers();
        ServerData info = savedEntry(list, name, address);
        if (info == null) {
            // like vanilla "Direct Connection": a hidden entry remembers the resource pack choice
            info = new ServerData(name, address, ServerData.Type.OTHER);
            list.add(info, true);
            list.save();
        }
        net.minecraft.client.gui.screens.ConnectScreen.startConnecting(toScreen(parent), mc(),
                net.minecraft.client.multiplayer.resolver.ServerAddress.parseString(address), info, false, null);
    }

    // ------------------------------------------------------------------ 1.4


    private static net.minecraft.client.renderer.Panorama panorama;

    @Override
    public void renderPanorama(dev.noreclient.api.Gfx g, float delta) {
        net.minecraft.client.gui.GuiGraphicsExtractor ctx = ((GfxImpl) g).context();
        if (panorama == null) panorama = new net.minecraft.client.renderer.Panorama();
        panorama.extractRenderState(ctx, ctx.guiWidth(), ctx.guiHeight());
    }

    private net.minecraft.client.multiplayer.ServerList servers() {
        net.minecraft.client.multiplayer.ServerList list = new net.minecraft.client.multiplayer.ServerList(mc());
        list.load();
        return list;
    }

    /** The listed server with this name and address, else any saved entry (also hidden ones) with the address. */
    private static ServerData savedEntry(net.minecraft.client.multiplayer.ServerList list, String name, String address) {
        for (int i = 0; i < list.size(); i++) {
            ServerData s = list.get(i);
            if (s.ip.equals(address) && java.util.Objects.equals(s.name, name)) return s;
        }
        return list.get(address);
    }

    @Override
    public void addServer(String name, String address) {
        net.minecraft.client.multiplayer.ServerList list = servers();
        // a server joined before through Direct Connection is stored hidden: show that entry (keeps its settings)
        ServerData hidden = list.unhide(address);
        if (hidden != null) hidden.name = name;
        else list.add(new ServerData(name, address, ServerData.Type.OTHER), false);
        list.save();
    }

    @Override
    public void editServer(int index, String name, String address) {
        net.minecraft.client.multiplayer.ServerList list = servers();
        if (index < 0 || index >= list.size()) return;
        ServerData info = list.get(index);
        info.name = name;
        info.ip = address;
        list.save();
    }

    @Override
    public void removeServer(int index) {
        net.minecraft.client.multiplayer.ServerList list = servers();
        if (index < 0 || index >= list.size()) return;
        list.remove(list.get(index));
        list.save();
    }

    @Override
    public void moveServer(int from, int to) {
        net.minecraft.client.multiplayer.ServerList list = servers();
        if (from < 0 || to < 0 || from >= list.size() || to >= list.size() || from == to) return;
        ServerData moved = list.get(from);
        if (from < to) for (int i = from; i < to; i++) list.replace(i, list.get(i + 1));
        else for (int i = from; i > to; i--) list.replace(i, list.get(i - 1));
        list.replace(to, moved);
        list.save();
    }

    @Override
    public int serverPackPolicy(int index) {
        net.minecraft.client.multiplayer.ServerList list = servers();
        if (index < 0 || index >= list.size()) return 0;
        ServerData.ServerPackStatus p = list.get(index).getResourcePackStatus();
        return p == ServerData.ServerPackStatus.ENABLED ? 1 : p == ServerData.ServerPackStatus.DISABLED ? 2 : 0;
    }

    @Override
    public void setServerPackPolicy(int index, int policy) {
        net.minecraft.client.multiplayer.ServerList list = servers();
        if (index < 0 || index >= list.size()) return;
        list.get(index).setResourcePackStatus(policy == 1 ? ServerData.ServerPackStatus.ENABLED : policy == 2 ? ServerData.ServerPackStatus.DISABLED : ServerData.ServerPackStatus.PROMPT);
        list.save();
    }

    @Override
    public double[] camera() {
        if (mc().level == null || mc().player == null) return null;
        net.minecraft.client.Camera c = mc().gameRenderer.mainCamera();
        net.minecraft.world.phys.Vec3 pos = c.position();
        return new double[]{pos.x, pos.y, pos.z, c.yRot(), c.xRot()};
    }

    @Override
    public void setChunkBorders(boolean on) {
        net.minecraft.resources.Identifier id = net.minecraft.client.gui.components.debug.DebugScreenEntries.CHUNK_BORDERS;
        if (mc().debugEntries.isCurrentlyEnabled(id) != on) mc().debugEntries.toggleStatus(id);
    }

    @Override public int selectedSlot() { return p() == null ? 0 : p().getInventory().getSelectedSlot(); }
    @Override public float fallDistance() { return p() == null ? 0 : (float) p().fallDistance; }
    @Override public boolean invulnerable() { return p() != null && p().getAbilities().invulnerable; }
    @Override public float hurtDirection() { return p() == null ? 0 : p().getHurtDir(); }
    @Override public void requestAttention() { org.lwjgl.glfw.GLFW.glfwRequestWindowAttention(windowHandle()); }
    @Override public boolean windowFocused() { return mc().isWindowActive(); }

    @Override
    public void playPing(float pitch) {
        mc().getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.NOTE_BLOCK_PLING.value(), pitch, 0.6f));
    }

    @Override
    public String itemName(ItemInfo item) {
        if (item == null || !(item.handle instanceof net.minecraft.world.item.ItemStack)) return item == null ? "" : item.id;
        return ((net.minecraft.world.item.ItemStack) item.handle).getHoverName().getString();
    }

    @Override
    public void openVanillaMultiplayer(Object parent) {
        dev.noreclient.platform.ScreenRouting.allowVanilla = true;
        mc().gui.setScreen(new JoinMultiplayerScreen(toScreen(parent) != null ? toScreen(parent) : new TitleScreen()));
    }

    @Override
    public List<String[]> mods() {
        List<String[]> out = new ArrayList<>();
        for (net.fabricmc.loader.api.ModContainer c : FabricLoader.getInstance().getAllMods()) {
            net.fabricmc.loader.api.metadata.ModMetadata m = c.getMetadata();
            if (m.getType().equals("builtin") && !m.getId().equals("minecraft") && !m.getId().equals("java")) continue;
            if (c.getContainingMod().isPresent()) continue; // bundled library inside another mod
            StringBuilder authors = new StringBuilder();
            for (net.fabricmc.loader.api.metadata.Person p : m.getAuthors()) authors.append(authors.length() > 0 ? ", " : "").append(p.getName());
            out.add(new String[]{m.getId(), m.getName(), m.getVersion().getFriendlyString(), m.getDescription(), authors.toString(),
                    m.getContact().get("homepage").orElse(""), m.getContact().get("sources").orElse(""), m.getContact().get("issues").orElse("")});
        }
        out.sort((a, b) -> a[1].compareToIgnoreCase(b[1]));
        return out;
    }

    @Override
    public byte[] modIcon(String id) {
        try {
            net.fabricmc.loader.api.ModContainer c = FabricLoader.getInstance().getModContainer(id).orElse(null);
            if (c == null) return null;
            String icon = c.getMetadata().getIconPath(64).orElse(null);
            if (icon == null) return null;
            java.util.Optional<java.nio.file.Path> path = c.findPath(icon);
            return path.isPresent() ? java.nio.file.Files.readAllBytes(path.get()) : null;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public List<String> tabPlayerNames() {
        List<String> out = new ArrayList<>();
        if (mc().getConnection() == null) return out;
        for (PlayerInfo e : mc().getConnection().getOnlinePlayers()) out.add(e.getProfile().name());
        return out;
    }

    @Override
    public void openChat(String text) {
        if (p() != null) mc().gui.setScreen(new net.minecraft.client.gui.screens.ChatScreen(text, false));
    }

    @Override
    public void setRenderHitboxes(boolean on) {
        Identifier id = net.minecraft.client.gui.components.debug.DebugScreenEntries.ENTITY_HITBOXES;
        if (mc().debugEntries.isCurrentlyEnabled(id) != on) mc().debugEntries.toggleStatus(id);
    }

    public static Identifier localCape;

    @Override public void setLocalCape(TextureRef cape) { localCape = cape == null ? null : (Identifier) cape.handle; }

    @Override public void openSingleplayer(Object parent) { mc().gui.setScreen(new SelectWorldScreen(toScreen(parent))); }
    @Override public void openMultiplayer(Object parent) { openScreen(new dev.noreclient.gui.menu.MultiplayerScreen2(parent)); }
    @Override public void openOptions(Object parent) { mc().gui.setScreen(new OptionsScreen(toScreen(parent), mc().options)); }

    @Override
    public void openAdvancements(Object parent) {
        if (p() != null) mc().gui.setScreen(new AdvancementsScreen(mc().player.connection.getAdvancements(), toScreen(parent)));
    }

    @Override public void openStats(Object parent) { if (p() != null) mc().gui.setScreen(new StatsScreen(toScreen(parent), mc().player.getStats())); }
    @Override public void openLan(Object parent) { mc().gui.setScreen(mc().level == null ? toScreen(parent) : new net.minecraft.client.gui.screens.WorldOptionsScreen(toScreen(parent), mc().level)); }
    @Override public boolean canOpenLan() { return mc().hasSingleplayerServer() && mc().getSingleplayerServer() != null && !mc().getSingleplayerServer().isPublished(); }

    @Override
    public void disconnect() {
        boolean sp = mc().isLocalServer();
        ServerData server = mc().getCurrentServer();
        if (mc().level != null) mc().level.disconnect(net.minecraft.client.multiplayer.ClientLevel.DEFAULT_QUIT_MESSAGE);
        if (sp) mc().disconnectWithSavingScreen();
        else mc().disconnectWithProgressScreen();
        TitleScreen title = new TitleScreen();
        if (sp || server == null) mc().gui.setScreen(title);
        else mc().gui.setScreen(new JoinMultiplayerScreen(title));
    }

    @Override
    public void respawn() {
        if (p() != null && p().isDeadOrDying()) mc().player.respawn();
    }

    @Override
    public void localChat(String message) {
        mc().gui.hud.getChat().addClientSystemMessage(Component.literal(message));
    }

    @Override public void quit() { mc().stop(); }
    @Override public void openUrl(String url) { com.mojang.blaze3d.Blaze3D.openUri(java.net.URI.create(url)); }

    // ------------------------------------------------------------------ resources
    @Override
    public TextureRef loadTexture(String key, byte[] png) {
        try {
            NativeImage img = NativeImage.read(new ByteArrayInputStream(png));
            Identifier id = Identifier.fromNamespaceAndPath("noreclient", key.toLowerCase().replaceAll("[^a-z0-9/._-]", "_"));
            // 1.21.11+: filtering is a sampler; GUI images are drawn smooth, capes stay pixel-sharp
            boolean smooth = !key.startsWith("cape/");
            mc().getTextureManager().register(id, new DynamicTexture(() -> key, img) {
                {
                    if (smooth) sampler = com.mojang.blaze3d.systems.RenderSystem.getSamplerCache().getSampler(
                            com.mojang.renderpearl.api.textures.AddressMode.CLAMP_TO_EDGE, com.mojang.renderpearl.api.textures.AddressMode.CLAMP_TO_EDGE,
                            com.mojang.renderpearl.api.textures.FilterMode.LINEAR, com.mojang.renderpearl.api.textures.FilterMode.LINEAR, false);
                }
            });
            return new TextureRef(id, img.getWidth(), img.getHeight());
        } catch (Exception e) {
            return null;
        }
    }

    @Override public File resourcePackDir() { return mc().getResourcePackDirectory().toFile(); }
    @Override public File datapackDir() { return mc().getSingleplayerServer() == null ? null : mc().getSingleplayerServer().getWorldPath(LevelResource.DATAPACK_DIR).toFile(); }

    @Override
    public void enableResourcePack(String fileName) {
        var manager = mc().getResourcePackRepository();
        manager.reload();
        if (manager.addPack("file/" + fileName)) mc().options.updateResourcePacks(manager);
    }

    @Override
    public void disableResourcePack(String fileName) {
        var manager = mc().getResourcePackRepository();
        if (manager.removePack("file/" + fileName)) mc().options.updateResourcePacks(manager);
    }

    @Override
    public boolean isResourcePackEnabled(String fileName) {
        return mc().getResourcePackRepository().getSelectedIds().contains("file/" + fileName);
    }

    @Override public int activeResourcePacks() { return (int) mc().getResourcePackRepository().getSelectedIds().stream().filter(id -> id.startsWith("file/")).count(); }
    @Override public String gpu() { return com.mojang.blaze3d.systems.RenderSystem.getDevice().getDeviceInfo().name(); }
    @Override public String cpu() { return net.minecraft.client.gui.components.debug.DebugEntrySystemSpecs.getCpuInfo(); }

    /** Helper for mixins: distance from the eye to the closest point of an entity's hitbox. */
    public static double reach(Player player, Entity target) {
        var eye = player.getEyePosition();
        var box = target.getBoundingBox();
        double cx = Math.max(box.minX, Math.min(eye.x, box.maxX));
        double cy = Math.max(box.minY, Math.min(eye.y, box.maxY));
        double cz = Math.max(box.minZ, Math.min(eye.z, box.maxZ));
        return Math.sqrt((eye.x - cx) * (eye.x - cx) + (eye.y - cy) * (eye.y - cy) + (eye.z - cz) * (eye.z - cz));
    }
}
