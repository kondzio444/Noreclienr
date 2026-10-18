package dev.noreclient.cosmetic;

import java.util.Random;

/**
 * Animation state of one player wearing wardrobe items, updated once per frame from a
 * {@link WearerState}: smoothed movement (body-space velocity, flight, sneak, sprint, hurt), head
 * turn rate and a few damped springs that items use for secondary motion (ears that lag behind a
 * head turn, a tail that trails and wags, a bouncing pompom), plus random ear twitches.
 */
public final class Wearer {
    /** A damped spring: x follows the target with overshoot. */
    public static final class Spring {
        public float x, v;
        final float k, c;

        Spring(float k, float c) { this.k = k; this.c = c; }

        void update(float target, float dt) {
            v += (k * (target - x) - c * v) * dt;
            x += v * dt;
            if (Float.isNaN(x) || Math.abs(x) > 50) { x = 0; v = 0; }
        }

        void kick(float dv) { v += dv; }
    }

    /** Never updated: everything at rest (items with the animation switched off). */
    public static final Wearer REST = new Wearer("");

    /** Seconds since this wearer was first seen. */
    public float time;
    /** Per-slot animation clocks (seconds scaled by each item's speed option). */
    public final float[] phase = new float[Slot.values().length];
    /** Horizontal speed 0..1 (1 = sprinting), body-space velocity (blocks/s, + = forward / to the player's left), vertical velocity. */
    public float speed, fwd, side, vy;
    /** 0..1 blends. */
    public float flight, sneak, sprint, hurt, air, swim, idle;
    /** Head turn rate in degrees per second (+ = turning to the player's left), head yaw relative to the body and pitch. */
    public float turn, lookYaw, lookPitch;
    public float limbSwing, limbAmount;
    /** + = perked up after a jump, - = flopped after landing. */
    public final Spring perk = new Spring(70, 7);
    /** Sideways swing of ears (lags behind head turns): + = swung towards +x. */
    public final Spring earSwing = new Spring(110, 7);
    /** Tail: sideways (+x) and lift (+ = up). */
    public final Spring tailSide = new Spring(26, 4.2f), tailLift = new Spring(22, 5f);
    /** Pendulums (pompoms, strings): x sideways, z backwards, y vertical. */
    public final Spring bobX = new Spring(60, 4.5f), bobY = new Spring(90, 5f), bobZ = new Spring(60, 4.5f);
    /** Ear twitches, 0..1 pulses (L = +x ear). */
    public float twitchL, twitchR;

    private final Random random;
    private long last;
    private boolean hasPos, wasGround = true;
    private double px, py, pz;
    private float rawFwd, rawSide, rawVy, prevLook, airTime, stillTime, fallSpeed;
    private float twitchTimer = 2, twitchT = -1;
    private int twitchSide, twitchCount;
    long seen;
    /** Seconds advanced by the last update (0 when it was a repeat in the same frame). */
    float frameDt;

    Wearer(String name) {
        random = new Random(name.hashCode() * 31L + 7);
        twitchTimer = 1 + random.nextFloat() * 3;
    }

    private static float approach(float cur, float target, float rate, float dt) {
        return cur + (target - cur) * (1f - (float) Math.exp(-rate * dt));
    }

    private static float clamp(float v, float lo, float hi) { return Math.max(lo, Math.min(hi, v)); }

    private static float wrap(float deg) {
        deg %= 360f;
        if (deg >= 180f) deg -= 360f;
        if (deg < -180f) deg += 360f;
        return deg;
    }

    /** Advances the animation to now. Several calls in one frame are harmless. */
    void update(WearerState s, long now) {
        seen = now;
        float dt = last == 0 ? 0 : (now - last) / 1e9f;
        if (last != 0 && dt < 0.002f) { frameDt = 0; return; }
        last = now;
        if (dt > 0.25f) dt = 0.25f;
        frameDt = dt;
        time += dt;

        // velocity in blocks per second, from the platform or from the movement since the last frame
        float vx, vyw, vz;
        if (!Double.isNaN(s.vx)) {
            vx = (float) s.vx * 20f; vyw = (float) s.vy * 20f; vz = (float) s.vz * 20f;
        } else if (hasPos && dt > 0) {
            vx = (float) ((s.x - px) / dt); vyw = (float) ((s.y - py) / dt); vz = (float) ((s.z - pz) / dt);
            if (Math.abs(vx) > 60 || Math.abs(vyw) > 60 || Math.abs(vz) > 60) { vx = 0; vyw = 0; vz = 0; } // teleport
        } else {
            vx = vyw = vz = 0;
        }
        px = s.x; py = s.y; pz = s.z;
        hasPos = true;
        double yaw = Math.toRadians(s.bodyYaw);
        float f = (float) (-Math.sin(yaw) * vx + Math.cos(yaw) * vz);
        float sd = (float) (Math.cos(yaw) * vx + Math.sin(yaw) * vz);
        float prevFwd = rawFwd, prevSide = rawSide;
        rawFwd = approach(rawFwd, f, 14, dt);
        rawSide = approach(rawSide, sd, 14, dt);
        rawVy = approach(rawVy, vyw, 14, dt);
        fwd = rawFwd; side = rawSide; vy = rawVy;
        float h = (float) Math.sqrt(fwd * fwd + side * side);
        speed = approach(speed, clamp(h / 5.6f, 0, 1), 8, dt);

        boolean flyingNow = s.flying || s.gliding;
        flight = approach(flight, flyingNow ? 1 : !s.onGround && rawVy < -9 ? 0.7f : 0, 3.5f, dt);
        sneak = approach(sneak, s.sneaking ? 1 : 0, 12, dt);
        sprint = approach(sprint, s.sprinting && h > 2 ? 1 : 0, 6, dt);
        swim = approach(swim, s.swimming ? 1 : 0, 6, dt);
        float hurtNow = s.hurtTime > 0 ? Math.min(1, s.hurtTime / 7f) : 0;
        hurt = hurtNow > hurt ? hurtNow : approach(hurt, hurtNow, 4, dt);
        air = approach(air, s.onGround || flyingNow ? 0 : 1, 10, dt);
        limbSwing = s.limbSwing;
        limbAmount = s.limbAmount;

        // jump / landing
        if (!s.onGround && !flyingNow) {
            airTime += dt;
            fallSpeed = Math.max(fallSpeed, -rawVy);
        }
        if (wasGround && !s.onGround && !flyingNow && vyw > 1.5f) perk.kick(9f);
        if (!wasGround && s.onGround) {
            if (airTime > 0.2f) {
                float hit = Math.min(1.6f, 0.5f + fallSpeed / 14f);
                perk.kick(-9f * hit);
                bobY.kick(9f * hit);
                tailLift.kick(-3.5f * hit);
            }
            airTime = 0;
            fallSpeed = 0;
        }
        wasGround = s.onGround;

        // head turning
        float look = s.bodyYaw + s.headYaw;
        float rate = dt > 0 ? wrap(look - prevLook) / dt : 0;
        if (Math.abs(rate) > 2000) rate = 0;
        prevLook = look;
        // + yaw turns the player to the right (clockwise seen from above), i.e. towards -x of the model
        turn = approach(turn, clamp(-rate, -720, 720), 12, dt);
        lookYaw = approach(lookYaw, clamp(wrap(s.headYaw), -75, 75), 14, dt);
        lookPitch = approach(lookPitch, clamp(s.headPitch, -90, 90), 14, dt);

        float accF = dt > 0 ? (rawFwd - prevFwd) / dt : 0, accS = dt > 0 ? (rawSide - prevSide) / dt : 0;
        accF = clamp(accF, -40, 40);
        accS = clamp(accS, -40, 40);

        // idle: standing still for a moment
        stillTime = h < 0.4f && s.onGround ? stillTime + dt : 0;
        idle = approach(idle, stillTime > 0.8f ? 1 : 0, 2.5f, dt);

        // springs, in small steps so stiff ones stay stable at low frame rates
        int steps = Math.max(1, (int) Math.ceil(dt / (1 / 120f)));
        float st = dt / steps;
        float swingTarget = clamp(turn / 480f, -1.2f, 1.2f) - clamp(accS / 60f, -0.5f, 0.5f);
        float tailSideTarget = clamp(-side / 5f, -0.9f, 0.9f) + clamp(turn / 600f, -0.8f, 0.8f);
        float tailLiftTarget = clamp(fwd / 6f, -0.4f, 0.9f) - sneak * 0.7f + air * 0.35f - swim * 0.2f + flight * 0.5f;
        for (int i = 0; i < steps; i++) {
            perk.update(0, st);
            earSwing.update(swingTarget, st);
            tailSide.update(tailSideTarget, st);
            tailLift.update(tailLiftTarget, st);
            bobX.update(clamp(-side * 0.12f + turn / 900f - accS / 80f, -1.2f, 1.2f), st);
            bobZ.update(clamp(fwd * 0.14f + accF / 70f, -1.2f, 1.2f), st);
            bobY.update(clamp(rawVy * 0.04f, -1, 1), st);
        }

        // ear twitches: now and then one ear flicks (sometimes twice), more often when idle
        if (twitchT >= 0) {
            twitchT += dt / 0.26f;
            float p = twitchT >= 1 ? 0 : (float) Math.sin(Math.PI * twitchT);
            if (twitchSide == 0) twitchL = p; else twitchR = p;
            if (twitchT >= 1) {
                twitchL = twitchR = 0;
                if (twitchCount > 0) { twitchCount--; twitchT = 0; } else twitchT = -1;
            }
        } else {
            twitchTimer -= dt * (0.5f + idle);
            if (twitchTimer <= 0) {
                twitchTimer = 1.6f + random.nextFloat() * 4.5f;
                twitchSide = random.nextInt(3) == 0 ? 2 : random.nextInt(2);
                twitchCount = random.nextInt(4) == 0 ? 1 : 0;
                if (twitchSide == 2) twitchSide = random.nextInt(2);
                twitchT = 0;
            }
        }
    }

    /** Advances one slot's animation clock. */
    void advance(Slot slot, float speedOpt) {
        phase[slot.ordinal()] += frameDt * speedOpt;
        if (phase[slot.ordinal()] > 36000) phase[slot.ordinal()] -= 36000;
    }
}
