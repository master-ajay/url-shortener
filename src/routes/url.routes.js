const { Router } = require("express");
const { shorten, redirect } = require("../controllers/url.controller");

const validate = require("../middleware/validate");
const {
  shortenUrlSchema,
  redirectSchema,
} = require("../validators/url.validator");

const router = Router();

router.post("/shorten", validate(shortenUrlSchema), shorten);
router.get("/:code", validate(redirectSchema), redirect);

module.exports = router;
