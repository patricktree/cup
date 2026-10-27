import { z } from "zod";

const LEAF_TYPES = new Set([
  "unknown",
  "string",
  "number",
  "boolean",
  "literal",
  "enum",
  "null",
  "undefined",
  "never",
]);

/**
 * Rebuilds a tolerant response schema so that every nested object rejects unknown keys, keeping
 * every other check. Clients parse listener responses tolerantly; tests use this strict variant so
 * that a field the contract does not declare fails in CI instead of reaching listeners.
 */
export function toStrictSchema<Schema extends z.core.$ZodType>(schema: Schema): Schema {
  if (schema instanceof z.ZodObject) {
    const shape = Object.fromEntries(
      Object.entries(schema.def.shape).map(([key, value]) => [key, toStrictSchema(value)]),
    );
    return schema.clone({ ...schema.def, shape, catchall: z.never() });
  }
  if (schema instanceof z.ZodUnion) {
    return schema.clone({ ...schema.def, options: schema.def.options.map(toStrictSchema) });
  }
  if (schema instanceof z.ZodArray) {
    return schema.clone({ ...schema.def, element: toStrictSchema(schema.def.element) });
  }
  if (schema instanceof z.ZodOptional) {
    return schema.clone({ ...schema.def, innerType: toStrictSchema(schema.def.innerType) });
  }
  if (schema instanceof z.ZodNullable) {
    return schema.clone({ ...schema.def, innerType: toStrictSchema(schema.def.innerType) });
  }
  // Clients preprocess away values they do not know; a response must still send only declared ones.
  if (schema instanceof z.ZodPipe && schema.def.in instanceof z.ZodTransform) {
    return schema.clone({ ...schema.def, in: z.unknown(), out: toStrictSchema(schema.def.out) });
  }
  // A schema from another zod instance would fail every check above and stay tolerant.
  if (!(schema instanceof z.ZodType)) {
    throw new Error("Cannot make a schema from another zod instance strict");
  }
  if (LEAF_TYPES.has(schema.def.type)) {
    return schema;
  }
  // A schema kind without a rule here would stay tolerant.
  throw new Error(`Cannot make a "${schema.def.type}" schema strict`);
}
