require("dotenv").config();

const express = require("express");
const router = express.Router();
const { logError } = require("./logs");

// Middleware: ensure user logged in
async function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect("/");
}

// Route for dashboard (or any page needing ads)
router.get("/dashboard", ensureAuthenticated, async (req, res) => {
  try {
    const enableAds = process.env.ENABLE_ADS === "true";

    const adData = {
      enableAds,
      adsenseClient: process.env.ADSENSE_CLIENT || "",
      adsenseSlot: process.env.ADSENSE_SLOT || "",
      adsterraSrc: process.env.ADSTERRA_SRC || ""
    };

    const user = await req.app.get("db").get(`user-${req.user.email}`);
    const admin = await req.app.get("db").get(`admin-${req.user.email}`);

    res.render("dashboard", {
      req,
      user: req.user,
      coins: user.coins,
      admin,
      name: process.env.APP_NAME,
      adData
    });
  } catch (error) {
    logError("Error rendering dashboard with ads", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

// Route for afk (with same ad support)
router.get("/afk", ensureAuthenticated, async (req, res) => {
  try {
    const enableAds = process.env.ENABLE_ADS === "true";

    const adData = {
      enableAds,
      adsenseClient: process.env.ADSENSE_CLIENT || "",
      adsenseSlot: process.env.ADSENSE_SLOT || "",
      adsterraSrc: process.env.ADSTERRA_SRC || ""
    };

    const user = await req.app.get("db").get(`user-${req.user.email}`);
    const admin = await req.app.get("db").get(`admin-${req.user.email}`);

    res.render("afk", {
      req,
      user: req.user,
      coins: user.coins,
      admin,
      name: process.env.APP_NAME,
      adData
    });
  } catch (error) {
    logError("Error rendering store with ads", error);
    res.redirect("/dashboard?err=INTERNALERROR");
  }
});

module.exports = router;