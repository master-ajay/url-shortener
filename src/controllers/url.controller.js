const { BASE_URL } = require("../config/env");
const { createShortUrl, getOriginalUrl } = require("../services/url.service");
const asyncHandler = require("../utils/asynchandler");
const ApiError = require("../utils/ApiError");

const { shortenResponseSchema } = require("../validators/url.validator");

const shorten = asyncHandler(async (req, res) => {
  const { url } = req.body;

  const code = await createShortUrl(url);

  const response = {
    success: true,
    code,
    short_url: `${BASE_URL}/${code}`,
  };

  shortenResponseSchema.parse(response);

  res.status(201).json(response);
});

const redirect = asyncHandler(async (req, res) => {
  const { code } = req.params;

  const original_url = await getOriginalUrl(code);

  if (!original_url) {
    throw new ApiError(404, "code not found");
  }

  return res.redirect(301, original_url);
});

module.exports = { shorten, redirect };
