# Kiểm thử

`npm test` kiểm tra công thức, dữ liệu rỗng, timezone doanh thu, trạng thái người thuê và migration SQL/RLS/RPC trên PostgreSQL PGlite. Bảng Auth/Storage được tạo riêng trong bộ nhớ để mô phỏng Supabase, không kết nối production.

## Luồng giao diện tích hợp

Cài trình duyệt:

```bash
npx playwright install chromium
```

Chạy server riêng để kiểm thử bằng URL/key giả **chỉ dành cho test** (không ghi vào .env.local, không dùng để deploy). Dừng các server Next.js khác của cùng checkout trước khi chạy để tránh dùng chung .next:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://hh-home-test.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test-public-key npm run dev -- --port 3001
```

Ở terminal khác, từ root repository:

```bash
npm run test:ui
```

Nếu dùng Chromium đã cài hệ thống, có thể đặt `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.

Test chặn HTTP tới domain Supabase giả và thực thi query/RPC trên PostgreSQL trong bộ nhớ với migration thật. Xác nhận đăng nhập, workspace trống, căn hộ/giá thuê, phòng, đơn giá, lời mời, hồ sơ, hợp đồng, hóa đơn, thanh toán một phần, dữ liệu sau reload, bố cục mobile, UI viewer, chuyển đi từng người trong phòng chung, lịch sử chứng từ và ngăn người mới nhận chứng từ cũ, xóa căn hộ trống có lịch sử và xem lại chứng từ/thanh toán sau khi xóa, lịch sử điện/nước/phí theo căn hộ/phòng/tháng kể cả căn hộ đã xóa, trạng thái phòng, bắt buộc mốc nhận phòng khi trống, giữ mốc khi thêm người ở chung và hóa đơn các đợt khác nhau trong cùng tháng. Test Auth và Storage HTTP dùng mô phỏng; không chứng minh việc gửi email hoặc tải tệp trên cloud thật. Ảnh kiểm tra được ghi tạm vào `/tmp`, không đưa dữ liệu fixture vào ứng dụng.

Dừng server test sau khi hoàn thành, bỏ các biến test và build lại cho môi trường thật. Dữ liệu fixture chỉ tồn tại trong bộ nhớ tiến trình kiểm thử.
