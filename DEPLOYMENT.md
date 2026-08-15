# Millers Hollow Online - Deployment Guide

## Quick Start - Local Testing (Windows)

### Prerequisites
- Node.js 20+ installed
- npm or pnpm

### Setup & Run

```powershell
# Install dependencies
npm install

# Development mode (server + client with hot reload)
npm run dev:full

# Production build
npm run build

# Start server (after build)
npm start
```

Server will run at `http://localhost:3001`  
Share the room link with your friends!

---

## Production Deployment

### Option 1: **Render.com** (Recommended - Free Tier Available)

1. **Push code to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/your-username/millers-hollow.git
   git push -u origin main
   ```

2. **Deploy to Render:**
   - Go to [render.com](https://render.com)
   - Sign up with GitHub
   - Click "New +"  → "Web Service"
   - Connect your repository
   - Render will auto-detect `render.yaml`
   - Set environment: `NODE_ENV=production`
   - Deploy!

3. **Your game will be live at:** `https://millers-hollow-XXXX.onrender.com`

**Free Tier Limits:**
- Free tier spins down after 15 minutes of inactivity (ok for casual play)
- Upgrade to Starter ($7/month) for always-on

---

### Option 2: **Railway.app** (Fast & Simple)

1. **Connect GitHub & Deploy:**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub
   - Create new project → Deploy from GitHub
   - Select your repository
   - Railway auto-detects Node.js project
   - Add environment: `NODE_ENV=production`
   - Done!

2. **Your game runs at:** `https://<your-project>.up.railway.app`

**Railway Free Tier:** $5/month free credits

---

### Option 3: **Heroku** (Classic)

```bash
# Install Heroku CLI
npm install -g heroku

# Login
heroku login

# Create app
heroku create millers-hollow-game

# Deploy from GitHub
git push heroku main

# View logs
heroku logs --tail

# Your game is at: https://millers-hollow-game.herokuapp.com
```

**Note:** Heroku discontinued free tier in 2022. Hobby dynos start at $7/month.

---

### Option 4: **Docker + VPS** (Full Control)

#### Build & Test Locally

```bash
docker build -t millers-hollow .
docker run -p 3001:3001 -e NODE_ENV=production millers-hollow
```

#### Deploy to VPS (DigitalOcean, Linode, etc.)

1. **SSH into your server:**
   ```bash
   ssh root@your.server.ip
   ```

2. **Install Docker:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

3. **Clone & deploy:**
   ```bash
   git clone https://github.com/your-username/millers-hollow.git
   cd millers-hollow
   docker build -t millers-hollow .
   docker run -d -p 80:3001 --restart always --name game millers-hollow
   ```

4. **Your game runs at:** `http://your.server.ip`

---

## Environment Variables

Create `.env` file in root (ignored by git):

```
NODE_ENV=production
PORT=3001
```

**Render/Railway:** Add these in their dashboard UI (Web Service settings)

---

## Monitoring & Logs

### Local Development
```powershell
npm run dev:full
```

### Production (after deploy)

**Render:**
- Dashboard → Your service → "Logs" tab
- Live streaming logs visible

**Railway:**
- Dashboard → Your project → "Logs"
- Real-time monitoring

**Docker/VPS:**
```bash
docker logs -f game
```

---

## Troubleshooting

### "Port already in use"
```powershell
Get-NetTCPConnection -LocalPort 3001  # Check what's using port
Stop-Process -Id <PID> -Force         # Kill the process
```

### Build fails on cloud
- Ensure `npm ci` (not `npm install`) in Dockerfile ✓
- Check Node version: `node -v` should show 20+
- Verify all dependencies in `package.json`

### Client can't connect to server
- Ensure Socket.io URL matches your deployment domain
- Cloud platforms handle this auto-magically via reverse proxy
- Check firewall: port 3001 should be accessible

### Game resets on deploy
- That's expected! Game state is in-memory (by design)
- For persistence, add a database later
- Session tokens help with rejoins

---

## Performance Tips

1. **Monitor server resources:**
   - Render shows CPU/RAM usage in dashboard
   - Railway has built-in monitoring

2. **Scale rooms:**
   - Current server handles ~50-100 concurrent games
   - Each room uses ~10KB memory (very efficient!)

3. **CDN (Optional):**
   - Static assets (CSS, JS) are cached by default
   - Consider Cloudflare for additional performance

---

## Next Steps

1. **Local Testing:** `npm run dev:full` on your PC
2. **Push to GitHub:** Get your code in version control
3. **Deploy:** Choose Render/Railway/Heroku and connect
4. **Share:** Invite friends with your deployment URL!
5. **Monitor:** Check logs as players join

---

## Support

- **Issues?** Check the Troubleshooting section above
- **Questions?** Review your platform's documentation (Render, Railway, etc.)
- **Feature requests?** The code is ready for future enhancements

Happy gaming! 🎮
