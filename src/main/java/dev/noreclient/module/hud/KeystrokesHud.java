package dev.noreclient.module.hud;

import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ClickTracker;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.option.KeyBinding;

public class KeystrokesHud extends HudModule {
    public final NumberSetting keySize = add(new NumberSetting("Key Size", "Rozmiar klawisza", 22, 14, 32, 1, "px"));
    public final NumberSetting gap = add(new NumberSetting("Gap", "Odstęp między klawiszami", 2, 0, 6, 1, "px"));
    public final BooleanSetting mouse = add(new BooleanSetting("Mouse Buttons", "Pokazuj LPM/PPM", true));
    public final BooleanSetting cps = add(new BooleanSetting("Show CPS", "CPS na przyciskach myszy", true)).visibleWhen(mouse::isOn);
    public final BooleanSetting space = add(new BooleanSetting("Space Bar", "Pokazuj spację", true));
    public final BooleanSetting accentPress = add(new BooleanSetting("Accent Press", "Wciśnięty klawisz w kolorze motywu", true));
    public final ColorSetting pressedColor = add(new ColorSetting("Pressed Color", "Kolor wciśniętego klawisza", 0xE0FFFFFF)).visibleWhen(() -> !accentPress.isOn());
    public final ColorSetting idleColor = add(new ColorSetting("Idle Color", "Kolor tła klawisza", 0x90101018));
    public final ColorSetting textColor = add(new ColorSetting("Text Color", "Kolor tekstu", 0xFFFFFFFF));
    public final ColorSetting pressedText = add(new ColorSetting("Pressed Text", "Kolor tekstu po wciśnięciu", 0xFF101018));
    public final BooleanSetting outline = add(new BooleanSetting("Outline", "Obramowanie klawiszy", false));

    private final Animation[] anims = new Animation[7];

    public KeystrokesHud() {
        super("Keystrokes", "Podgląd wciskanych klawiszy WASD i myszy", 0.0f, 0.8f);
        for (int i = 0; i < anims.length; i++) anims[i] = new Animation(0, 18);
        setEnabled(true);
    }

    private void key(DrawContext ctx, int idx, float x, float y, float w, float h, String label, String sub, boolean pressed) {
        Animation a = anims[idx];
        a.target(pressed ? 1 : 0);
        float p = a.update();
        int pc = accentPress.isOn() ? Theme.accent((long) (x * 8)) : pressedColor.getColor();
        int bg = ColorUtil.lerp(idleColor.getColor(), pc, p);
        float r = Theme.radius() * 0.6f;
        float shrink = p * 0.6f;
        Render2D.roundedRect(ctx, x + shrink, y + shrink, w - shrink * 2, h - shrink * 2, r, bg);
        if (outline.isOn()) Render2D.roundedOutline(ctx, x, y, w, h, r, 1, ColorUtil.withAlpha(Theme.accent(), 160));
        int tc = ColorUtil.lerp(textColor.getColor(), pressedText.getColor(), p);
        if (sub == null) {
            Render2D.centeredText(ctx, label, x + w / 2f, y + h / 2f - 3.5f, tc, false);
        } else {
            Render2D.centeredText(ctx, label, x + w / 2f, y + h / 2f - 7, tc, false);
            Render2D.scaledText(ctx, sub, x + w / 2f - Render2D.textWidth(sub) * 0.35f, y + h / 2f + 2.5f, 0.7f, ColorUtil.fade(tc, 0.8f), false);
        }
    }

    private static boolean down(KeyBinding k) { return k.isPressed(); }

    private static String keyLabel(KeyBinding k, String fallback) {
        String s = k.getBoundKeyLocalizedText().getString();
        return s.length() > 3 || s.isEmpty() ? fallback : s.toUpperCase();
    }

    @Override
    public void render(DrawContext ctx, float tickDelta, boolean editor) {
        float s = keySize.floatValue(), g = gap.floatValue();
        float total = s * 3 + g * 2;
        var o = mc.options;
        key(ctx, 0, s + g, 0, s, s, keyLabel(o.forwardKey, "W"), null, down(o.forwardKey));
        key(ctx, 1, 0, s + g, s, s, keyLabel(o.leftKey, "A"), null, down(o.leftKey));
        key(ctx, 2, s + g, s + g, s, s, keyLabel(o.backKey, "S"), null, down(o.backKey));
        key(ctx, 3, (s + g) * 2, s + g, s, s, keyLabel(o.rightKey, "D"), null, down(o.rightKey));
        float y = (s + g) * 2;
        if (mouse.isOn()) {
            float mw = (total - g) / 2f;
            float mh = s * (cps.isOn() ? 0.95f : 0.8f);
            key(ctx, 4, 0, y, mw, mh, "LMB", cps.isOn() ? ClickTracker.left() + " CPS" : null, down(o.attackKey));
            key(ctx, 5, mw + g, y, mw, mh, "RMB", cps.isOn() ? ClickTracker.right() + " CPS" : null, down(o.useKey));
            y += mh + g;
        }
        if (space.isOn()) {
            float sh = s * 0.5f;
            Animation a = anims[6];
            a.target(down(o.jumpKey) ? 1 : 0);
            float p = a.update();
            int pc = accentPress.isOn() ? Theme.accent() : pressedColor.getColor();
            Render2D.roundedRect(ctx, 0, y, total, sh, Theme.radius() * 0.6f, ColorUtil.lerp(idleColor.getColor(), pc, p));
            int tc = ColorUtil.lerp(textColor.getColor(), pressedText.getColor(), p);
            Render2D.roundedRect(ctx, total / 2f - 12, y + sh / 2f - 1, 24, 2, 1, tc);
            y += sh + g;
        }
        width = total;
        height = y - g;
    }
}
