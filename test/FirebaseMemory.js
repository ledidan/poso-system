const clone = (value) => value === undefined ? null : JSON.parse(JSON.stringify(value));

export const createMemoryDatabase = (initial = {}) => {
  const data = clone(initial);
  let sequence = 0;
  const read = (path = "") => clone(path.split("/").filter(Boolean).reduce((node, key) => node?.[key], data));
  const write = (path, value) => {
    const keys = path.split("/").filter(Boolean);
    const last = keys.pop();
    const parent = keys.reduce((node, key) => node[key] ||= {}, data);
    if (value === null) delete parent[last]; else parent[last] = clone(value);
  };
  const snapshot = (path, value = read(path)) => ({ val: () => clone(value), exists: () => value !== null });
  const db = { data, read, write, reads: [], writes: [], beforeTransaction: null, ref(path = "") {
    let field, equality, upperBound, limit;
    return {
      orderByChild(key) { field = key; return this; },
      equalTo(value) { equality = value; return this; },
      endAt(value) { upperBound = value; return this; },
      limitToFirst(value) { limit = value; return this; },
      async once(_event, callback) {
        db.reads.push(path);
        let value = read(path);
        if (field && value) value = Object.fromEntries(Object.entries(value).filter(([, item]) => {
          const selected = field.split("/").reduce((node, key) => node?.[key], item);
          return upperBound !== undefined ? selected <= upperBound : selected === equality;
        }).slice(0, limit));
        const result = snapshot(path, value); callback?.(result); return result;
      },
      async set(value, callback) { db.writes.push(path); write(path, value); callback?.(null); },
      async update(updates, callback) {
        for (const [key, value] of Object.entries(updates)) { const target = [path, key].filter(Boolean).join("/"); db.writes.push(target); write(target, value); }
        callback?.(null);
      },
      async remove() { db.writes.push(path); write(path, null); },
      push(value) {
        const key = `generated-${++sequence}`;
        if (value !== undefined) { db.writes.push(`${path}/${key}`); write(`${path}/${key}`, value); }
        const child = { ...db.ref(`${path}/${key}`), key };
        return { ...child, then(resolve, reject) { return Promise.resolve(child).then(resolve, reject); } };
      },
      child(key) { return db.ref(`${path}/${key}`); },
      async transaction(updater) {
        await db.beforeTransaction?.(path);
        const next = updater(read(path));
        if (next === undefined) return { committed: false, snapshot: snapshot(path) };
        db.writes.push(path); write(path, next); return { committed: true, snapshot: snapshot(path) };
      },
    };
  } };
  return db;
};
