# Deploy POSO System trên Vercel

Đích production: `https://poso-system.vercel.app`. Frontend và `/api` cùng domain;
database, sessions và bộ đếm đăng nhập tiếp tục dùng database đang cấu hình.

Đã tối ưu và xác minh độ trễ production: xem
[báo cáo đo trước/sau](production-latency-2026-10-29.md). Function chạy ở Singapore;
lượt đọc đồng thời bị giới hạn theo request, giữ nguyên số liệu và kiểm tra quyền.

## Env đã chuẩn bị

File thật nằm tại `.env.vercel.production`, quyền đọc/ghi `0600`, bị Git ignore
và bị loại khỏi upload Vercel. File này đã sao chép bốn thông tin kết nối database
từ `.env`, giữ username admin hiện tại và sinh riêng các giá trị sau:

- `ADMIN_PASSWORD`: mật khẩu mới dài 48 ký tự, thay cho mật khẩu local 7 ký tự
  không đạt điều kiện production. Chưa thay đổi mật khẩu trên deployment hiện tại.
- `ADMIN_SESSION_SECRET`: chuỗi ngẫu nhiên riêng dài 64 ký tự.
- `CRON_SECRET`: đã sinh riêng để dùng khi bật lại Cron, hiện không bắt buộc.
- `ADMIN_ORIGIN=https://poso-system.vercel.app`.
- `ADMIN_COOKIE_SECURE=true`. Không khai báo `TRUST_PROXY` trên Vercel.
  Không cần tự khai báo `NODE_ENV`;
  lệnh build và API runtime đã đặt production khi chạy.

Mở file riêng để lấy username/password khi đăng nhập; không dán secret vào chat,
source hoặc biến có tiền tố `VITE_`. Mẫu không chứa credential nằm tại
`.env.vercel.production.example`. Không dùng file `.env` local để import production.

Các biến bắt buộc:

| Biến | Nguồn |
| --- | --- |
| `ADMIN_USERNAME` | File production đã chuẩn bị |
| `ADMIN_PASSWORD` | Mật khẩu mới trong file production |
| `ADMIN_SESSION_SECRET` | Secret riêng trong file production |
| `ADMIN_ORIGIN` | `https://poso-system.vercel.app` |
| `FIREBASE_PROJECT_ID` | Service account đang dùng |
| `FIREBASE_CLIENT_EMAIL` | Service account đang dùng |
| `FIREBASE_PRIVATE_KEY` | Private key đầy đủ, gồm BEGIN/END PRIVATE KEY |
| `FIREBASE_DATABASE_URL` | URL Realtime Database đang dùng |

Nếu FCM nằm ở project khác, bổ sung đủ bộ `FCM_FIREBASE_PROJECT_ID`,
`FCM_FIREBASE_CLIENT_EMAIL`, `FCM_FIREBASE_PRIVATE_KEY`. Nếu cùng project thì
không cần khai báo ba biến này. Runtime hỗ trợ PEM chứa newline thật hoặc `\n`.
Khi nhập thủ công vào dashboard, dán PEM nhiều dòng và không thêm dấu ngoặc kép.

## Thiết lập project và deploy

1. Chọn đúng account/team triển khai. `vercel.json` hiện không khai báo Cron,
   nên không còn lỗi giới hạn tần suất Cron khi deploy trên Hobby.
2. Import repository, Root Directory là thư mục project, project name là
   `poso-system`. Kiểm tra domain `poso-system.vercel.app` thuộc đúng project/account.
3. Settings → Environment Variables: import `.env.vercel.production`, chỉ chọn
   **Production**. Giữ private key, mật khẩu và secrets ở chế độ sensitive khi có
   tùy chọn. Không đưa credential production vào Preview/Development.
4. Bật **Enable access to System Environment Variables**. Adapter chỉ tin các
   header IP/protocol của Vercel khi runtime có `VERCEL=1`; thiếu thiết lập này
   có thể khiến API đăng nhập trả 426 do không xác nhận được HTTPS.
5. Giữ build settings theo `vercel.json`: framework Vite, Node `22.x`, install
   `npm ci --include=dev`, build `npm run build`, output `dist`. Lệnh install này
   vẫn cài Vite và plugin build nếu dashboard còn `NODE_ENV=production`.
   Không dùng `npm start` hoặc
   entrypoint `server/worker.js` để deploy Vercel.
   Function chạy tại `sin1` (Singapore), cùng khu vực database `asia-southeast1`.
   Giữ cấu hình region này để các lượt đọc database không đi vòng qua Mỹ.
6. Deploy Production hoặc Redeploy sau khi thêm env. Nếu dùng CLI:

   ```sh
   npx vercel login
   npx vercel link --project poso-system
   ```

   Sau khi đã import env vào đúng project Production:

   ```sh
   npm run deploy:vercel
   ```

CLI cần đăng nhập vào đúng account/team và liên kết đúng project trước khi
upload env hoặc deploy. Không tạo deployment tạm bằng credential production
để thay thế việc đăng nhập vào đúng account.

## Lỗi build thoát với mã 127

Đã tái hiện bằng cài đặt sạch: `NODE_ENV=production npm ci` không cài
`devDependencies`, nên `npm run build` báo `vite: command not found` và trả 127.
`vercel.json` đã đổi Install Command thành `npm ci --include=dev`, giữ build
dependencies trong giai đoạn build dù có `NODE_ENV=production`.

Nếu dashboard đang override Install Command, đặt lại đúng `npm ci --include=dev`
và redeploy source mới. Có thể xóa biến `NODE_ENV` đã nhập thủ công khỏi Vercel;
API runtime vẫn tự đặt production và lệnh build đã có `NODE_ENV=production`.

Nếu API trả 503 sau build thành công, đọc runtime log. Vercel không cần khai báo
`TRUST_PROXY`: adapter xử lý IP/protocol từ edge của Vercel. Xóa override sai
thay vì nhập `true`, `false` hoặc chuỗi dấu ngoặc kép vào giá trị này. Khi dùng CLI
để import env, truyền giá trị đã parse qua stdin; không truyền cả dấu ngoặc kép
của định dạng file env vào giá trị trên dashboard.

## API và Cron

- Một Node Function `api/index.js` phục vụ các API hiện tại qua rewrite `/api/*`.
  Không mở cổng server, chạy `setInterval` hoặc giữ kết nối database thường trực.
- Vercel dùng chung REST adapter với Workers, giữ shallow reads và ETag transaction;
  shared database tiếp tục lưu phiên và khóa sau 5 lần sai trong 15 phút.
- Hiện không có lịch Cron tự động. Campaign đặt lịch và tác vụ dọn state hết hạn
  tạm thời không chạy tự động trên Vercel. Runtime vẫn kiểm tra expiry của session
  và thời hạn khóa sau 5 lần sai khi xử lý request.
- `CRON_SECRET` không bắt buộc để khởi động API. Nếu không cấu hình secret này,
  các đường dẫn `/api/cron/*` trả 404. Nếu đã cấu hình, các endpoint vẫn yêu cầu
  `Authorization: Bearer <CRON_SECRET>` và chỉ chạy khi được gọi bằng secret hợp lệ.
- Khi cần bật lại lịch: thêm `crons` trong `vercel.json`, cấu hình secret riêng và
  chọn gói hỗ trợ tần suất mong muốn. Cookie admin không cấp quyền chạy Cron.
- Function có `maxDuration=300` giây. Đây là giới hạn thời gian của invocation;
  không đảm bảo mọi campaign lớn sẽ hoàn tất. Cần theo dõi thời gian thực tế và
  chia batch khi lượng người nhận tăng.
- Frontend có CSP/HSTS và các security headers từ `vercel.json`; API có Secure,
  HttpOnly, SameSite cookie, CSRF origin check và no-store như trước.

## Index và kiểm tra sau deploy

Đã đọc Rules live bằng credential trong env production: hai index security
`expiresAt`/`resetAt` đã có. Test bằng runtime Node của Vercel từng xác nhận query
subscription bị 400 vì thiếu `timeStamp` tại `tableActiveOrders`. Các bucket
`dineInOrders` và `exchangedOrders` cũng được bootstrap subscription truy vấn theo
`timeStamp` nhưng khi đó chưa có index trong Rules live.

Đã Publish và đọc lại xác minh bản Rules đầy đủ tại
`.wrangler/firebase-rules-vercel-production.json`. Chỉ thêm ba index `timeStamp` vào
`shops/$shopID/tableActiveOrders`, `dineInOrders`, `exchangedOrders`, giữ các index
và quyền hiện có. Bản sao lưu ngay trước khi Publish nằm ở
`.wrangler/firebase-rules-before-production-index-fix.json`; checksum JSON compact:
`19769924efa67110f1cc50c503df42e1c60e668953b5b9066f08adafccfd76a8`.
Biên bản diff/checksum nằm ở `.wrangler/firebase-index-release.json`. Nếu cần
cập nhật Rules về sau, đối chiếu lại Rules live để giữ thay đổi của người khác.

Sau deploy:

1. `https://poso-system.vercel.app/api/health` trả 200 và `ok: true`.
2. `/api/auth/session` và `/api/admin/users` chưa đăng nhập trả 401.
3. Đăng nhập bằng credential trong file production, mở overview, subscriptions,
   users, stores; kiểm tra API trả 200 và cookie có Secure/HttpOnly/SameSite.
4. `/api/cron/campaigns` không có bearer secret trả 404 khi chưa cấu hình Cron,
   hoặc 401 nếu đã khai báo `CRON_SECRET`. Không có lịch tự động trên Vercel;
   không gọi tay endpoint có secret để thử nếu còn campaign thực đang chờ gửi.
5. Đăng xuất rồi mở lại `/api/auth/session` phải trả 401.
6. Nếu không dùng lịch tự động nữa, tắt Cron cũ trên Cloudflare khi hoàn tất chuyển
   sang Vercel. Việc bỏ Cron trong `vercel.json` không đổi lịch ở Cloudflare.

Test local dùng dữ liệu giả kiểm tra HTTPS/origin, đăng nhập, thu hồi phiên giữa
hai instance, khóa 5 lần, phân tách quyền Cron và giữ state chưa hết hạn. Kiểm tra
thêm bằng `@vercel/node` local: health 200, anonymous session/Cron 401, login 200,
overview/users/store-options 200; body JSON lỗi 400 và quá 64 kB trả 413.
Các index còn thiếu đã được Publish trong lần phát hành nêu trên. Test API dùng tài khoản auth kiểm thử
riêng, chỉ đọc dữ liệu nghiệp vụ, không chạy campaign thật. Local không thay thế
xác minh production, quota, quyền FCM và việc nhận push thực.

## Xác minh production ngày 29/10/2026

Đã deploy thành công tới `https://poso-system.vercel.app` bằng deployment
`dpl_5uMSv2rJ5u39eKKAbckNvzB55JAm`. Build Vercel đã dùng
`npm ci --include=dev`; lỗi 127 do thiếu Vite đã hết. Đã đồng bộ env từ file
production qua stdin, giữ secrets ở dạng Secret, xóa override `NODE_ENV` và
`TRUST_PROXY` không cần thiết. Đăng nhập dùng credential trong file production.

Kết quả kiểm tra HTTPS trực tiếp sau deploy:

| Kiểm tra | Kết quả |
| --- | --- |
| Frontend và bundle JavaScript | 200 |
| `/api/health` | 200, `ok: true` |
| Session và API quản trị thiếu đăng nhập | 401 |
| Đăng nhập, cookie Secure/HttpOnly/SameSite | 200 |
| Overview | 200 |
| Subscriptions sau khi bổ sung ba index | 200 |
| Users | 200 |
| Đăng xuất | 204 |
| Dùng lại session đã đăng xuất | 401 |

Không có Cron schedule trong deployment. Chỉ thay đổi Rules bằng ba index
`timeStamp` đã ghi nhận; giữ nguyên toàn bộ quyền đọc/ghi. Các request xác minh
chỉ đọc nghiệp vụ, không chạy campaign hoặc khởi tạo subscription meter.
Biên bản local nằm tại `.wrangler/vercel-production-smoke.json` và
`.wrangler/firebase-index-release.json`.

Nguồn: [Node Functions](https://vercel.com/docs/functions/runtimes/node-js),
[Cron authorization](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[Cron plans](https://vercel.com/docs/cron-jobs/usage-and-pricing),
[system env](https://vercel.com/docs/environment-variables/system-environment-variables).
