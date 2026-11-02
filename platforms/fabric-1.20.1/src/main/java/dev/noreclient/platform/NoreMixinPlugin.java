package dev.noreclient.platform;

import dev.noreclient.util.LaunchAuth;
import net.fabricmc.loader.api.FabricLoader;
import org.objectweb.asm.tree.ClassNode;
import org.spongepowered.asm.mixin.extensibility.IMixinConfigPlugin;
import org.spongepowered.asm.mixin.extensibility.IMixinInfo;

import java.util.List;
import java.util.Set;

/** Applies Nore Client's mixins only for games started by Nore Launcher (or a dev environment). */
public class NoreMixinPlugin implements IMixinConfigPlugin {
    public static boolean allowed() {
        return FabricLoader.getInstance().isDevelopmentEnvironment() || LaunchAuth.valid();
    }

    @Override
    public void onLoad(String mixinPackage) {
        if (!allowed()) System.err.println("[Nore Client] Nore Client dziala tylko z Nore Launcher - mod jest wylaczony.");
    }

    @Override public String getRefMapperConfig() { return null; }
    @Override public boolean shouldApplyMixin(String targetClassName, String mixinClassName) { return allowed(); }
    @Override public void acceptTargets(Set<String> myTargets, Set<String> otherTargets) {}
    @Override public List<String> getMixins() { return null; }
    @Override public void preApply(String targetClassName, ClassNode targetClass, String mixinClassName, IMixinInfo mixinInfo) {}
    @Override public void postApply(String targetClassName, ClassNode targetClass, String mixinClassName, IMixinInfo mixinInfo) {}
}
