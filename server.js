const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Supabase is optional during the first UI deployment.
// Once the environment variables are added in Render, the API will use it.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "medical-booking",
    database: supabase ? "supabase" : "not-configured"
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    appName: "موعدي",
    currency: "جنيه سوداني",
    databaseConfigured: Boolean(supabase)
  });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Medical Booking server running on port ${PORT}`);
});
