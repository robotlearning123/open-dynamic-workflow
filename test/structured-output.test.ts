import { describe, it, expect } from "vitest";
import {
  MAX_SCHEMA_RETRIES,
  toToolDef,
  validate,
} from "../src/structured-output.js";
import type { JsonSchema } from "../src/types.js";

describe("MAX_SCHEMA_RETRIES", () => {
  it("equals 2", () => {
    expect(MAX_SCHEMA_RETRIES).toBe(2);
  });
});

describe("toToolDef", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: { x: { type: "string" } },
    required: ["x"],
  };

  it("uses default name StructuredOutput", () => {
    const def = toToolDef(schema);
    expect(def.name).toBe("StructuredOutput");
  });

  it("accepts a custom name", () => {
    const def = toToolDef(schema, "MyTool");
    expect(def.name).toBe("MyTool");
  });

  it("passes input_schema verbatim", () => {
    const def = toToolDef(schema);
    expect(def.input_schema).toBe(schema);
  });

  it("has a description string", () => {
    const def = toToolDef(schema);
    expect(typeof def.description).toBe("string");
    expect(def.description.length).toBeGreaterThan(0);
  });
});

describe("validate — valid object passes", () => {
  it("valid flat object returns ok:true", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name", "age"],
    };
    const result = validate({ name: "Alice", age: 30 }, schema);
    expect(result.ok).toBe(true);
  });

  it("extra properties are allowed", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { x: { type: "string" } },
      required: ["x"],
    };
    const result = validate({ x: "hello", extra: 99 }, schema);
    expect(result.ok).toBe(true);
  });
});

describe("validate — missing required fails", () => {
  it("single missing required field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name", "age"],
    };
    const result = validate({ name: "Bob" }, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("age"))).toBe(true);
    }
  });

  it("all required missing", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["a", "b"],
    };
    const result = validate({}, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBe(2);
    }
  });
});

describe("validate — wrong type fails", () => {
  it("string given where integer expected", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    };
    const result = validate({ count: "five" }, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("count"))).toBe(true);
    }
  });

  it("float fails integer check", () => {
    const schema: JsonSchema = { type: "integer" };
    const result = validate(3.14, schema);
    expect(result.ok).toBe(false);
  });

  it("float passes number check", () => {
    const schema: JsonSchema = { type: "number" };
    const result = validate(3.14, schema);
    expect(result.ok).toBe(true);
  });

  it("wrong root type (array given, object expected)", () => {
    const schema: JsonSchema = { type: "object" };
    const result = validate([1, 2], schema);
    expect(result.ok).toBe(false);
  });

  it("null given where string expected", () => {
    const schema: JsonSchema = { type: "string" };
    const result = validate(null, schema);
    expect(result.ok).toBe(false);
  });

  it("null type passes for null value", () => {
    const schema: JsonSchema = { type: "null" };
    const result = validate(null, schema);
    expect(result.ok).toBe(true);
  });

  it("boolean type", () => {
    expect(validate(true, { type: "boolean" }).ok).toBe(true);
    expect(validate(1, { type: "boolean" }).ok).toBe(false);
  });
});

describe("validate — enum violations", () => {
  it("value not in enum fails", () => {
    const schema: JsonSchema = { type: "string", enum: ["red", "green", "blue"] };
    const result = validate("purple", schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("value in enum passes", () => {
    const schema: JsonSchema = { type: "string", enum: ["red", "green", "blue"] };
    const result = validate("green", schema);
    expect(result.ok).toBe(true);
  });

  it("enum with mixed types — correct type passes", () => {
    const schema: JsonSchema = { enum: [1, "two", null] };
    expect(validate(1, schema).ok).toBe(true);
    expect(validate("two", schema).ok).toBe(true);
    expect(validate(null, schema).ok).toBe(true);
    expect(validate(3, schema).ok).toBe(false);
  });

  it("enum on property inside object", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "inactive"] },
      },
      required: ["status"],
    };
    const bad = validate({ status: "pending" }, schema);
    expect(bad.ok).toBe(false);

    const good = validate({ status: "active" }, schema);
    expect(good.ok).toBe(true);
  });
});

describe("validate — nested object and array", () => {
  it("nested object validates recursively", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: {
            city: { type: "string" },
            zip: { type: "integer" },
          },
          required: ["city", "zip"],
        },
      },
      required: ["address"],
    };

    const good = validate({ address: { city: "NYC", zip: 10001 } }, schema);
    expect(good.ok).toBe(true);

    const bad = validate({ address: { city: "NYC" } }, schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.includes("zip"))).toBe(true);
    }
  });

  it("array items validate", () => {
    const schema: JsonSchema = {
      type: "array",
      items: { type: "integer" },
    };

    expect(validate([1, 2, 3], schema).ok).toBe(true);

    const bad = validate([1, "two", 3], schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.includes("[1]"))).toBe(true);
    }
  });

  it("array of objects validates each element", () => {
    const schema: JsonSchema = {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "integer" } },
        required: ["id"],
      },
    };

    const good = validate([{ id: 1 }, { id: 2 }], schema);
    expect(good.ok).toBe(true);

    const bad = validate([{ id: 1 }, { name: "oops" }], schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.includes("id"))).toBe(true);
    }
  });

  it("deeply nested invalid field surfaces an error path", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        meta: {
          type: "object",
          properties: {
            tags: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["tags"],
        },
      },
      required: ["meta"],
    };

    const bad = validate({ meta: { tags: ["ok", 42] } }, schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      // error path should reference meta.tags[1]
      expect(bad.errors.some((e) => e.includes("meta") && e.includes("[1]"))).toBe(true);
    }
  });
});
