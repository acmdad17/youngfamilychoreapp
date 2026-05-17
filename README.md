# Young Family Dashboard

A family schedule, chores, and weather dashboard — installable as a Progressive Web App (PWA) with push notifications.

## Files
- `index.html` — The main dashboard
- `sw.js` — Service worker (enables offline use + notifications)
- `manifest.json` — PWA manifest (enables "Add to Home Screen")

## How to Deploy on GitHub Pages (Free Hosting)

### Step 1 — Create a GitHub account
Go to https://github.com and sign up if you don't have one.

### Step 2 — Create a new repository
1. Click the **+** button (top right) → **New repository**
2. Name it something like `young-family-dashboard`
3. Set it to **Public**
4. Click **Create repository**

### Step 3 — Upload the files
1. On your new repo page, click **Add file** → **Upload files**
2. Drag and drop all three files: `index.html`, `sw.js`, `manifest.json`
3. Scroll down and click **Commit changes**

### Step 4 — Enable GitHub Pages
1. Go to your repo's **Settings** tab
2. Click **Pages** in the left sidebar
3. Under **Branch**, select `main` and `/ (root)`
4. Click **Save**

### Step 5 — Access your dashboard
After a minute or two, your dashboard will be live at:
`https://YOUR-USERNAME.github.io/young-family-dashboard/`

Share that link with the family!

## Notifications
- Open the dashboard in your browser
- Click **🔔 Enable Alerts**
- Allow notifications when prompted
- You'll get a notification 15 minutes before any scheduled event

## Install as an App (Mobile & Desktop)
- On **iPhone/iPad**: Open in Safari → Share button → "Add to Home Screen"
- On **Android**: Open in Chrome → Menu → "Add to Home Screen" or tap the Install banner
- On **Desktop Chrome**: Click the install icon in the address bar, or click "📲 Install App" button in the dashboard
