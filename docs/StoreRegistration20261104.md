# Tạo cửa hàng và email cấp tài khoản — 04/11/2026

## Phạm vi

Sửa lỗi đọc danh sách subscription và triển khai tạo cửa hàng kèm tài khoản chủ cửa hàng tại Poso System. Không thay đổi handler, payload, nghiệp vụ hoặc phân quyền hóa đơn điện tử.

Danh sách subscription lỗi vì các bản ghi pending thiếu `adds` hoặc `removes`: database bỏ các mảng rỗng. Phần báo cáo `initialize: false` chuẩn hóa một bản sao trước khi đếm; không sửa ledger hoặc thuật toán đặt/hoàn hạn mức của nghiệp vụ. Đã đọc lại thành công 40 subscription hiện tại; không ghi dữ liệu thật.

## Form và dữ liệu

Đối chiếu form https://app.poso.vn/register ngày 04/11/2026. Các trường họ tên chủ cửa hàng, tên cửa hàng, số điện thoại, mật khẩu, tỉnh/thành phố và ngành kinh doanh giữ cùng ý nghĩa. Dùng lại FormField và style modal hiện có; thêm email tùy chọn, mã số thuế và địa chỉ chi tiết tùy chọn. Danh sách tỉnh và ngành lấy theo form hiện tại, đóng gói cục bộ để form quản trị không phụ thuộc request ngoài khi mở.

Số điện thoại Việt Nam được chuẩn hóa và là tên đăng nhập. Mã số thuế/mã định danh lưu dạng chuỗi để giữ số 0 đầu. Password tối thiểu 8 ký tự, tối đa 72 byte UTF-8. Không nhận quyền/gói/ngày từ client.

`POST /api/admin/stores` tạo mới tài khoản owner, alias điện thoại, cửa hàng độc lập và Pro dùng thử đúng 14 ngày. Giữ chính sách tự về Free hiện có. Tài khoản được đặt chỗ bằng transaction để tránh trùng; dữ liệu hoàn chỉnh được commit nguyên tử. Khi ghi thất bại, chỉ dọn bản ghi đặt chỗ của yêu cầu đó; không sửa tài khoản đã có. Mật khẩu chỉ lưu bcrypt, không nằm trong bản ghi vận hành email hoặc response JSON.

Form giữ registrationId cho một lần tạo. Lặp lại cùng yêu cầu trả cửa hàng đã tạo, không tạo trùng hoặc tự gửi lại email đã thành công. Nếu tiến trình dừng giữa bước đặt chỗ và commit, cần đối soát yêu cầu đang dở; không tự chiếm lại tài khoản hoặc đổi mật khẩu của khách hàng.

## Email

Email HTML và plain text dùng nội dung đã được cung cấp: tên đăng nhập bằng số điện thoại, mật khẩu tạm thời, link https://www.poso.vn/tai-ung-dung, thông tin đăng ký, khuyến nghị đổi mật khẩu, hotline 0977140536 và support@autuna.com. Tên khách hàng/mật khẩu được escape khi đưa vào HTML. Không ghi nội dung email hoặc mật khẩu vào log/database.

Thư chỉ được gửi sau khi commit tài khoản thành công. Không có email thì bỏ qua. Nếu gửi lỗi, API vẫn trả tài khoản đã tạo với trạng thái email thất bại; UI có nút gửi lại, không yêu cầu tạo tài khoản khác. API gửi lại kiểm tra password với bcrypt và membership owner, gửi tới email đã ghi nhận tại lần đăng ký (không lấy email có thể đã sửa sau đó). Không tự gửi lại một email đã được ghi nhận thành công.

Cấu hình server:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=<Gmail gửi thư>
SMTP_PASSWORD=<Gmail App Password>
SMTP_FROM=<cùng địa chỉ Gmail gửi thư>
```

Gmail dùng TLS ở cổng 465, kiểm tra chứng thư được giữ bật. Tài liệu: https://developers.google.com/workspace/gmail/imap/imap-smtp và https://nodemailer.com/smtp.

Các giá trị thật chỉ được đặt trong `.env` bị Git bỏ qua, quyền file 0600. Khi triển khai, cần thêm năm biến này vào môi trường server Vercel hoặc secret binding của runtime tương ứng; không đưa vào biến `VITE_*`, repository hoặc bundle frontend. Không deploy production trong công việc này.

## Kiểm chứng

- Tái hiện lỗi báo cáo bằng pending thiếu mảng, kiểm tra không ghi dữ liệu khi đọc.
- Kiểm thử HTTP tạo owner/alias/trial, dữ liệu không chứa password rõ, yêu cầu lặp, số điện thoại trùng, lỗi alias, rollback khi commit lỗi, email tùy chọn, lỗi SMTP và gửi lại, địa chỉ nhận được cố định, chống chèn HTML.
- Gmail SMTP đã xác thực thành công bằng `verify()`, không gửi thư thật để thử.
- Kiểm tra trình duyệt dùng database trong bộ nhớ; email được thu cục bộ và mật khẩu che trong ảnh minh họa. Không tạo tài khoản hoặc hóa đơn thật.
- Full test Node 22, build frontend và Wrangler dry-run được chạy riêng. Dry-run chỉ kiểm tra bundle, không chứng minh khả năng gửi SMTP từ runtime Cloudflare đang deploy.

Kết quả cuối: 97/97 kiểm thử trên Node 22; Vite build thành công; Wrangler dry-run thành công. Preview xác nhận tạo tài khoản, bảng subscription, trạng thái gửi thư và bản email HTML bằng dữ liệu giả. SMTP Gmail verify thành công; chưa xác minh nhận email thực tế hoặc deploy production.
