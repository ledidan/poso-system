# Độ trễ production POSO System — 29/10/2026

Đã kiểm tra và sửa trên https://poso-system.vercel.app. Deployment cuối:
`dpl_EAVpMagrw6MXmRj9bRBWe2WDUNQV`.

## Nguyên nhân được xác nhận

- Database production ở `asia-southeast1` (Singapore). Trước sửa,
  `x-vercel-id` của API cho thấy Function chạy tại `iad1` (Washington).
  Overview gọi hàng trăm lượt đọc nhỏ; các lượt gọi giữa Mỹ và Singapore bị
  cộng dồn. Response overview chỉ 33.222 byte, còn thời gian chờ gần 60 giây.
- Các bước đọc metadata và tổng hợp cửa hàng dùng mức song song thấp dành cho
  Workers. Sau khi đặt Function gần database, chúng vẫn tạo nhiều lượt chờ tuần tự.

## Thay đổi đã triển khai

- `vercel.json`: đặt một Function region `sin1` (Singapore), phù hợp gói Hobby.
- Vercel: tối đa 16 lượt đọc database đang chạy trong mỗi request, tối đa 8 cửa
  hàng được tổng hợp cùng lúc. Các bucket lớn của từng cửa hàng vẫn xử lý lần lượt.
- Một hàng đợi dùng chung trong request bao phủ metadata, shallow keys, query
  subscription và các lượt đọc không giữ cache. Lượt đọc lỗi luôn trả slot.
- Metadata độc lập được đọc song song; các shallow key trùng nhau trong cùng
  request dùng chung kết quả. Cache không tồn tại qua request và không cache
  kết quả xác thực, token phiên, hoặc thay đổi quyền truy cập.
- Mặc định Workers vẫn tối đa 4 lượt đọc / 2 cửa hàng đồng thời. Không thay đổi
  cách tính tiền, số đơn, usage meter, dữ liệu trả về hoặc quyền ghi.
- Không thêm Cron, scheduler hoặc ghi pre-aggregate lên database.

## Kết quả đo trực tiếp production

Đơn vị: giây, tính từ gửi request đến đọc xong response. Cùng máy đo và origin.
Mốc trước sửa có một lượt; mỗi bản sau có hai lượt liên tiếp. Đây là phép đo
trực tiếp để đối chiếu, chưa phải kiểm thử tải hoặc thống kê p95.

| API | Trước sửa, iad1 | Chỉ đổi sang sin1 | sin1 và tối ưu lượt đọc |
| --- | ---: | ---: | ---: |
| Overview | 59.67 | 4.88–6.64 | 2.56–3.07 |
| Subscriptions | 32.08 | 2.98–3.27 | 1.43–1.73 |
| Users | 6.17 | 0.72–0.76 | 0.65–0.72 |
| Store options | 8.59 | 1.00–1.02 | 0.47–0.82 |

Tám response của bản cuối đều HTTP 200 và so sánh toàn bộ JSON với response
trước sửa đều bằng nhau, gồm tổng tiền, số lượng, usage/pending và danh sách
người dùng. Tất cả header định tuyến của bản cuối xác nhận `sin1`.
Login thành công, các API vẫn `Cache-Control: no-store`; logout 204 và dùng
lại session đã logout trả 401. Các phép đo chỉ đọc dữ liệu nghiệp vụ; chỉ trạng
thái phiên đăng nhập được tạo/thu hồi trong bước xác minh.

## Kiểm tra source

- 89/89 test pass, gồm parity giữa hai mức song song, giới hạn tổng số lượt đọc,
  khử lượt đọc trùng và tiếp tục hàng đợi khi một lượt đọc lỗi.
- Frontend build và Workers dry-run pass; Vercel production deployment READY.
- Evidence riêng, không commit: `.wrangler/perf-before.json`,
  `.wrangler/perf-after.json`, `.wrangler/perf-final.json`. Các snapshot JSON
  để đối chiếu nằm cùng thư mục bị ignore, quyền file 0600.

Nguồn đối chiếu: [Vercel regions](https://vercel.com/docs/functions/configuring-functions/region),
[region identifiers](https://vercel.com/docs/regions),
[database locations](https://firebase.google.com/docs/database/locations).
