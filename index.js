const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs-extra");
const { login } = require("ws3-fca");
const path = require("path");

const app = express();
const port = process.env.PORT || 5000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

// User data file
const USERS_FILE = "users.json";

// Load all users
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

// Save all users
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// 🟢 Show homepage
app.get("/", (req, res) => {
  const users = loadUsers();
  res.render("index", { users });
});

// 🟢 Handle login
app.post("/login", async (req, res) => {
  const { name, cookie } = req.body;

  if (!name || !cookie) {
    return res.send("⚠️ Name aur Cookie dono required hai!");
  }

  try {
    // Save user in users.json
    let users = loadUsers();
    users.push({ name, cookie, time: new Date().toISOString() });
    saveUsers(users);

    // Test login
    login({ appState: JSON.parse(cookie) }, (err, api) => {
      if (err) {
        console.error(err);
        return res.send("❌ Cookie invalid hai ya login fail!");
      }

      res.send(`✅ ${name} added successfully!`);
    });
  } catch (e) {
    console.error(e);
    res.send("❌ Cookie format galat hai!");
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
