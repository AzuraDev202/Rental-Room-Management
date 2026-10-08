# HH HOME

Ứng dụng quản lý căn hộ và phòng trọ: Next.js + TypeScript, Supabase PostgreSQL/Auth/Storage, React Hook Form + Zod, Recharts. Không có dữ liệu mẫu hoặc tài khoản mặc định.

## 1. Tạo và cấu hình Supabase

1. Tạo dự án tại https://supabase.com/dashboard. Chọn vùng gần Việt Nam và lưu mật khẩu database trong trình quản lý mật khẩu.
2. Mở **SQL Editor**, chạy lần lượt `supabase/migrations/202610080001_hh_home.sql` rồi `supabase/migrations/202610080002_property_service_rates.sql` rồi `supabase/migrations/202610080003_delete_property.sql` và `supabase/migrations/202610080004_tenant_document_history.sql`, mỗi file một lần trên dự án mới. Migration tạo bảng, RPC, RLS và bucket `contracts` riêng tư; không tạo dữ liệu căn hộ/người thuê/hóa đơn.
3. Trong **Authentication → Providers → Email**, bật đăng ký email/password và **Confirm email**. Thiết lập mật khẩu tối thiểu 8 ký tự. Với môi trường production, cấu hình SMTP để gửi email xác nhận và đặt lại mật khẩu ổn định.
4. Trong **Authentication → URL Configuration**, đặt Site URL theo domain triển khai và thêm redirect URL cho domain đó. Khi chạy local, thêm `http://localhost:3000` và `http://localhost:3000/**`. Production dùng domain HTTPS cụ thể, không dùng wildcard rộng.
5. Lấy Project URL và **publishable key hoặc anon key** từ Project Settings → API. Chỉ hai giá trị công khai này được dùng trong frontend. Không dùng `service_role` hoặc secret key.
6. Sao chép `.env.example` thành `.env.local`, điền hai giá trị:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

`.env.local` không được commit. Trên Vercel, khai báo hai biến trong Environment Variables và redeploy; biến `NEXT_PUBLIC_*` được đóng gói lúc build.

Nếu chưa cấu hình, ứng dụng hiển thị hướng dẫn kết nối và không hiển thị dữ liệu giả. Dự án Supabase thật chưa được tạo tự động bởi repository này.

## 2. Chạy và kiểm tra

```bash
npm ci
npm run dev
```

Mở http://localhost:3000.

```bash
npm test
npm run build
npm start
```

`npm test` chạy kiểm thử nghiệp vụ và kiểm thử SQL bằng PostgreSQL PGlite với mô phỏng schemas Auth/Storage của Supabase. Kiểm thử không tác động database thật. PGlite dùng `gen_random_uuid` tích hợp thay cho bật extension `pgcrypto`. Việc gửi email, Storage HTTP và phiên Auth thật cần kiểm tra trên dự án Supabase đã cấu hình.

## 3. Bắt đầu sử dụng

1. Đăng ký, xác nhận email, đăng nhập.
2. Tạo không gian quản lý đầu tiên; người tạo nhận quyền **Quản trị viên**. Nếu được cấp quyền vào không gian có sẵn, chọn **Nhận lời mời** thay vì tạo không gian mới.
3. Vào **Căn hộ → Thêm căn hộ**, nhập tên, địa chỉ, số phòng và giá thuê căn hộ/tháng. Phòng được tạo trong cùng giao dịch và có giá thuê ban đầu 0; mở từng phòng để đặt tên và giá thuê thực tế.
4. Vào **Cài đặt** để nhập đơn giá điện/nước và phí rác, wifi, máy giặt **riêng cho từng căn hộ**. Phần đơn giá không hiển thị khi chưa có căn hộ. Các phí này hiện tính theo phòng/tháng. Căn hộ mới chưa có đơn giá cho đến khi được lưu; cần thiết lập trước khi lập hóa đơn.
5. Thêm người thuê; khai báo họ tên, giới tính, ngày sinh, CCCD, điện thoại, email (tùy chọn), ngày vào ở. Sửa hồ sơ hoặc ghi nhận chuyển đi; giữ lại hồ sơ đã chuyển đi. Trang Người thuê mặc định chỉ hiển thị Đang ở, phân nhóm căn hộ → phòng; có bộ lọc Sắp vào ở/Đã chuyển đi/Tất cả, căn hộ, phòng và tìm kiếm theo tên/điện thoại/phòng/căn hộ.
6. Tải hợp đồng PDF/JPG/PNG tối đa 10 MB, nhập ngày hiệu lực. Tệp thuộc đúng không gian và phòng; nút Xem tạo URL ký có hiệu lực 60 giây, không phải liên kết công khai.
7. Mở phòng để lập hóa đơn. Lần đầu nhập chỉ số cũ; các kỳ tiếp theo lấy chỉ số mới của hóa đơn gần nhất. Hóa đơn chỉ lập theo thứ tự kỳ, không trùng kỳ và không lập cho tháng tương lai. Máy chủ chốt giá phòng, đơn giá, phí và tính tổng; lịch sử không đổi khi chỉnh đơn giá.
8. Trong **Hóa đơn**, ghi nhận thanh toán một phần hoặc toàn bộ. Máy chủ khóa hóa đơn khi thu tiền, chặn vượt công nợ và thu lặp khi đã đủ. Ngày thanh toán là thời điểm ghi nhận, không hỗ trợ sửa lịch sử hoặc backdate.
9. Dashboard thống kê thực thu theo ngày nhận tiền, quy đổi giờ Việt Nam; chọn tháng/năm và lọc căn hộ cho biểu đồ 12 tháng. Còn phải thu được lọc theo kỳ hóa đơn. Tỷ lệ lấp đầy dựa vào ngày vào ở/chuyển đi, tính theo ngày hiện tại ở Việt Nam.

## 4. Phân quyền

| Vai trò       | Xem dữ liệu/hợp đồng | Căn hộ, phòng, người thuê, đơn giá | Lập hóa đơn, thu tiền, tải hợp đồng | Cấp quyền thành viên |
| ------------- | -------------------- | ---------------------------------- | ----------------------------------- | -------------------- |
| Quản trị viên | Có                   | Có                                 | Có                                  | Có                   |
| Quản lý       | Có                   | Có                                 | Có                                  | Không                |
| Chỉ xem       | Có                   | Không                              | Không                               | Không                |

Quản trị viên vào **Cài đặt → Cấp quyền** để tạo lời mời theo email, vai trò Quản lý/Chỉ xem. Người nhận đăng ký bằng đúng email, xác nhận email và chọn nhận lời mời. Ứng dụng không tự gửi email mời. Có thể hủy lời mời chờ và đổi vai trò thành viên, nhưng luôn giữ ít nhất một quản trị viên. Người dùng có thể tham gia nhiều không gian và chọn không gian ở thanh bên.

RLS và RPC kiểm tra quyền độc lập với UI. CCCD, hồ sơ và hợp đồng có thể được đọc bởi cả ba vai trò trong cùng không gian; không cung cấp cổng đăng nhập người thuê trong phiên bản này.

## 5. Cơ sở dữ liệu và vận hành

Xem [thiết kế database](docs/database.md). Không chạy script xóa/reset dữ liệu trên production. Các thay đổi schema sau này cần migration mới. Không có chức năng xóa lịch sử hóa đơn/thanh toán; chỉnh sai nghiệp vụ cần thiết kế quy trình điều chỉnh riêng.

- Bật backup phù hợp với gói Supabase và kiểm tra khôi phục; backup database không thay thế backup tệp Storage.
- Giữ bucket `contracts` ở chế độ private, không mở policy `anon`.
- Kiểm tra email xác nhận/reset, đăng nhập, tài khoản khác không gian, viewer, upload và signed URL trên Supabase thật trước khi vận hành.
- Hợp đồng tải lên được bù trừ bằng xóa tệp nếu lưu metadata thất bại. Nếu mất kết nối hoặc dọn tệp thất bại, cần đối chiếu Storage với bảng `contracts` để dọn tệp mồ côi.
- Ứng dụng dùng client Supabase với RLS; không có service-role key hoặc tài khoản bypass phân quyền trong frontend. Không lưu dữ liệu nghiệp vụ vào localStorage; Supabase SDK lưu phiên đăng nhập để khôi phục phiên trên trình duyệt.

## Cập nhật database đã chạy migration đầu tiên

Nếu bạn đã chạy `202610080001_hh_home.sql` trước đây, **chỉ chạy nội dung file mới** [202610080002_property_service_rates.sql](supabase/migrations/202610080002_property_service_rates.sql) trong SQL Editor. Không chạy lại file đầu tiên.

Migration mới tạo đơn giá riêng cho từng căn hộ, sao chép bộ đơn giá cũ vào các căn hộ đang có và giữ nguyên hóa đơn/thanh toán. Bảng đơn giá cũ được đổi tên thành `legacy_organization_service_rates` để lưu bản gốc và thu hồi quyền truy cập của ứng dụng. Workspace hoặc căn hộ mới không tự tạo bộ phí mặc định. Sau đó cập nhật mã ứng dụng và khởi động lại.

## Xóa căn hộ

Cập nhật database đã có: chạy **nội dung** [202610080003_delete_property.sql](supabase/migrations/202610080003_delete_property.sql) một lần sau hai migration trước. Không chạy lại các migration đã áp dụng.

Quản trị viên/Quản lý mở trang chi tiết căn hộ → **Xóa căn hộ**, nhập chính xác tên căn hộ và xác nhận. Căn hộ chưa có hồ sơ người thuê, hợp đồng, tệp hợp đồng hoặc hóa đơn có thể xóa cùng các phòng trống và đơn giá, trong một giao dịch. Căn hộ đã có dữ liệu nghiệp vụ bị chặn xóa để giữ lịch sử; không xóa hợp đồng/thanh toán qua chức năng này. Vai trò Chỉ xem không có quyền xóa. Có thể hủy trước khi xác nhận; sau khi xóa thành công không thể hoàn tác bằng ứng dụng.

## Lịch sử người thuê sau khi chuyển đi

Chạy **nội dung** [202610080004_tenant_document_history.sql](supabase/migrations/202610080004_tenant_document_history.sql) một lần sau ba migration trước. Không chạy lại file đã áp dụng. Sau đó cập nhật mã, khởi động lại ứng dụng.

Mở hồ sơ người thuê → **Ghi nhận chuyển đi**. Đến ngày chuyển đi, người này không còn trong danh sách đang ở của phòng; xem lại ở **Người thuê → Đã chuyển đi → Chi tiết**, gồm hợp đồng, hóa đơn, lịch sử thanh toán và công nợ còn lại. Nếu còn người liên quan đang ở, chứng từ chung vẫn hiển thị trong phòng. Khi tất cả người liên quan đã đi, chứng từ chỉ còn trong hồ sơ lịch sử và danh sách tài chính tổng hợp. Người thuê mới không tự nhận chứng từ cũ.

Migration tự liên kết tài liệu hiện có dựa trên phòng, thời gian thuê và thời điểm tạo tài liệu. Với tài liệu cũ chưa xác định được người liên quan, dùng **Gán người thuê** ở hợp đồng hoặc chi tiết hóa đơn; hồ sơ đã gán được giữ lại. Các liên kết này không nhân bản số tiền: hóa đơn chung vẫn có một công nợ và một lịch sử thanh toán, không chia nợ theo đầu người. Tệp gốc, doanh thu và thanh toán được giữ nguyên. Hồ sơ đã có chứng từ không được đổi phòng/ngày vào ở; đợt ở đã kết thúc không được mở lại.
