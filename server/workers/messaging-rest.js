export const toRestMessage = ({ token, notification, data, android, apns }) => ({
  token,
  notification: { title: notification.title, body: notification.body, ...(notification.imageUrl ? { image: notification.imageUrl } : {}) },
  data,
  android: { priority: android.priority.toUpperCase(), notification: { channel_id: android.notification.channelId, sound: android.notification.sound, ...(android.notification.imageUrl ? { image: android.notification.imageUrl } : {}) } },
  apns: {
    headers: apns.headers,
    payload: { aps: { sound: apns.payload.aps.sound, badge: apns.payload.aps.badge, ...(apns.payload.aps.mutableContent ? { "mutable-content": 1 } : {}) } },
    ...(apns.fcmOptions?.imageUrl ? { fcm_options: { image: apns.fcmOptions.imageUrl } } : {})
  }
});
const errorCode = (code) => ({ UNREGISTERED: "messaging/registration-token-not-registered", SENDER_ID_MISMATCH: "messaging/mismatched-credential", INVALID_ARGUMENT: "messaging/invalid-argument", QUOTA_EXCEEDED: "messaging/quota-exceeded", UNAVAILABLE: "messaging/server-unavailable" }[code] || "messaging/internal-error");
export const createRestMessaging = ({ projectId, getToken, fetcher = fetch }) => ({
  async sendEachForMulticast({ tokens, ...message }) {
    const credential = await getToken();
    const responses = new Array(tokens.length);
    let next = 0;
    // Bound parallel requests; never retry an ambiguous send and risk duplicates.
    await Promise.all(Array.from({ length: Math.min(5, tokens.length) }, async () => {
      while (next < tokens.length) {
        const index = next++;
        try {
          const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: toRestMessage({ token: tokens[index], ...message }) }), signal: AbortSignal.timeout(20_000) });
          const result = await response.json();
          const code = result.error?.details?.find((item) => item.errorCode)?.errorCode || result.error?.status;
          responses[index] = response.ok ? { success: true, messageId: result.name } : { success: false, error: { code: errorCode(code), message: "Không thể gửi thông báo đến thiết bị." } };
        } catch { responses[index] = { success: false, error: { code: "messaging/server-unavailable", message: "Dịch vụ thông báo tạm thời không khả dụng." } }; }
      }
    }));
    const successCount = responses.filter((result) => result.success).length;
    return { responses, successCount, failureCount: responses.length - successCount };
  }
});
