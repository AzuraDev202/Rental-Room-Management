import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'HH HOME · Quản lý phòng trọ', description: 'Không gian quản lý căn hộ và phòng trọ HH HOME' };
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>) {return <html lang="vi"><body>{children}</body></html>}
