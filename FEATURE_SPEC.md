# Young Family Chore App — Feature Spec & Implementation Guide
_Audit date: 2026-07-07. Audited against actual code in this repo: `index.html` (~2662 lines), `sw.js`, `functions/index.js`, `firebase-security-rules.json`._

**Corrections to prior documentation found during audit (trust these, not older docs):**
- `choreLog` is stored **date-first**: `choreLog/{YYYY-MM-DD}/{choreId}/{pushKey} = {person, time(ISO)}` — not `choreLog/{choreId}/{date}`.
- `fcmTokens/{deviceId}` is a **bare token string**, no person mapping. The Cloud Function does `Object.values(tokensObj).filter(Boolean)` and assumes strings. Any change to store objects here **must** update `functions/index.js` in the same task or push breaks silently.
- HA presence trigger abuses the `emoji` field to carry the state (`state: t.emoji || 'not_home'` at index.html ~line 1311). Keep that convention or change both ends.
- `firebase-security-rules.json` in the repo says `auth != null` for everything, but production allows unauthenticated writes to `ha_triggers/`. **The repo rules file has drifted from deployed rules.** Never deploy this file as-is or HA integration dies.

---

## 1. NOTIFICATION AUDIT & FIX

### What actually works today
- Pipeline architecture is sound: HA → `ha_triggers/` → app mirrors to `familyAlerts/ha_{id}` (dedup via `_processed`, 10-min TTL, deterministic key) → Cloud Function `sendFamilyAlertPush` → FCM multicast to all `fcmTokens`.
- Stale-token cleanup in the function works (deletes tokens whose send failed).
- Foreground: `onMessage` toast + `handleAlertsUpdate` overlay + `playDing()` + `navigator.vibrate` — works on Android; overlay works everywhere.
- HA Companion critical iOS push for dishwasher/washer already bypasses silent mode for the phones that have the automations targeting them. This is the only reliable "always makes sound" channel on iOS.

### What is actually broken or fragile

**B1. Double/duplicate notification risk + no control over background presentation (real bug).**
`functions/index.js` sends a `notification` payload. When a push with a `notification` key arrives while the page is backgrounded, the FCM SDK / browser auto-displays it, **and** `onBackgroundMessage` in `sw.js` also calls `showNotification` → two notifications on Android Chrome in some versions; on others `onBackgroundMessage` never fires so the `vibrate` array in sw.js is dead code and only the function's `webpush.notification.vibrate` applies. You have two competing definitions of the notification.
**Fix: send data-only messages and build the notification exclusively in the service worker.**

`functions/index.js` — replace the `sendEachForMulticast` call:
```js
const response = await getMessaging().sendEachForMulticast({
  tokens,
  data: {
    title: `${alert.emoji || '🔔'} ${alert.label}`,
    body:  `${alert.triggeredBy} needs a hand — tap to respond`,
    type:  alert.type || 'alert',
    alertId: event.params.alertId,
  },
  webpush: {
    headers: { Urgency: 'high', TTL: '600' },   // don't deliver stale alerts
    fcmOptions: { link: 'https://acmdad17.github.io/youngfamilychoreapp/' },
  },
});
```
`sw.js` — replace the handler:
```js
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  return self.registration.showNotification(d.title || '🏠 Young Family', {
    body: d.body || '',
    icon: 'https://acmdad17.github.io/youngfamilychoreapp/icon-192.png',
    badge:'https://acmdad17.github.io/youngfamilychoreapp/icon-192.png',
    vibrate: [300,100,300,100,300],      // Android only; ignored on iOS
    tag: d.type || 'alert',
    renotify: true,
    requireInteraction: true,            // stays on screen (Android/desktop)
    data: d,
  });
});
```
And in `index.html` `subscribePush()`, the `onMessage` handler must read `payload.data` instead of `payload.notification`:
```js
onMessage(messaging,payload=>{
  const d=payload.data||payload.notification||{};
  showToast(`${d.title||''}${d.body?' — '+d.body:''}`);
});
```
Note: `handleAlertsUpdate` already drives the in-app overlay from the RTDB listener, so foreground UX is unchanged.

**B2. `playDing()` silently fails on iOS (and sometimes Android) — AudioContext starts suspended.**
`playDing` creates a fresh `AudioContext` inside a Firebase `onValue` callback — not a user gesture. iOS Safari keeps it `suspended`, so the overlay appears with no sound. Fix: create one shared context, unlock it on first user interaction, and resume before playing:
```js
let _audioCtx=null;
function getAudioCtx(){
  if(!_audioCtx)_audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  if(_audioCtx.state==='suspended')_audioCtx.resume().catch(()=>{});
  return _audioCtx;
}
document.addEventListener('pointerdown',()=>getAudioCtx(),{once:true});
```
Then `playDing()` uses `getAudioCtx()` instead of `new AudioContext()`. This makes the ding reliable whenever the app has been touched once since load (true for any real session). No web API can play sound in a *backgrounded* browser tab — that's what push notifications are for.

**B3. Honest iOS limitations (cannot be coded around in the PWA):**
- Web push on iOS requires the PWA to be **installed to the Home Screen** (iOS 16.4+). Safari-tab visitors get nothing. Onboarding (Section 2) must enforce install.
- iOS web push plays the **default system tri-tone only**. No custom sound, no `vibrate` (the array is ignored), no way to bypass Silent mode or Focus. If the phone is on silent, web push is silent. Period.
- The only silent-mode bypass on iOS is the **HA Companion app with `push.critical: 1`** — which already exists for the dishwasher/washer automations. Recommendation: extend those HA automations' `notify.mobile_app_*` targets to **every family member who installs the HA Companion app**, and add the same critical notify action to the `Young Family Alert` webhook automation (`young_family_alert_1783371173935`) so app-triggered alerts (feedDogs, dinner) also hit iPhones loudly. This is an HA-side YAML change, not an app change.
- Layered strategy (what "reliable sound + vibration" actually means here):
  - **Android devices**: FCM web push with vibrate + requireInteraction (B1 fix) — good.
  - **iPhones, app installed to Home Screen**: FCM web push → default sound when not silenced.
  - **iPhones with HA Companion**: critical push → sound even on silent. Install Companion on all iPhones.
  - **App open on any device**: overlay + fixed `playDing` (B2) + vibrate where supported.

**B4. Minor but real:**
- `handleAlertsUpdate` only surfaces the **newest** active alert; if two alerts fire within seconds, the older is never shown as an overlay (push still arrives). Acceptable; document it.
- `subscribePush()` runs at boot only if permission already granted — good (token refresh on every launch keeps iOS subscriptions alive). Keep it.
- `undoChore` deducts points but writes **no negative `pointsLedger` entry** — the ledger overstates earnings. One-line fix: `await dbPush('pointsLedger',{person,delta:-pts,reason:'undo: '+name,type:'undo',ts:Date.now()});`
- Cloud Function pushes to **all** devices including the trigger's own device. Fine for a family; do not "fix" without adding token→person mapping first (Section 2).

---

## 2. ON-BOARDING FLOW

### Problem
Today a new user picks a name (stored in `localStorage.young_user`), sees a toast hinting at the 🔔 button, and that's it. Nothing verifies push actually works, nothing records which devices belong to whom, iOS users are never told to install the PWA (mandatory for push), and Bradford has no way to see who is actually onboarded.

### Design: 4-step modal wizard
Trigger: on boot, if `!localStorage.getItem('young_onboarded_v2')` and not TV_MODE, open `#onboard-modal` (full-screen modal, same pattern as existing modals, cannot be dismissed by backdrop until step 1 done).

- **Step 1 — Who are you?** 5 big member cards from `MEMBERS` (reuse colors/emoji). Selecting writes `currentUser` exactly as the existing picker does (keep the existing picker working — the wizard just calls the same function).
- **Step 2 — Install check (iOS only).** Detect: `const isIOS=/iphone|ipad/i.test(navigator.userAgent); const standalone=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;` If iOS and not standalone: show Share → "Add to Home Screen" instructions with a "I've installed it — reopen there" note, and stop the wizard here (it resumes at step 3 on next launch in standalone mode). On Android, if a captured `beforeinstallprompt` event exists, offer the install button; otherwise skip.
- **Step 3 — Turn on alerts.** Big button → calls existing `requestNotifications()` (this is the required user gesture for iOS). On grant, `subscribePush()` already fires. Show ✅/❌ state.
- **Step 4 — Test + presence note.** "Send me a test" button → `swNotify('🔔 Test','If you saw this, you're all set','test')`. Below it, one paragraph: "The dashboard shows who's home using Home Assistant. Bradford/Brooke/Audrey/Christian are tracked automatically; Mitchum see Section 6." Finish button sets `localStorage.young_onboarded_v2='1'`.

### Data changes — token ownership (prereq for everything per-person later)
Change `subscribePush()` to write metadata:
```js
if(token)await set(ref(db,`fcmTokens/${deviceId}`),{
  token,
  person: currentUser?.name||'Guest',
  platform: /iphone|ipad/i.test(navigator.userAgent)?'ios':/android/i.test(navigator.userAgent)?'android':'desktop',
  standalone: navigator.standalone===true||matchMedia('(display-mode: standalone)').matches,
  updatedAt: Date.now(),
});
```
**MANDATORY companion change** in `functions/index.js` (or every push breaks — values are no longer strings):
```js
const tokens = Object.values(tokensObj)
  .map(v => typeof v === 'string' ? v : v?.token)
  .filter(Boolean);
```
(and the bad-token cleanup must compare against the same mapped array). Ship these two changes in the **same commit**.

### Onboarding status board
On the Members tab, an "Devices" card (visible to everyone; it's a family): for each member, list registered devices from `fcmTokens` where `person === member`, showing platform icon + relative `updatedAt` ("2d ago"). Members with zero devices get a red "Not set up" chip. This is how Bradford verifies all 5 are onboarded.

---

## 3. SCHEDULE SYSTEM REDESIGN — Standing Schedules

### Data model
New path `standingSchedule/{person}/{entryId}` (push keys):
```json
{
  "title": "Work",
  "type": "work",            // work | school | activity | other — reuses event type styling
  "days": [1, 3],            // 0=Sun..6=Sat, same convention as chores' scheduleDays
  "start": "17:00",          // 24h, may be "" for all-day
  "end": "21:00",            // optional
  "location": "",            // optional
  "active": true,
  "effectiveFrom": "2026-07-01",   // optional; null = always
  "effectiveUntil": null,          // optional; e.g. school year end
  "updatedAt": 1720000000000
}
```
Why person-keyed: writes are per-person, reads are all-at-once via one `onValue(ref(db,'standingSchedule'))` into a `standingSchedules` global (same pattern as every other listener at index.html ~line 1279).

### Expansion into the existing views (the whole trick)
One pure function, used everywhere:
```js
function standingEventsOn(dateStr){
  const d=new Date(dateStr+'T12:00:00'),dow=d.getDay(),out=[];
  Object.entries(standingSchedules||{}).forEach(([person,entries])=>{
    Object.entries(entries||{}).forEach(([id,s])=>{
      if(!s.active||!s.days?.includes(dow))return;
      if(s.effectiveFrom&&dateStr<s.effectiveFrom)return;
      if(s.effectiveUntil&&dateStr>s.effectiveUntil)return;
      out.push({person,title:s.title,time:s.start||'',endTime:s.end||'',type:s.type||'other',fromStanding:true,standingId:id});
    });
  });
  return out;
}
```
Then in `renderWeek` (line ~1736), `renderSelectedDay` (~1760), and `renderMembers` (~1781), append `standingEventsOn(ds)` to the existing `evList` for that date. Standing items render like calendar-import events (non-editable inline; distinct 🔁 badge, slight opacity). `filterMember`, dots, and "At Work" detection (`e.type==='work'`) all work for free — member cards will automatically show "💼 At Work" on days a standing work shift exists.

### UI
- "My Schedule" button in the schedule section header → modal listing **currentUser's** entries with edit/delete, plus an add form: title, type select, 7-day chip grid (**reuse `buildDaysGrid()`**, rename the checkbox `name` to avoid clashing with the chore modal), start/end time inputs, optional until-date.
- Viewing others: a person select at the top of the modal (default = you); entries for other people are shown read-only unless the viewer is Bradford/Brooke (simple `['Bradford','Brooke'].includes(currentUser.name)` guard — no real auth exists, don't pretend otherwise).
- Deleting an entry: `dbRemove(\`standingSchedule/${person}/${id}\`)`.

---

## 4. CHORE ACCOUNTABILITY VIEW — "Who's Slacking"

### The data reality
Everything needed already exists in memory: `chores` (with `assignedTo`, `scheduleDays`, `freq`, `points`), `choreLog` (date-first log of every completion), `streaks`. No new Firebase paths required. This is a pure render feature.

### Metrics (computed per person over a date range)
For each date D in range, for each chore C where `!C.scheduleDays || C.scheduleDays.includes(dow(D))` and `C.created <= endOfDay(D)`:
- **Expected**: if `C.assignedTo` includes person P → P owed `C.freq||1` completions that day (split expectation across assignees: `(C.freq||1)/assignedTo.length`, fractional is fine for rates). Unassigned chores count into a shared "House" pool, not against individuals.
- **Done**: count of `choreLog[D][C.id]` entries where `entry.person===P`.
- Derived per person: `completionRate = done/expected` (cap display at 100%+ shown as "over-delivered"), `pickedUpSlack` = completions on chores not assigned to them (or unassigned), `lastActive` = most recent date with any entry, `missedCount` = expected−done summed where positive, current best streak (existing `getBestStreak`).

### Display
New "Team" panel on the chores tab (or a sub-view toggled by a "📊 Accountability" button next to "Add Chore"):
1. **Range chips**: Today / 7 days / 30 days / All — default 7 days. All = iterate `Object.keys(choreLog)` (bounded, fine at family scale).
2. **Leaderboard**: one row per member sorted by completionRate desc — emoji+name, horizontal bar (member color), `done/expected`, 🔥 streak, 🤝 pickedUpSlack count, and a 😴 "slacking" badge when rate < 50% and expected ≥ 3 (don't shame someone with 1 missed chore).
3. **Per-chore matrix**: rows = chores active in range, columns = members; cell = completion count; red-tinted cell when the member is assigned and count is 0; footer row "House" for unassigned completions.
4. **Actions per member row**: **Nudge** → `dbPush('familyAlerts',{type:'nudge',label:\`${name}, chores are waiting (${missed} missed)\`,emoji:'👀',color:'#ff8c42',triggeredBy:currentUser.name,triggeredAt:Date.now(),claimedBy:null,active:true})` — rides the entire existing overlay+push pipeline with zero backend changes. **Reassign** per matrix row → opens existing `openEditChore(id)`.

Honest note: until fairness matters more, don't build weighting by points/difficulty. Rate + missed count is what a family will actually read.

---

## 5. CHORE AUDIT TRAIL

### Query pattern (document, don't rebuild)
`choreLog/{YYYY-MM-DD}/{choreId}/{pushKey} = {person:'Audrey', time:'2026-07-07T18:31:02.123Z'}`. The whole node is already subscribed via `onValue(choreLogRef())` (~line 1282) into the `choreLog` global — filtering is client-side. Scale check: 5 people × ~10 completions/day ≈ 18k entries/year, ~2 MB JSON — fine for now. If it ever gets slow, switch that one listener to `query(choreLogRef(), orderByKey(), startAt(fmtDate(addDays(today,-90))))` — RTDB date-first keys sort lexicographically, which is exactly why the date-first layout is right. Do not restructure the path.

Flattening helper (shared with Section 4):
```js
function flattenChoreLog(fromDate,toDate){ // 'YYYY-MM-DD' inclusive
  const rows=[];
  Object.entries(choreLog).forEach(([date,byChore])=>{
    if(date<fromDate||date>toDate)return;
    Object.entries(byChore||{}).forEach(([choreId,entries])=>{
      Object.entries(entries||{}).forEach(([key,e])=>{
        rows.push({date,choreId,choreName:chores[choreId]?.name||choreId,
          icon:chores[choreId]?.icon||'✅',person:e.person,time:e.time,
          points:chores[choreId]?.points||1,key});
      });
    });
  });
  return rows.sort((a,b)=>(b.time||b.date).localeCompare(a.time||a.date));
}
```

### UI
"📜 Full History" button next to the accountability toggle → modal (reuse `history-modal` styling, new modal element): filter row = person select (Everyone + MEMBERS), chore select (All + chores), from/to date inputs (default last 30 days). Body = grouped-by-date list; each row: `6:31 PM · 🍽️ Unload dishwasher · [Audrey chip] · ⭐2`. Footer: totals line ("42 completions · Audrey 18, Christian 12, …") + Export button.

### Export
CSV via Blob (no backend):
```js
function exportChoreCSV(rows){
  const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv='date,time,chore,person,points\n'+rows.map(r=>[r.date,r.time,esc(r.choreName),r.person,r.points].join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const a=Object.assign(document.createElement('a'),{href:url,download:`choreLog_${todayStr}.csv`});
  a.click();URL.revokeObjectURL(url);
}
```
iOS standalone PWAs handle anchor-download poorly — add a fallback "Copy summary" button that builds a plain-text summary and `navigator.clipboard.writeText()`s it.

---

## 6. MITCHUM PRESENCE TRACKING

Mitchum is already in `PRESENCE_MEMBERS` (index.html ~1635) and `renderMembers` — the app side is **done**. The chip is hidden only because `presence/Mitchum` never gets written. Options, ranked:

1. **HA Companion app on Mitchum's phone (recommended if he has any smartphone).** Install Companion → HA auto-creates `device_tracker.<his_phone>` → create `person.mitchum` in HA and attach the tracker → add `person.mitchum` to the existing `automation.track_family_presence_in_firebase` (same `rest_command.firebase_ha_trigger` call with `type: presence`, `label: Mitchum`, `emoji: "{{ 'home' if ... else 'not_home' }}"` — remember: **state travels in the `emoji` field**). Bonus: he can also receive HA critical push. Effort: ~20 minutes, all HA-side.
2. **Router/network tracking (no app needed).** If his phone joins home WiFi: HA `ping` device_tracker against a DHCP-reserved IP, or `nmap_tracker`. Home/not_home only, ~5–10 min lag on leave (consider_home). Attach to `person.mitchum`, same automation change as option 1.
3. **Manual self-report fallback (pure app change, works today).** A tap-to-toggle on his presence chip when `currentUser.name==='Mitchum'`: writes `presence/Mitchum = {state:'home'|'not_home', updatedAt:Date.now(), source:'manual'}`. Honest but forgettable — ship as fallback, not the solution.

**Spec decision: implement option 1; if no smartphone, option 2. Add option 3's toggle regardless as a manual override for anyone whose tracker misfires (guard: only your own chip is tappable, and show a small ✋ badge when `source==='manual'`).** App change needed either way: none for options 1–2 (path already consumed), small for option 3.

---

## 7. PRIORITY IMPLEMENTATION PROMPTS (TASK.md-ready)

**Global rules for every task below (copy into each TASK.md):**
- Repo: `C:\Users\Bradford\Claude\Projects\Chore App` (GitHub `acmdad17/youngfamilychoreapp`, branch main).
- Git policy: `git add -A && git commit -m "..."` locally. **NEVER `git push` — Bradford pushes manually.** Never push `index.html` via GitHub MCP.
- `index.html` is a single file; make surgical edits, never reformat/rewrite whole sections.
- Do NOT touch: Firebase config/VAPID key, the `ha_triggers` mirror listener (~line 1293) unless the task says so, TV mode code paths, `firebase-security-rules.json` (drifted from prod — deploying it breaks HA).
- Cloud Function deploys: note in RESULT.md that Bradford must run `firebase deploy --only functions`.
- Write results/status to `RESULT.md`, delete `TASK.md` when done.

---

### Task 1 — Data-only push refactor (fixes duplicate/dead notification handling)
**Files:** `functions/index.js`, `sw.js`, `index.html` (only the `onMessage` handler inside `subscribePush`, ~line 1530).
**Do:** Convert `sendFamilyAlertPush` to send a data-only message (`data:{title,body,type,alertId}`, `webpush.headers:{Urgency:'high',TTL:'600'}`, keep `fcmOptions.link`); remove the `notification` and `webpush.notification` blocks. Rewrite `sw.js` `onBackgroundMessage` to build the notification from `payload.data` with `vibrate:[300,100,300,100,300]`, `requireInteraction:true`, `tag:d.type`, `renotify:true`, icon/badge `icon-192.png`. Update the in-page `onMessage` to read `payload.data`. Bump sw.js `CACHE` to `young-fam-v7`.
**Don't change:** token collection logic in the function (Task 2 owns it), notificationclick handler, cache fetch strategy.
**Success:** exactly one notification per alert on Android background; body/title identical to before; foreground toast still appears; no console errors.

### Task 2 — FCM token metadata + function compatibility (single atomic commit)
**Files:** `index.html` (`subscribePush`, ~line 1516), `functions/index.js`.
**Firebase:** `fcmTokens/{deviceId}` becomes `{token,person,platform,standalone,updatedAt}`.
**Do:** Write the metadata object (person from `currentUser?.name`); in the function, map values with `typeof v==='string'?v:v?.token` before filtering (backward compatible with old string tokens), and fix the bad-token cleanup to use the same mapping.
**Don't change:** deviceId generation, VAPID key, message payload (Task 1 owns it).
**Success:** new device registration writes the object; pushing an alert still reaches devices with BOTH old-string and new-object entries; invalid tokens still get pruned.

### Task 3 — Onboarding wizard modal
**Files:** `index.html` only.
**Do:** Build `#onboard-modal` per Section 2: 4 steps (identity via existing member-selection code path; iOS install-check gate using `navigator.standalone`/display-mode with Add-to-Home-Screen instructions; enable-alerts button calling existing `requestNotifications()`; test-notification via existing `swNotify` + finish). Show when `!localStorage.getItem('young_onboarded_v2')` and not TV_MODE. Reuse existing modal CSS classes.
**Don't change:** existing user-picker (must keep working), `requestNotifications`, `subscribePush` internals.
**Success:** fresh browser profile → wizard appears, completes end-to-end on Android; iOS Safari (non-standalone) stops at install step and resumes at step 3 when opened standalone; `young_onboarded_v2` set; never shows again; TV untouched.

### Task 4 — Device status board on Members tab
**Files:** `index.html`.
**Firebase reads:** `fcmTokens/` (add one `onValue` listener following the pattern at ~line 1279).
**Do:** "Devices" card after `#members-grid`: per member, devices where `person===member.key` (skip legacy string entries), platform icon + "updated Xd ago"; red "Not set up" chip for members with none; "Guest" tokens grouped under "Unassigned".
**Don't change:** `renderMembers` internals beyond appending the card container; no writes to `fcmTokens`.
**Success:** board reflects reality live; members without devices clearly flagged; no errors when `fcmTokens` contains old string tokens.

### Task 5 — Standing schedule: data model + editor
**Files:** `index.html`.
**Firebase:** new `standingSchedule/{person}/{pushId}` per Section 3 schema; add `onValue(ref(db,'standingSchedule'))` listener → `standingSchedules` global.
**Do:** "My Schedule" button in schedule section header → modal: person select (default currentUser; other people read-only unless currentUser is Bradford/Brooke), list of entries with edit/delete, add form (title, type select work/school/activity/other, 7-day chip grid — clone `buildDaysGrid` with a distinct input name like `sched-day`, start/end time, optional effectiveUntil date). Include the `standingEventsOn(dateStr)` helper from Section 3 (exported for Task 6).
**Don't change:** `events/` handling, chore modal's `chore-day` checkboxes, iCal import.
**Success:** entry created for Mitchum "Band practice, Tue, 15:30–17:30" persists across devices; edit and delete work; read-only enforcement works.

### Task 6 — Standing schedule integration into week/day/member views
**Files:** `index.html` (`renderWeek` ~1732, `renderSelectedDay` ~1754, `renderMembers` ~1779). Depends on Task 5.
**Do:** Append `standingEventsOn(ds)` to each view's event list; render standing items with 🔁 badge and `opacity:.85`, no edit/delete buttons (guard on `e.fromStanding` like the existing `e.fromCal` guard); ensure `filterMember` filters them; member-card "💼 At Work" must trigger from standing `type==='work'`.
**Don't change:** event storage, `eventOccursOn`, calendar-import rendering.
**Success:** standing work shift shows on correct weekdays in week strip dots, selected-day list, and flips the member badge to "At Work"; person filter works; no duplicate rendering of regular events.

### Task 7 — "Who's Slacking" accountability panel
**Files:** `index.html` (chores tab).
**Firebase:** read-only from existing in-memory `chores`, `choreLog`, `streaks`; Nudge writes one `familyAlerts` push-key entry (schema identical to `triggerAlert`'s, ~line 2498).
**Do:** Section 4 in full: "📊 Accountability" toggle button next to Add Chore; range chips (today/7d/30d/all); leaderboard with per-member bar, done/expected, rate, 🔥, 🤝 picked-up-slack, 😴 badge (rate<50% && expected≥3); per-chore × member matrix with red assigned-but-zero cells and "House" footer; Nudge button per member; Reassign per chore row → existing `openEditChore(id)`. Expected-completion math per Section 4 (respect `scheduleDays`, `freq`, `assignedTo` split, chore `created` timestamp).
**Don't change:** `logChore`/`undoChore`/streak logic, existing chore list rendering.
**Success:** metrics hand-verify against a seeded week of choreLog; Nudge fires the overlay+push pipeline on other devices; empty-data states don't divide by zero.

### Task 8 — Audit trail + CSV export
**Files:** `index.html`.
**Firebase:** read-only `choreLog` (date-first structure — see header of this spec).
**Do:** Section 5 in full: `flattenChoreLog(from,to)` helper; "📜 Full History" modal with person/chore/date-range filters (defaults: everyone, all chores, last 30 days), grouped-by-date rows (time · icon+chore · person chip · points), totals footer; CSV export via Blob download + "Copy summary" clipboard fallback for iOS standalone.
**Don't change:** the existing per-chore `showChoreHistory` modal (keep both), choreLog structure, the choreLog listener.
**Success:** filters compose correctly; CSV opens in Excel with correct rows; clipboard fallback works; 1000+ entries render without jank (build one HTML string, single innerHTML assignment).

### Task 9 — Mitchum presence (HA-side + manual override in app)
**Files:** HA config via `Z:\` (Samba) — automation for presence sync; `index.html` (`renderPresenceStrip` ~1642).
**Firebase:** `presence/Mitchum = {state,updatedAt,source?}`.
**Do:** (a) Document/implement HA side per Section 6 option 1 (Companion app → `person.mitchum` → extend `automation.track_family_presence_in_firebase`; **state goes in the `emoji` field** of `rest_command.firebase_ha_trigger` — do not "fix" this convention). If no smartphone available, option 2 (ping tracker). (b) In-app: make your **own** presence chip tappable → toggles `presence/{me}` with `source:'manual'`, show ✋ badge when `source==='manual'`. (c) Reminder in RESULT.md: HA automation changes need reload; rest_command changes need full HA restart.
**Don't change:** the ha_triggers listener's presence branch (~line 1309), other members' tracking, PRESENCE_MEMBERS array (Mitchum already there).
**Success:** `presence/Mitchum` populates; chip appears in strip and member card flips Home/Away; manual toggle works only on your own chip and survives refresh.

---

## Suggested execution order
1 → 2 (push pipeline correctness) → 3 → 4 (onboarding, verify all 5 members) → 9 (Mitchum) → 5 → 6 (schedules) → 7 → 8 (accountability + audit). Tasks 1+2 first because everything else assumes push works; Task 3 depends on nothing but is highest family-visible value after push.
