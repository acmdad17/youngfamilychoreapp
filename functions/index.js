const { onValueCreated } = require('firebase-functions/v2/database');
const { initializeApp }  = require('firebase-admin/app');
const { getMessaging }   = require('firebase-admin/messaging');
const { getDatabase }    = require('firebase-admin/database');

initializeApp();

// Fires whenever a new familyAlert is created.
// Sends a push notification to every device that has subscribed.
exports.sendFamilyAlertPush = onValueCreated(
  { ref: '/familyAlerts/{alertId}', region: 'us-central1' },
  async (event) => {
    const alert = event.data.val();
    if (!alert?.active) return;   // only push for active alerts

    const db = getDatabase();
    const tokensSnap = await db.ref('fcmTokens').once('value');
    const tokensObj  = tokensSnap.val() || {};
    const tokens = Object.values(tokensObj)
      .map(v => typeof v === 'string' ? v : v?.token)
      .filter(Boolean);
    if (!tokens.length) return;

    const title = `${alert.emoji || '🔔'} ${alert.label}`;
    const body  = `${alert.triggeredBy} needs a hand — tap to respond`;

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      // notification field required for iOS to show the push when app is closed
      notification: { title, body },
      data: {
        title,
        body,
        type:    alert.type || 'alert',
        alertId: event.params.alertId,
      },
      webpush: {
        headers: { Urgency: 'high', TTL: '600' },
        notification: {
          title,
          body,
          icon:  'https://acmdad17.github.io/youngfamilychoreapp/icon-192.png',
          badge: 'https://acmdad17.github.io/youngfamilychoreapp/icon-192.png',
        },
        fcmOptions: { link: 'https://acmdad17.github.io/youngfamilychoreapp/' },
      },
    });

    // Log FCM response to Firebase for debugging
    const summary = {
      ts: Date.now(),
      tokenCount: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses.map((r, i) => ({
        token: tokens[i].slice(0, 20),
        success: r.success,
        error: r.error?.message || null,
      })),
    };
    await db.ref('debug/fcmResponse').set(summary);

    // Remove tokens that are no longer valid
    const badKeys = Object.entries(tokensObj)
      .filter(([, v]) => {
        const tok = typeof v === 'string' ? v : v?.token;
        const idx = tokens.indexOf(tok);
        return idx >= 0 && !response.responses[idx].success;
      })
      .map(([key]) => key);

    if (badKeys.length) {
      const updates = Object.fromEntries(badKeys.map(k => [`fcmTokens/${k}`, null]));
      await db.ref().update(updates);
    }
  }
);
