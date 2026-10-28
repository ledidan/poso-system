# POSO Central Admin

Hệ thống quản trị tập trung, tách biệt với `be-online-ordering`. Frontend dùng
React + Vite, API dùng Express và đọc Firebase Realtime Database bằng Firebase
Admin SDK.

## Chức năng

- Dashboard doanh thu, đơn hàng, tổng người dùng và kiểm soát subscription.
- Danh sách, tìm kiếm, lọc, tạo và cập nhật cửa hàng.
- Xuất Excel chi tiết cửa hàng theo kết quả đang lọc hoặc toàn bộ danh sách,
  chọn thống kê 7/30/90/365 ngày, gồm tổng quan, cửa hàng, subscription và nhân sự.
- Thêm, sửa, xóa người dùng và phân quyền vào nhiều cửa hàng.
- Quản lý subscription, hạn mức đơn hàng và thời hạn sử dụng.
- Chi tiết cửa hàng, đơn hàng gần đây và nhân sự.
- Theo dõi đơn hàng toàn hệ thống theo từng cửa hàng.
- Gửi campaign notification đến toàn bộ người dùng, owner theo cửa hàng hoặc
  owner theo nhóm doanh thu trung bình.
- Cho phép gửi campaign ngay hoặc lên lịch tự động theo ngày, giờ; campaign đang
  chờ có thể hủy từ danh sách quản trị.
- Cấu hình doanh thu trung bình và bật/tắt campaign, báo cáo doanh thu cuối ngày
  cho từng cửa hàng.
- Chăm sóc cơ bản: tra cứu người dùng hệ thống, tạo và cập nhật yêu cầu hỗ trợ tài khoản.
- Đăng nhập bằng tài khoản quản trị khai báo trong `.env`.
- Giao diện dùng Noto Sans, hỗ trợ dấu tiếng Việt và tải font từ cùng server.
- API chỉ trả các trường quản trị an toàn, không trả cấu hình hóa đơn hay token
  tích hợp của cửa hàng.

## Cấu hình

```bash
cp .env.example .env
```

Điền Firebase service account giống project đang được dùng bởi backend, sau đó
cấu hình tài khoản quản trị và khóa ký phiên đăng nhập:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-unique-credential-at-least-16-characters
ADMIN_SESSION_SECRET=<generate-with-openssl-rand-hex-32>
ADMIN_COOKIE_SECURE=false

# Không bắt buộc. Dùng khi FCM thuộc Firebase project khác database.
FCM_FIREBASE_PROJECT_ID=poso-2026
FCM_FIREBASE_CLIENT_EMAIL=firebase-adminsdk@poso-2026.iam.gserviceaccount.com
FCM_FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
```

Tên đăng nhập và mật khẩu chỉ được đọc tại Express. Trình duyệt nhận cookie
phiên `HttpOnly`, không nhận giá trị mật khẩu hoặc khóa ký phiên.
Production luôn bật cookie `Secure` và từ chối HTTP. Khai báo `ADMIN_ORIGIN` là
origin HTTPS công khai. Nếu đứng sau reverse proxy, khai báo `TRUST_PROXY` bằng
IP/CIDR của các proxy thực sự tin cậy; không dùng `true` hoặc số hop chung chung.
Nếu khai báo cấu hình FCM riêng thì phải khai báo đủ cả ba biến `FCM_*` ở trên.
Campaign dùng Android channel `poso_notifications_v2`, sound `poso_alert` và
iOS sound `poso-alert.wav`.

Các cấu hình cửa hàng được lưu tại `shops/${shopID}/basicInfo`:

```json
{
  "revenueAverage": "under_1b",
  "notificationSettings": {
    "enabled": true,
    "campaignEnabled": true,
    "dailyRevenueEnabled": true,
    "dailyRevenueTime": "23:55"
  }
}
```

`revenueAverage` nhận `under_500m`, `under_1b` hoặc `one_to_three_b`. Cửa hàng
cũ chưa có `notificationSettings` được xem là đang bật để giữ tương thích.
Worker campaign kiểm tra lịch gửi mỗi 30 giây. Backend báo cáo doanh thu kiểm tra
mỗi phút và chỉ gửi khi đã tới `dailyRevenueTime` của từng cửa hàng.

## Chạy local

```bash
npm install
npm run dev
```

- Giao diện: `http://localhost:5173`
- API: `http://localhost:4100`

## Xuất Excel quản lý cửa hàng

Trong **Cửa hàng → Xuất Excel**, chọn phạm vi và kỳ thống kê rồi bấm
**Tải file Excel**. File `.xlsx` có 4 sheet:

- **Tổng quan**: thời điểm xuất, bộ lọc, kỳ thống kê và các tổng số có công thức.
- **Cửa hàng**: liên hệ, ngành hàng, chủ cửa hàng, trạng thái, ngày tạo, doanh thu
  đơn hoàn tất, đơn xử lý/hủy/hoàn trả, khách hàng, sản phẩm, nhân sự, tồn kho thấp
  và thiết lập thông báo.
- **Subscription**: cửa hàng trung tâm, số gian hàng dùng chung, gói đăng ký và
  gói thực tế, ngày bắt đầu/hết hạn, số ngày còn lại, hạn mức và tính năng.
- **Nhân sự**: tài khoản, mã nhân sự, họ tên, vai trò, trạng thái truy cập và
  cấu hình tham gia tính lương theo từng cửa hàng.

API `GET /api/admin/stores/export.xlsx?search=&status=all&days=30` yêu cầu phiên
quản trị. `days` nhận số nguyên 1–365, mặc định 30. File có bộ lọc, cố định hàng
tiêu đề và 2 cột nhận diện, số tiền/số lượng/ngày có kiểu Excel tương ứng.
Ngày giờ hiển thị theo GMT+7. Doanh thu là tổng `total` của `pastOrders` trong
kỳ tính tới thời điểm xuất, chưa trừ hoàn trả. Khách hàng/sản phẩm/nhân sự và đơn
đang xử lý là số liệu hiện tại. Hạn mức subscription dùng chung theo cửa hàng
trung tâm. Cửa hàng đã xóa và chi nhánh của trung tâm đã xóa được loại khỏi file.
Xuất file chỉ đọc dữ liệu, không khởi tạo hạn mức hay sửa liên kết subscription.
File không chứa mật khẩu, PIN, token hoặc cấu hình tích hợp riêng của cửa hàng.

## Production

Triển khai **Cloudflare Workers, không dùng VPS**: làm theo
[hướng dẫn cấu hình Workers](docs/deploy-cloudflare-workers.md). Repo đã có
`wrangler.jsonc`, backend Workers, static assets và Cron Trigger. Dùng
`npm run build:worker` để dry-run, rồi deploy với secrets production riêng.
Local giữ `.env` với `ADMIN_ORIGIN=http://localhost:5173`; Workers local dùng
`.dev.vars` riêng. Hướng dẫn Node bên dưới áp dụng cho hosting Node thông thường.

```bash
npm run build
npm start
```

Express phục vụ cả API và frontend tại cổng 4100, sau reverse proxy có HTTPS.
`npm start` từ chối khởi động nếu thiếu cấu hình production an toàn. Không mở
cổng backend trực tiếp ra Internet nếu đang tin cậy một reverse proxy.

```env
ADMIN_ORIGIN=https://<your-admin-domain>
TRUST_PROXY=<trusted-proxy-IP-or-CIDR>
```

Đăng nhập sai 5 lần trong cửa sổ 15 phút sẽ khóa 15 phút kể từ lần sai thứ 5.
Bộ đếm áp dụng theo tài khoản và IP, dùng transaction trong database để tồn tại
qua restart và dùng chung giữa nhiều instance. Đăng nhập đúng trước khi khóa
sẽ đặt lại bộ đếm; khi đang khóa, mật khẩu đúng cũng bị từ chối. Giao diện hiển
thị số lần còn lại và thời gian chờ từ server.

Phiên có hạn 8 giờ, lưu trong database, dùng cookie `HttpOnly`, `SameSite=Strict`
và `Secure` trong production. Đăng xuất thu hồi phiên ở server; thay username,
mật khẩu hoặc khóa ký làm phiên cũ hết hiệu lực. Trình duyệt tự quay về trang
đăng nhập khi nhận HTTP 401. Cookie từ phiên bản cũ yêu cầu đăng nhập lại.

Mọi request ghi `/api/*` phải có `Content-Type: application/json` và
`X-Requested-With: POSO-Admin`. Frontend đã gửi các header này. Request từ origin
khác bị từ chối; API không mở CORS. Client/script riêng cần cập nhật header.

Trước khi triển khai, đọc [báo cáo bảo mật và các điều kiện còn thiếu](docs/production-security-review-2026-10-27.md).
File `.env.example` chỉ chứa placeholder. Không đưa `.env`, service account,
private key hoặc token tích hợp vào Git hay frontend.
# poso-system
