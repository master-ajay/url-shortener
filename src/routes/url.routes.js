const { Router } = require("express");
const { shorten, redirect,getStats } = require("../controllers/url.controller");

const validate = require("../middleware/validate");
const {
  shortenUrlSchema,
  redirectSchema,
  statsSchema
} = require("../validators/url.validator");

const router = Router();

router.post("/shorten", validate(shortenUrlSchema), shorten);
router.get("/stats/:code", validate(statsSchema), getStats);
router.get("/:code", validate(redirectSchema), redirect);

module.exports = router;
