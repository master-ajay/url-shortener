const { z } = require("zod");

// Request body Validation
const shortenUrlSchema = z.object({
  body: z.object({
    url: z.string().min(1, "URL is required").url("Invalid URL format"),
    custom_code: z
      .string()
      .min(3, "Code must have atleast 3 characters")
      .max(10, "Code must have max 10 characters")
      .regex(/^[a-zA-Z0-9]*$/, "Code must contain only lowercase letters and numbers")
      .optional(),
  }),
});

// Params Validation
const redirectSchema = z.object({
  params: z.object({
    code: z.string().min(3, "Code too short").max(10, "Code too long"),
  }),
});

// Params Validation
const statsSchema = z.object({
  params: z.object({
    code: z.string().min(3, "Code too short").max(10, "Code too long"),
  }),
});

// Response Validation (success is added by ApiResponse, don't include here)
const shortenResponseSchema = z.object({
  code: z.string(),
  short_url: z.string().url(),
});

module.exports = {
  shortenUrlSchema,
  redirectSchema,
  statsSchema,
  shortenResponseSchema,
};
