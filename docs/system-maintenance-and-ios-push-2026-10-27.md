# Thông báo bảo trì và đăng ký push iOS — 27/10/2026

## Chức năng đã bổ sung

- POSO System có mục **Bảo trì hệ thống**: tạo/chỉnh sửa, bản nháp, công bố theo lịch, chọn Merchant Dashboard/Mobile, thu hồi và giữ lịch sử.
- Nhập thời gian theo giờ Việt Nam (UTC+7). Tách thời điểm bắt đầu hiển thị khỏi thời gian bắt đầu/kết thúc bảo trì để có thể báo trước.
- Mỗi lần công bố thay thế thông báo hiện tại trong một transaction. Thu hồi thông báo cũ không xóa thông báo mới. Chuyển thông báo hiện tại về bản nháp sẽ gỡ khỏi phần công khai.
- Web có thẻ thông báo, giờ bảo trì, nút xem chi tiết và ẩn. Mobile có thanh thông báo ở đáy, mở nội dung chi tiết và đóng. Cả hai xuất hiện cả trước đăng nhập, không phụ thuộc gói dịch vụ hoặc FCM, không khóa thao tác bán hàng.
- Client kiểm tra khi mở/quay lại app/trang và mỗi 60 giây khi đang sử dụng. Mốc thời gian lấy theo server; kiểm tra tự ẩn mỗi 15 giây, không chờ lần tải API kế tiếp. Bản sửa mới của thông báo có thể hiện lại sau khi bản cũ đã được ẩn.
- Nếu không có thông báo hoặc API tạm lỗi, không chặn đăng nhập/bán hàng. Nội dung là văn bản thuần, không thực thi HTML.

## Dữ liệu và API

- Lịch sử quản trị: `systemAdmin/maintenance/notices/:id`.
- Bản công khai duy nhất: `systemAdmin/maintenance/current`. Không có người tạo, thông tin tài khoản hay bản nháp.
- API quản trị dưới session/CSRF hiện có: `GET/POST /api/admin/maintenance`, `PUT /api/admin/maintenance/:id`, `POST /api/admin/maintenance/:id/cancel`.
- API đọc: `GET /app/maintenance?audience=merchant|mobile`; public để hiển thị trước đăng nhập. Chỉ trả bản hợp lệ cho đúng kênh và khoảng thời gian; không trả toàn bộ dữ liệu quản trị. `Cache-Control: no-store`.
- Cần POSO System và backend trỏ cùng Firebase project/database. Đã kiểm tra cấu hình local của hai repo cùng `autuna-fandb`. Không mở quyền truy cập Firebase trực tiếp cho client.

## FCM / APNs

Nguyên nhân của log đã gửi: bước đăng ký APNs chạy trên bản Simulator không có `aps-environment` trong chữ ký ứng dụng. File entitlements trong source đã có `development`, nhưng chữ ký của app Simulator đang cài không chứa entitlement đó; chỉ reload JavaScript không thêm quyền native vào chữ ký.

- Simulator: trả kết quả có cấu trúc `success:false, skipped:true, code:IOS_SIMULATOR, platform:ios, type:fcm` trước khi xin quyền/lấy token; không đăng ký token đã cache lên backend hoặc gắn listener refresh trên Simulator. Không giả lập token thành công.
- iPhone thật: vẫn xin quyền, đăng ký APNs rồi mới lấy FCM token. Lỗi thiếu entitlement được phân loại `PUSH_ENTITLEMENT_MISSING`, ghi cảnh báo một lần và không thử lặp trong cùng tiến trình.
- Cấu hình Expo có entitlements. Xcode bật Push Notifications, sử dụng `APS_ENVIRONMENT=development` ở Debug và `production` ở Release; file entitlements đọc biến build này.
- Đã xác minh build settings Debug/Release và build native Simulator thành công với `CODE_SIGNING_ALLOWED=NO`. Chưa có kiểm thử push đầu cuối trên iPhone thật hoặc bản App Store/TestFlight.
- Bản iPhone thật cần build/ký lại bằng provisioning profile có Push Notifications; profile quyết định môi trường APNs. Tham khảo [Apple APS Environment Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment). Thông báo bảo trì trong app không cần chờ FCM được cấu hình xong.

## Kiểm thử

| Hạng mục | Kết quả |
| --- | --- |
| POSO System | 68 test đạt, gồm 4 test mới về bản nháp/công bố/thu hồi/validation/quyền API |
| Backend | 3 test bảo trì đạt: kênh, mốc thời gian, trường public, dữ liệu rỗng, lỗi DB và route public |
| Merchant web | 59 file, 281 test đạt; 4 test mới về đọc API, văn bản an toàn, ẩn thông báo, đồng hồ lệch, hết hạn và offline |
| Mobile | 52 suite, 334 test đạt, 1 todo cũ; gồm 4 test hiển thị bảo trì và 4 test FCM iOS/Android |
| Build | Admin + merchant Vite; backend webpack development/production; export iOS + Android; native iOS Simulator đều thành công |
| Kiểm tra local | `/app/maintenance?audience=merchant` HTTP 200, không có thông báo thật; `/app/version` HTTP 200; admin không có session trả 401 |

Đã kiểm tra giao diện bằng server riêng chỉ bind loopback, database in-memory, không có Firebase credentials hoặc messaging service: chỉnh thông báo thành bản nháp → công bố → xem trên component merchant thật và Simulator → thu hồi → merchant không còn hiển thị. Mobile mở được chi tiết và đóng; bản native đang chạy không hiện LogBox lỗi entitlement.

Để kiểm tra native UI, tạm chuyển riêng transport đọc bảo trì sang server in-memory rồi khôi phục source về backend đã cấu hình, đối chiếu checksum và chạy lại test/export. Đã kiểm tra Simulator sau khôi phục không còn thông báo thử. Không sửa `.env`, không ghi thông báo thử vào Firebase, không gửi FCM.

Ảnh có nhãn dữ liệu kiểm thử, không phải lịch bảo trì thật:

- [Quản lý bảo trì](qa/system-maintenance-2026-10-27/admin-maintenance.png)
- [Thông báo merchant](qa/system-maintenance-2026-10-27/merchant-maintenance.png)
- [Chi tiết mobile](qa/system-maintenance-2026-10-27/mobile-maintenance.png)

## Trạng thái bàn giao

Chưa deploy production và chưa công bố thông báo thật. Đang chờ tiêu đề, nội dung/phạm vi ảnh hưởng, giờ bắt đầu/kết thúc và giờ bắt đầu hiển thị do người dùng cung cấp. Khi phát hành cần cập nhật POSO System, backend, merchant và bản mobile; quyền Push trên iPhone chỉ có hiệu lực sau khi build/ký lại native.

## Phiên demo theo yêu cầu

Đã mở phiên demo riêng tại `http://127.0.0.1:5174` (POSO System, chọn Bảo trì hệ thống) và `http://127.0.0.1:5174/?merchant=1` (component thông báo merchant). Dữ liệu nằm trong bộ nhớ của server loopback, không ghi Firebase hoặc gửi FCM. Có thể chỉnh sửa/công bố/thu hồi trong POSO System demo; web demo đọc cùng dữ liệu. Phiên sẽ mất dữ liệu khi server demo dừng.

Mobile đã trình diễn banner và modal nội dung thật trên Simulator bằng cùng API demo. Sau khi chụp ảnh, đã khôi phục transport và Metro về cấu hình phát triển bình thường, giữ nguyên `.env`; mobile không được giữ cấu hình trỏ tới server demo trong source. Ảnh tại `qa/maintenance-demo-2026-10-27/mobile.png`; ảnh web và quản lý lần lượt `merchant.png`, `system.png` trong cùng thư mục.

Đã tách HTTP client đọc thông báo khỏi axios dùng chung trên cả web/mobile. Request public không cần đọc token/Keychain hoặc chạy interceptor đăng nhập. Regression kiểm tra request đi qua client riêng, không gọi `axios.get` của client đăng nhập; mobile vẫn đạt 334 test, web 4 test bảo trì đạt, build web thành công.

Trong lần cold start development client, `expo-notifications` còn ghi cảnh báo Keychain của bản Simulator unsigned. Đây là thông báo khác với lỗi đăng ký FCM: helper FCM trả `IOS_SIMULATOR` và không xin token APNs/FCM. Chưa xác nhận push đầu cuối trên iPhone thật.
