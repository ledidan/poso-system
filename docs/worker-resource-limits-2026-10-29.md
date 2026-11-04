# POSO System — CPU limit và database index, 29/10/2026

## Chẩn đoán đã xác nhận

Có hai lỗi độc lập:

1. `Worker exceeded CPU time limit` tại `/api/admin/overview`, `/subscriptions`
   và `/users`. Account đang dùng **Workers Free**; gói này chỉ có 10 ms CPU và
   50 subrequest mỗi invocation. Nâng giới hạn CPU trong source không làm Free
   có thêm quota. Với chức năng tổng hợp, bcrypt và Excel hiện có, cần Workers
   Paid để giữ đầy đủ luồng xử lý. Đây là thay đổi gói của account, không phải
   đổi port hoặc mật khẩu.
2. Đã chạy lại query chỉ đọc và nhận đúng HTTP 400:
   - `systemAdmin/security/sessions` thiếu index `expiresAt`.
   - `systemAdmin/security/loginLimits` thiếu index `resetAt`.
   Mốc 15 phút trong log phù hợp với cron dọn phiên/bộ đếm. Các query này trả
   thông báo `Index not defined` trực tiếp từ database; không thực hiện ghi test.

Endpoint `/api/health` production hiện 200; API quản trị thiếu session trả 401.
Điều này xác nhận lỗi cấu hình khởi tạo trước đây đã qua. Không dùng GET thiếu
session để kết luận hai API tổng hợp đã hết lỗi khi có người đăng nhập.

## Các thay đổi source

- Overview, subscription và danh mục cửa hàng không đọc toàn bộ cây `shops`.
  Workers lấy danh sách key bằng `shallow=true`, đọc cờ xóa trước, rồi chỉ tải
  metadata cửa hàng còn hiển thị.
- Các dòng tổng quan dùng key để đếm catalog/khách hàng/nhân sự; không tải nội
  dung sản phẩm hoặc token của người dùng chỉ để tính số lượng.
- Xử lý từng bucket với concurrency giới hạn, chỉ chuẩn hóa 12 đơn gần nhất cần
  trả về; không tạo và sort mảng normalized chứa toàn bộ lịch sử đơn.
- REST snapshot không `structuredClone` cả subtree sau khi JSON đã được parse.
  Transaction vẫn clone dữ liệu đưa vào updater và dùng ETag để tránh lost update.
- GET overview/subscriptions không khởi tạo hạn mức hoặc migrate liên kết cửa
  hàng. Các thao tác ghi vẫn dùng mặc định cũ, tiếp tục kiểm tra subscription và
  quota. Với dữ liệu cũ chưa có meter, đọc baseline để giữ số liệu chính xác mà
  không ghi meter mới.
- GET users chỉ đọc memberships và tên cửa hàng, không tải password hay device
  token. Thêm GET `/api/admin/store-options` cho các dropdown chọn cửa hàng.
- Frontend tải theo màn hình. Overview được render sau request đầu; bảng gói tải
  tiếp theo. Không gửi đồng thời sáu API toàn hệ thống ngay sau login.
- Cache metadata chỉ tồn tại trong một request. Không cache token xác thực hoặc
  dùng chung in-flight I/O giữa các request Workers.
- Lỗi thiếu index có mã `DATABASE_INDEX_REQUIRED` và log path/field cần index;
  không trả provider diagnostics hoặc secret ra giao diện.

Việc chia nhỏ đọc giúp giảm payload và peak memory nhưng có thể tăng số
subrequest. **Bản tối ưu này không được xác nhận phù hợp giới hạn Workers Free**,
và không thay thế bước chọn gói phù hợp. Muốn giữ Free tuyệt đối cần thiết kế
API phân trang, chia job và tiền tổng hợp thay cho hợp đồng tổng hợp hiện tại.

## Cách triển khai

1. Trong Cloudflare account, bật Workers Paid nếu chọn giữ đầy đủ chức năng.
   Sau đó kiểm tra CPU limit của Worker `poso-system`; có thể dùng mặc định
   30.000 ms trên Paid. Không đặt CPU limit 30.000 ms để cố chạy trên Free.
2. Đã chuẩn bị một bản Rules đầy đủ, sao chép từ rules hiện tại:

   `.wrangler/firebase-rules-security-indexes.json`

   Bản gốc trước khi thêm index:

   `.wrangler/firebase-rules-before-security-indexes.json`

   Đã xác minh diff chỉ gồm hai `.indexOn` ở nhánh security; không đổi read/write
   hoặc rules nghiệp vụ. Kiểm tra lại rules live trước khi Publish để tránh ghi
   đè thay đổi mới từ người khác. Các file này nằm trong `.wrangler/` bị Git ignore.
   Chưa publish rules lên database.
3. Chạy `npm test`, `npm run build:worker`, rồi deploy đúng `poso-system` bằng
   `npm run deploy:worker`. Nếu cần gửi secrets mới, dùng
   `npx wrangler deploy --secrets-file .env.worker.production` sau khi build.
4. Mở lại frontend để lấy bundle mới; đăng nhập, thử overview/subscriptions/users.
   Theo dõi outcome, CPU time, memory và số subrequest trong Workers Logs.
   Xác nhận cron 15 phút không còn `DATABASE_INDEX_REQUIRED`.

## Xác minh local

- 81/81 test pass; gồm parity tổng tiền/số lượng, trạng thái subscription,
  pending capacity, legacy grouping, GET không ghi dữ liệu và giới hạn số đơn
  được normalize trước khi trả response.
- Workers dry-run thành công.
- Wrangler local dùng database đang cấu hình và tài khoản kiểm thử riêng:
  login 200, overview 200 (8 cửa hàng), subscriptions 200 (8 gói), users 200
  (13 người dùng), store-options 200; logout 204. Chỉ trạng thái auth được ghi;
  các GET nghiệp vụ không ghi migration hoặc meter.
- Browser với database giả cô lập: overview tải đúng hai API theo thứ tự;
  danh sách người dùng chỉ tải khi mở trang; chuyển về cửa hàng và overview
  không gặp lỗi render.
- Local không áp giới hạn CPU production của Free. Chưa nâng gói, publish rules
  hoặc deploy source mới; vẫn cần xác minh bằng session thật sau deploy.

## Nguồn đối chiếu

- [Workers errors](https://developers.cloudflare.com/workers/observability/errors/)
- [Workers CPU, memory và subrequest limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Database indexes](https://firebase.google.com/docs/database/security/indexing-data)
