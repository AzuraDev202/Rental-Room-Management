"use client";
import { useState } from "react";
import { Home, ArrowLeft, LogIn } from "lucide-react";
import { supabase } from "../lib/supabase";
import { z } from "zod";
export function Auth() {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <div className="auth-page">
      <div className="auth-story">
        <span className="brand-icon">
          <Home size={27} />
        </span>
        <h1>HH HOME</h1>
        <h2>Chăm sóc từng mái nhà.</h2>
        <p>
          Căn hộ, người thuê và tài chính.
          <br />
          Tất cả trong một không gian quản lý.
        </p>
      </div>
      <section className="auth-card">
        <div className="eyebrow">CHÀO MỪNG ĐẾN HH HOME</div>
        <h1>
          {mode === "login"
            ? "Đăng nhập"
            : mode === "signup"
              ? "Tạo tài khoản"
              : "Đặt lại mật khẩu"}
        </h1>
        <p>
          {mode === "login"
            ? "Đăng nhập để truy cập không gian quản lý."
            : mode === "signup"
              ? "Xác nhận email để tạo hoặc tham gia không gian quản lý."
              : "Chúng tôi sẽ gửi liên kết đặt lại mật khẩu qua email."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setNotice("");
            setBusy(true);
            try {
              if (!supabase) throw new Error("Chưa cấu hình kết nối");
              z.string().email().parse(email);
              if (mode !== "reset" && password.length < 8)
                throw new Error("Mật khẩu cần ít nhất 8 ký tự");
              if (mode === "signup" && !name.trim())
                throw new Error("Vui lòng nhập họ tên");
              const result =
                mode === "login"
                  ? await supabase.auth.signInWithPassword({ email, password })
                  : mode === "signup"
                    ? await supabase.auth.signUp({
                        email,
                        password,
                        options: {
                          data: { display_name: name.trim() },
                          emailRedirectTo: window.location.origin,
                        },
                      })
                    : await supabase.auth.resetPasswordForEmail(email, {
                        redirectTo: window.location.origin + "/?recovery=1",
                      });
              if (result.error)
                throw new Error(
                  mode === "login"
                    ? "Email hoặc mật khẩu không đúng, hoặc email chưa được xác nhận."
                    : result.error.message,
                );
              if (mode === "signup")
                setNotice(
                  "Đã gửi yêu cầu đăng ký. Vui lòng kiểm tra email để xác nhận tài khoản.",
                );
              if (mode === "reset")
                setNotice(
                  "Nếu email tồn tại trong hệ thống, bạn sẽ nhận được liên kết đặt lại mật khẩu.",
                );
            } catch (e) {
              setError(
                e instanceof z.ZodError
                  ? "Email không hợp lệ"
                  : e instanceof Error
                    ? e.message
                    : "Không thể đăng nhập",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            {mode === "signup" && (
              <label>
                Họ tên
                <input
                  required
                  maxLength={120}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label>
              Email
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {mode !== "reset" && (
              <label>
                Mật khẩu
                <input
                  required
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            <button className="primary wide">
              {busy ? (
                "Đang xử lý..."
              ) : mode === "login" ? (
                <>
                  <LogIn size={16} /> Đăng nhập
                </>
              ) : mode === "signup" ? (
                "Đăng ký"
              ) : (
                "Gửi liên kết"
              )}
            </button>
          </fieldset>
        </form>
        <div className="auth-links">
          {mode === "login" ? (
            <>
              <button
                onClick={() => {
                  setMode("reset");
                  setError("");
                  setNotice("");
                }}
              >
                Quên mật khẩu?
              </button>
              <button
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setNotice("");
                }}
              >
                Tạo tài khoản
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setMode("login");
                setError("");
                setNotice("");
              }}
            >
              <ArrowLeft size={14} /> Quay lại đăng nhập
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
export function Recovery({ done }: { done: () => void }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth-page">
      <section className="auth-card">
        <h1>Mật khẩu mới</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await supabase!.auth.updateUser({ password });
              if (r.error) throw r.error;
              history.replaceState({}, "", "/");
              done();
            } catch {
              setError(
                "Không thể cập nhật mật khẩu. Hãy gửi lại yêu cầu đặt lại mật khẩu.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Mật khẩu mới
            <input
              required
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary wide" disabled={busy}>
            {busy ? "Đang cập nhật..." : "Lưu mật khẩu mới"}
          </button>
        </form>
      </section>
    </div>
  );
}
