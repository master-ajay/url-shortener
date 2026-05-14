const { BASE_URL } = require("../config/env");
const { createShortUrl, getOriginalUrl } = require("../services/url.service");

const shorten = asyncHandler(async (req, res) => {
  const { url } = req.body;

  if (!url) {
    throw new ApiError(400, "url is required");
  }

  const code = await createShortUrl(url);

  res.status(201).json({
    success: true,
    code,
    short_url: `${BASE_URL}/${code}`,
  });
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
