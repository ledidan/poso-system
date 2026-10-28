export const REVENUE_AVERAGE_OPTIONS = [
  { value: "under_500m", label: "Dưới 500 triệu / năm" },
  { value: "under_1b", label: "Dưới 1 tỷ / năm" },
  { value: "one_to_three_b", label: "Trên 1 tỷ đến 3 tỷ / năm" }
];

export const isNotificationEnabled = (shop = {}, type = "campaign") => {
  const settings = shop.basicInfo?.notificationSettings || {};
  if (settings.enabled === false) return false;
  if (type === "campaign" && settings.campaignEnabled === false) return false;
  if (type === "daily" && (settings.dailyRevenueEnabled !== true || settings.dailyRevenueMobileEnabled === false)) return false;
  return shop.isDeleted !== true;
};

export const collectCampaignRecipients = ({ users = {}, shops = {}, target = {} }) => {
  const targetType = target.type || "all";
  const selectedShopIds = Object.entries(shops)
    .filter(([shopId, shop]) => {
      if (!isNotificationEnabled(shop, "campaign")) return false;
      if (targetType === "shop") return shopId === target.shopId;
      if (targetType === "revenueAverage") {
        return shop.basicInfo?.revenueAverage === target.revenueAverage;
      }
      return true;
    })
    .map(([shopId]) => shopId);
  const selectedshopset = new Set(selectedShopIds);
  const tokens = [];

  Object.values(users).forEach((user = {}) => {
    const token = user.notificationTokens?.fcmToken || user.notificationTokens?.token;
    if (!token) return;
    const memberships = Object.entries(user.shops || {});
    if (targetType === "all") {
      if (!memberships.length || memberships.some(([shopId]) => selectedshopset.has(shopId))) {
        tokens.push(token);
      }
      return;
    }
    const isTargetOwner = memberships.some(
      ([shopId, membership]) =>
        selectedshopset.has(shopId) && membership?.role === "owner"
    );
    if (isTargetOwner) tokens.push(token);
  });

  return {
    tokens: [...new Set(tokens)],
    shopIds: selectedShopIds
  };
};

export const buildCampaignMessage = ({ title, body, imageUrl = "", data = {} }) => ({
  notification: { title, body, ...(imageUrl ? { imageUrl } : {}) },
  data: Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value ?? "")])
  ),
  android: {
    priority: "high",
    notification: {
      channelId: "poso_notifications_v2",
      sound: "poso_alert",
      ...(imageUrl ? { imageUrl } : {})
    }
  },
  apns: {
    headers: { "apns-priority": "10" },
    payload: {
      aps: {
        sound: "poso-alert.wav",
        badge: 1,
        ...(imageUrl ? { mutableContent: true } : {})
      }
    },
    ...(imageUrl ? { fcmOptions: { imageUrl } } : {})
  }
});

export const sendCampaign = async ({
  db,
  messaging,
  messagingProjectId = "",
  campaignId,
  campaign,
  now = Date.now()
}) => {
  const [usersSnapshot, shopsSnapshot] = await Promise.all([
    db.ref("users").once("value"),
    db.ref("shops").once("value")
  ]);
  const recipients = collectCampaignRecipients({
    users: usersSnapshot.val() || {},
    shops: shopsSnapshot.val() || {},
    target: campaign.target
  });
  if (!recipients.tokens.length) {
    const error = new Error("Không tìm thấy thiết bị phù hợp để gửi.");
    error.code = "campaign/no-recipients";
    throw error;
  }

  const message = buildCampaignMessage({
    title: campaign.title,
    body: campaign.body,
    imageUrl: campaign.imageUrl || "",
    data: {
      type: "campaign_notification",
      campaignId,
      targetType: campaign.target.type,
      shopID: campaign.target.shopId || ""
    }
  });
  let successCount = 0;
  let failureCount = 0;
  const errors = [];
  for (let index = 0; index < recipients.tokens.length; index += 500) {
    const response = await messaging.sendEachForMulticast({
      tokens: recipients.tokens.slice(index, index + 500),
      ...message
    });
    successCount += response.successCount;
    failureCount += response.failureCount;
    response.responses.forEach((result) => {
      if (!result.success && result.error && errors.length < 20) {
        errors.push({ code: result.error.code, message: result.error.message });
      }
    });
  }

  const sentAt = new Date(now).toISOString();
  const result = {
    status: failureCount && !successCount ? "failed" : "sent",
    recipientCount: recipients.tokens.length,
    successCount,
    failureCount,
    matchedShopIds: recipients.shopIds,
    messagingProjectId,
    sentAt,
    errors
  };
  await db.ref(`systemAdmin/notificationCampaigns/${campaignId}`).update(result);
  return { id: campaignId, ...campaign, ...result };
};

export const processScheduledCampaigns = async ({
  db,
  messaging,
  messagingProjectId = "",
  now = Date.now()
}) => {
  const snapshot = await db.ref("systemAdmin/notificationCampaigns").once("value");
  const staleSendingBefore = now - 10 * 60 * 1000;
  const dueCampaigns = Object.entries(snapshot.val() || {}).filter(([, campaign]) => {
    const isDue = Date.parse(campaign?.scheduledAt || "") <= now;
    const isScheduled = campaign?.status === "scheduled";
    const isStaleSending = campaign?.status === "sending" &&
      Date.parse(campaign.startedAt || "") <= staleSendingBefore;
    return isDue && (isScheduled || isStaleSending);
  });
  const results = [];

  for (const [campaignId, dueCampaign] of dueCampaigns) {
    const campaignRef = db.ref(`systemAdmin/notificationCampaigns/${campaignId}`);
    const claim = await campaignRef.transaction((current) => {
      const candidate = current || dueCampaign;
      const isScheduled = candidate.status === "scheduled";
      const isStaleSending = candidate.status === "sending" &&
        Date.parse(candidate.startedAt || "") <= staleSendingBefore;
      if (
        !candidate ||
        (!isScheduled && !isStaleSending) ||
        Date.parse(candidate.scheduledAt || "") > now
      ) {
        return undefined;
      }
      return {
        ...candidate,
        status: "sending",
        startedAt: new Date(now).toISOString()
      };
    });
    if (!claim.committed) continue;

    const campaign = claim.snapshot.val();
    try {
      results.push(await sendCampaign({
        db,
        messaging,
        messagingProjectId,
        campaignId,
        campaign,
        now
      }));
    } catch (error) {
      await campaignRef.update({
        status: "failed",
        failedAt: new Date(now).toISOString(),
        errors: [{ code: error.code || "campaign/send-error", message: error.message }]
      });
      results.push({ id: campaignId, status: "failed", error: error.message });
    }
  }

  return results;
};
