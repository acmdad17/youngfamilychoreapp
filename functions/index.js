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

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      data: {
        title: `${alert.emoji || '🔔'} ${alert.label}`,
        body:  `${alert.triggeredBy} needs a hand — tap to respond`,
        type:  alert.type || 'alert',
        alertId: event.params.alertId,
      },
      webpush: {
        headers: { Urgency: 'high', TTL: '600' },
        fcmOptions: { link: 'https://acmdad17.github.io/youngfamilychoreapp/' },
      },
    });

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
