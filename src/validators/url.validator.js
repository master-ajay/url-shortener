const { z } = require("zod");

// Request body Validation
const shortenUrlSchema = z.object({
  body: z.object({
    url: z.string().min(1, "URL is required").url("Invalid URL format"),
  }),
});

// Params Validation
const redirectSchema = z.object({
  params: z.object({
    code: z.string().min(3, "Code too short").max(20, "Code too long"),
  }),
});

// Response Validation
const shortenResponseSchema = z.object({
  success: z.boolean(),
  code: z.string(),
  short_url: z.string().url(),
});

module.exports = {
  shortenUrlSchema,
  redirectSchema,
  shortenResponseSchema,
};
