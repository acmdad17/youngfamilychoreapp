# Push Notifications — ROOT CAUSE FOUND & FIXED ✅

## The actual bug
`sw.js` has been **truncated/corrupted since commit `f596f4e` (2026-07-07)** — cut off mid-statement after `const clone = response.clone();` with no closing braces. This made the file invalid JavaScript.

Any device trying to freshly install this service worker got `SyntaxError: Unexpected end of script` on `navigator.serviceWorker.register()` — confirmed live via Safari Web Inspector on Bradford's iPhone. That means `navigator.serviceWorker.ready` never resolved, `getToken()` never completed, and no FCM token could ever register on that device.

**Why it looked so confusing:** devices that already had an older, working service worker installed *before* the file broke (e.g. Bradford's desktop/PC) kept silently running that old cached version and never needed to re-register — so the pipeline appeared to work there. Any device forced to install fresh (like the iPhone, especially after repeated cache-clears during debugging) hit the broken file every time and failed identically, with no error ever visible because the code path also had an unrelated secondary bug (see below) that swallowed the real error.

## Fix
Commit `bdb5f66` restored the missing ending of `sw.js` from the last known-good version (`7568bd7`). `node --check` now passes. Confirmed end-to-end on Bradford's iPhone: fresh service worker installs, `getToken()` succeeds, a properly-tagged `fcmTokens` entry appears (`person: Bradford, platform: ios, standalone: true`), and real push notifications now arrive on the phone with the app closed.

## Other real bugs found & fixed along the way (all deployed, all still worth knowing about)
1. **Eventarc/Cloud Function trigger was silently dead** since the very first deploy (2026-07-05) — an Eventarc IAM permission grant failed on first attempt and never fully recovered even though the function API-level deploy succeeded. Fixed by deleting and doing a clean fresh redeploy of `sendFamilyAlertPush` (commit history in `functions/` around 2026-07-12).
2. **Missing `notification` field** in the FCM payload — required for iOS to show a push when the app is fully closed (data-only pushes don't display on iOS). Added in `functions/index.js`.
3. **`showToast` is called dozens of times throughout `index.html` but is never defined anywhere in the codebase.** This is a separate, pre-existing bug — likely silently breaking toast confirmations app-wide, not just for push. It's specifically what hid the real service-worker error from us for hours: the push-subscription catch block calls `showToast(...)` before writing debug info to Firebase, so the `ReferenceError` from the missing function aborted execution before the real error could ever be logged. **Not yet fixed** — needs someone to either define `showToast` properly or remove the dead calls.
4. **GitHub Pages HTTP caching** (`Cache-Control: max-age=600`) could serve a stale `index.html` for up to 10 minutes after a deploy, even with the service worker's "network-first" strategy, because plain `fetch()` still honors browser HTTP cache. Fixed with `fetch(request, {cache:'no-store'})` for document requests in `sw.js`.
5. **Service worker was force-reloading every open client on every single activation** (not just real updates), which could kill an in-flight `getToken()` call mid-registration. Removed — no longer needed now that #4 is fixed.

## Known non-issue
Background/locked-screen push notifications don't vibrate on iOS — **not fixable**. iOS ignores the `vibrate` option inside a service worker's `showNotification()` call for backgrounded push. This is narrower than it might sound: `navigator.vibrate()` called directly from the active page (e.g. `showFamilyAlertOverlay()` in `index.html`) does work on iOS and vibrates fine when the app is open — it's specifically background-triggered notification vibration that Apple doesn't expose to web content.

## Still outstanding
- Fix #3 above (`showToast` undefined) — low priority, cosmetic, but worth cleaning up since it's currently masking any future errors in that code path.
