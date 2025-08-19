// index.js
const express = require("express");
const bodyParser = require("body-parser");
const { login } = require("ws3-fca");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

let api = null;

// Home Page - Form
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// Handle form submit
app.post("/start", (req, res) => {
  const { appState, groupId, groupName, nicknameId, nicknameText } = req.body;

  try {
    const token = JSON.parse(appState);

    login({ appState: token }, (err, apiResult) => {
      if (err) {
        return res.send("❌ Login failed: " + err.error || err);
      }

      api = apiResult;

      // Group rename
      api.setTitle(groupId, groupName, (err2) => {
        if (err2) console.log("Rename error:", err2);
        else console.log("✅ Group renamed:", groupName);
      });

      // Nickname set
      api.changeNickname(nicknameText, groupId, nicknameId, (err3) => {
        if (err3) console.log("Nickname error:", err3);
        else console.log("✅ Nickname set:", nicknameText);
      });

      return res.send(`
        ✅ Bot started successfully!<br>
        Group UID: ${groupId}<br>
        New Name: ${groupName}<br>
        Nickname Set: ${nicknameText}
      `);
    });
  } catch (e) {
    return res.send("❌ Invalid AppState JSON");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
