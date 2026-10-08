# HH HOME

Bản mẫu giao diện quản lý căn hộ và phòng trọ, xây dựng với Next.js, React, TypeScript và Lucide.

## Chạy ứng dụng

```bash
npm install
npm run dev
```

Mở http://localhost:3000.

```bash
npm run build
npm start
```

## Các màn hình

- Dashboard doanh thu, tỷ lệ lấp đầy và hóa đơn cần thu.
- Danh sách căn hộ, tìm kiếm và thêm căn hộ minh họa.
- Chi tiết căn hộ, danh sách phòng.
- Chi tiết phòng, người thuê, hợp đồng minh họa và tính tiền điện nước.
- Danh sách người thuê và xem hồ sơ.
- Hóa đơn, ghi nhận thanh toán minh họa, xuất CSV doanh thu.
- Cài đặt đơn giá điện, nước, rác, wifi, máy giặt.

Dữ liệu hiện được lưu trong bộ nhớ trình duyệt và đặt lại khi tải trang. Biểu đồ và số liệu dashboard là dữ liệu minh họa, chưa có backend, đăng nhập hoặc lưu hợp đồng thực tế. Hình minh họa căn hộ SVG được lưu cục bộ; font dùng Google Fonts, với font dự phòng nếu mất kết nối.
