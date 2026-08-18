# 🎮 Millers Hollow Online - Quick Deploy Guide

## **Option A: Run Locally Right Now (2 minutes)**

### Windows PowerShell
```powershell
# First time: build the project
npm run build

# Start production server
npm start
```

**Then open:** http://localhost:3001 in your browser

**To stop:** Press `Ctrl+C` in terminal

---

## **Option B: Deploy to Cloud (10 minutes)**

### **Best for you:** Render.com (Free, No Credit Card)

1. **Create GitHub repo:**
   ```bash
   git init
   git add .
   git commit -m "Deploy Millers Hollow"
   git remote add origin https://github.com/YOUR-USERNAME/millers-hollow.git
   git push -u origin main
   ```

2. **Deploy:**
   - Go to https://render.com
   - Click "New" → "Web Service"
   - Choose your GitHub repo
   - Set name: `millers-hollow`
   - Auto-detects Dockerfile ✓
   - Click "Deploy"

3. **Done!** Your game is live in 3-5 minutes
   - URL: `https://millers-hollow-XXXX.onrender.com`
   - Share that link with friends!

---

## **What's Included**

✅ Full Werewolf game with 9 roles  
✅ Real-time multiplayer (Socket.io)  
✅ Rejoin recovery (5-minute tokens)  
✅ Host controls (kick, lock, preset roles)  
✅ Post-game summary (vote history, timeline)  
✅ Tutorial hints  
✅ Sound effects  
✅ Works on mobile too!  

---

## **Server Specs**

- **Language:** Node.js + TypeScript
- **Port:** 3001 (configurable)
- **Health check:** `/health` endpoint ✓
- **Memory:** ~50KB per game room
- **Max concurrent:** 100+ rooms simultaneously

---

## **Troubleshooting**

| Problem | Solution |
|---------|----------|
| "Port 3001 already in use" | Kill other process: `netstat -ano \| findstr 3001` |
| Build fails | Run: `npm ci` then `npm run build` |
| Can't connect | Check firewall allows port 3001 |
| Game stuck | Refresh page (session tokens auto-restore) |

---

## **Next Steps**

**Local (fastest to start):**
```powershell
npm start
# Open http://localhost:3001
# Invite friends via room code or URL
```

**Cloud (share worldwide):**
1. Push to GitHub
2. Connect to Render.com
3. Share your deployment URL
4. Friends can join from anywhere!

---

**Questions?** See `DEPLOYMENT.md` for detailed guides.
