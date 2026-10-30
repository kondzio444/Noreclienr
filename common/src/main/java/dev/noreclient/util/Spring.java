package dev.noreclient.util;

/**
 * Damped spring from the Album motion tokens ({@link ThemeTokens#SPRING_STICK} etc.). Call
 * {@link #update()} once per frame; dt is capped at 0.05 s. Under reduced motion the spring
 * becomes a short ease-out (140 ms), with animations off it jumps straight to the target.
 */
public class Spring {
    private final float k, c, m;
    private float value, velocity, target;
    private float from;
    private long last = System.nanoTime();
    private long easeStart = -1;

    public Spring(float[] constants, float initial) {
        this.k = constants[0];
        this.c = constants[1];
        this.m = constants[2];
        this.value = initial;
        this.target = initial;
        this.from = initial;
    }

    public static Spring stick(float initial) { return new Spring(ThemeTokens.SPRING_STICK, initial); }

    public static Spring tab(float initial) { return new Spring(ThemeTokens.SPRING_TAB, initial); }

    public static Spring knob(float initial) { return new Spring(ThemeTokens.SPRING_KNOB, initial); }

    public static Spring soft(float initial) { return new Spring(ThemeTokens.SPRING_SOFT, initial); }

    public Spring target(float t) {
        if (t != target) {
            target = t;
            from = value;
            easeStart = System.currentTimeMillis();
        }
        return this;
    }

    /** Jumps to a value with no motion. */
    public void set(float v) {
        value = v;
        target = v;
        from = v;
        velocity = 0;
    }

    /** Starts from {@code v} and springs to the current target (an impulse). */
    public void kick(float v) {
        value = v;
        from = v;
        velocity = 0;
        easeStart = System.currentTimeMillis();
    }

    public float update() {
        long now = System.nanoTime();
        float dt = Math.min(0.05f, (now - last) / 1_000_000_000f);
        last = now;
        int level = Motion.level();
        if (level == Motion.OFF) {
            set(target);
            return value;
        }
        if (level == Motion.REDUCED) {
            float p = easeStart < 0 ? 1 : Math.min(1f, (System.currentTimeMillis() - easeStart) / (float) ThemeTokens.DUR_QUICK);
            value = from + (target - from) * Motion.ease(ThemeTokens.EASE_OUT, p);
            velocity = 0;
            return value;
        }
        // semi-implicit Euler, sub-stepped so stiff springs stay stable
        int steps = Math.max(1, (int) Math.ceil(dt / 0.008f));
        float h = dt / steps;
        for (int i = 0; i < steps; i++) {
            float force = -k * (value - target) - c * velocity;
            velocity += force / m * h;
            value += velocity * h;
        }
        if (Math.abs(value - target) < 0.0005f && Math.abs(velocity) < 0.001f) {
            value = target;
            velocity = 0;
        }
        return value;
    }

    public float get() { return value; }

    public float getTarget() { return target; }

    public boolean isDone() { return value == target && velocity == 0; }
}
