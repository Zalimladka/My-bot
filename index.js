const express = require("express");
const bodyParser = require("body-parser");
const { login } = require("ws3-fca");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

let api = null;

// Web panel form
app.get("/", (req, res) => {
  res.send(`
    <h2>🚀 Facebook Group Bot Panel</h2>
    <form method="POST" action="/start">
      <label><b>EAAB Token:</b></label><br>
      <input type="text" name="token" style="width:400px"><br><br>

      <label><b>Group ID:</b></label><br>
      <input type="text" name="group" style="width:400px"><br><br>

      <label><b>New Group Name:</b></label><br>
      <input type="text" name="gname" style="width:400px"><br><br>

      <label><b>Your Nickname:</b></label><br>
      <input type="text" name="nickname" style="width:400px"><br><br>

      <button type="submit">✅ Start Bot</button>
    </form>
  `);
});

// Bot start
app.post("/start", async (req, res) => {
  const { token, group, gname, nickname } = req.body;

  if (!token || !group) {
    return res.send("❌ Token aur Group ID required hai!");
  }

  // FB login
  login({ appState: token }, (err, apiResult) => {
    if (err) {
      console.error("Login failed:", err);
      return res.send("❌ Login Failed (Console check karo)");
    }

    api = apiResult;
    res.send("✅ Bot Started! Console logs check karo.");

    // Group name change
    api.setTitle(group, gname, (err) => {
      if (err) console.log("❌ Group rename failed:", err);
      else console.log(`✅ Group name changed to: ${gname}`);
    });

    // Nickname change (self user)
    api.changeNickname(nickname, group, api.getCurrentUserID(), (err) => {
      if (err) console.log("❌ Nickname change failed:", err);
      else console.log(`✅ Nickname changed to: ${nickname}`);
    });
  });
});

// Render port
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
