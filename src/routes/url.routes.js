const { Router } = require("express");
const { shorten, redirect } = require("../controllers/url.controller");

const router = Router();

router.post("/shorten", shorten);
router.get("/:code", redirect);

module.exports = router;
