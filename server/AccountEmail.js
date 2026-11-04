import nodemailer from "nodemailer";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
export const accountEmailMessage = ({ username, password, ownerName, taxCode, address, phoneNumber, email }) => {
  const subject = `[POSO] Thông tin cấp tài khoản phần mềm quản lý Poso - Khách hàng ${ownerName.toLocaleUpperCase("vi-VN")}`;
  const rows = [["Mã số thuế", taxCode || "Chưa cung cấp"], ["Họ và tên", ownerName], ["Địa chỉ", address || "Chưa cung cấp"], ["Số điện thoại", phoneNumber], ["Email", email]];
  const downloadURL = "https://www.poso.vn/tai-ung-dung";
  const text = `Kính gửi Quý khách hàng, ${ownerName},\n\nLời đầu tiên, chúng tôi xin chân thành cảm ơn Quý khách đã tin tưởng và lựa chọn sử dụng phần mềm quản lý Poso.\n\nChúng tôi xin trân trọng thông báo tài khoản sử dụng phần mềm của Quý khách đã được khởi tạo thành công với các thông tin chi tiết dưới đây:\n\nThông tin tài khoản\n- Tên đăng nhập: ${username}\n- Mật khẩu tạm thời: ${password}\n- Link tải và đăng nhập phần mềm: ${downloadURL}\n\nThông tin khách hàng đăng ký\n${rows.map(([label, value]) => `- ${label}: ${value}`).join("\n")}\n\nLưu ý quan trọng dành cho Quý khách:\n1. Bảo mật: Ngay sau khi đăng nhập lần đầu tiên, Quý khách vui lòng đổi mật khẩu mới để đảm bảo tính bảo mật cho tài khoản của mình.\n2. Hỗ trợ kỹ thuật: Trong quá trình cài đặt và sử dụng, nếu gặp bất kỳ khó khăn hoặc cần hỗ trợ hướng dẫn tính năng, Quý khách vui lòng liên hệ:\n- Hotline hỗ trợ: 0977140536\n- Email hỗ trợ: support@autuna.com\n\nMột lần nữa, Poso xin cảm ơn Quý khách và chúc Quý khách có những trải nghiệm tuyệt vời cùng phần mềm!\n\nTrân trọng,\nĐội ngũ Hỗ trợ khách hàng Poso`;
  const html = `<!doctype html><html lang="vi"><body style="margin:0;font-family:Arial,sans-serif;overflow-wrap:anywhere;color:#243143;line-height:1.7"><main style="max-width:640px;margin:24px auto;background:#fff;padding:32px;border-radius:12px"><p>Kính gửi Quý khách hàng, <strong>${escape(ownerName)}</strong>,</p><p>Lời đầu tiên, chúng tôi xin chân thành cảm ơn Quý khách đã tin tưởng và lựa chọn sử dụng phần mềm quản lý <strong>Poso</strong>.</p><p>Chúng tôi xin trân trọng thông báo tài khoản sử dụng phần mềm của Quý khách đã được khởi tạo thành công với các thông tin chi tiết dưới đây:</p><h2 style="font-size:20px">Thông tin tài khoản</h2><div style="background:#fff6ed;padding:18px;border-radius:8px"><div><strong>Tên đăng nhập:</strong> <code>${escape(username)}</code></div><div><strong>Mật khẩu tạm thời:</strong> <code>${escape(password)}</code></div><div><strong>Link tải và đăng nhập phần mềm:</strong> <a href="${downloadURL}">${downloadURL}</a></div></div><h2 style="font-size:20px">Thông tin khách hàng đăng ký</h2><table style="width:100%;border-collapse:collapse">${rows.map(([label, value]) => `<tr><th style="text-align:left;padding:8px 12px 8px 0;vertical-align:top;border-bottom:1px solid #eee;white-space:nowrap">${label}</th><td style="padding:8px 0;border-bottom:1px solid #eee">${escape(value)}</td></tr>`).join("")}</table><h2 style="font-size:20px">Lưu ý quan trọng dành cho Quý khách</h2><ol><li><strong>Bảo mật:</strong> Ngay sau khi đăng nhập lần đầu tiên, Quý khách vui lòng đổi mật khẩu mới để đảm bảo tính bảo mật cho tài khoản của mình.</li><li><strong>Hỗ trợ kỹ thuật:</strong> Trong quá trình cài đặt và sử dụng, nếu gặp bất kỳ khó khăn hoặc cần hỗ trợ hướng dẫn tính năng, Quý khách vui lòng liên hệ:<ul><li>Hotline hỗ trợ: <a href="tel:0977140536">0977140536</a></li><li>Email hỗ trợ: <a href="mailto:support@autuna.com">support@autuna.com</a></li></ul></li></ol><p>Một lần nữa, <strong>Poso</strong> xin cảm ơn Quý khách và chúc Quý khách có những trải nghiệm tuyệt vời cùng phần mềm!</p><p>Trân trọng,<br><strong>Đội ngũ Hỗ trợ khách hàng Poso</strong></p></main></body></html>`;
  return { to: email, subject, text, html };
};

export const createAccountMailer = (env = process.env, transportFactory = nodemailer.createTransport) => {
  let transport;
  return {
    isConfigured: () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM),
    async send(details) {
      if (!this.isConfigured()) throw Object.assign(new Error("Email cấp tài khoản chưa được cấu hình."), { code: "MAIL_NOT_CONFIGURED" });
      const port = Number(env.SMTP_PORT) || 465;
      transport ||= transportFactory({ host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true });
      const result = await transport.sendMail({ ...accountEmailMessage(details), from: { name: "Poso", address: env.SMTP_FROM }, replyTo: "support@autuna.com" });
      if (!result.accepted?.some((address) => address.toLowerCase() === details.email.toLowerCase())) throw Object.assign(new Error("Máy chủ email chưa chấp nhận thư."), { code: "MAIL_REJECTED" });
      return { status: "sent" };
    }
  };
};
