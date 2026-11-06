import { z } from "zod";
import {
  checkRequestSchema,
  checkResponseSchema,
  errorResponseSchema,
  modelSchema,
} from "../contracts/index.js";
const modelsResponseSchema = z.strictObject({
  default: modelSchema,
  models: z.array(
    z.strictObject({
      id: modelSchema,
      name: z.string(),
      provider: z.string(),
      configured: z.boolean(),
    }),
  ),
});

let cachedDocument: ReturnType<typeof buildOpenApiDocument> | undefined;

export function openApiDocument() {
  return (cachedDocument ??= buildOpenApiDocument());
}

function buildOpenApiDocument() {
  const schemas = {
    CheckRequest: z.toJSONSchema(checkRequestSchema, { io: "input" }),
    CheckResponse: z.toJSONSchema(checkResponseSchema),
    ErrorResponse: z.toJSONSchema(errorResponseSchema),
    ModelsResponse: z.toJSONSchema(modelsResponseSchema),
  };
  const errorResponses = Object.fromEntries(
    [400, 401, 408, 413, 415, 422, 429, 500, 502, 503, 504].map((status) => [
      status,
      {
        description: "Structured service error. No semantic verdict was produced.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
      },
    ]),
  );
  return {
    openapi: "3.1.0",
    info: {
      title: "Countercheck",
      version: "0.1.0",
      description:
        "Compare one claim with supplied snippets. Every result refers to submitted text, not a whole corpus. English evaluation preview; thresholds are not yet release-qualified.",
    },
    paths: {
      "/v1/models": {
        get: {
          operationId: "listModels",
          summary: "List supported hosted models and the default",
          description:
            "Public catalog; no inference is performed. Check requests default to pinned Jev 1.14 when model is omitted. An unavailable selected provider returns an error; there is no automatic model fallback.",
          responses: {
            200: {
              description: "Supported hosted models",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ModelsResponse" } },
              },
            },
          },
        },
      },
      "/health": {
        get: {
          summary: "Process liveness, without inference or dependency checks",
          responses: { 200: { description: "Worker is running" } },
        },
      },
      "/v1/check": {
        post: {
          operationId: "checkContradictions",
          summary: "Check one claim against each supplied comparison text",
          description:
            "Comparison texts are not checked against one another. The default balanced-v1 profile uses shared snippet context. Opt-in semantic-v2 and structured-value-v1 are experimental; each question carries its comparison privately with shared claim and rubric. Private question context reduces distractors but is not a security isolation guarantee. All profiles still require quality qualification. Inputs are never truncated. All comparisons complete atomically; uncertainty is a valid completed result. Verdicts appear only on comparisons, never at the request level. Requests use exactly one provider call and are not automatically retried or deduplicated.",
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/CheckRequest" } },
            },
          },
          responses: {
            200: {
              description: "All supplied comparisons assessed; this is not a proof of consistency",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/CheckResponse" } },
              },
            },
            ...errorResponses,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", bearerFormat: "Countercheck API key" },
      },
      schemas,
    },
  };
}
