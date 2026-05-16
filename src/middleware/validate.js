const { ZodError } = require("zod");
const ApiResponse = require('../utils/ApiResponse')

const validate = (schema) => (req, res, next) => {
  try {
    schema.parse({
      body: req.body,
      params: req.params,
      query: req.query,
    });
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      const response = new ApiResponse(400, {
        success: false,
        errors: error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        })),
      });

      return res.status(response.statusCode).json(response);
    }

    next(error);
  }
};

module.exports = validate;
