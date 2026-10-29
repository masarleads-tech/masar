import type { Schema } from "../ai/base";

/** Small helpers for strict JSON schemas (every property required, no extras). */
export const str: Schema = { type: "string" };
export const nstr: Schema = { type: ["string", "null"] };
export const nint: Schema = { type: ["integer", "null"] };
export const nbool: Schema = { type: ["boolean", "null"] };
export const int: Schema = { type: "integer" };
export const bool: Schema = { type: "boolean" };
export const arr = (items: Schema): Schema => ({ type: "array", items });
export const nenum = (values: string[]): Schema => ({ type: ["string", "null"], enum: [...values, null] });
export const enm = (values: string[]): Schema => ({ type: "string", enum: values });
export function obj(properties: Record<string, Schema>): Schema {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}
