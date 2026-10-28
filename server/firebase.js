import { createPlanDatabase } from "./subscriptions/PlanDatabase.js";
import "dotenv/config";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";

const requiredKeys = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_DATABASE_URL"
];

export const hasFirebaseConfig = () => requiredKeys.every((key) => Boolean(process.env[key]));

export const getFirebaseServices = () => {
  if (!hasFirebaseConfig()) {
    throw new Error("Thiếu cấu hình Firebase Admin SDK trong file .env");
  }

  const app = getApps()[0] || initializeApp({
    credential: cert({
      type: process.env.FIREBASE_TYPE || "service_account",
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      clientId: process.env.FIREBASE_CLIENT_ID,
      authUri: process.env.FIREBASE_AUTH_URI,
      tokenUri: process.env.FIREBASE_TOKEN_URI,
      authProviderX509CertUrl: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
      clientC509CertUrl: process.env.FIREBASE_CLIENT_X509_CERT_URL
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });

  const configuredFcmValues = [
    process.env.FCM_FIREBASE_PROJECT_ID,
    process.env.FCM_FIREBASE_CLIENT_EMAIL,
    process.env.FCM_FIREBASE_PRIVATE_KEY
  ];
  const hasAnyDedicatedMessaging = configuredFcmValues.some(Boolean);
  const hasDedicatedMessaging = configuredFcmValues.every(Boolean);
  if (hasAnyDedicatedMessaging && !hasDedicatedMessaging) {
    throw new Error(
      "Cấu hình FCM riêng chưa đầy đủ. Cần FCM_FIREBASE_PROJECT_ID, FCM_FIREBASE_CLIENT_EMAIL và FCM_FIREBASE_PRIVATE_KEY."
    );
  }

  const fcmProjectId = process.env.FCM_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const fcmClientEmail = process.env.FCM_FIREBASE_CLIENT_EMAIL || "";
  const fcmPrivateKey = process.env.FCM_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n") || "";
  let messagingApp = app;
  if (hasDedicatedMessaging) {
    try {
      messagingApp = getApp("poso-fcm");
    } catch {
      messagingApp = initializeApp({
        credential: cert({
          projectId: fcmProjectId,
          clientEmail: fcmClientEmail,
          privateKey: fcmPrivateKey
        })
      }, "poso-fcm");
    }
  }

  return {
    securityDb: getDatabase(app),
    db: createPlanDatabase(getDatabase(app)),
    messaging: getMessaging(messagingApp),
    messagingProjectId: fcmProjectId
  };
};
