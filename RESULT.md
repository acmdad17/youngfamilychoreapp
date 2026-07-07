# Bug Fix Results

## Status: Code edits complete — manual git commit required

The sandbox couldn't commit due to a git index.lock file on the Windows-mounted filesystem (permission error). Run this from the project folder:

```
git add -A && git commit -m "fix: data-only FCM push, AudioContext iOS fix, fcmToken person mapping, undo ledger"
```

---

## Files Changed

### `functions/index.js`
- **Bug 1**: Switched FCM payload from `notification:` key to `data:`-only. Removed `webpush.notification` block. Added `Urgency: high` header and `TTL: 600`.
- **Bug 3**: Token extraction now handles both bare string tokens and new object format (`v?.token`). `badKeys` filter updated to match (variable renamed `v`/`tok` to avoid shadowing).

### `sw.js`
- **Bug 1**: `onBackgroundMessage` now reads from `payload.data` instead of `payload.notification`. Added `icon`, `badge`, and `requireInteraction` fields. Vibrate array now actually works (was dead code before since browser auto-displayed the notification).

### `index.html`
- **Bug 1**: `onMessage` handler in `subscribePush()` reads from `payload.data` with `payload.notification` as fallback.
- **Bug 2**: Added shared `_audioCtx` / `getAudioCtx()` helper with `pointerdown` warm-up before `playDing`. `playDing` now calls `getAudioCtx()` instead of creating a new `AudioContext` each time — fixes iOS silent audio.
- **Bug 3**: `subscribePush()` now writes an object `{token, person, platform, standalone, updatedAt}` to `fcmTokens/${deviceId}` instead of a bare string.
- **Bug 4**: `undoChore` now pushes a `pointsLedger` entry with `delta: -pts`, `reason: 'undo: <name>'`, `type: 'undo'` immediately after deducting points.

---

## Deploy Steps

1. **Run git commit** (see command above)
2. **Firebase Functions**: Run `firebase deploy --only functions` after reviewing `functions/index.js` — the FCM payload shape changed, which affects all push notifications.
3. **Frontend** (`index.html`, `sw.js`): Deploy via your normal `deploy.bat`. The SW cache version may need bumping if you want clients to pick up `sw.js` changes immediately (currently `CACHE = 'young-fam-v6'`).
