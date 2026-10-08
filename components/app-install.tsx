"use client";
import { useEffect, useState } from "react";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export function AppInstall() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
        !!(navigator as Navigator & { standalone?: boolean }).standalone,
    );
    const ready = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  return (
    <section className="panel app-install" aria-label="Cài đặt ứng dụng">
      <h2>HH HOME trên điện thoại</h2>
      {installed ? (
        <p>Ứng dụng đã mở từ màn hình chính.</p>
      ) : (
        <>
          <p>Thêm HH HOME vào màn hình chính để mở như một ứng dụng.</p>
          {prompt ? (
            <button
              className="primary"
              onClick={async () => {
                await prompt.prompt();
                await prompt.userChoice;
                setPrompt(null);
              }}
            >
              Cài đặt HH HOME
            </button>
          ) : (
            <p>
              iPhone/iPad: mở bằng Safari → Chia sẻ → Thêm vào Màn hình chính.
              Android: mở menu trình duyệt → Cài đặt ứng dụng hoặc Thêm vào màn
              hình chính.
            </p>
          )}
        </>
      )}
      <p>Cần kết nối Internet để đăng nhập, xem và lưu dữ liệu.</p>
    </section>
  );
}
export function RegisterApp() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .catch(() => {});
    }
  }, []);
  return null;
}
