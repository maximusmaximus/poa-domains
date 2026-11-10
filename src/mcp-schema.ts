/** One JSON Schema source for MCP action inputs (permanent-ownership surface only). */
export type Schema = Record<string, any>;
export const objectSchema = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const STRING: Schema = { type: "string", maxLength: 256 };
export const NAME: Schema = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  examples: ["alpha", "agent.alpha", "👍"],
};
export const ID: Schema = { type: "string", pattern: "^[a-f0-9]{64}$" };
export const PRINCIPAL: Schema = {
  type: "string",
  maxLength: 80,
  pattern: "^(ed25519:[a-f0-9]{64}|poa1[1-9A-HJ-NP-Za-km-z]{32,50})$",
};
export const UINT: Schema = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};
export const AMOUNT: Schema = {
  type: "string",
  pattern: "^(0|[1-9][0-9]{0,38})$",
  examples: ["1000"],
};
const ASSET: Schema = {
  type: "string",
  minLength: 1,
  maxLength: 16,
  examples: ["POA"],
  description:
    "Use an asset advertised by this registry's capabilities; TEST exists only in local fixtures.",
};
const METADATA = objectSchema({
  cid: { type: "string", maxLength: 128 },
  document: objectSchema({
    schema: { const: "poa-domains.metadata.v1" },
    name: NAME,
    rightsHash: ID,
    description: { type: "string", maxLength: 2048 },
  }),
});
const resource = { auctionId: ID, expectedVersion: UINT };
const deed = { name: NAME, expectedDeedId: ID, expectedVersion: UINT };
const RECORD: Schema = {
  oneOf: [
    objectSchema({
      type: { const: "service" },
      url: { type: "string", format: "uri", maxLength: 2048 },
    }),
    objectSchema({ type: { const: "wallet" }, chain: STRING, address: STRING }),
    objectSchema({ type: { const: "ipfs" }, cid: STRING }),
  ],
};
export const ACTION_SCHEMAS: Record<string, Schema> = {
  announceAuction: objectSchema({
    name: NAME,
    asset: ASSET,
    reserve: AMOUNT,
    openAt: UINT,
    expectedVersion: UINT,
    expectedDeedId: { anyOf: [ID, { type: "null" }] },
    metadata: METADATA,
  }),
  bid: objectSchema({
    ...resource,
    asset: ASSET,
    amount: AMOUNT,
    beneficiary: PRINCIPAL,
  }),
  finalize: objectSchema(resource),
  closeNoBid: objectSchema(resource),
  cancelAuction: objectSchema(resource),
  withdrawRefund: objectSchema({ ...resource, asset: ASSET, amount: AMOUNT }),
  createChildOffer: objectSchema({
    parent: NAME,
    parentDeedId: ID,
    expectedOwnerVersion: UINT,
    asset: ASSET,
    price: AMOUNT,
    validUntil: UINT,
    rights: objectSchema({ kind: { const: "permanent" } }),
    labels: {
      anyOf: [{ type: "null" }, { type: "array", items: NAME, maxItems: 256 }],
    },
    maxUses: { type: "integer", minimum: 1, maximum: 1000000 },
  }),
  fillChildOffer: objectSchema({
    offerId: ID,
    expectedVersion: UINT,
    expectedGeneration: UINT,
    label: NAME,
    asset: ASSET,
    amount: AMOUNT,
    metadata: METADATA,
  }),
  cancelOffer: objectSchema({ offerId: ID, expectedVersion: UINT }),
  sellFixed: objectSchema({
    ...deed,
    asset: { const: "POA" },
    price: AMOUNT,
    validUntil: UINT,
  }),
  buyFixed: objectSchema({
    offerId: ID,
    expectedVersion: UINT,
    asset: ASSET,
    amount: AMOUNT,
  }),
  transfer: objectSchema({ ...deed, recipient: PRINCIPAL }),
  setRecords: objectSchema({
    ...deed,
    records: { type: "array", items: RECORD, maxItems: 32 },
  }),
  setMetadata: objectSchema({ ...deed, metadata: METADATA }),
  revokeChild: objectSchema({ ...deed, parentOwnerVersion: UINT }),
};
const common = {
  domain: { const: "poa-domains.local.intent.v1" },
  revision: STRING,
  chainId: STRING,
  genesisHash: ID,
  registryId: ID,
  policyHash: ID,
  normalizationHash: ID,
  signer: PRINCIPAL,
  coSigners: {
    type: "array",
    items: PRINCIPAL,
    maxItems: 3,
    uniqueItems: true,
  },
  requestId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" },
  nonce: UINT,
  notBefore: UINT,
  deadline: UINT,
  maxTotal: AMOUNT,
  maxNetworkFee: AMOUNT,
};
export const BODY_SCHEMA: Schema = {
  type: "object",
  oneOf: Object.entries(ACTION_SCHEMAS).map(([action, params]) =>
    objectSchema({ ...common, action: { const: action }, params }),
  ),
};
export const PACKET_SCHEMA: Schema = objectSchema({
  body: BODY_SCHEMA,
  signatures: {
    type: "object",
    minProperties: 1,
    maxProperties: 4,
    propertyNames: PRINCIPAL,
    additionalProperties: {
      type: "string",
      pattern: "^([a-f0-9]{128}|[1-9A-HJ-NP-Za-km-z]{64,100})$",
    },
  },
});
/** Deliberately small, eval-free validator for the schema keywords used above.
 * Tests cross-check it against Ajv 2020. No schemas are supplied by callers. */
export function matches(schema: Schema, value: any): boolean {
  if (
    schema.oneOf &&
    schema.oneOf.filter((s: Schema) => matches(s, value)).length !== 1
  )
    return false;
  if (schema.anyOf && !schema.anyOf.some((s: Schema) => matches(s, value)))
    return false;
  if (Object.hasOwn(schema, "const") && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type) {
    const ok =
      schema.type === "object"
        ? value !== null && typeof value === "object" && !Array.isArray(value)
        : schema.type === "array"
          ? Array.isArray(value)
          : schema.type === "integer"
            ? Number.isSafeInteger(value)
            : schema.type === "null"
              ? value === null
              : typeof value === schema.type;
    if (!ok) return false;
  }
  if (typeof value === "string") {
    if (
      value.length < (schema.minLength ?? 0) ||
      value.length > (schema.maxLength ?? Infinity)
    )
      return false;
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value))
      return false;
    if (schema.format === "uri")
      try {
        new URL(value);
      } catch {
        return false;
      }
  }
  if (
    typeof value === "number" &&
    (value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity))
  )
    return false;
  if (Array.isArray(value)) {
    if (
      value.length > (schema.maxItems ?? Infinity) ||
      value.length < (schema.minItems ?? 0)
    )
      return false;
    if (
      schema.uniqueItems &&
      new Set(value.map((v) => JSON.stringify(v))).size !== value.length
    )
      return false;
    if (schema.items && !value.every((v) => matches(schema.items, v)))
      return false;
  } else if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (
      keys.length > (schema.maxProperties ?? Infinity) ||
      keys.length < (schema.minProperties ?? 0)
    )
      return false;
    if (schema.required?.some((k: string) => !Object.hasOwn(value, k)))
      return false;
    for (const key of keys) {
      if (schema.propertyNames && !matches(schema.propertyNames, key))
        return false;
      const field =
        schema.properties && Object.hasOwn(schema.properties, key)
          ? schema.properties[key]
          : undefined;
      if (field) {
        if (!matches(field, value[key])) return false;
      } else if (schema.additionalProperties === false) return false;
      else if (
        typeof schema.additionalProperties === "object" &&
        !matches(schema.additionalProperties, value[key])
      )
        return false;
    }
  }
  return true;
}
