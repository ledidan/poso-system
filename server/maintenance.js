import express from "express";
import { customAlphabet } from "nanoid";

const createId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const path = "systemAdmin/maintenance";
const validId = id => typeof id === "string" && /^[a-z0-9-]{1,64}$/.test(id) && !["constructor", "prototype"].includes(id);
const fail = message => Object.assign(new Error(message), { status: 400 });
export const validateMaintenance = (input = {}) => {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!title || title.length > 120) throw fail("Tiêu đề cần từ 1 đến 120 ký tự.");
  if (!message || message.length > 2000) throw fail("Nội dung cần từ 1 đến 2.000 ký tự.");
  const dates = {};
  for (const key of ["displayFrom", "startsAt", "endsAt"]) {
    if (typeof input[key] !== "string" || !Number.isFinite(Date.parse(input[key]))) throw fail("Vui lòng nhập đủ thời gian hiển thị và thời gian bảo trì hợp lệ.");
    dates[key] = new Date(input[key]).toISOString();
  }
  if (Date.parse(dates.endsAt) <= Date.parse(dates.startsAt)) throw fail("Thời gian kết thúc phải sau thời gian bắt đầu.");
  if (Date.parse(dates.displayFrom) >= Date.parse(dates.endsAt)) throw fail("Thời gian hiển thị phải trước thời gian kết thúc.");
  if (!["draft", "published"].includes(input.status)) throw fail("Trạng thái thông báo không hợp lệ.");
  if (!Array.isArray(input.audiences) || !input.audiences.length || input.audiences.some(value => !["merchant", "mobile"].includes(value))) throw fail("Chọn ít nhất một nơi hiển thị hợp lệ.");
  return { title, message, ...dates, status: input.status, audiences: [...new Set(input.audiences)] };
};
const publicNotice = notice => Object.fromEntries(["id", "title", "message", "displayFrom", "startsAt", "endsAt", "audiences", "updatedAt"].map(key => [key, notice[key]]));

export const saveMaintenance = async ({ db, id = createId(), input, actor, now = Date.now() }) => {
  if (!validId(id)) throw fail("Mã thông báo không hợp lệ.");
  const fields = validateMaintenance(input);
  if (fields.status === "published" && Date.parse(fields.endsAt) <= now) throw fail("Không thể công bố thông báo đã hết thời gian bảo trì.");
  const timestamp = new Date(now).toISOString();
  let saved;
  await db.ref(path).transaction(state => {
    state ||= {};
    const previous = state.notices?.[id];
    saved = { ...fields, id, createdAt: previous?.createdAt || timestamp, createdBy: previous?.createdBy || actor, updatedAt: timestamp, updatedBy: actor };
    state.notices ||= {};
    if (fields.status === "published") {
      const replaced = state.current?.id;
      if (replaced && replaced !== id && state.notices[replaced]) state.notices[replaced] = { ...state.notices[replaced], status: "retired", updatedAt: timestamp, updatedBy: actor };
      state.current = publicNotice(saved);
    } else if (state.current?.id === id) state.current = null;
    state.notices[id] = saved;
    return state;
  });
  return saved;
};
export const cancelMaintenance = async ({ db, id, actor, now = Date.now() }) => {
  if (!validId(id)) throw fail("Mã thông báo không hợp lệ.");
  let found = false;
  await db.ref(path).transaction(state => {
    found = Boolean(state?.notices?.[id]);
    if (!found) return;
    state.notices[id] = { ...state.notices[id], status: "canceled", updatedAt: new Date(now).toISOString(), updatedBy: actor };
    if (state.current?.id === id) state.current = null;
    return state;
  });
  if (!found) throw Object.assign(new Error("Không tìm thấy thông báo bảo trì."), { status: 404 });
};
export const createMaintenanceRouter = ({ db }) => {
  const router = express.Router();
  const handle = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : "Không thể cập nhật thông báo bảo trì. Vui lòng thử lại." }); }
  };
  router.get("/", handle(async (_req, res) => {
    const snapshot = await db.ref(`${path}/notices`).once("value");
    const notices = Object.values(snapshot.val() || {}).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    res.json({ notices: notices.slice(0, 100), serverTime: new Date().toISOString() });
  }));
  router.post("/", handle(async (req, res) => res.status(201).json({ notice: await saveMaintenance({ db, input: req.body, actor: req.adminUser.username }) })));
  router.put("/:noticeId", handle(async (req, res) => res.json({ notice: await saveMaintenance({ db, id: req.params.noticeId, input: req.body, actor: req.adminUser.username }) })));
  router.post("/:noticeId/cancel", handle(async (req, res) => {
    await cancelMaintenance({ db, id: req.params.noticeId, actor: req.adminUser.username });
    res.json({ success: true });
  }));
  return router;
};
