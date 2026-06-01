import type { JsonSchema } from "./types.js";

export const MAX_SCHEMA_RETRIES = 2;

/** Wrap a user-supplied JSON Schema as an Anthropic tool definition for structured output.
 *  The tool is named StructuredOutput (or the caller-supplied name) and its input_schema
 *  is the schema verbatim — matches ANALYSIS §4. */
export function toToolDef(
  schema: JsonSchema,
  name = "StructuredOutput",
): { name: string; description: string; input_schema: JsonSchema } {
  return {
    name,
    description: "Return a structured value matching the provided JSON Schema.",
    input_schema: schema,
  };
}

/** Validate a value against a minimal JSON Schema subset.
 *  Supported keywords: type, properties, required, items, enum.
 *  Returns {ok:true} on success; {ok:false, errors} on failure. */
export function validate(
  value: unknown,
  schema: JsonSchema,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  validateNode(value, schema, "", errors);
  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
}

function validateNode(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: string[],
): void {
  const loc = path === "" ? "(root)" : path;

  // enum check — evaluated before type so an enum can narrow to a subset of a type
  if (schema.enum !== undefined) {
    const match = schema.enum.some((e) => deepEqual(e, value));
    if (!match) {
      errors.push(
        `${loc}: expected one of ${JSON.stringify(schema.enum)} but got ${JSON.stringify(value)}`,
      );
      // still validate type/properties below so errors are comprehensive
    }
  }

  if (schema.type !== undefined) {
    if (!checkType(value, schema.type)) {
      errors.push(
        `${loc}: expected type "${schema.type}" but got "${jsType(value)}"`,
      );
      // type mismatch — skip structural keywords (properties/items) which require the right type
      return;
    }
  }

  if (schema.type === "object" || (schema.type === undefined && isPlainObject(value))) {
    const obj = value as Record<string, unknown>;

    // required fields
    if (schema.required !== undefined) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          const childLoc = path === "" ? key : `${path}.${key}`;
          errors.push(`${childLoc}: required property is missing`);
        }
      }
    }

    // properties
    if (schema.properties !== undefined) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          const childLoc = path === "" ? key : `${path}.${key}`;
          validateNode(obj[key], childSchema, childLoc, errors);
        }
      }
    }
  } else if (schema.type === "array" || (schema.type === undefined && Array.isArray(value))) {
    if (schema.items !== undefined) {
      const arr = value as unknown[];
      for (let i = 0; i < arr.length; i++) {
        validateNode(arr[i], schema.items, `${loc}[${i}]`, errors);
      }
    }
  }
}

function checkType(value: unknown, type: NonNullable<JsonSchema["type"]>): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      // reject NaN/Infinity — they pass `typeof`, but JSON.stringify turns them into null,
      // so a "valid number" would silently corrupt to null through the journal.
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}
