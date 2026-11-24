// Builds a Screaming Frog .seospiderconfig from a readable JSON spec, using the
// installed SEO Spider's own classes, so no binary config is committed.
//
// Run with Screaming Frog's bundled Java (single-file source mode):
//   java -cp "<ScreamingFrogSEOSpider.jar>:<lib>/*" BuildConfig.java spec.json out.seospiderconfig
//   java -cp ... BuildConfig.java --dump            (prints every default field path=value)
//
// Spec: {"set": {"mCrawlConfig.mCrawlExternalLinks": false, ...},
//        "enum_sets": {"path": ["A", "B"]}}
// Paths are dotted field names from SpiderConfigPersistableState. An unknown
// path, a type mismatch or an unknown enum constant stops with exit code 2.
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.FileOutputStream;
import java.io.ObjectOutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.lang.reflect.ParameterizedType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collection;
import java.util.Collections;
import java.util.EnumSet;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;

public class BuildConfig {
    static final String STATE = "seo.spider.config.SpiderConfigPersistableState";

    static Field field(Class<?> c, String name) {
        for (Class<?> k = c; k != null; k = k.getSuperclass()) {
            try {
                Field f = k.getDeclaredField(name);
                f.setAccessible(true);
                return f;
            } catch (NoSuchFieldException e) {
                // keep looking in the superclass
            }
        }
        throw new IllegalArgumentException("unknown field '" + name + "' on " + c.getName());
    }

    static Object[] resolve(Object root, String path) throws Exception {
        String[] parts = path.split("\\.");
        Object owner = root;
        for (int i = 0; i < parts.length - 1; i++) {
            owner = field(owner.getClass(), parts[i]).get(owner);
            if (owner == null) {
                throw new IllegalArgumentException("null object at '" + parts[i] + "' in " + path);
            }
        }
        return new Object[] {owner, field(owner.getClass(), parts[parts.length - 1])};
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static Object convert(Class<?> type, JsonElement v, String path) {
        if (type == boolean.class || type == Boolean.class) {
            if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isBoolean()) {
                throw new IllegalArgumentException(path + " needs true/false");
            }
            return v.getAsBoolean();
        }
        if (type == int.class || type == Integer.class) return v.getAsInt();
        if (type == long.class || type == Long.class) return v.getAsLong();
        if (type == double.class || type == Double.class) return v.getAsDouble();
        if (type == String.class) return v.getAsString();
        if (type.isEnum()) {
            String name = v.getAsString();
            for (Object c : type.getEnumConstants()) {
                if (((Enum) c).name().equals(name)) return c;
            }
            throw new IllegalArgumentException(path + ": unknown " + type.getSimpleName() + " '" + name + "'");
        }
        throw new IllegalArgumentException(path + ": unsupported type " + type.getName());
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static void apply(Object root, JsonObject spec) throws Exception {
        JsonObject set = spec.has("set") ? spec.getAsJsonObject("set") : new JsonObject();
        for (Map.Entry<String, JsonElement> e : set.entrySet()) {
            Object[] r = resolve(root, e.getKey());
            Field f = (Field) r[1];
            f.set(r[0], convert(f.getType(), e.getValue(), e.getKey()));
        }
        JsonObject sets = spec.has("enum_sets") ? spec.getAsJsonObject("enum_sets") : new JsonObject();
        for (Map.Entry<String, JsonElement> e : sets.entrySet()) {
            Object[] r = resolve(root, e.getKey());
            Field f = (Field) r[1];
            Class ec = (Class) ((ParameterizedType) f.getGenericType()).getActualTypeArguments()[0];
            EnumSet values = EnumSet.noneOf(ec);
            for (JsonElement name : e.getValue().getAsJsonArray()) {
                values.add(convert(ec, name, e.getKey()));
            }
            Set current = (Set) f.get(r[0]);
            current.clear();
            current.addAll(values);
        }
    }

    static void dump(String path, Object o, int depth, Set<Object> seen) {
        if (o == null) {
            System.out.println(path + "=null");
            return;
        }
        Class<?> c = o.getClass();
        if (o instanceof Number || o instanceof Boolean || o instanceof String || c.isEnum()) {
            System.out.println(path + "=" + o);
            return;
        }
        if (o instanceof Collection || o instanceof Map || c.isArray()) {
            System.out.println(path + "=<" + c.getSimpleName() + ">" + (o instanceof Set ? o : ""));
            return;
        }
        if (depth > 6 || !seen.add(o) || !(c.getName().startsWith("seo.") || c.getName().startsWith("uk."))) {
            return;
        }
        for (Class<?> k = c; k != null && k != Object.class; k = k.getSuperclass()) {
            for (Field f : k.getDeclaredFields()) {
                if (Modifier.isStatic(f.getModifiers()) || !f.getName().startsWith("m")) continue;
                try {
                    f.setAccessible(true);
                    dump(path.isEmpty() ? f.getName() : path + "." + f.getName(), f.get(o), depth + 1, seen);
                } catch (Exception ex) {
                    // skip fields the JVM will not open
                }
            }
        }
    }

    public static void main(String[] args) throws Exception {
        Object state = Class.forName(STATE).getConstructor(boolean.class).newInstance(true);
        if (args.length == 1 && args[0].equals("--dump")) {
            dump("", state, 0, Collections.newSetFromMap(new IdentityHashMap<>()));
            return;
        }
        if (args.length != 2) {
            System.err.println("usage: BuildConfig.java <spec.json> <out.seospiderconfig> | --dump");
            System.exit(64);
        }
        JsonObject spec = JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonObject();
        try {
            apply(state, spec);
        } catch (IllegalArgumentException e) {
            System.err.println("spec error: " + e.getMessage());
            System.exit(2);
        }
        Path out = Path.of(args[1]);
        if (out.getParent() != null) Files.createDirectories(out.getParent());
        try (ObjectOutputStream o = new ObjectOutputStream(new FileOutputStream(out.toFile()))) {
            o.writeObject(state);
        }
        System.out.println("wrote " + out);
    }
}
