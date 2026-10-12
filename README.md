# HH HOME

Ứng dụng quản lý căn hộ và phòng trọ dành cho người quản lý: quản lý phòng, người thuê, hợp đồng, hóa đơn, thu chi và bảo trì. Mỗi người có không gian dữ liệu riêng. Giao diện hỗ trợ máy tính và điện thoại, có chế độ sáng/tối.

Dự án sử dụng **Next.js, TypeScript và Supabase**.

## Cài đặt và chạy trên web

Cần **Node.js 22 LTS**, npm và một dự án [Supabase](https://supabase.com/dashboard).

1. Tải mã nguồn và cài thư viện:

   ```bash
   git clone https://github.com/AzuraDev202/Rental-Room-Management.git
   cd Rental-Room-Management
   npm ci
   ```

2. Với dự án Supabase mới, mở **SQL Editor**, chạy **nội dung** từng file trong [supabase/migrations](supabase/migrations) theo thứ tự tên tăng dần. Không dán đường dẫn file vào SQL Editor và không chạy lại migration đã áp dụng.

3. Sao chép `.env.example` thành `.env.local`, điền Project URL và publishable/anon key của Supabase:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
   ```

   Không dùng secret/service-role key và không đưa `.env.local` lên GitHub.

4. Trong Supabase **Authentication → URL Configuration**, đặt Site URL và thêm Redirect URLs phù hợp với địa chỉ chạy app. Khi chạy local, dùng `http://localhost:3000` và thêm `http://localhost:3000/**` vào Redirect URLs.

5. Chạy app:

   ```bash
   npm run dev
   ```

   Mở http://localhost:3000, đăng ký tài khoản, xác nhận email nếu được yêu cầu và tạo không gian quản lý. Không có tài khoản mặc định.

### Đưa web lên Vercel

Import repository vào [Vercel](https://vercel.com), thêm hai biến môi trường ở trên và deploy. Cập nhật Site URL và Redirect URLs trong Supabase theo địa chỉ HTTPS của web. Nếu bật xác nhận email, cấu hình SMTP trong Supabase để gửi email ổn định.

Để chạy bản production trên máy:

```bash
npm run build
npm start
```

## Dùng trên điện thoại

Mở địa chỉ HTTPS của web đã triển khai, đăng nhập rồi thêm app vào màn hình chính:

- **Android:** mở bằng Chrome → menu ⋮ → **Cài đặt ứng dụng** hoặc **Thêm vào màn hình chính**.
- **iPhone/iPad:** mở bằng Safari → **Chia sẻ** → **Thêm vào Màn hình chính**.

HH HOME là ứng dụng web cài trên màn hình chính (PWA), không cần tải từ App Store/Google Play. Cần Internet để đăng nhập, xem và lưu dữ liệu.
