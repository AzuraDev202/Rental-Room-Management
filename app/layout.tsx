import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterApp } from "../components/app-install";
export const metadata: Metadata = {
  title: "HH HOME · Quản lý phòng trọ",
  description: "Không gian quản lý căn hộ và phòng trọ HH HOME",
  applicationName: "HH HOME",
  appleWebApp: { capable: true, title: "HH HOME", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png", icon: "/icons/icon-192.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#245e4c",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <RegisterApp />
        {children}
      </body>
    </html>
  );
}
