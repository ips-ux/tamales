// Codec for the typed values of the Firestore REST API.
// https://firebase.google.com/docs/firestore/reference/rest/v1/Value

export type FirestoreValue = Record<string, unknown>;
export type FirestoreFields = Record<string, FirestoreValue>;

export function encodeValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  throw new Error(`Cannot encode a ${typeof value} for Firestore.`);
}

/** Encodes an object. It drops keys that have the value `undefined`. */
export function encodeFields(data: Record<string, unknown>): FirestoreFields {
  const fields: FirestoreFields = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) fields[key] = encodeValue(value);
  }
  return fields;
}

export function decodeValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("stringValue" in value) return String(value.stringValue);
  // A timestamp decodes to its ISO text. The application stores times as ISO text.
  if ("timestampValue" in value) return String(value.timestampValue);
  if ("referenceValue" in value) return String(value.referenceValue);
  if ("bytesValue" in value) return String(value.bytesValue);
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) {
    const values = (value.arrayValue as { values?: FirestoreValue[] } | null)?.values ?? [];
    return values.map(decodeValue);
  }
  if ("mapValue" in value) {
    return decodeFields((value.mapValue as { fields?: FirestoreFields } | null)?.fields);
  }
  return null;
}

export function decodeFields(fields: FirestoreFields | undefined): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) data[key] = decodeValue(value);
  return data;
}
