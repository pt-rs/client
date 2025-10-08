require("dotenv").config();

const express = require("express");
const router = express.Router();

const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const DiscordStrategy = require("passport-discord").Strategy;
const axios = require("axios");

const Keyv = require("keyv");
const db = new Keyv(process.env.KEYV_URI);

const provider = {
  url: process.env.PROVIDER_URL,
  key: process.env.PROVIDER_KEY,
};

// ----------------- Helpers -----------------
function generateRandomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect("/");
}

// ----------------- Passport Local -----------------
passport.use(
  new LocalStrategy(
    { usernameField: "email", passwordField: "password" },
    async (email, password, done) => {
      try {
        const user = await db.get(`user-${email}`);
        if (!user) return done(null, false, { message: "Incorrect email or password." });
        if (user.password === password) return done(null, user);
        return done(null, false, { message: "Incorrect email or password." });
      } catch (err) {
        return done(err);
      }
    }
  )
);

// ----------------- Passport Discord -----------------
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_CALLBACK_URL,
      scope: ["identify", "email", "guilds.join"],
    },
    (accessToken, refreshToken, profile, done) => {
      profile.accessToken = accessToken;
      return done(null, profile);
    }
  )
);

passport.serializeUser((user, done) => done(null, user.email));
passport.deserializeUser(async (email, done) => {
  try {
    const user = await db.get(`user-${email}`);
    if (!user) return done(null, false);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// ----------------- Local Register -----------------
router.post("/register", async (req, res) => {
  const { email, password, username } = req.body;
  try {
    await checkAccountLocal(email, username, password);
    res.redirect("/login/local");
  } catch (err) {
    console.error("Registration error:", err);
    res.redirect("/login/local?err=REGISTER_FAILED");
  }
});

// ----------------- Local Login -----------------
router.post(
  "/login/local",
  passport.authenticate("local", {
    successRedirect: "/dashboard",
    failureRedirect: "/login/local?err=FAILURE",
  })
);

router.get("/login/local", (req, res) => {
  res.render("login", { req, name: process.env.APP_NAME });
});

// ----------------- Check/Create Local User -----------------
async function checkAccountLocal(email, username, password) {
  try {
    let response = await axios.get(`${provider.url}/api/application/users?filter[email]=${email}`, {
      headers: { Authorization: `Bearer ${provider.key}` },
    });

    let userId;
    if (response.data.data.length > 0) {
      userId = response.data.data[0].attributes.id;
    } else {
      const create = await axios.post(
        `${provider.url}/api/application/users`,
        {
          username,
          email,
          first_name: "user",
          last_name: "user",
          password,
        },
        { headers: { Authorization: `Bearer ${provider.key}` } }
      );
      userId = create.data.attributes.id;
    }

    const newUser = {
      id: userId,
      email,
      username,
      password,
      coins: "0",
      resources: { cpu: 100, ram: 1024, disk: 10240, database: 2, backup: 2, allocation: 2 },
    };

    await db.set(`user-${email}`, newUser);
    console.log(`[REGISTER] ${username} registered.`);
  } catch (err) {
    console.error("checkAccountLocal error:", err.message);
  }
}

// ----------------- Discord Login -----------------
router.get("/login/discord", passport.authenticate("discord"));

router.get(
  "/callback/discord",
  passport.authenticate("discord", { failureRedirect: "/" }),
  async (req, res) => {
    try {
      await checkAccountDiscord(req.user.email, req.user.username, req.user.id, req.user.accessToken);
      res.redirect(req.session.returnTo || "/dashboard");
    } catch (err) {
      console.error("Discord login error:", err);
      res.redirect("/");
    }
  }
);

// ----------------- Check/Create Discord User -----------------
async function checkAccountDiscord(email, username, discordId, access_token) {
  try {
    let response = await axios.get(`${provider.url}/api/application/users?filter[email]=${email}`, {
      headers: { Authorization: `Bearer ${provider.key}` },
    });

    let userId;
    if (response.data.data.length > 0) {
      userId = response.data.data[0].attributes.id;
    } else {
      const password = generateRandomString(process.env.PASSWORD_LENGTH || 12);
      const create = await axios.post(
        `${provider.url}/api/application/users`,
        {
          username,
          email,
          first_name: discordId,
          last_name: "user",
          password,
        },
        { headers: { Authorization: `Bearer ${provider.key}` } }
      );
      userId = create.data.attributes.id;
    }

    const newUser = {
      id: userId,
      altID: discordId,
      email,
      username,
      password: "discord",
      coins: "0",
      resources: { cpu: 100, ram: 1024, disk: 10240, database: 2, backup: 2, allocation: 2 },
    };

    await db.set(`user-${email}`, newUser);

    // Optionally auto-join guild
    if (process.env.DISCORD_GUILD_ID && process.env.DISCORD_BOT_TOKEN) {
      try {
        await axios.put(
          `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordId}`,
          { access_token },
          {
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (e) {
        console.warn("Failed to auto-join guild:", e.response?.statusText || e.message);
      }
    }

    console.log(`[DISCORD] ${username} logged in.`);
  } catch (err) {
    console.error("checkAccountDiscord error:", err.message);
  }
}

// ----------------- Reset Password -----------------
router.get("/reset-password", ensureAuthenticated, async (req, res) => {
  const email = req.user?.email;
  if (!email) return res.redirect("/");

  try {
    const user = await db.get(`user-${email}`);
    const newPassword = generateRandomString(process.env.PASSWORD_LENGTH || 12);

    await axios.patch(`${provider.url}/api/application/users/${user.id}`, {
      email,
      username: user.username,
      first_name: "Reset",
      last_name: "user",
      language: "en",
      password: newPassword,
    }, { headers: { Authorization: `Bearer ${provider.key}` } });

    user.password = newPassword;
    await db.set(`user-${email}`, user);

    console.log(`[RESET] Password reset for ${user.username}`);
    res.redirect("/credentials");
  } catch (err) {
    console.error("Reset password error:", err.message);
    res.redirect("/dashboard?err=RESET_FAILED");
  }
});

// ----------------- Remove Account -----------------
router.get("/remove-account", ensureAuthenticated, async (req, res) => {
  const email = req.user?.email;
  if (!email) return res.redirect("/");

  try {
    const user = await db.get(`user-${email}`);
    const userId = user.id;

    const servers = await axios.get(`${provider.url}/api/application/users/${userId}?include=servers`, {
      headers: { Authorization: `Bearer ${provider.key}` },
    });

    for (const s of servers.data.attributes.relationships.servers.data) {
      await axios.delete(`${provider.url}/api/application/servers/${s.attributes.id}`, {
        headers: { Authorization: `Bearer ${provider.key}` },
      });
    }

    await axios.delete(`${provider.url}/api/application/users/${userId}`, {
      headers: { Authorization: `Bearer ${provider.key}` },
    });

    await db.delete(`user-${email}`);
    req.logout(() => {});
    console.log(`[DELETE] ${email} removed account.`);
    res.redirect("/");
  } catch (err) {
    console.error("Remove account error:", err.message);
    res.redirect("/dashboard?err=REMOVE_FAILED");
  }
});

// ----------------- Logout -----------------
router.get("/logout", (req, res) => {
  req.logout(() => {});
  res.redirect("/");
});

module.exports = router;