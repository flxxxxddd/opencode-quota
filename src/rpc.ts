import { Rpc } from "@opencode/plugin/rpc"

export const QuotaRpc = Rpc.define({
  id: "whosydd.quota",
  methods: {
    snapshot: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: {
          providers: { type: "array", items: { type: "object", additionalProperties: true } },
          errors: { type: "array", items: { type: "string" } },
        },
        required: ["providers", "errors"],
        additionalProperties: false,
      },
    },
    redeem: {
      input: {
        type: "object",
        properties: { credentialID: { type: "string" }, creditID: { type: "string" } },
        required: ["credentialID", "creditID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
  events: {},
} as const)
