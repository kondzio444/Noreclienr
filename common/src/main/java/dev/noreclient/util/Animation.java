package dev.noreclient.util;

/**
 * Frame-rate independent exponential animation. Call {@link #update()} once per frame and read
 * {@link #get()}.
 */
public class Animation {
    private float value;
    private float target;
    private final float speed;
    private long last = System.nanoTime();

    public Animation(float initial, float speed) {
        this.value = initial;
        this.target = initial;
        this.speed = speed;
    }

    public Animation target(float target) {
        this.target = target;
        return this;
    }

    public float update() {
        long now = System.nanoTime();
        float dt = Math.min(0.1f, (now - last) / 1_000_000_000f);
        last = now;
        value += (target - value) * (1f - (float) Math.exp(-speed * dt));
        if (Math.abs(target - value) < 0.0005f) value = target;
        return value;
    }

    public float get() { return value; }
    public float getTarget() { return target; }
    public void set(float v) { value = v; target = v; }
    public boolean isDone() { return value == target; }

    public static float easeOutCubic(float t) {
        t = Math.max(0, Math.min(1, t));
        return 1 - (float) Math.pow(1 - t, 3);
    }

    public static float easeOutBack(float t) {
        t = Math.max(0, Math.min(1, t));
        float c1 = 1.70158f, c3 = c1 + 1;
        return 1 + c3 * (float) Math.pow(t - 1, 3) + c1 * (float) Math.pow(t - 1, 2);
    }
}
