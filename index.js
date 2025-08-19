const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const { login } = require("ws3-fca");

const app = express();
const port = process.env.PORT || 10000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

let api = null;

// ✅ Facebook login
login({ appState: JSON.parse(fs.readFileSync("appstate.json", "utf8")) }, (err, fbApi) => {
    if (err) return console.error("❌ Login error:", err);
    api = fbApi;
    console.log("✅ Logged in!");
});

// ✅ Handle form submit
app.post("/start", async (req, res) => {
    if (!api) return res.send("❌ Bot not logged in yet!");

    const groupId = req.body.groupId;
    const newName = req.body.groupName;
    const nicknameInput = req.body.nickname;

    try {
        // 🔹 Group Name change
        if (newName && newName.trim() !== "") {
            await api.changeGroupName(newName, groupId);
            console.log(`✅ Group name changed to: ${newName}`);
        }

        // 🔹 Nickname logic
        let nicknames = [];
        if (!nicknameInput || nicknameInput.trim() === "") {
            // file se nicknames load
            if (fs.existsSync("nicknames.txt")) {
                nicknames = fs.readFileSync("nicknames.txt", "utf8").split("\n").filter(n => n.trim());
            }
        }

        const threadInfo = await api.getThreadInfo(groupId);
        const participants = threadInfo.participantIDs;

        let i = 0;
        for (let user of participants) {
            let nicknameToSet = nicknameInput && nicknameInput.trim() !== "" ? nicknameInput : (nicknames[i % nicknames.length] || "BotUser");
            await api.changeNickname(nicknameToSet, groupId, user);
            console.log(`✅ Changed nickname for ${user} -> ${nicknameToSet}`);
            i++;
        }

        res.send("✅ Group updated successfully!");
    } catch (e) {
        console.error("❌ Error:", e);
        res.send("❌ Something went wrong: " + e.message);
    }
});

app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});
