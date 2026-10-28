import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCampaignMessage,
  collectCampaignRecipients,
  processScheduledCampaigns
} from "../server/notification-campaign.js";

const getPath = (root, path) => path.split("/").filter(Boolean).reduce(
  (value, key) => value?.[key],
  root
);

const setPath = (root, path, value) => {
  const keys = path.split("/").filter(Boolean);
  const leaf = keys.pop();
  const parent = keys.reduce((current, key) => {
    current[key] ||= {};
    return current[key];
  }, root);
  parent[leaf] = value;
};

const createFakeDb = (state, { transactionStartsEmpty = false } = {}) => ({
  ref: (path) => ({
    once: async () => ({ val: () => getPath(state, path) }),
    update: async (updates) => {
      setPath(state, path, { ...(getPath(state, path) || {}), ...updates });
    },
    transaction: async (updater) => {
      let nextValue = updater(transactionStartsEmpty ? undefined : getPath(state, path));
      if (nextValue !== undefined && transactionStartsEmpty) {
        nextValue = updater(getPath(state, path));
      }
      if (nextValue === undefined) {
        return { committed: false, snapshot: { val: () => getPath(state, path) } };
      }
      setPath(state, path, nextValue);
      return { committed: true, snapshot: { val: () => nextValue } };
    }
  })
});

const shops = {
  shopA: {
    basicInfo: {
      revenueAverage: "under_500m",
      notificationSettings: { enabled: true, campaignEnabled: true }
    }
  },
  shopB: {
    basicInfo: {
      revenueAverage: "under_1b",
      notificationSettings: { enabled: true, campaignEnabled: false }
    }
  },
  shopC: {
    basicInfo: {
      revenueAverage: "under_1b",
      notificationSettings: { enabled: true, campaignEnabled: true }
    }
  }
};

const users = {
  ownerA: {
    notificationTokens: { fcmToken: "token-a" },
    shops: { shopA: { role: "owner" } }
  },
  employeeA: {
    notificationTokens: { fcmToken: "token-employee" },
    shops: { shopA: { role: "Nhân viên" } }
  },
  ownerB: {
    notificationTokens: { fcmToken: "token-b" },
    shops: { shopB: { role: "owner" } }
  },
  ownerC: {
    notificationTokens: { fcmToken: "token-c" },
    shops: { shopC: { role: "owner" } }
  },
  duplicateOwnerA: {
    notificationTokens: { token: "token-a" },
    shops: { shopA: { role: "owner" } }
  },
  userWithoutShop: {
    notificationTokens: { fcmToken: "token-global" }
  }
};

test("campaign toàn hệ thống bỏ qua user chỉ thuộc shop đã tắt campaign", () => {
  const recipients = collectCampaignRecipients({ users, shops, target: { type: "all" } });
  assert.deepEqual(recipients.shopIds.sort(), ["shopA", "shopC"]);
  assert.deepEqual(
    recipients.tokens.sort(),
    ["token-a", "token-c", "token-employee", "token-global"].sort()
  );
});

test("campaign theo shop chỉ gửi owner và loại token trùng", () => {
  const recipients = collectCampaignRecipients({
    users,
    shops,
    target: { type: "shop", shopId: "shopA" }
  });
  assert.deepEqual(recipients.shopIds, ["shopA"]);
  assert.deepEqual(recipients.tokens, ["token-a"]);
});

test("campaign theo doanh thu chỉ gửi owner của shop đang bật", () => {
  const recipients = collectCampaignRecipients({
    users,
    shops,
    target: { type: "revenueAverage", revenueAverage: "under_1b" }
  });
  assert.deepEqual(recipients.shopIds, ["shopC"]);
  assert.deepEqual(recipients.tokens, ["token-c"]);
});

test("payload campaign dùng custom sound POSO trên Android và iOS", () => {
  const message = buildCampaignMessage({
    title: "POSO",
    body: "Thông báo",
    imageUrl: "https://cdn.poso.vn/campaign.jpg",
    data: { campaignId: 123 }
  });
  assert.equal(message.android.notification.channelId, "poso_notifications_v2");
  assert.equal(message.android.notification.sound, "poso_alert");
  assert.equal(message.apns.payload.aps.sound, "poso-alert.wav");
  assert.equal(message.apns.payload.aps.mutableContent, true);
  assert.equal(message.notification.imageUrl, "https://cdn.poso.vn/campaign.jpg");
  assert.equal(message.android.notification.imageUrl, "https://cdn.poso.vn/campaign.jpg");
  assert.equal(message.apns.fcmOptions.imageUrl, "https://cdn.poso.vn/campaign.jpg");
  assert.equal(message.data.campaignId, "123");
});

test("worker chỉ gửi campaign đã đến lịch và cập nhật trạng thái", async () => {
  const now = Date.parse("2026-08-11T12:00:00.000Z");
  const state = {
    users: {
      owner: {
        notificationTokens: { fcmToken: "scheduled-token" },
        shops: { shopA: { role: "owner" } }
      }
    },
    shops: { shopA: shops.shopA },
    systemAdmin: {
      notificationCampaigns: {
        due: {
          title: "Đến giờ",
          body: "Gửi ngay",
          target: { type: "shop", shopId: "shopA" },
          status: "scheduled",
          scheduledAt: "2026-08-11T11:59:00.000Z"
        },
        future: {
          title: "Chưa đến giờ",
          body: "Chưa gửi",
          target: { type: "all" },
          status: "scheduled",
          scheduledAt: "2026-08-11T13:00:00.000Z"
        }
      }
    }
  };
  const sentMessages = [];
  const messaging = {
    sendEachForMulticast: async (message) => {
      sentMessages.push(message);
      return { successCount: 1, failureCount: 0, responses: [{ success: true }] };
    }
  };

  const results = await processScheduledCampaigns({
    db: createFakeDb(state, { transactionStartsEmpty: true }),
    messaging,
    messagingProjectId: "poso-2026",
    now
  });

  assert.equal(results.length, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(state.systemAdmin.notificationCampaigns.due.status, "sent");
  assert.equal(state.systemAdmin.notificationCampaigns.future.status, "scheduled");
});

test("worker phục hồi campaign bị kẹt sending quá 10 phút", async () => {
  const now = Date.parse("2026-08-12T04:20:00.000Z");
  const state = {
    users: {
      owner: {
        notificationTokens: { fcmToken: "scheduled-token" },
        shops: { shopA: { role: "owner" } }
      }
    },
    shops: { shopA: shops.shopA },
    systemAdmin: {
      notificationCampaigns: {
        stuck: {
          title: "Campaign bị kẹt",
          body: "Gửi lại",
          target: { type: "shop", shopId: "shopA" },
          status: "sending",
          scheduledAt: "2026-08-12T03:00:00.000Z",
          startedAt: "2026-08-12T04:00:00.000Z"
        }
      }
    }
  };
  const messaging = {
    sendEachForMulticast: async () => ({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }]
    })
  };

  const results = await processScheduledCampaigns({
    db: createFakeDb(state, { transactionStartsEmpty: true }),
    messaging,
    now
  });

  assert.equal(results.length, 1);
  assert.equal(state.systemAdmin.notificationCampaigns.stuck.status, "sent");
});
