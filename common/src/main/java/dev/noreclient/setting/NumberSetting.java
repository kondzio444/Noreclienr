package dev.noreclient.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

public class NumberSetting extends Setting<Double> {
    private final double min, max, step;
    private final String suffix;

    public NumberSetting(String name, String description, double defaultValue, double min, double max, double step) {
        this(name, description, defaultValue, min, max, step, "");
    }

    public NumberSetting(String name, String description, double defaultValue, double min, double max, double step, String suffix) {
        super(name, description, defaultValue);
        this.min = min;
        this.max = max;
        this.step = step;
        this.suffix = suffix;
    }

    @Override
    public void set(Double v) {
        double clamped = Math.max(min, Math.min(max, v));
        if (step > 0) clamped = Math.round(clamped / step) * step;
        this.value = Math.max(min, Math.min(max, clamped));
    }

    public double getMin() { return min; }
    public double getMax() { return max; }
    public double getStep() { return step; }
    public float floatValue() { return value.floatValue(); }
    public int intValue() { return (int) Math.round(value); }

    public String format() {
        String num = step >= 1 ? String.valueOf((long) Math.round(value))
                : step >= 0.1 ? String.format("%.1f", value) : String.format("%.2f", value);
        return num + suffix;
    }

    @Override
    public JsonElement toJson() { return new JsonPrimitive(value); }

    @Override
    public void fromJson(JsonElement element) {
        if (element.isJsonPrimitive()) set(element.getAsDouble());
    }
}
