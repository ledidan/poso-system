const validID = (id) => typeof id === "string" && id.length > 0 && !/[.#$\[\]/\u0000-\u001f]/.test(id);
const owners = (people) => Object.entries(people || {}).filter(([, person]) => person.role === "owner" && person.isActive !== false).map(([id]) => id);
const common = (first, second) => first.filter((id) => second.includes(id));
// Adopt existing parent/child relationships once, after verifying a shared owner.
// New stores use protected subscriptionRootID/Branches metadata directly.
export const resolveSubscriptionGroup = async ({ db, shopID }) => {
  const canonical = (await db.ref(`shops/${shopID}/subscriptionRootID`).once("value")).val();
  if (canonical) return { rootShopID: canonical, updates: null };
  if (!(await db.ref(`shops/${shopID}/basicInfo`).once("value")).exists()) return { rootShopID: shopID, updates: null };
  let rootShopID = shopID;
  let sharedOwners = owners((await db.ref(`shops/${shopID}/personnelPins`).once("value")).val());
  const visited = new Set([shopID]);
  for (let depth = 0; depth < 20; depth++) {
    const parent = (await db.ref(`shops/${rootShopID}/basicInfo/branchInfo/parentShopID`).once("value")).val();
    if (!validID(parent) || visited.has(parent)) break;
    const nextOwners = owners((await db.ref(`shops/${parent}/personnelPins`).once("value")).val());
    const overlap = common(sharedOwners, nextOwners);
    if (!overlap.length) break;
    sharedOwners = overlap; rootShopID = parent; visited.add(parent);
    const linked = (await db.ref(`shops/${parent}/subscriptionRootID`).once("value")).val();
    if (linked && linked !== parent) {
      if (!validID(linked) || visited.has(linked)) break;
      const ownerOverlap = common(sharedOwners, owners((await db.ref(`shops/${linked}/personnelPins`).once("value")).val()));
      if (!ownerOverlap.length) break;
      sharedOwners = ownerOverlap; rootShopID = linked; visited.add(linked);
    }
  }
  const existing = (await db.ref(`shops/${rootShopID}/subscriptionBranches`).once("value")).val() || {};
  const branchIDs = new Set([rootShopID, ...Object.keys(existing).filter((id) => existing[id]), ...visited]);
  const memberships = await Promise.all(sharedOwners.map((id) => db.ref(`users/${id}/shops`).once("value")));
  const candidates = new Set();
  memberships.forEach((snapshot) => {
    const shops = snapshot.val() || {};
    if (shops[rootShopID]?.role !== "owner" || shops[rootShopID]?.isActive === false) return;
    Object.entries(shops).forEach(([id, membership]) => { if (membership.role === "owner" && membership.isActive !== false && validID(id)) candidates.add(id); });
  });
  const profiles = await Promise.all([...candidates].map(async (id) => {
    const [parent, linked, deleted] = await Promise.all([
      db.ref(`shops/${id}/basicInfo/branchInfo/parentShopID`).once("value"),
      db.ref(`shops/${id}/subscriptionRootID`).once("value"), db.ref(`shops/${id}/isDeleted`).once("value"),
    ]);
    return { id, parent: parent.val(), linked: linked.val(), deleted: deleted.val() };
  }));
  let changed = true;
  while (changed) {
    changed = false;
    profiles.forEach((profile) => {
      if (!profile.deleted && (!profile.linked || profile.linked === rootShopID) && branchIDs.has(profile.parent) && !branchIDs.has(profile.id)) { branchIDs.add(profile.id); changed = true; }
    });
  }
  const updates = {};
  for (const id of branchIDs) {
    updates[`shops/${id}/subscriptionRootID`] = rootShopID;
    updates[`shops/${rootShopID}/subscriptionBranches/${id}`] = true;
  }
  return { rootShopID, branchIDs: [...branchIDs], updates };
};
