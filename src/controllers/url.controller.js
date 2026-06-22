const { BASE_URL } = require("../config/env");
const {
  createShortUrl,
  getOriginalUrl,
  getUrlStats,
} = require("../services/url.service");
const asyncHandler = require("../utils/asynchandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

const { shortenResponseSchema } = require("../validators/url.validator");

const shorten = asyncHandler(async (req, res) => {
  const { url } = req.body;

  const code = await createShortUrl(url);

  const responseData = {
    code,
    short_url: `${BASE_URL}/${code}`,
  };

  shortenResponseSchema.parse(responseData);

  const response = new ApiResponse(201, responseData);

  res.status(response.statusCode).json(response);
});

const redirect = asyncHandler(async (req, res) => {
  const { code } = req.params;

  const original_url = await getOriginalUrl(code);

  if (!original_url) {
    throw new ApiError(404, "code not found");
  }

  return res.redirect(301, original_url);
});

const getStats = asyncHandler(async (req, res) => {
  const { code } = req.params;

  const stats = await getUrlStats(code);

  if (!stats) {
    throw new ApiError(404, "URL not found");
  }

  const responseData = {
    code: stats.short_code,
    original_url: stats.original_url,
    clicks: stats.clicks,
    created_at: stats.created_at,
    is_expired: stats.is_expired,
    expires_at: stats.expires_at,
  };

  const response = new ApiResponse(200, responseData);
  res.status(response.statusCode).json(response);
});

module.exports = { shorten, redirect, getStats };
