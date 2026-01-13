import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ---------------- ROOT ----------------
app.get("/", (req, res) => {
  res.send("Sindhudurg Education API running");
});

// ---------------- TALUKA FORM DATA ----------------
app.get("/taluka/form-data", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.json([]);

    const token = auth.replace("Bearer ", "");

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(token);

    if (userError || !user) return res.json([]);

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("taluka_id")
      .eq("user_id", user.id)
      .single();

    if (!profile) return res.json([]);

    const { month, year } = req.query;

    const { data, error } = await supabase
      .from("sanctioned_posts")
      .select(`
        post_category_id,
        sanctioned,
        post_categories!sanctioned_posts_post_category_id_fkey(name),
        monthly_filled!left(filled, month, year)
      `)
      .eq("taluka_id", profile.taluka_id);

    if (error || !Array.isArray(data)) {
      console.error(error);
      return res.json([]);
    }

    const rows = data.map(r => {
      const record = r.monthly_filled?.find(
        m => m.month == month && m.year == year
      );

      const filled = record?.filled || 0;

      return {
        category_id: r.post_category_id,
        category: r.post_categories.name,
        sanctioned: r.sanctioned,
        filled,
        vacant: r.sanctioned - filled
      };
    });

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.json([]);
  }
});


// ---------------- TALUKA SUBMIT ----------------
app.post("/taluka/submit", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "No token" });

    const token = auth.replace("Bearer ", "");

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return res.status(401).json({ error: "Invalid user" });
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("taluka_id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return res.status(400).json({ error: "No taluka mapping" });
    }

    const { month, year, data } = req.body;

    const { data: lock } = await supabase
      .from("month_locks")
      .select("locked")
      .eq("month", month)
      .eq("year", year)
      .single();

    if (lock?.locked) {
      return res.status(403).json({ error: "Month is locked" });
    }

    // Delete previous entries
    await supabase
      .from("monthly_filled")
      .delete()
      .eq("taluka_id", profile.taluka_id)
      .eq("month", month)
      .eq("year", year);

    // Insert new ones
    for (const row of data) {
      await supabase.from("monthly_filled").insert({
        taluka_id: profile.taluka_id,
        post_category_id: row.category_id,
        month,
        year,
        filled: row.filled
      });
    }

    res.json({ status: "saved" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});


// ---------------- DISTRICT SUMMARY ----------------
app.get("/district/summary", async (req, res) => {
  const { month, year } = req.query;

  const { data, error } = await supabase
    .from("district_summary_view")
    .select("*")
    .eq("month", month)
    .eq("year", year);

  if (error) return res.status(500).json(error);
  res.json(data);
});

// ---------------- DISTRICT REPORT ----------------
app.get("/district/report", async (req, res) => {
  const { month, year } = req.query;

  const { data, error } = await supabase
    .from("district_report")
    .select("taluka, category, sanctioned, filled, vacant, vacancy_percent")
    .eq("month", month)
    .eq("year", year)
    .order("taluka")
    .order("category");

  if (error) return res.status(500).json(error);
  res.json(data);
});

// ---------------- PENDING TALUKAS ----------------
app.get("/district/pending", async (req, res) => {
  const { month, year } = req.query;

  const { data, error } = await supabase
    .from("district_pending_view")
    .select("taluka")
    .eq("month", month)
    .eq("year", year);

  if (error) return res.status(500).json(error);
  res.json(data);
});

// ---------------- CATEGORY TOTALS ----------------
app.get("/district/category-totals", async (req, res) => {
  const { data, error } = await supabase
    .from("district_category_totals")
    .select("*");

  if (error) return res.status(500).json(error);
  res.json(data);
});


// ---------------- ADMIN MONTH CONTROL ----------------

// Check if month is locked
app.get("/admin/month-status", async (req, res) => {
  const { month, year } = req.query;

  const { data, error } = await supabase
    .from("month_locks")
    .select("locked")
    .eq("month", month)
    .eq("year", year)
    .single();

  if (error) return res.json({ locked: false });

  res.json({ locked: data.locked });
});


// Lock month
app.post("/admin/lock-month", async (req, res) => {
  const { month, year } = req.body;

  await supabase
    .from("month_locks")
    .upsert({ month, year, locked: true });

  res.json({ status: "locked" });
});


// Unlock month
app.post("/admin/unlock-month", async (req, res) => {
  const { month, year } = req.body;

  await supabase
    .from("month_locks")
    .upsert({ month, year, locked: false });

  res.json({ status: "unlocked" });
});


// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
