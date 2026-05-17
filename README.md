# Young Family Dashboard — Firebase Setup

## Why Firebase?
Firebase lets all 5 family members see the same events, chores, and grocery list in real time.
When Christian logs a chore, everyone sees it instantly. Free for a family-sized app.

---

## Step 1 — Create a Firebase project
1. Go to https://firebase.google.com and sign in with a Google account
2. Click "Add project" → name it `young-family` → Continue
3. Disable Google Analytics (not needed) → Create project

## Step 2 — Create a Realtime Database
1. In the left sidebar: Build → Realtime Database → Create Database
2. Choose United States as the location
3. Select "Start in test mode" → Enable

## Step 3 — Get your config
1. Click the gear icon (Project Settings) top left
2. Scroll to "Your apps" → Add app → Web icon (</>)
3. Nickname: `young-fam-web` → Register app
4. Copy the firebaseConfig block that appears

## Step 4 — Paste config into index.html
1. Open index.html in any text editor
2. Find the block near the top that says REPLACE_WITH_YOUR_API_KEY etc.
3. Replace the entire firebaseConfig block with your copied one
4. Save the file

## Step 5 — Upload to GitHub
1. Go to your GitHub repo and drag/drop the updated index.html
2. Commit changes — site updates in about a minute

## Step 6 — Share the link
Send the URL to everyone: https://YOUR-USERNAME.github.io/young-family-dashboard/

---

## How Chores Work
- Tap "I did it" to log yourself doing the chore
- Shows per-person counters: Christian x2, Bradford x1
- Chores with a daily limit show progress e.g. 2/3 times today
- Auto-resets at midnight and keeps a 14-day history
- Tap "View history" to see who did what each day

## Troubleshooting
- Stuck on "Connecting" → check your databaseURL in the config
- Permission denied → Firebase → Realtime Database → Rules → set read/write to true
- Changes not showing → refresh; Firebase normally syncs in under a second
