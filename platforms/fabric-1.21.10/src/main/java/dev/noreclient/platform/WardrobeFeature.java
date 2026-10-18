package dev.noreclient.platform;

import dev.noreclient.api.TextureRef;
import dev.noreclient.cosmetic.Mesh;
import dev.noreclient.cosmetic.Slot;
import dev.noreclient.cosmetic.Wardrobe;
import dev.noreclient.cosmetic.WearerState;
import dev.noreclient.util.Capes;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.command.OrderedRenderCommandQueue;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.entity.player.PlayerSkinType;
import net.minecraft.entity.player.SkinTextures;
import net.minecraft.util.AssetInfo;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityPose;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.Vec3d;

import org.joml.Quaternionf;
import org.joml.Vector3f;

import java.util.List;

/**
 * Wardrobe items (Nore Client cosmetics) on every player: the local player wears the saved look,
 * other Nore players the look from the Nore Hub, and the wardrobe screen's preview (a render state
 * with {@link Wardrobe#PREVIEW_ID}) the look being edited.
 */
public class WardrobeFeature extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
    private static final PlayerEntityRenderer<?>[] RENDERERS = new PlayerEntityRenderer<?>[2];
    private static final WearerState STATE = new WearerState();
    private static final int FULL_BRIGHT = 0xF000F0;

    public WardrobeFeature(FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context) {
        super(context);
    }

    /** Called by the player renderer mixin for both models (wide / slim): used by the preview. */
    public static void register(PlayerEntityRenderer<?> renderer, boolean slim) { RENDERERS[slim ? 1 : 0] = renderer; }

    @Override
    public void render(MatrixStack matrices, OrderedRenderCommandQueue queue, int light, PlayerEntityRenderState state, float limbAngle, float limbDistance) {
        if (state.invisible) return;
        MinecraftClient mc = MinecraftClient.getInstance();
        int who = state.id == Wardrobe.PREVIEW_ID ? Wardrobe.PREVIEW : mc.player != null && state.id == mc.player.getId() ? Wardrobe.LOCAL : Wardrobe.OTHER;
        Entity entity = mc.world == null || who == Wardrobe.PREVIEW ? null : mc.world.getEntityById(state.id);
        String name = entity instanceof PlayerEntity ? ((PlayerEntity) entity).getGameProfile().name()
                : state.playerName != null ? state.playerName.getString() : "";
        if (!Wardrobe.wears(who, name)) return;
        WearerState s;
        if (who == Wardrobe.PREVIEW) s = Wardrobe.previewState();
        else {
            s = STATE.reset(name);
            s.x = state.x;
            s.y = state.y;
            s.z = state.z;
            s.bodyYaw = state.bodyYaw;
            s.headYaw = state.relativeHeadYaw;
            s.headPitch = state.pitch;
            s.limbSwing = state.limbSwingAnimationProgress;
            s.limbAmount = state.limbSwingAmplitude;
            s.sneaking = state.isInSneakingPose;
            s.gliding = state.isGliding;
            s.swimming = state.isSwimming;
            s.hurtTime = state.hurt ? 6 : 0;
            s.helmet = !state.equippedHeadStack.isEmpty();
            s.elytra = state.equippedChestStack.isOf(Items.ELYTRA);
            Entity e = entity;
            if (e instanceof PlayerEntity) {
                PlayerEntity p = (PlayerEntity) e;
                s.onGround = p.isOnGround();
                s.sprinting = p.isSprinting();
                s.flying = p.getAbilities().flying;
                s.hurtTime = p.hurtTime;
                if (who == Wardrobe.LOCAL) {
                    Vec3d v = p.getVelocity();
                    s.vx = v.x;
                    s.vy = p.isOnGround() ? 0 : v.y;
                    s.vz = v.z;
                }
            }
        }
        draw(matrices, queue, light, getContextModel(), Wardrobe.pieces(who, s));
    }

    /** Submits the pieces attached to the head / body parts of the model as custom geometry. */
    static void draw(MatrixStack matrices, OrderedRenderCommandQueue queue, int light, PlayerEntityModel model, List<Wardrobe.Piece> pieces) {
        for (Wardrobe.Piece piece : pieces) {
            ModelPart part = piece.part == Wardrobe.Part.HEAD ? model.head : model.body;
            matrices.push();
            part.applyTransform(matrices);
            Identifier tex = (Identifier) piece.texture.handle;
            final int l = piece.glow() ? FULL_BRIGHT : light;
            final List<Mesh.Quad> quads = piece.quads;
            queue.submitCustom(matrices, piece.glow() ? RenderLayer.getEyes(tex) : RenderLayer.getEntityCutoutNoCull(tex), (entry, vc) -> {
                for (Mesh.Quad q : quads) {
                    for (int i = 0; i < 4; i++) {
                        vc.vertex(entry.getPositionMatrix(), q.x[i] / 16f, q.y[i] / 16f, q.z[i] / 16f).color(q.color).texture(q.u[i], q.v[i])
                                .overlay(OverlayTexture.DEFAULT_UV).light(l).normal(entry, q.nx, q.ny, q.nz);
                    }
                }
            });
            matrices.pop();
        }
    }

    /** A render state for the wardrobe preview: the local player's skin, the preview cape and pose. */
    static PlayerEntityRenderState previewState(PlayerEntityRenderer<?> r, float yaw) {
        MinecraftClient mc = MinecraftClient.getInstance();
        SkinTextures skin = skin();
        WearerState s = Wardrobe.previewState();
        float age = Wardrobe.time() * 20;
        PlayerEntityRenderState st = r.createRenderState();
        st.id = Wardrobe.PREVIEW_ID;
        String cape = Wardrobe.previewCape();
        TextureRef capeTex = cape == null ? null : Capes.texture(cape, Wardrobe.capeFrame(Wardrobe.previewLook.get(Slot.CAPE)));
        Identifier capeId = capeTex == null ? null : (Identifier) capeTex.handle;
        AssetInfo.TextureAssetInfo capeAsset = capeId == null ? null : new AssetInfo.TextureAssetInfo(capeId, capeId);
        st.skinTextures = new SkinTextures(skin.body(), capeAsset, capeAsset, skin.model(), skin.secure());
        st.capeVisible = capeId != null;
        st.hatVisible = st.jacketVisible = st.leftSleeveVisible = st.rightSleeveVisible = st.leftPantsLegVisible = st.rightPantsLegVisible = true;
        st.age = age;
        st.bodyYaw = 180 + yaw;
        st.relativeHeadYaw = s.headYaw;
        st.pitch = s.headPitch;
        st.limbSwingAnimationProgress = s.limbSwing;
        st.limbSwingAmplitude = s.limbAmount;
        st.isInSneakingPose = s.sneaking;
        st.sneaking = s.sneaking;
        st.pose = s.sneaking ? EntityPose.CROUCHING : EntityPose.STANDING;
        st.baseScale = 1;
        st.ageScale = 1;
        st.equippedHeadStack = ItemStack.EMPTY;
        st.equippedChestStack = ItemStack.EMPTY;
        st.equippedLegsStack = ItemStack.EMPTY;
        st.equippedFeetStack = ItemStack.EMPTY;
        st.field_53536 = 4 + s.limbAmount * 22 + (s.flying ? 28 : 0) + 3 * (float) Math.sin(age * 0.05f);
        st.field_53537 = 0;
        st.field_53538 = 2 * (float) Math.sin(age * 0.07f);
        return st;
    }

    private static SkinTextures skin() {
        MinecraftClient mc = MinecraftClient.getInstance();
        return mc.player != null ? mc.player.getSkin() : mc.getSkinProvider().supplySkinTextures(mc.getGameProfile(), false).get();
    }

    /** The wardrobe preview: a render state drawn by the GUI's entity renderer (with the cape and this feature). */
    public static boolean drawPreview(DrawContext ctx, int x1, int y1, int x2, int y2, float size, float yaw, float pitch) {
        MinecraftClient mc = MinecraftClient.getInstance();
        SkinTextures skin = skin();
        PlayerEntityRenderer<?> r = RENDERERS[skin.model() == PlayerSkinType.SLIM ? 1 : 0];
        if (r == null) return false;
        PlayerEntityRenderState st = previewState(r, yaw);
        float lift = Wardrobe.previewState().flying ? 0.12f + (float) Math.sin(Wardrobe.time() * 1.6f) * 0.06f : 0;
        float cy = (y1 + y2) / 2f;
        Vector3f translation = new Vector3f(0, (y2 - size * 0.25f - lift * size - cy) / size, 0);
        float pr = (float) Math.toRadians(pitch);
        Quaternionf rotation = new Quaternionf().rotateZ((float) Math.PI).rotateX(pr);
        ctx.addEntity(st, size, translation, rotation, new Quaternionf().rotateX(pr), x1, y1, x2, y2);
        return true;
    }
}
