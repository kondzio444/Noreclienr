package dev.noreclient.platform;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.noreclient.api.TextureRef;
import dev.noreclient.cosmetic.Mesh;
import dev.noreclient.cosmetic.Slot;
import dev.noreclient.cosmetic.Wardrobe;
import dev.noreclient.cosmetic.WearerState;
import dev.noreclient.util.Capes;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.player.PlayerModel;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.RenderLayerParent;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import net.minecraft.client.renderer.entity.player.AvatarRenderer;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.core.ClientAsset;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.player.PlayerModelType;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.Vec3;
import org.joml.Quaternionf;
import org.joml.Vector3f;

import java.util.List;

/**
 * Wardrobe items (Nore Client cosmetics) on every player, submitted as custom geometry: the local
 * player wears the saved look, other Nore players the look from the Nore Hub, and the wardrobe
 * screen's preview (a render state with {@link Wardrobe#PREVIEW_ID}) the look being edited.
 */
public class WardrobeLayer extends RenderLayer<AvatarRenderState, PlayerModel> {
    private static final AvatarRenderer<?>[] RENDERERS = new AvatarRenderer<?>[2];
    private static final WearerState STATE = new WearerState();
    private static final int FULL_BRIGHT = 0xF000F0;

    public WardrobeLayer(RenderLayerParent<AvatarRenderState, PlayerModel> parent) {
        super(parent);
    }

    /** Called by the avatar renderer mixin for both models (wide / slim): used by the preview. */
    public static void register(AvatarRenderer<?> renderer, boolean slim) { RENDERERS[slim ? 1 : 0] = renderer; }

    @Override
    public void submit(PoseStack pose, SubmitNodeCollector collector, int light, AvatarRenderState state, float yRot, float xRot) {
        if (state.isInvisible) return;
        Minecraft mc = Minecraft.getInstance();
        int who = state.id == Wardrobe.PREVIEW_ID ? Wardrobe.PREVIEW : mc.player != null && state.id == mc.player.getId() ? Wardrobe.LOCAL : Wardrobe.OTHER;
        Entity entity = mc.level == null || who == Wardrobe.PREVIEW ? null : mc.level.getEntity(state.id);
        String name = entity instanceof Player ? ((Player) entity).getGameProfile().name() : "";
        if (!Wardrobe.wears(who, name)) return;
        WearerState s;
        if (who == Wardrobe.PREVIEW) s = Wardrobe.previewState();
        else {
            s = STATE.reset(name);
            s.x = state.x;
            s.y = state.y;
            s.z = state.z;
            s.bodyYaw = state.bodyRot;
            s.headYaw = state.yRot;
            s.headPitch = state.xRot;
            s.limbSwing = state.walkAnimationPos;
            s.limbAmount = state.walkAnimationSpeed;
            s.sneaking = state.isCrouching;
            s.gliding = state.isFallFlying;
            s.swimming = state.isVisuallySwimming;
            s.hurtTime = state.hasRedOverlay ? 6 : 0;
            s.helmet = !state.headEquipment.isEmpty();
            s.elytra = state.chestEquipment.is(Items.ELYTRA);
            if (entity instanceof Player) {
                Player p = (Player) entity;
                s.onGround = p.onGround();
                s.sprinting = p.isSprinting();
                s.flying = p.getAbilities().flying;
                s.hurtTime = p.hurtTime;
                if (who == Wardrobe.LOCAL) {
                    Vec3 v = p.getDeltaMovement();
                    s.vx = v.x;
                    s.vy = p.onGround() ? 0 : v.y;
                    s.vz = v.z;
                }
            }
        }
        draw(pose, collector, light, getParentModel(), Wardrobe.pieces(who, s));
    }

    /** Submits the pieces attached to the head / body parts of the model as custom geometry. */
    static void draw(PoseStack pose, SubmitNodeCollector collector, int light, PlayerModel model, List<Wardrobe.Piece> pieces) {
        for (Wardrobe.Piece piece : pieces) {
            ModelPart part = piece.part == Wardrobe.Part.HEAD ? model.head : model.body;
            pose.pushPose();
            part.translateAndRotate(pose);
            Identifier tex = (Identifier) piece.texture.handle;
            final int l = piece.glow() ? FULL_BRIGHT : light;
            final List<Mesh.Quad> quads = piece.quads;
            collector.submitCustomGeometry(pose, piece.glow() ? RenderTypes.eyes(tex) : RenderTypes.entityCutout(tex), (p, vc) -> {
                for (Mesh.Quad q : quads) {
                    for (int i = 0; i < 4; i++) {
                        vc.addVertex(p, q.x[i] / 16f, q.y[i] / 16f, q.z[i] / 16f).setColor(q.color).setUv(q.u[i], q.v[i])
                                .setOverlay(OverlayTexture.NO_OVERLAY).setLight(l).setNormal(p, q.nx, q.ny, q.nz);
                    }
                }
            });
            pose.popPose();
        }
    }

    private static PlayerSkin skin() {
        Minecraft mc = Minecraft.getInstance();
        return mc.player != null ? mc.player.getSkin() : mc.getSkinManager().createLookup(mc.getGameProfile(), false).get();
    }

    /** A render state for the wardrobe preview: the local player's skin, the preview cape and pose. */
    static AvatarRenderState previewState(AvatarRenderer<?> r, float yaw) {
        PlayerSkin skin = skin();
        WearerState s = Wardrobe.previewState();
        float age = Wardrobe.time() * 20;
        AvatarRenderState st = r.createRenderState();
        st.id = Wardrobe.PREVIEW_ID;
        String cape = Wardrobe.previewCape();
        TextureRef capeTex = cape == null ? null : Capes.texture(cape, Wardrobe.capeFrame(Wardrobe.previewLook.get(Slot.CAPE)));
        ClientAsset.ResourceTexture capeAsset = capeTex == null ? null : new ClientAsset.ResourceTexture((Identifier) capeTex.handle, (Identifier) capeTex.handle);
        st.skin = new PlayerSkin(skin.body(), capeAsset, capeAsset, skin.model(), skin.secure());
        st.showCape = capeAsset != null;
        st.showHat = st.showJacket = st.showLeftSleeve = st.showRightSleeve = st.showLeftPants = st.showRightPants = true;
        st.ageInTicks = age;
        st.bodyRot = 180 + yaw;
        st.yRot = s.headYaw;
        st.xRot = s.headPitch;
        st.walkAnimationPos = s.limbSwing;
        st.walkAnimationSpeed = s.limbAmount;
        st.isCrouching = s.sneaking;
        st.isDiscrete = s.sneaking;
        st.pose = s.sneaking ? Pose.CROUCHING : Pose.STANDING;
        st.scale = 1;
        st.ageScale = 1;
        st.headEquipment = ItemStack.EMPTY;
        st.chestEquipment = ItemStack.EMPTY;
        st.legsEquipment = ItemStack.EMPTY;
        st.feetEquipment = ItemStack.EMPTY;
        st.capeFlap = 4 + s.limbAmount * (s.sneaking ? 6 : 22) + (s.flying ? 28 : 0) + 3 * (float) Math.sin(age * 0.05f);
        st.capeLean = 0;
        st.capeLean2 = 2 * (float) Math.sin(age * 0.07f);
        return st;
    }

    /** The wardrobe preview: a render state drawn by the GUI's entity renderer (with the cape and this layer). */
    public static boolean drawPreview(GuiGraphicsExtractor ctx, int x1, int y1, int x2, int y2, float size, float yaw, float pitch) {
        PlayerSkin skin = skin();
        AvatarRenderer<?> r = RENDERERS[skin.model() == PlayerModelType.SLIM ? 1 : 0];
        if (r == null) return false;
        AvatarRenderState st = previewState(r, yaw);
        float lift = Wardrobe.previewState().flying ? 0.12f + (float) Math.sin(Wardrobe.time() * 1.6f) * 0.06f : 0;
        float cy = (y1 + y2) / 2f;
        Vector3f translation = new Vector3f(0, (y2 - size * 0.25f - lift * size - cy) / size, 0);
        float pr = (float) Math.toRadians(pitch);
        Quaternionf rotation = new Quaternionf().rotateZ((float) Math.PI).rotateX(pr);
        ctx.entity(st, size, translation, rotation, new Quaternionf().rotateX(pr), x1, y1, x2, y2);
        return true;
    }
}
