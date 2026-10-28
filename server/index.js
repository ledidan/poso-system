import "dotenv/config";
import { createApp } from "./app.js";
import { assertProductionConfig } from "./security.js";
import { getFirebaseServices, hasFirebaseConfig } from "./firebase.js";
import { processScheduledCampaigns } from "./notification-campaign.js";

assertProductionConfig({ databaseConfigured: hasFirebaseConfig() });
const services = hasFirebaseConfig() ? getFirebaseServices() : {};
const { app, auth } = createApp({ services });
const port = Number(process.env.PORT) || 4100;
if (services.db) {
  let running = false;
  const runCampaignWorker = async () => {
    if (running) return;
    running = true;
    try { await processScheduledCampaigns(services); }
    catch (error) { console.error("Scheduled campaign worker failed:", error); }
    finally { running = false; }
  };
  setTimeout(runCampaignWorker, 1_000).unref();
  setInterval(runCampaignWorker, 30_000).unref();
}
const cleanup = () => auth.store.cleanup(Date.now()).catch((error) => console.error("Security state cleanup failed:", error));
setInterval(cleanup, 15 * 60 * 1000).unref();

app.listen(port, () => console.log(`POSO Central Admin API listening on port ${port}`));
