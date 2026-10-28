// Production state is separate from merchant accounts and subscription data.
export const createDatabaseAuthStore = (db) => {
  const root = "systemAdmin/security";
  return {
    async updateLimit(key, updater) {
      const result = await db.ref(`${root}/loginLimits/${key}`).transaction(updater, undefined, false);
      return { committed: result.committed, value: result.snapshot.val() };
    },
    async saveSession(id, session) { await db.ref(`${root}/sessions/${id}`).set(session); },
    async getSession(id) { return (await db.ref(`${root}/sessions/${id}`).once("value")).val(); },
    async deleteSession(id) { await db.ref(`${root}/sessions/${id}`).remove(); },
    async cleanup(now) {
      for (const [collection, field] of [["sessions", "expiresAt"], ["loginLimits", "resetAt"]]) {
        const snapshot = await db.ref(`${root}/${collection}`).orderByChild(field).endAt(now).limitToFirst(200).once("value");
        // Recheck atomically: an expired record may have been renewed after the query.
        for (const id of Object.keys(snapshot.val() || {})) {
          await db.ref(`${root}/${collection}/${id}`).transaction((current) =>
            current && current[field] <= now ? null : undefined, undefined, false);
        }
      }
    }
  };
};

// Local development and isolated tests only; production must supply a shared store.
export const createMemoryAuthStore = () => {
  const limits = new Map(), sessions = new Map();
  return {
    async updateLimit(key, updater) {
      const value = updater(structuredClone(limits.get(key) || null));
      if (value === undefined) return { committed: false, value: structuredClone(limits.get(key) || null) };
      if (value === null) limits.delete(key); else limits.set(key, structuredClone(value));
      return { committed: true, value: structuredClone(value) };
    },
    async saveSession(id, session) { sessions.set(id, structuredClone(session)); },
    async getSession(id) { return structuredClone(sessions.get(id) || null); },
    async deleteSession(id) { sessions.delete(id); },
    async cleanup(now) {
      for (const [id, value] of limits) if (value.resetAt <= now) limits.delete(id);
      for (const [id, value] of sessions) if (value.expiresAt <= now) sessions.delete(id);
    }
  };
};
