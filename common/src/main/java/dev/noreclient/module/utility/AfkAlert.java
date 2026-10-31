package dev.noreclient.module.utility;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/**
 * Notices when you stop playing for a while; while you are away it calls you back (sound, flashing
 * taskbar) when you take damage, run low on health or someone mentions you, and sums it up when
 * you return.
 */
public class AfkAlert extends Module {
    public final NumberSetting minutes = add(new NumberSetting("AFK After", "Po ilu minutach bez ruchu jesteś AFK", 3, 1, 30, 1, " min"));
    public final BooleanSetting damage = add(new BooleanSetting("On Damage", "Alarm, gdy otrzymujesz obrażenia", true));
    public final BooleanSetting lowHealth = add(new BooleanSetting("On Low Health", "Alarm przy mniej niż 4 serduszkach", true));
    public final BooleanSetting mention = add(new BooleanSetting("On Mention", "Alarm, gdy ktoś napisze Twój nick", true));
    public final BooleanSetting flash = add(new BooleanSetting("Flash Window", "Miganie paska zadań", true));
    public final BooleanSetting sound = add(new BooleanSetting("Sound", "Dźwięk alarmu", true));
    public final BooleanSetting indicator = add(new BooleanSetting("Indicator", "Znacznik „AFK” u góry ekranu", true));

    private long lastActivity = System.currentTimeMillis(), afkSince, lastAlert;
    private boolean afk, lowWarned;
    private float lastYaw, lastPitch;
    private int lastHurt, mentions, hits;

    public AfkAlert() {
        super("AFK Alert", "Wykrywa, że jesteś AFK, i woła Cię, gdy coś się dzieje", Category.UTILITY);
    }

    public void onActivity() {
        lastActivity = System.currentTimeMillis();
        if (afk) back();
    }

    @Override
    public void onKeyPressed(int key) { onActivity(); }

    private void back() {
        afk = false;
        long mins = Math.max(1, (System.currentTimeMillis() - afkSince) / 60000);
        if (isActive()) {
            String sum = "AFK przez " + mins + " min";
            if (mentions > 0) sum += " · wzmianki: " + mentions;
            if (hits > 0) sum += " · obrażenia: " + hits;
            NotificationManager.push("Witaj z powrotem", sum, mentions + hits > 0 ? NotificationManager.Type.WARNING : NotificationManager.Type.SUCCESS);
        }
        mentions = hits = 0;
    }

    public void onChat(String text, boolean aboutMe) {
        if (!afk || !aboutMe) return;
        mentions++;
        if (mention.isOn()) alert("Ktoś Cię wspomniał na czacie");
    }

    private void alert(String what) {
        long now = System.currentTimeMillis();
        if (now - lastAlert < 4000) return;
        lastAlert = now;
        NotificationManager.push("AFK Alert", what, NotificationManager.Type.WARNING);
        if (sound.isOn()) { game().playPing(0.8f); game().playPing(1.2f); }
        if (flash.isOn() && !game().windowFocused()) game().requestAttention();
    }

    @Override
    public void onTick() {
        if (!inGame()) { lastActivity = System.currentTimeMillis(); afk = false; return; }
        float yaw = game().yaw(1), pitch = game().pitch();
        boolean moved = Math.abs(yaw - lastYaw) > 0.3f || Math.abs(pitch - lastPitch) > 0.3f
                || game().keyDown("forward") || game().keyDown("back") || game().keyDown("left") || game().keyDown("right")
                || game().keyDown("jump") || game().keyDown("attack") || game().keyDown("use");
        lastYaw = yaw;
        lastPitch = pitch;
        if (moved) onActivity();
        long now = System.currentTimeMillis();
        if (!afk && now - lastActivity > minutes.get() * 60000) {
            afk = true;
            afkSince = lastActivity;
            mentions = hits = 0;
        }
        int hurt = game().hurtTime();
        if (afk && hurt > lastHurt) {
            hits++;
            if (damage.isOn()) alert("Otrzymujesz obrażenia!");
        }
        lastHurt = hurt;
        float hp = game().health() + game().absorption();
        if (afk && lowHealth.isOn() && hp <= 8 && !game().dead()) {
            if (!lowWarned) alert("Mało życia: " + Math.round(hp) / 2f + " ❤");
            lowWarned = true;
        } else if (hp > 10) lowWarned = false;
    }

    public boolean isAfk() { return afk && isActive(); }

    @Override
    public void onRenderOverlay(Gfx g, float tickDelta) {
        if (!afk || !indicator.isOn() || game().hudHidden()) return;
        long secs = (System.currentTimeMillis() - afkSince) / 1000;
        String t = "AFK  " + secs / 60 + ":" + String.format("%02d", secs % 60);
        float w = Render2D.textWidth(t) + 18, x = (g.width() - w) / 2f, y = 4;
        float pulse = 0.5f + 0.5f * (float) Math.sin(System.currentTimeMillis() / 400.0);
        Render2D.roundedRect(g, x, y, w, 14, 7, 0xB0160F26);
        Render2D.circle(g, x + 8, y + 7, 2.5f, ColorUtil.withAlpha(Theme.WARNING, (int) (120 + 135 * pulse)));
        Render2D.text(g, t, x + 13, y + 3.5f, 0xFFFFFFFF, true);
    }

    @Override
    public String getSuffix() { return afk ? "AFK" : null; }
}
