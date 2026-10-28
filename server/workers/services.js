import { createGoogleTokenProvider } from "./google-auth.js";
import { createRestDatabase } from "./database-rest.js";
import { createRestMessaging } from "./messaging-rest.js";
import { createPlanDatabase } from "../subscriptions/PlanDatabase.js";

export const createWorkerServices = (env) => {
  for (const key of ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_DATABASE_URL"]) {
    if (!env[key]) throw new Error(`Missing service configuration: ${key}`);
  }
  const dedicated = [env.FCM_FIREBASE_PROJECT_ID, env.FCM_FIREBASE_CLIENT_EMAIL, env.FCM_FIREBASE_PRIVATE_KEY];
  if (dedicated.some(Boolean) && !dedicated.every(Boolean)) throw new Error("Dedicated messaging configuration is incomplete.");
  const databaseToken = createGoogleTokenProvider({ email: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY, scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email" });
  const messagingProjectId = env.FCM_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID;
  const messagingToken = createGoogleTokenProvider({ email: env.FCM_FIREBASE_CLIENT_EMAIL || env.FIREBASE_CLIENT_EMAIL, privateKey: env.FCM_FIREBASE_PRIVATE_KEY || env.FIREBASE_PRIVATE_KEY, scope: "https://www.googleapis.com/auth/firebase.messaging" });
  const securityDb = createRestDatabase({ databaseURL: env.FIREBASE_DATABASE_URL, getToken: databaseToken });
  return { securityDb, db: createPlanDatabase(securityDb), messaging: createRestMessaging({ projectId: messagingProjectId, getToken: messagingToken }), messagingProjectId };
};
