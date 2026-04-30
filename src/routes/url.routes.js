const { Router } = require("express");
const { shorten, redirect } = require("../controllers/url.controller");

let router = Router();

router.post("/shorten", shorten);
router.get("/redirect/:code", redirect);

module.exports = router;
