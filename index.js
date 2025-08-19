const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const { login } = require("ws3-fca");

const app = express();
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static("public"));

app.post("/start", (req, res) => {
  const appstate = req.body.appstate;
  const groupId = req.body.groupId;
  const nicknames = req.body.nicknames.split(",");

  // Save appstate.json
  try {
    fs.writeFileSync("appstate.json", appstate);
  } catch (err) {
    return res.send("❌ Failed to save appstate.json: " + err);
  }

  // Login with new appstate
  login({ appState: JSON.parse(appstate) }, (err, api) => {
    if (err) return res.send("❌ Login error: " + err);

    res.send("✅ Bot started! Nicknames will be updated automatically.");

    // Change nickname for each member
    nicknames.forEach((nickname, i) => {
      setTimeout(() => {
        api.changeNickname(nickname.trim(), groupId, (e) => {
          if (e) console.log("Error:", e);
          else console.log("Nickname changed to:", nickname);
        });
      }, i * 5000); // delay each change
    });
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
