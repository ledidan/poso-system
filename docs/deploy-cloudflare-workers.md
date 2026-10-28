# Deploy POSO Central Admin trên Cloudflare Workers

Không cần VPS. React và font được phục vụ bằng Workers Assets; API Express chạy
trong Workers qua `httpServerHandler`. Database hiện có được giữ nguyên, truy cập
qua HTTPS REST với service account. Không cần chuyển dữ liệu sang D1/KV.

Cấu hình đã có ở `wrangler.jsonc`, entrypoint `server/worker.js`. Worker dùng
Cron Trigger mỗi phút để xử lý campaign theo lịch; có thể trễ tối đa khoảng một
phút so với giờ đã chọn. Dọn phiên và bộ đếm hết hạn mỗi 15 phút. Không dùng
`npm start`, `server/index.js` hoặc process chạy nền trên Cloudflare.

## 1. Local hiện tại

- Giao diện: http://localhost:5173
- API: http://localhost:4100/api/health
- Chạy lại khi cần: `npm run dev`.
- `.env` đang dùng local, với `ADMIN_ORIGIN=http://localhost:5173` và
  `ADMIN_COOKIE_SECURE=false`. Không đổi file này thành cấu hình domain production.
- Đã xác nhận login/session/danh sách 7 cửa hàng trả 200 và logout trả 204.
  Các bước này chỉ ghi trạng thái phiên/bộ đếm bảo mật, không sửa dữ liệu cửa hàng.

Wrangler local dùng `.dev.vars` riêng. File này và `.env*` đều được Git ignore;
chỉ các file `*.example` đã làm sạch được đưa vào source. `.dev.vars` local đã
được tạo bằng tài khoản kiểm thử riêng, không dùng tài khoản đó làm production.

## 2. Chuẩn bị account và source

1. Dùng Node.js 22 trở lên trên máy build, đăng nhập đúng Cloudflare account.
2. Với chức năng hiện có, nên dùng **Workers Paid**: Free giới hạn 10 ms CPU và
   50 subrequest/invocation, có thể không đủ cho bcrypt, xuất Excel và tổng hợp
   nhiều cửa hàng. Chưa đo CPU/quota trên deployment thật. Không có thay đổi gói
   hoặc phát sinh deployment nào được thực hiện trong bước chuẩn bị này.
3. Kiểm tra tên Worker trong `wrangler.jsonc`: mặc định `poso-central-admin`.
   Đổi tên nếu account đã có Worker khác cùng tên.
4. Trước deploy, thay các private key/secret từng nằm trong file mẫu cũ. Bản mẫu
   hiện chỉ chứa placeholder; làm sạch file không thu hồi các key cũ.
5. Đưa đầy đủ `server/`, `shared/`, `src/`, `public/`, manifest/lockfile và
   `wrangler.jsonc` vào Git nếu deploy qua Git. Checkout hiện có các file chưa track.

```bash
npm ci
npm test
npm run build:worker
npx wrangler login
npx wrangler whoami
```

`build:worker` là dry-run: build frontend và đóng gói Worker tại `worker-dist/`,
không upload hay kích hoạt ứng dụng. Cấu hình compatibility date đã bật Node
compatibility. Alias `iconv-lite` dùng bản mới để tránh lỗi stream khi khởi động
Express/body-parser trong Workers.

## 3. Tạo file secrets production riêng

```bash
cp .dev.vars.example .env.worker.production
chmod 600 .env.worker.production
```

Sửa file `.env.worker.production` trên máy anh, không commit hoặc gửi file đó vào
chat. Tạo các giá trị ngẫu nhiên riêng bằng:

```bash
openssl rand -hex 24
openssl rand -hex 32
```

Dùng kết quả thứ nhất làm mật khẩu; kết quả thứ hai làm khóa phiên. Không dùng
lại khóa JWT hoặc mật khẩu của backend merchant.

| Biến | Giá trị production |
| --- | --- |
| `ADMIN_USERNAME` | Tên đăng nhập quản trị do anh đặt |
| `ADMIN_PASSWORD` | Mật khẩu riêng, tối thiểu 16 ký tự; dùng giá trị ngẫu nhiên ở trên |
| `ADMIN_SESSION_SECRET` | Khóa ngẫu nhiên tối thiểu 32 ký tự, dùng chung giữa các phiên bản của cùng deployment |
| `ADMIN_ORIGIN` | Origin HTTPS anh sẽ dùng, ví dụ `https://admin.example.com`; không có path hoặc `/` cuối |
| `ADMIN_COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | Để trống; adapter Workers tự xác định HTTPS và IP từ request ở edge |
| `FIREBASE_PROJECT_ID` | Project database hiện có |
| `FIREBASE_DATABASE_URL` | URL HTTPS của Realtime Database, lấy từ project đó |
| `FIREBASE_CLIENT_EMAIL` | Email của service account có quyền truy cập database |
| `FIREBASE_PRIVATE_KEY` | Private key mới tương ứng service account, dạng PEM đầy đủ |

Private key có thể dùng newline thật trong giá trị được quote, hoặc viết trên một
dòng với `\n` như file mẫu. Không thêm prefix `VITE_` cho các biến này. Chỉ khai
báo các biến ứng dụng cần; không copy nguyên `.env` backend merchant lên Worker.
`NODE_ENV` đã được định nghĩa là production khi đóng gói Worker, không cần khai
báo lại. Không cần `PORT`, Redis, Typesense hoặc Shopee credentials.

Nếu gửi thông báo bằng project khác database, khai báo đủ cả ba biến:

```env
FCM_FIREBASE_PROJECT_ID=<messaging-project>
FCM_FIREBASE_CLIENT_EMAIL=<messaging-service-account-email>
FCM_FIREBASE_PRIVATE_KEY="<full-private-key-PEM>"
```

Nếu dùng cùng project thì xóa ba dòng trống `FCM_*` khỏi file production để dùng
credential chính. Service account gửi thông báo phải có quyền gửi FCM và FCM
HTTP v1 API phải được bật. Không dùng API key của ứng dụng web thay private key.

Khi chưa có custom domain, có thể đặt `ADMIN_ORIGIN` thành Workers URL của account:
`https://poso-central-admin.<your-workers-subdomain>.workers.dev`. Lấy subdomain
thực tế trong Cloudflare account; không dùng nguyên placeholder này. Sau khi
chuyển custom domain, cập nhật origin rồi deploy lại. Mỗi deployment chỉ chấp
nhận một origin cho request ghi; mở ứng dụng bằng đúng origin đó.

## 4. Thêm index bảo mật trước khi chạy Cron

Tại Firebase Console → Realtime Database → Rules, merge nhánh sau **bên trong
`rules` hiện có**. Giữ nguyên mọi rules của `shops` và các nhánh đang vận hành.
Không thay toàn bộ rules bằng đoạn ví dụ.

```json
{
  "systemAdmin": {
    "security": {
      ".read": false,
      ".write": false,
      "sessions": { ".indexOn": ["expiresAt"] },
      "loginLimits": { ".indexOn": ["resetAt"] }
    }
  }
}
```

Xác nhận ancestor/root không cấp client quyền đọc/ghi nhánh này: deny ở con
không thu hẹp grant ở cha. Service account vẫn truy cập qua quyền server.
REST yêu cầu có index cho query, nên thiếu index có thể làm Cron cleanup trả lỗi
400 dù login vẫn hoạt động. Một số query khởi tạo hạn mức còn dùng `timeStamp`
trên các bucket đơn hàng; giữ các index nghiệp vụ đang có. Theo dõi log khi chạy
với dữ liệu lớn và bổ sung index đúng query, không mở quyền đọc database.

## 5. Deploy bằng CLI

Sau khi đã thay key, điền secrets và cập nhật rules/index:

```bash
npm run build
npx wrangler deploy --secrets-file .env.worker.production
```

Wrangler upload cùng lúc code, static assets, secrets và Cron Trigger đã khai
báo. **Lệnh này đưa ứng dụng lên Cloudflare thật.** Không chạy `npm start` trên
Workers, không upload riêng thư mục `dist` thành một Pages site: Pages chỉ có
frontend sẽ không có các API đang dùng.

Sau lần đầu, có thể dùng `npm run deploy:worker` khi chỉ thay code và muốn giữ
secrets hiện có. Khi thay secrets, dùng lại `--secrets-file` hoặc cập nhật qua
Cloudflare Dashboard → Workers & Pages → chọn Worker → Settings → Variables and
Secrets → Add → Type **Secret** → Deploy. Không đặt password/private key trong
`vars` của source hoặc trong frontend.

## 6. Custom domain

1. Vào Workers & Pages → Worker `poso-central-admin` → Settings → Domains & Routes.
2. Add → Custom Domain, nhập domain anh muốn, ví dụ `admin.example.com`, thuộc
   zone đã quản lý trên Cloudflare.
3. Chờ domain/TLS hoạt động. Dùng cùng domain cho cả frontend và `/api/*`.
4. Đặt `ADMIN_ORIGIN=https://admin.example.com` trong secrets rồi deploy lại.
5. Nếu đã có Cache Rules cho domain, bypass cache đối với `/api/*`; không đặt
   rule Cache Everything bỏ qua `Cache-Control` cho API hoặc nội dung phiên.

Worker đã gửi CSP/HSTS cho frontend và `no-store` cho API. Header IP/protocol
nội bộ luôn được adapter ghi đè; không tin `X-Forwarded-*` do client gửi.

## 7. Nếu deploy qua Git / Workers Builds

- Loại project: Worker, root directory là repo này.
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy`.
- Dùng Node 22 trở lên. Wrangler đã nằm trong devDependencies; máy build phải
  cài devDependencies, không dùng `npm ci --omit=dev` ở bước build.
- Thêm runtime secrets trong Settings → Variables and Secrets của Worker, không
  dùng secrets production làm biến `VITE_*` hoặc đưa file secrets vào Git.
- Cấu hình `ADMIN_ORIGIN` đúng custom domain/Workers URL được chọn.
- Sau deploy, xác nhận cả code version, secrets, static assets và Cron schedule.

## 8. Kiểm tra sau deploy

```bash
curl -i https://<your-admin-host>/api/health
curl -i https://<your-admin-host>/api/admin/me
npx wrangler tail
```

Health phải 200; API quản trị chưa login phải 401. Health chỉ kiểm tra cấu hình
sẵn sàng. Tiếp tục dùng trình duyệt để kiểm tra login, danh sách cửa hàng và xuất
Excel; logout xong cookie cũ phải bị từ chối. Dùng tài khoản/môi trường thử riêng
để kiểm tra sai 5 lần, khóa 15 phút và giữ khóa qua deployment mới. Việc thay
`ADMIN_SESSION_SECRET` chủ động sẽ đổi namespace bộ đếm và vô hiệu hóa phiên cũ.

Theo dõi Triggers/Logs để xác nhận Cron chạy mỗi phút. Chỉ tạo campaign thử khi
đã chọn thiết bị/người nhận kiểm thử được phép; chưa gửi thông báo thật trong
quá trình chuẩn bị. Đo CPU, memory và số subrequest trên traffic đại diện trước
khi mở rộng. Tổng hợp/export hiện đọc cây cửa hàng và có giới hạn memory 128 MB
của Workers; campaign lớn cần đánh giá thêm và có thể cần tách hàng đợi/chia batch.

Lỗi thường gặp:

| Hiện tượng | Kiểm tra |
| --- | --- |
| 503 lúc khởi động | Thiếu secrets, mật khẩu/secret yếu, origin sai hoặc thiếu cấu hình database |
| Login 403 | `ADMIN_ORIGIN` khác domain đang mở; frontend và API phải cùng origin |
| 429 | Tài khoản hoặc IP bị khóa sau 5 lần sai; chờ `Retry-After` |
| API trả HTML | Đang deploy riêng frontend hoặc routes/assets không dùng cấu hình Worker trong repo |
| Cron báo Database 400 | Index của query chưa được khai báo trong database rules |
| FCM lỗi quyền | Kiểm tra project, service account, IAM và FCM HTTP v1 API |
| Error 1102 / resource limit | Xem CPU/memory/subrequest thực tế và gói Workers |

## Đã xác minh và phần còn lại

- Local Node/Vite: login, session, đọc 7 cửa hàng, logout hoạt động.
- Workers runtime local qua Wrangler: frontend + CSP 200; login + Secure cookie;
  session và stores 200; Excel 200 đúng MIME; logout 204; replay phiên cũ 401.
- Bộ REST giữ multi-location PATCH, transaction ETag/retry, hạn mức subscription,
  lock 5 lần và thu hồi phiên. Cron/campaign và payload FCM kiểm thử bằng mock.
- Tài khoản Wrangler local riêng đã xác nhận trực tiếp 4 lần sai trả 401, lần
  sai thứ 5 trả 429 với `Retry-After: 900`; nhập đúng khi đang khóa vẫn bị chặn.
- 64/64 test pass; Workers dry-run thành công; `npm audit` báo 0 advisory.
- Chưa deploy vào account Cloudflare, chưa áp rules/index thật, chưa kiểm tra
  custom domain, quyền gửi/nhận notification thật hoặc quota production.

Tài liệu chính thức:

- [Express trên Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)
- [Workers Secrets và deploy với secrets file](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Static Assets](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Xác thực Database REST](https://firebase.google.com/docs/database/rest/auth)
- [Transaction REST bằng ETag](https://firebase.google.com/docs/database/rest/save-data)
