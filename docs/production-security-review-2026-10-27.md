# POSO Central Admin — kiểm tra trước production, 27/10/2026

## Cập nhật phương án Cloudflare

Đã bổ sung entrypoint và cấu hình để chạy trực tiếp trên **Cloudflare Workers,
không dùng VPS**. Xem [hướng dẫn Workers](deploy-cloudflare-workers.md) để cấu hình
secrets, database index, domain và deploy. Phần hướng dẫn reverse proxy bên dưới
áp dụng cho phương án Node hosting; Workers không cần khai báo `TRUST_PROXY`.
Sau cập nhật: 64/64 test; Workers local đã xác minh login/stores/export/logout và
khóa 5 lần bằng tài khoản thử riêng; chưa deploy vào Cloudflare account.

## Kết luận

**Chưa đủ điều kiện bật production với cấu hình đang có.** Các thay đổi mã nguồn
đã được kiểm tra local. Cần thay các secret từng có trong file mẫu, đặt mật khẩu
quản trị đủ mạnh, khai báo origin HTTPS và cấu hình proxy/index trước khi deploy.
Chưa deploy ứng dụng, chưa thay rules, chưa ghi dữ liệu nghiệp vụ vào database thật.

## Giao diện

- Noto Sans variable, gồm hai subset Latin và tiếng Việt, được đóng gói cùng
  frontend; không tải Google Fonts. Heading, form, bảng và số liệu dùng cùng font.
- Bỏ nội dung Firebase và tên project gửi khỏi màn hình đăng nhập, gợi ý lỗi và
  chi tiết campaign. API campaign cũng bỏ project ID và thông báo lỗi gốc từ provider.
- Đăng nhập sai có số lần còn lại; đến lần thứ 5 hiển thị thời gian chờ và khóa
  nút. Reload không vượt qua giới hạn vì server kiểm soát bộ đếm.

## Phạm vi auth và authorization

[Inventory 23 route quản trị](admin-route-inventory.json) được đối chiếu trực tiếp
với Express router và kiểm thử từng route khi không có phiên. Toàn bộ bị từ chối
trước khi đọc/ghi dữ liệu cửa hàng. Bao gồm cửa hàng/export, người dùng, đơn hàng,
subscription, khách hàng, campaign và yêu cầu hỗ trợ. `/audit-logs` được bảo vệ
chung nhưng trả 410 sau đăng nhập vì chức năng đang tắt.

| Endpoint | Chính sách |
| --- | --- |
| `POST /api/auth/login` | Public có chủ đích; CSRF guard và giới hạn đăng nhập |
| `POST /api/auth/logout` | CSRF guard; thu hồi phiên hiện có, không trả dữ liệu quản trị |
| `GET /api/auth/session` | JWT hợp lệ và phiên còn hoạt động trong database |
| `GET /api/health` | Public; chỉ có `ok`, `timestamp`; không có cấu hình hệ thống |
| `/api/admin/*` | Phiên quản trị hợp lệ và còn hiệu lực tại server |
| API không tồn tại | JSON 404, không rơi vào HTML của SPA |

Ứng dụng dùng **một tài khoản quản trị hệ thống** từ biến môi trường. Tài khoản
này có quyền trên tất cả cửa hàng; đây là quyền quản trị trung tâm. Không dùng tài
khoản này cho nhân viên hoặc merchant. Vai trò trong `users/*/shops` là dữ liệu
phân quyền của merchant, không cấp quyền đăng nhập Central Admin. Chưa có RBAC
nhiều tài khoản quản trị hoặc MFA trong ứng dụng.

## Các điểm đã sửa

1. Đổi giới hạn 10 lần trong RAM thành 5 lần sai trong cửa sổ 15 phút. Lần sai
   thứ 5 khóa thêm 15 phút. Bộ đếm tài khoản và IP dùng transaction, khóa vẫn còn
   khi đổi IP hoặc restart. Các retry lúc bị khóa không kéo dài khóa. Đăng nhập
   thành công trước khi bị khóa đặt lại bộ đếm. HTTP 429 có `Retry-After`.
2. Production lưu giới hạn và phiên tại `systemAdmin/security`, tách khỏi tài
   khoản merchant. Key bộ đếm là HMAC; không lưu IP, password hoặc password guess
   dạng rõ. Memory store chỉ dùng cho local/test.
3. Phiên 8 giờ có ID ngẫu nhiên và trạng thái trong database. Logout xóa phiên;
   cookie hoặc Bearer cũ không thể dùng lại. JWT chỉ đúng chữ ký vẫn không đủ.
   Đổi cấu hình tài khoản/secret vô hiệu hóa phiên cũ; lỗi storage không cấp quyền.
4. Cookie `HttpOnly`, `SameSite=Strict`, luôn `Secure` trong production. Bắt buộc
   HTTPS; chỉ `/api/health` cho phép HTTP phục vụ probe nội bộ. Header chuyển tiếp
   chỉ được tin từ IP/CIDR proxy khai báo tường minh.
5. Request ghi phải dùng JSON và custom header; kiểm tra Origin/Fetch Metadata,
   từ chối cả sibling origin. Frontend login/logout và CRUD đã cập nhật header.
6. CSP production, chống nhúng iframe, HSTS, bỏ `X-Powered-By`, `no-store` cho API.
   Script và font chỉ tải từ cùng origin. Inline style attributes vẫn được phép
   cho các thanh biểu đồ/preview trong React; inline script bị cấm.
7. Giới hạn JSON 64 KB; từ chối cookie/JSON hỏng an toàn; kiểm tra ID trên route,
   store membership và target campaign để chặn chèn đường dẫn. Password merchant
   không vượt quá 72 byte để tránh bcrypt âm thầm cắt đầu vào.
8. Bỏ fallback sang `JWT_SECRET` dùng chung. Startup production kiểm tra username,
   password từ 16 ký tự, secret ngẫu nhiên từ 32 ký tự, origin HTTPS và shared DB.
9. File mẫu trước đây chứa private key và thông tin tích hợp. Đã thay hoàn toàn
   bằng placeholder, bỏ biến không dùng, giữ `.env*` ngoài Git và cho phép commit
   `.env.example` đã làm sạch. Không thay secret thật trong `.env` đang dùng local.
10. Cập nhật các dependency trong phạm vi tương thích. Override `uuid` ở 11.1.1
    (có CommonJS) xử lý advisory còn lại của ExcelJS/Google clients; các thư viện
    này dùng API v4 vẫn có ở phiên bản này. Không chạy `npm audit fix --force`.

## Kiểm tra database thật — chỉ đọc

Dùng project đã có trong `.env`; không gửi notification, sửa subscription, tạo
phiên hay thử sai đăng nhập vào database thật.

- Đọc rules qua Admin SDK thành công. Root `.read` và `.write` hiện có biểu thức
  `now < 1919935259`, đã hết hạn theo thời gian mili giây của rules.
- Không có grant ở `systemAdmin` hoặc wildcard root cấp quyền nhánh security.
- HTTP GET ẩn danh đến `systemAdmin/security/sessions.json` và
  `systemAdmin/security/loginLimits.json` đều trả **401 Permission denied**.
- Nhánh security chưa có index. Cần thêm index bên dưới trước khi vận hành lâu dài.
- Đây là kiểm tra quyền đọc nhánh security, không phải kiểm chứng tất cả rules
  cho các merchant app. Không thực hiện request ghi để kiểm tra quyền ghi thật.

## Điều kiện cần xử lý trước deploy

1. **Thu hồi/cấp lại private key và các thông tin xác thực từng có trong file mẫu**,
   gồm các key của service account và các secret tích hợp liên quan. Việc làm sạch
   file không thu hồi key. Kiểm tra các nơi dùng chung trước khi thay key để cập
   nhật đồng bộ. Không thể xác nhận từ checkout rằng key chưa từng bị chia sẻ.
2. Mật khẩu quản trị trong `.env` hiện chưa đạt 16 ký tự. Thay bằng mật khẩu riêng
   đủ mạnh. Tạo `ADMIN_SESSION_SECRET` riêng bằng `openssl rand -hex 32`, không
   tái sử dụng khóa JWT của backend merchant.
3. `ADMIN_ORIGIN` hiện chưa khai báo. Đặt đúng origin HTTPS công khai, không thêm
   path hoặc dấu `/` cuối. Cấu hình TLS certificate hợp lệ và proxy truyền
   `X-Forwarded-Proto: https`. Nếu có proxy, khai báo đúng IP/CIDR và chặn truy cập
   trực tiếp vào cổng Node từ Internet. Bỏ trống `TRUST_PROXY` khi Node kết thúc TLS trực tiếp.
4. Merge nhánh rules bên dưới vào rules hiện có, giữ nguyên các nhánh nghiệp vụ.
   Không thay toàn bộ rules bằng snippet. Deny ở nhánh con không thể thu hẹp một
   grant ở cha, vì vậy phải xác nhận root/ancestor vẫn không cấp quyền nhánh này.

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

   Admin SDK tiếp tục hoạt động bằng credential phía server. Worker dọn bản ghi
   hết hạn mỗi 15 phút, tối đa 200 bản ghi/mỗi collection/mỗi lượt, recheck bằng
   transaction để không xóa một bộ đếm vừa được gia hạn. Theo dõi dung lượng khi
   có lượng lớn IP tấn công; giới hạn lưu lượng ở reverse proxy phù hợp hạ tầng.
5. Chạy `npm ci`, `npm test`, `npm run build`, `npm audit` trong môi trường deploy.
   Đảm bảo runtime Node tương thích dependency và mọi file source được đưa vào
   release: checkout hiện vẫn đang có nhiều file chưa được Git track.
6. Smoke test qua HTTPS thật: login, đọc/sửa dữ liệu kiểm thử được cho phép,
   export Excel, logout và replay cookie cũ phải 401; 5 lần sai trả 429 và restart
   không xóa khóa; chờ hết khóa mới đăng nhập lại. Với nhiều instance, kiểm tra
   cùng một phiên và bộ đếm đi qua các instance. Dùng tài khoản/môi trường thử riêng
   để tránh khóa quản trị viên đang vận hành.
7. `/api/health` là kiểm tra cấu hình sẵn sàng, không ping DB mỗi request. Cần
   kiểm tra một API quản trị sau login và theo dõi lỗi DB thực tế khi smoke test.
   Thiết lập rollback và hạn chế truy cập admin theo chính sách hạ tầng. Audit log
   trong ứng dụng hiện bị tắt; chưa có lịch sử thay đổi nghiệp vụ từ Central Admin.

## Kết quả local

- Full suite: 55/55 test pass, gồm 16 test bảo mật mới.
- Bao phủ 23 route quản trị khi chưa đăng nhập; không đọc/ghi DB nghiệp vụ.
- Kiểm thử bộ đếm dùng chung, concurrent login, rotate IP, restart, expiry,
  logout replay, cookie hỏng, storage lỗi, CSRF, proxy spoofing, input/path injection.
- Vite production build thành công. Font được xuất thành hai file WOFF2 local.
- `npm audit`: từ 23 advisory (3 critical, 7 high, 13 moderate) xuống 0.
- Trình duyệt kiểm tra bản build bằng dữ liệu local cô lập: login, dashboard,
  logout, thông báo lỗi và nút đếm ngược sau 5 lần sai. HTTPS termination được mô
  phỏng riêng trong preview; chưa kiểm chứng certificate/TLS của hosting thật.

## Tài liệu đối chiếu

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Express production security](https://expressjs.com/en/advanced/best-practice-security/)
- [Database transactions](https://firebase.google.com/docs/database/admin/save-data)
