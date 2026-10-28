// A stateless subset of the Admin Database interface used by this application.
// Conditional REST writes retain transaction semantics across Worker instances.
const snapshot = (value) => ({ val: () => structuredClone(value), exists: () => value !== null && value !== undefined });
const validSegment = (value) => value.length > 0 && !/[.#$\[\]\u0000-\u001f\u007f]/.test(value);
const serialize = (value) => JSON.stringify(value, (key, item) => {
  if (item === undefined || typeof item === "function" || typeof item === "symbol" || (typeof item === "number" && !Number.isFinite(item))) throw new Error("Invalid database value.");
  return item;
});
const normalize = (value) => {
  if (typeof value !== "string") throw new Error("Invalid database path.");
  const parts = value.split("/").filter(Boolean);
  if (!parts.every(validSegment)) throw new Error("Invalid database path.");
  return parts.join("/");
};
export const createRestDatabase = ({ databaseURL, getToken, fetcher = fetch }) => {
  const base = new URL(databaseURL);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/" || !/\.(firebaseio\.com|firebasedatabase\.app)$/.test(base.hostname)) throw new Error("Invalid database URL.");
  const send = async (path, { method = "GET", body, headers = {}, query = {} } = {}) => {
    const url = new URL(`${path.split("/").map(encodeURIComponent).join("/")}.json`, base);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, JSON.stringify(value));
    const payload = body !== undefined ? serialize(body) : undefined;
    const response = await fetcher(url, { method, headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json", ...headers }, ...(payload !== undefined ? { body: payload } : {}), signal: AbortSignal.timeout(20_000) });
    if (!response.ok && response.status !== 412) {
      await response.body?.cancel();
      throw new Error(`Database request failed (${response.status}).`);
    }
    return response;
  };
  const reference = (path, query = {}) => {
    const ref = {
      key: path.split("/").at(-1) || null,
      child: (child) => reference(normalize(`${path}/${child}`)),
      orderByChild: (field) => reference(path, { ...query, orderBy: field }),
      startAt: (value) => reference(path, { ...query, startAt: value }),
      endAt: (value) => reference(path, { ...query, endAt: value }),
      equalTo: (value) => reference(path, { ...query, equalTo: value }),
      limitToFirst: (value) => reference(path, { ...query, limitToFirst: value }),
      limitToLast: (value) => reference(path, { ...query, limitToLast: value }),
      async once(event, callback) {
        if (event !== "value") throw new Error("Only value snapshots are supported.");
        const result = snapshot(await (await send(path, { query })).json());
        callback?.(result);
        return result;
      },
      async set(value, callback) {
        try { const response = await send(path, { method: "PUT", body: value }); await response.body?.cancel(); callback?.(null); }
        catch (error) { callback?.(error); throw error; }
      },
      async update(updates, callback) {
        try {
          if (!updates || Array.isArray(updates) || typeof updates !== "object") throw new Error("Invalid database updates.");
          for (const key of Object.keys(updates)) normalize(key);
          const response = await send(path, { method: "PATCH", body: updates }); await response.body?.cancel(); callback?.(null);
        } catch (error) { callback?.(error); throw error; }
      },
      async remove(callback) {
        try { const response = await send(path, { method: "DELETE" }); await response.body?.cancel(); callback?.(null); }
        catch (error) { callback?.(error); throw error; }
      },
      push(value, callback) {
        const child = reference(`${path ? `${path}/` : ""}${crypto.randomUUID().replace(/-/g, "")}`);
        if (value === undefined) return child;
        const promise = child.set(value, callback);
        return { ...child, then: (resolve, reject) => promise.then(() => child).then(resolve, reject), catch: (reject) => promise.catch(reject) };
      },
      async transaction(updater, onComplete) {
        try {
          let response = await send(path, { headers: { "X-Firebase-ETag": "true" } });
          for (let retry = 0; retry < 25; retry++) {
            const current = await response.json(), etag = response.headers.get("etag");
            const next = updater(structuredClone(current));
            if (next === undefined) {
              const result = { committed: false, snapshot: snapshot(current) }; onComplete?.(null, false, result.snapshot); return result;
            }
            if (!etag) throw new Error("Database transaction requires an ETag.");
            response = await send(path, { method: "PUT", body: next, headers: { "if-match": etag, "X-Firebase-ETag": "true" } });
            if (response.status !== 412) {
              const result = { committed: true, snapshot: snapshot(await response.json()) }; onComplete?.(null, true, result.snapshot); return result;
            }
          }
          throw new Error("Database transaction conflict limit reached.");
        } catch (error) { onComplete?.(error, false, null); throw error; }
      }
    };
    return ref;
  };
  return { ref: (path) => {
    if (path === undefined) return reference("");
    if (path === "") throw new Error("Explicit empty database paths are invalid.");
    return reference(normalize(path));
  } };
};
