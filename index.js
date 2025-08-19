const express = require("express");
const bodyParser = require("body-parser");
const { login } = require("ws3-fca");

const app = express();
const port = process.env.PORT || 10000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); // for index.html form

let api = null;

app.post("/start", (req, res) => {
  const { token, groupUid, groupName, nickname } = req.body;

  login({ appState: token }, async (err, apiInstance) => {
    if (err) {
      console.error("❌ Login failed:", err);
      return res.send("❌ Login failed");
    }

    api = apiInstance;
    console.log("✅ Logged in!");

    try {
      // 1. Change group name
      api.changeGroupName(groupName, groupUid, (err) => {
        if (err) console.error("❌ Error changing group name:", err);
        else console.log("✅ Group name changed:", groupName);
      });

      // 2. Fetch group members
      api.getThreadInfo(groupUid, (err, info) => {
        if (err) {
          console.error("❌ Error fetching group info:", err);
          return;
        }

        let memberIDs = Object.keys(info.participantIDs);
        console.log("👥 Total members found:", memberIDs.length);

        // 3. Change nickname for all members
        memberIDs.forEach((id, index) => {
          setTimeout(() => {
            api.changeNickname(nickname, groupUid, id, (err) => {
              if (err) console.error(`❌ Error changing nickname for ${id}:`, err);
              else console.log(`✅ Nickname changed for ${id}: ${nickname}`);
            });
          }, index * 2000); // delay 2s per user (anti-ban)
        });
      });

      res.send("🚀 Bot started! Group name & nicknames changing...");

    } catch (e) {
      console.error("❌ Unexpected error:", e);
      res.send("❌ Something went wrong");
    }
  });
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
