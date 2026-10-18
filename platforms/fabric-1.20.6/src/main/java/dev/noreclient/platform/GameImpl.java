package dev.noreclient.platform;

import com.mojang.blaze3d.platform.GlDebugInfo;
import dev.noreclient.api.EffectInfo;
import dev.noreclient.api.Game;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.api.TargetInfo;
import dev.noreclient.api.TextureRef;
import dev.noreclient.gui.NoreScreen;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.SharedConstants;
import net.minecraft.block.BlockState;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.screen.MessageScreen;
import net.minecraft.client.gui.screen.OpenToLanScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.StatsScreen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.screen.advancement.AdvancementsScreen;
import net.minecraft.client.gui.screen.multiplayer.MultiplayerScreen;
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.gui.screen.world.SelectWorldScreen;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.option.Perspective;
import net.minecraft.client.sound.PositionedSoundInstance;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.client.util.InputUtil;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.BowItem;
import net.minecraft.item.CrossbowItem;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
import net.minecraft.util.Util;
import net.minecraft.util.WorldSavePath;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.hit.EntityHitResult;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.LightType;

import net.minecraft.client.gui.screen.ingame.CraftingScreen;
import net.minecraft.client.gui.screen.ingame.InventoryScreen;
import net.minecraft.recipe.Ingredient;
import net.minecraft.recipe.RecipeEntry;
import net.minecraft.recipe.RecipeMatcher;
import net.minecraft.recipe.ShapedRecipe;
import net.minecraft.screen.AbstractRecipeScreenHandler;
import net.minecraft.screen.slot.Slot;
import net.minecraft.screen.slot.SlotActionType;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.List;

/** Game facade for Minecraft 1.20.5 – 1.20.6 (Fabric, yarn mappings). */
public final class GameImpl implements Game {
    private static MinecraftClient mc() { return MinecraftClient.getInstance(); }

    private static PlayerEntity p() { return mc().player; }

    // ------------------------------------------------------------------ general
    @Override public String minecraftVersion() { return SharedConstants.getGameVersion().getName(); }
    @Override public String username() { return mc().getSession().getUsername(); }
    @Override public int fps() { return mc().getCurrentFps(); }
    @Override public boolean inWorld() { return mc().player != null && mc().world != null; }
    @Override public boolean screenOpen() { return mc().currentScreen != null; }
    @Override public boolean chatOpen() { return mc().currentScreen instanceof net.minecraft.client.gui.screen.ChatScreen; }
    @Override public boolean hudHidden() { return mc().options.hudHidden; }
    @Override public boolean debugScreen() { return mc().getDebugHud().shouldShowDebugHud(); }
    @Override public int scaledWidth() { return mc().getWindow().getScaledWidth(); }
    @Override public int scaledHeight() { return mc().getWindow().getScaledHeight(); }
    @Override public File gameDir() { return FabricLoader.getInstance().getGameDir().toFile(); }
    @Override public long windowHandle() { return mc().getWindow().getHandle(); }

    // ------------------------------------------------------------------ camera
    @Override
    public int perspective() {
        Perspective p = mc().options.getPerspective();
        return p == Perspective.FIRST_PERSON ? 0 : p == Perspective.THIRD_PERSON_BACK ? 1 : 2;
    }

    @Override
    public void setPerspective(int p) {
        mc().options.setPerspective(p == 0 ? Perspective.FIRST_PERSON : p == 1 ? Perspective.THIRD_PERSON_BACK : Perspective.THIRD_PERSON_FRONT);
    }

    @Override public boolean smoothCamera() { return mc().options.smoothCameraEnabled; }
    @Override public void setSmoothCamera(boolean on) { mc().options.smoothCameraEnabled = on; }

    // ------------------------------------------------------------------ player
    @Override public double x() { return p() == null ? 0 : p().getX(); }
    @Override public double y() { return p() == null ? 0 : p().getY(); }
    @Override public double z() { return p() == null ? 0 : p().getZ(); }
    @Override public double prevX() { return p() == null ? 0 : p().prevX; }
    @Override public double prevY() { return p() == null ? 0 : p().prevY; }
    @Override public double prevZ() { return p() == null ? 0 : p().prevZ; }
    @Override public float yaw(float d) { return p() == null ? 0 : p().getYaw(d); }
    @Override public float pitch() { return p() == null ? 0 : p().getPitch(); }

    @Override
    public void setRotation(float yaw, float pitch) {
        if (p() == null) return;
        p().setYaw(yaw);
        p().setPitch(pitch);
    }

    @Override public double velocityX() { return p() == null ? 0 : p().getVelocity().x; }
    @Override public double velocityY() { return p() == null ? 0 : p().getVelocity().y; }
    @Override public double velocityZ() { return p() == null ? 0 : p().getVelocity().z; }
    @Override public float health() { return p() == null ? 20 : p().getHealth(); }
    @Override public float maxHealth() { return p() == null ? 20 : p().getMaxHealth(); }
    @Override public float absorption() { return p() == null ? 0 : p().getAbsorptionAmount(); }
    @Override public int armorValue() { return p() == null ? 0 : p().getArmor(); }
    @Override public int food() { return p() == null ? 20 : p().getHungerManager().getFoodLevel(); }
    @Override public float saturation() { return p() == null ? 5 : p().getHungerManager().getSaturationLevel(); }
    @Override public int xpLevel() { return p() == null ? 0 : p().experienceLevel; }
    @Override public float xpProgress() { return p() == null ? 0 : p().experienceProgress; }
    @Override public int hurtTime() { return p() == null ? 0 : p().hurtTime; }
    @Override public boolean dead() { return p() != null && p().isDead(); }
    @Override public boolean sneaking() { return p() != null && p().isSneaking(); }
    @Override public boolean sprinting() { return p() != null && p().isSprinting(); }
    @Override public boolean swimming() { return p() != null && p().isSwimming(); }
    @Override public boolean flying() { return p() != null && p().getAbilities().flying; }
    @Override public boolean fallFlying() { return p() != null && p().isFallFlying(); }
    @Override public boolean horizontalCollision() { return p() != null && p().horizontalCollision; }
    @Override public float attackCooldown() { return p() == null ? 1 : p().getAttackCooldownProgress(0); }

    @Override
    public float bowCharge() {
        if (p() == null || !p().isUsingItem()) return -1;
        if (p().getActiveItem().getItem() instanceof BowItem) return BowItem.getPullProgress(p().getItemUseTime());
        if (p().getActiveItem().getItem() instanceof CrossbowItem) return Math.min(1, p().getItemUseTime() / 25f);
        return -1;
    }

    @Override public String facing() { return p() == null ? "north" : p().getHorizontalFacing().asString(); }

    // ------------------------------------------------------------------ world
    @Override
    public String biome() {
        if (!inWorld()) return "plains";
        return mc().world.getBiome(p().getBlockPos()).getKey().map(k -> k.getValue().getPath()).orElse("unknown");
    }

    @Override public String dimension() { return mc().world == null ? "overworld" : mc().world.getRegistryKey().getValue().getPath(); }
    @Override public long timeOfDay() { return mc().world == null ? 6000 : mc().world.getTimeOfDay(); }
    @Override public boolean raining() { return mc().world != null && mc().world.isRaining(); }
    @Override public boolean thundering() { return mc().world != null && mc().world.isThundering(); }

    @Override
    public int lightLevel(int mode) {
        if (!inWorld()) return 15;
        BlockPos pos = p().getBlockPos();
        if (mode == 1) return mc().world.getLightLevel(LightType.BLOCK, pos);
        if (mode == 2) return mc().world.getLightLevel(LightType.SKY, pos);
        return mc().world.getLightLevel(pos);
    }

    @Override public int entityCount() { return mc().world == null ? 0 : mc().world.getRegularEntityCount(); }
    @Override public int worldPlayerCount() { return mc().world == null ? 0 : mc().world.getPlayers().size(); }

    // ------------------------------------------------------------------ server
    @Override public boolean singleplayer() { return mc().isInSingleplayer(); }

    @Override
    public String serverAddress() {
        ServerInfo s = mc().getCurrentServerEntry();
        return s == null ? null : s.address;
    }

    @Override public String serverBrand() { return mc().getNetworkHandler() == null ? null : mc().getNetworkHandler().getBrand(); }

    @Override
    public int ping() {
        if (mc().getNetworkHandler() == null || p() == null) return 0;
        PlayerListEntry e = mc().getNetworkHandler().getPlayerListEntry(p().getUuid());
        return e == null ? 0 : e.getLatency();
    }

    @Override public int tabPlayerCount() { return mc().getNetworkHandler() == null ? 1 : mc().getNetworkHandler().getPlayerList().size(); }

    // ------------------------------------------------------------------ crosshair
    @Override
    public String lookBlock(boolean asId) {
        if (mc().world == null || !(mc().crosshairTarget instanceof BlockHitResult) || mc().crosshairTarget.getType() != HitResult.Type.BLOCK) return null;
        BlockState st = mc().world.getBlockState(((BlockHitResult) mc().crosshairTarget).getBlockPos());
        return asId ? Registries.BLOCK.getId(st.getBlock()).getPath() : st.getBlock().getName().getString();
    }

    @Override
    public TargetInfo lookEntity() {
        if (mc().crosshairTarget instanceof EntityHitResult) return describe(((EntityHitResult) mc().crosshairTarget).getEntity());
        return null;
    }

    @Override
    public double lookDistance() {
        HitResult h = mc().crosshairTarget;
        if (p() == null || h == null || h.getType() == HitResult.Type.MISS) return -1;
        if (h instanceof EntityHitResult) return p().getEyePos().distanceTo(((EntityHitResult) h).getEntity().getPos());
        return p().getEyePos().distanceTo(h.getPos());
    }

    @Override
    public TargetInfo describe(Object handle) {
        if (!(handle instanceof LivingEntity)) return null;
        LivingEntity e = (LivingEntity) handle;
        if (e.isRemoved()) return null;
        double d = p() == null ? 0 : p().distanceTo(e);
        return new TargetInfo(e, e.getName().getString(), e.getHealth(), e.getMaxHealth(), e.getArmor(), d, e instanceof PlayerEntity);
    }

    // ------------------------------------------------------------------ inventory
    private static ItemInfo info(ItemStack s) {
        if (s == null || s.isEmpty()) return null;
        return new ItemInfo(s, Registries.ITEM.getId(s.getItem()).toString(), s.getCount(),
                s.isDamageable() ? s.getDamage() : 0, s.isDamageable() ? s.getMaxDamage() : 0);
    }

    @Override
    public List<ItemInfo> inventory() {
        List<ItemInfo> out = new ArrayList<>();
        if (p() == null) return out;
        var main = p().getInventory().main;
        for (int i = 9; i < 36; i++) out.add(info(main.get(i)));
        for (int i = 0; i < 9; i++) out.add(info(main.get(i)));
        return out;
    }

    private final Map<String, ItemInfo> icons = new HashMap<>();

    @Override
    public ItemInfo itemIcon(String id) {
        return icons.computeIfAbsent(id, k -> {
            Identifier ident = Identifier.tryParse(k);
            if (ident == null || !Registries.ITEM.containsId(ident)) return null;
            return info(new ItemStack(Registries.ITEM.get(ident)));
        });
    }

    // ------------------------------------------------------------------ crafting
    private AbstractRecipeScreenHandler<?> recipeHandler() {
        if (p() == null || !(mc().currentScreen instanceof InventoryScreen || mc().currentScreen instanceof CraftingScreen)) return null;
        return p().currentScreenHandler instanceof AbstractRecipeScreenHandler<?> h ? h : null;
    }

    private RecipeEntry<?> recipe(String id) {
        if (mc().world == null) return null;
        Identifier ident = Identifier.tryParse(id.contains(":") ? id : "minecraft:" + id);
        return ident == null ? null : mc().world.getRecipeManager().get(ident).orElse(null);
    }

    @Override
    public int craftingGrid() {
        AbstractRecipeScreenHandler<?> h = recipeHandler();
        return h == null ? 0 : h.getCraftingWidth();
    }

    @Override
    public int craftableCount(String recipeId) {
        AbstractRecipeScreenHandler<?> h = recipeHandler();
        RecipeEntry<?> r = recipe(recipeId);
        if (h == null || r == null || !r.value().fits(h.getCraftingWidth(), h.getCraftingHeight())) return 0;
        RecipeMatcher matcher = new RecipeMatcher();
        p().getInventory().populateRecipeFinder(matcher);
        h.populateRecipeFinder(matcher);
        return matcher.countCrafts(r, null);
    }

    private void click(AbstractRecipeScreenHandler<?> h, int slot, int button, SlotActionType type) {
        mc().interactionManager.clickSlot(h.syncId, slot, button, type, p());
    }

    @Override
    public boolean fillRecipe(String recipeId, boolean all) {
        AbstractRecipeScreenHandler<?> h = recipeHandler();
        RecipeEntry<?> r = recipe(recipeId);
        if (h == null || r == null || craftableCount(recipeId) <= 0 || !h.getCursorStack().isEmpty()) return false;
        if (mc().player.getRecipeBook().contains(r)) {
            mc().interactionManager.clickRecipe(h.syncId, r, all);
            return true;
        }
        // Recipe not unlocked: place one set of ingredients by hand, like a player would.
        int gw = h.getCraftingWidth(), gh = h.getCraftingHeight();
        for (int i = 0; i < h.getCraftingSlotCount(); i++) {
            if (i != h.getCraftingResultSlotIndex() && h.getSlot(i).hasStack()) click(h, i, 0, SlotActionType.QUICK_MOVE);
        }
        List<Ingredient> ingredients = r.value().getIngredients();
        int rw = r.value() instanceof ShapedRecipe shaped ? shaped.getWidth() : gw;
        for (int k = 0; k < ingredients.size(); k++) {
            Ingredient ing = ingredients.get(k);
            if (ing.isEmpty()) continue;
            int row = k / rw, col = k % rw;
            if (row >= gh || col >= gw) return false;
            int target = 1 + row * gw + col;
            int source = -1;
            for (Slot slot : h.slots) {
                if (slot.inventory == p().getInventory() && slot.getIndex() < 36 && slot.hasStack() && ing.test(slot.getStack())) {
                    source = slot.id;
                    break;
                }
            }
            if (source < 0) return false;
            click(h, source, 0, SlotActionType.PICKUP);
            click(h, target, 1, SlotActionType.PICKUP);
            click(h, source, 0, SlotActionType.PICKUP);
        }
        return true;
    }

    @Override
    public boolean craftResultReady() {
        AbstractRecipeScreenHandler<?> h = recipeHandler();
        return h != null && h.getSlot(h.getCraftingResultSlotIndex()).hasStack();
    }

    @Override
    public void takeCraftResult() {
        AbstractRecipeScreenHandler<?> h = recipeHandler();
        if (h != null) click(h, h.getCraftingResultSlotIndex(), 0, SlotActionType.QUICK_MOVE);
    }

    @Override
    public int countItem(String id) {
        if (p() == null) return 0;
        int n = 0;
        var inv = p().getInventory();
        for (int i = 0; i < inv.size(); i++) {
            ItemStack s = inv.getStack(i);
            if (!s.isEmpty() && Registries.ITEM.getId(s.getItem()).toString().equals(id)) n += s.getCount();
        }
        return n;
    }

    @Override
    public List<ItemInfo> armor() {
        List<ItemInfo> out = new ArrayList<>();
        if (p() == null) return out;
        for (int i = 3; i >= 0; i--) {
            ItemInfo it = info(p().getInventory().getArmorStack(i));
            if (it != null) out.add(it);
        }
        return out;
    }

    @Override public ItemInfo mainHand() { return p() == null ? null : info(p().getMainHandStack()); }
    @Override public ItemInfo chestItem() { return p() == null ? null : info(p().getEquippedStack(EquipmentSlot.CHEST)); }

    private static EffectInfo effect(StatusEffectInstance e) {
        return new EffectInfo(e, e.getEffectType().value().getName().getString(), e.getAmplifier(), e.getDuration(), e.isInfinite(), e.getEffectType().value().getColor());
    }

    @Override
    public List<EffectInfo> effects() {
        List<EffectInfo> out = new ArrayList<>();
        if (p() != null) for (StatusEffectInstance e : p().getStatusEffects()) out.add(effect(e));
        return out;
    }

    @Override
    public List<EffectInfo> previewEffects() {
        return Arrays.asList(effect(new StatusEffectInstance(StatusEffects.SPEED, 20 * 95, 1)), effect(new StatusEffectInstance(StatusEffects.FIRE_RESISTANCE, 20 * 300, 0)));
    }

    @Override
    public List<ItemInfo> previewArmor() {
        return Arrays.asList(info(new ItemStack(Items.DIAMOND_HELMET)), info(new ItemStack(Items.DIAMOND_CHESTPLATE)),
                info(new ItemStack(Items.DIAMOND_LEGGINGS)), info(new ItemStack(Items.DIAMOND_BOOTS)));
    }

    // ------------------------------------------------------------------ input
    private KeyBinding binding(String key) {
        var o = mc().options;
        switch (key) {
            case "forward": return o.forwardKey;
            case "back": return o.backKey;
            case "left": return o.leftKey;
            case "right": return o.rightKey;
            case "jump": return o.jumpKey;
            case "sneak": return o.sneakKey;
            case "sprint": return o.sprintKey;
            case "attack": return o.attackKey;
            default: return o.useKey;
        }
    }

    @Override public boolean keyDown(String key) { return binding(key).isPressed(); }
    @Override public String keyLabel(String key) { return binding(key).getBoundKeyLocalizedText().getString(); }
    @Override public String keyName(int glfw) { return InputUtil.Type.KEYSYM.createFromCode(glfw).getLocalizedText().getString(); }
    @Override public void setSprintHeld(boolean held) { mc().options.sprintKey.setPressed(held); }
    @Override public boolean shiftDown() { return Screen.hasShiftDown(); }
    @Override public boolean controlDown() { return Screen.hasControlDown(); }
    @Override public String clipboard() { return mc().keyboard.getClipboard(); }

    @Override public void setClipboard(String text) { mc().keyboard.setClipboard(text); }

    // ------------------------------------------------------------------ actions
    public static Screen toScreen(Object parent) {
        if (parent instanceof NoreScreen) return new ScreenAdapter((NoreScreen) parent);
        if (parent instanceof Screen) return (Screen) parent;
        return null;
    }

    @Override public void openScreen(NoreScreen screen) { mc().setScreen(new ScreenAdapter(screen)); }

    @Override
    public void openParent(Object parent) {
        Screen s = toScreen(parent);
        if (s == null && mc().world == null) s = new TitleScreen();
        mc().setScreen(s);
    }

    @Override
    public Object currentScreenHandle() {
        Screen s = mc().currentScreen;
        return s instanceof ScreenAdapter ? ((ScreenAdapter) s).screen : s;
    }

    @Override
    public void sendChat(String message) {
        if (p() == null) return;
        if (message.startsWith("/")) mc().player.networkHandler.sendChatCommand(message.substring(1));
        else mc().player.networkHandler.sendChatMessage(message);
    }

    @Override
    public void playClick(float pitch) {
        mc().getSoundManager().play(PositionedSoundInstance.master(SoundEvents.UI_BUTTON_CLICK.value(), pitch, 0.35f));
    }

    @Override
    public List<String[]> serverList() {
        List<String[]> out = new ArrayList<>();
        net.minecraft.client.option.ServerList list = new net.minecraft.client.option.ServerList(mc());
        list.loadFile();
        for (int i = 0; i < list.size(); i++) out.add(new String[]{list.get(i).name, list.get(i).address});
        return out;
    }

    @Override
    public void connect(String name, String address, Object parent) {
        // the saved entry, not a fresh one: keeps its resource pack choice (vanilla also replaces the
        // saved entry with the one used for the connection after joining)
        net.minecraft.client.option.ServerList list = servers();
        ServerInfo info = savedEntry(list, name, address);
        if (info == null) {
            // like vanilla "Direct Connection": a hidden entry remembers the resource pack choice
            info = new ServerInfo(name, address, ServerInfo.ServerType.OTHER);
            list.add(info, true);
            list.saveFile();
        }
        net.minecraft.client.gui.screen.multiplayer.ConnectScreen.connect(toScreen(parent), mc(),
                net.minecraft.client.network.ServerAddress.parse(address), info, false, null);
    }

    // ------------------------------------------------------------------ 1.4

    private static net.minecraft.client.gui.RotatingCubeMapRenderer panorama;

    @Override
    public void takePanorama(String dir) {
        java.io.File d = new java.io.File(dir);
        d.mkdirs();
        mc().takePanorama(d, 1024, 1024);
    }

    @Override
    public void renderPanorama(dev.noreclient.api.Gfx g, float delta) {
        if (panorama == null) panorama = new net.minecraft.client.gui.RotatingCubeMapRenderer(
                new net.minecraft.client.gui.CubeMapRenderer(new Identifier("textures/gui/title/background/panorama")));
        net.minecraft.client.gui.DrawContext ctx = ((GfxImpl) g).context();
        panorama.render(ctx, ctx.getScaledWindowWidth(), ctx.getScaledWindowHeight(), 1f, delta);
    }

    private net.minecraft.client.option.ServerList servers() {
        net.minecraft.client.option.ServerList list = new net.minecraft.client.option.ServerList(mc());
        list.loadFile();
        return list;
    }

    /** The listed server with this name and address, else any saved entry (also hidden ones) with the address. */
    private static ServerInfo savedEntry(net.minecraft.client.option.ServerList list, String name, String address) {
        for (int i = 0; i < list.size(); i++) {
            ServerInfo s = list.get(i);
            if (s.address.equals(address) && java.util.Objects.equals(s.name, name)) return s;
        }
        return list.get(address);
    }

    @Override
    public void addServer(String name, String address) {
        net.minecraft.client.option.ServerList list = servers();
        // a server joined before through Direct Connection is stored hidden: show that entry (keeps its settings)
        ServerInfo hidden = list.tryUnhide(address);
        if (hidden != null) hidden.name = name;
        else list.add(new ServerInfo(name, address, ServerInfo.ServerType.OTHER), false);
        list.saveFile();
    }

    @Override
    public void editServer(int index, String name, String address) {
        net.minecraft.client.option.ServerList list = servers();
        if (index < 0 || index >= list.size()) return;
        ServerInfo info = list.get(index);
        info.name = name;
        info.address = address;
        list.saveFile();
    }

    @Override
    public void removeServer(int index) {
        net.minecraft.client.option.ServerList list = servers();
        if (index < 0 || index >= list.size()) return;
        list.remove(list.get(index));
        list.saveFile();
    }

    @Override
    public void moveServer(int from, int to) {
        net.minecraft.client.option.ServerList list = servers();
        if (from < 0 || to < 0 || from >= list.size() || to >= list.size() || from == to) return;
        ServerInfo moved = list.get(from);
        if (from < to) for (int i = from; i < to; i++) list.set(i, list.get(i + 1));
        else for (int i = from; i > to; i--) list.set(i, list.get(i - 1));
        list.set(to, moved);
        list.saveFile();
    }

    @Override
    public int serverPackPolicy(int index) {
        net.minecraft.client.option.ServerList list = servers();
        if (index < 0 || index >= list.size()) return 0;
        ServerInfo.ResourcePackPolicy p = list.get(index).getResourcePackPolicy();
        return p == ServerInfo.ResourcePackPolicy.ENABLED ? 1 : p == ServerInfo.ResourcePackPolicy.DISABLED ? 2 : 0;
    }

    @Override
    public void setServerPackPolicy(int index, int policy) {
        net.minecraft.client.option.ServerList list = servers();
        if (index < 0 || index >= list.size()) return;
        list.get(index).setResourcePackPolicy(policy == 1 ? ServerInfo.ResourcePackPolicy.ENABLED : policy == 2 ? ServerInfo.ResourcePackPolicy.DISABLED : ServerInfo.ResourcePackPolicy.PROMPT);
        list.saveFile();
    }

    @Override
    public double[] camera() {
        if (mc().world == null || mc().player == null) return null;
        net.minecraft.client.render.Camera c = mc().gameRenderer.getCamera();
        net.minecraft.util.math.Vec3d pos = c.getPos();
        return new double[]{pos.x, pos.y, pos.z, c.getYaw(), c.getPitch()};
    }

    @Override
    public void setChunkBorders(boolean on) {
        // toggle returns the new state: a second toggle fixes it if it was already on (F3 + G)
        if (mc().debugRenderer.toggleShowChunkBorder() != on) mc().debugRenderer.toggleShowChunkBorder();
    }

    @Override public int selectedSlot() { return p() == null ? 0 : p().getInventory().selectedSlot; }
    @Override public float fallDistance() { return p() == null ? 0 : (float) p().fallDistance; }
    @Override public boolean invulnerable() { return p() != null && p().getAbilities().invulnerable; }
    @Override public float hurtDirection() { return p() == null ? 0 : p().getDamageTiltYaw(); }
    @Override public void requestAttention() { org.lwjgl.glfw.GLFW.glfwRequestWindowAttention(windowHandle()); }
    @Override public boolean windowFocused() { return mc().isWindowFocused(); }

    @Override
    public void playPing(float pitch) {
        mc().getSoundManager().play(PositionedSoundInstance.master(SoundEvents.BLOCK_NOTE_BLOCK_PLING.value(), pitch, 0.6f));
    }

    @Override
    public String itemName(ItemInfo item) {
        if (item == null || !(item.handle instanceof ItemStack)) return item == null ? "" : item.id;
        return ((ItemStack) item.handle).getName().getString();
    }

    @Override
    public void openVanillaMultiplayer(Object parent) {
        dev.noreclient.platform.ScreenRouting.allowVanilla = true;
        mc().setScreen(new MultiplayerScreen(toScreen(parent) != null ? toScreen(parent) : new TitleScreen()));
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
        if (mc().getNetworkHandler() == null) return out;
        for (PlayerListEntry e : mc().getNetworkHandler().getPlayerList()) out.add(e.getProfile().getName());
        return out;
    }

    @Override
    public void openChat(String text) {
        if (p() != null) mc().setScreen(new net.minecraft.client.gui.screen.ChatScreen(text));
    }

    @Override public void setRenderHitboxes(boolean on) { mc().getEntityRenderDispatcher().setRenderHitboxes(on); }

    public static Identifier localCape;

    @Override public void setLocalCape(TextureRef cape) { localCape = cape == null ? null : (Identifier) cape.handle; }

    @Override
    public boolean drawPlayerModel(dev.noreclient.api.Gfx g, int x1, int y1, int x2, int y2, float size, float yaw, float pitch) {
        return g instanceof GfxImpl && WardrobeFeature.drawPreview(((GfxImpl) g).context(), x1, y1, x2, y2, size, yaw, pitch);
    }

    @Override public void openSingleplayer(Object parent) { mc().setScreen(new SelectWorldScreen(toScreen(parent))); }
    @Override public void openMultiplayer(Object parent) { openScreen(new dev.noreclient.gui.menu.MultiplayerScreen2(parent)); }
    @Override public void openOptions(Object parent) { mc().setScreen(new OptionsScreen(toScreen(parent), mc().options)); }

    @Override
    public void openAdvancements(Object parent) {
        if (p() != null) mc().setScreen(new AdvancementsScreen(mc().player.networkHandler.getAdvancementHandler(), toScreen(parent)));
    }

    @Override public void openStats(Object parent) { if (p() != null) mc().setScreen(new StatsScreen(toScreen(parent), mc().player.getStatHandler())); }
    @Override public void openLan(Object parent) { mc().setScreen(new OpenToLanScreen(toScreen(parent))); }
    @Override public boolean canOpenLan() { return mc().isIntegratedServerRunning() && mc().getServer() != null && !mc().getServer().isRemote(); }

    @Override
    public void disconnect() {
        boolean sp = mc().isInSingleplayer();
        ServerInfo server = mc().getCurrentServerEntry();
        if (mc().world != null) mc().world.disconnect();
        if (sp) mc().disconnect(new MessageScreen(Text.translatable("menu.savingLevel")));
        else mc().disconnect();
        TitleScreen title = new TitleScreen();
        if (sp || server == null) mc().setScreen(title);
        else mc().setScreen(new MultiplayerScreen(title));
    }

    @Override
    public void respawn() {
        if (p() != null && p().isDead()) mc().player.requestRespawn();
    }

    @Override
    public void localChat(String message) {
        mc().inGameHud.getChatHud().addMessage(Text.literal(message));
    }

    @Override public void quit() { mc().scheduleStop(); }
    @Override public void openUrl(String url) { Util.getOperatingSystem().open(url); }

    // ------------------------------------------------------------------ resources
    @Override
    public TextureRef loadTexture(String key, byte[] png) {
        try {
            NativeImage img = NativeImage.read(new ByteArrayInputStream(png));
            Identifier id = new Identifier("noreclient", key.toLowerCase().replaceAll("[^a-z0-9/._-]", "_"));
            mc().getTextureManager().registerTexture(id, new NativeImageBackedTexture(img));
            return new TextureRef(id, img.getWidth(), img.getHeight());
        } catch (Exception e) {
            return null;
        }
    }

    @Override public File resourcePackDir() { return mc().getResourcePackDir().toFile(); }
    @Override public File datapackDir() { return mc().getServer() == null ? null : mc().getServer().getSavePath(WorldSavePath.DATAPACKS).toFile(); }

    @Override
    public void enableResourcePack(String fileName) {
        var manager = mc().getResourcePackManager();
        manager.scanPacks();
        if (manager.enable("file/" + fileName)) mc().options.refreshResourcePacks(manager);
    }

    @Override
    public void disableResourcePack(String fileName) {
        var manager = mc().getResourcePackManager();
        if (manager.disable("file/" + fileName)) mc().options.refreshResourcePacks(manager);
    }

    @Override
    public boolean isResourcePackEnabled(String fileName) {
        return mc().getResourcePackManager().getEnabledIds().contains("file/" + fileName);
    }

    @Override public int activeResourcePacks() { return (int) mc().getResourcePackManager().getEnabledIds().stream().filter(id -> id.startsWith("file/")).count(); }
    @Override public String gpu() { return GlDebugInfo.getRenderer(); }
    @Override public String cpu() { return GlDebugInfo.getCpuInfo(); }

    /** Helper for mixins: distance from the eye to the closest point of an entity's hitbox. */
    public static double reach(PlayerEntity player, Entity target) {
        var eye = player.getEyePos();
        var box = target.getBoundingBox();
        double cx = Math.max(box.minX, Math.min(eye.x, box.maxX));
        double cy = Math.max(box.minY, Math.min(eye.y, box.maxY));
        double cz = Math.max(box.minZ, Math.min(eye.z, box.maxZ));
        return Math.sqrt((eye.x - cx) * (eye.x - cx) + (eye.y - cy) * (eye.y - cy) + (eye.z - cz) * (eye.z - cz));
    }
}
