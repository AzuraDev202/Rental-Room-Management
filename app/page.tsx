"use client";
import { z } from "zod";
import { AppInstall } from "../components/app-install";
import { useEffect, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Home,
  Trash2,
  LayoutDashboard,
  Building2,
  Users,
  ReceiptText,
  Settings,
  Plus,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  ChevronLeft,
  LogOut,
  Menu,
  X,
  MapPin,
  DoorOpen,
  Wallet,
  TrendingUp,
  FileText,
  Download,
  Check,
  Search,
  Upload,
  Shield,
  LoaderCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { TenantArrivalForm } from "../components/tenant-arrival-form";
import { TenantDirectory } from "../components/tenant-directory";
import { Auth, Recovery } from "../components/auth";
import { DataForm, type Field } from "../components/data-form";
import dynamic from "next/dynamic";
const RevenueChart = dynamic(
  () =>
    import("../components/revenue-chart").then((module) => module.RevenueChart),
  {
    ssr: false,
    loading: () => <div className="loading">Đang tải biểu đồ...</div>,
  },
);
import {
  propertySchema,
  roomSchema,
  tenantSchema,
  ratesSchema,
  invoiceSchema,
  initialReadingsSchema,
  paymentSchema,
  inviteSchema,
  workspaceSchema,
  contractSchema,
  deletePropertySchema,
} from "../lib/forms";
import {
  money,
  balance,
  currentMonth,
  localDay,
  calculateBill,
  tenantStatus,
  nextMonth,
  documentTenants,
  isCurrentDocument,
  revenueSeries,
} from "../lib/business";
import { loadData, rpc, insert, update, databaseError } from "../lib/data";
import {
  emptyData,
  type Data,
  type Membership,
  type Property,
  type Room,
  type Tenant,
  type Invoice,
  type BillingCycle,
  type Contract,
  type Role,
  type Rates,
} from "../lib/types";
const roleNames: Record<Role, string> = {
  admin: "Quản trị viên",
  manager: "Quản lý",
  viewer: "Chỉ xem",
};
const rateFields: Field[] = [
  { name: "electricity", label: "Điện (₫/kWh)", type: "number", min: 0 },
  {
    name: "water_mode",
    label: "Cách tính nước",
    options: [
      { value: "meter", label: "Theo m³" },
      { value: "person", label: "Theo người/tháng" },
    ],
  },
  { name: "water", label: "Nước (₫/m³)", type: "number", min: 0 },
  { name: "service", label: "Dịch vụ (đ/phòng/tháng)", type: "number", min: 0 },
  {
    name: "laundry",
    label: "Máy giặt (đ/người/tháng)",
    type: "number",
    min: 0,
  },
];
const propertyFields: Field[] = [
  { name: "name", label: "Tên căn hộ" },
  { name: "address", label: "Địa chỉ" },
  { name: "room_count", label: "Số phòng", type: "number", min: 1, max: 100 },
];
const roomFields: Field[] = [
  { name: "name", label: "Tên phòng" },
  {
    name: "monthly_rent",
    label: "Giá thuê phòng / tháng (VNĐ)",
    type: "number",
    min: 0,
  },
];
export default function Page() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [recovery, setRecovery] = useState(false),
    [authError, setAuthError] = useState("");
  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    let alive = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (!alive) return;
      setSession(next);
      setReady(true);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error)
          setAuthError(
            "Không thể khôi phục phiên đăng nhập. Vui lòng thử lại.",
          );
        setSession(data.session);
        setRecovery(new URLSearchParams(location.search).has("recovery"));
        setReady(true);
      })
      .catch(() => {
        if (alive) {
          setAuthError("Không thể kết nối dịch vụ đăng nhập.");
          setReady(true);
        }
      });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);
  if (!supabase)
    return (
      <div className="auth-page">
        <section className="auth-card setup-card">
          <span className="brand-icon">
            <Home size={25} />
          </span>
          <div className="eyebrow">HH HOME</div>
          <h1>Kết nối không gian của bạn</h1>
          <p>
            Ứng dụng đã sẵn sàng cho dữ liệu thật. Hãy cấu hình Supabase để bắt
            đầu đăng nhập và quản lý căn hộ.
          </p>
          <ol>
            <li>Tạo dự án Supabase.</li>
            <li>
              Chạy migration trong thư mục <code>supabase/migrations</code>.
            </li>
            <li>
              Điền Project URL và publishable/anon key vào{" "}
              <code>.env.local</code> theo <code>.env.example</code>, rồi khởi
              động lại ứng dụng.
            </li>
          </ol>
          <p>
            Hướng dẫn chi tiết có trong README của repository. Chưa có dữ liệu
            căn hộ, người thuê hay hóa đơn.
          </p>
        </section>
      </div>
    );
  if (!ready) return <Loading label="Đang kiểm tra phiên đăng nhập..." />;
  if (!session)
    return (
      <>
        {authError && <div className="banner error">{authError}</div>}
        <Auth />
      </>
    );
  if (recovery) return <Recovery done={() => setRecovery(false)} />;
  return <Workspace key={session.user.id} session={session} />;
}
function Workspace({ session }: { session: Session }) {
  const [memberships, setMemberships] = useState<Membership[]>([]),
    [orgNames, setOrgNames] = useState<Record<string, string>>({}),
    [org, setOrg] = useState(""),
    [data, setData] = useState<Data>(emptyData),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [page, setPage] = useState("dashboard"),
    [propertyId, setPropertyId] = useState(""),
    [roomId, setRoomId] = useState(""),
    [modal, setModal] = useState(""),
    [search, setSearch] = useState(""),
    [period, setPeriod] = useState(currentMonth()),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState(""),
    [tenant, setTenant] = useState<Tenant | null>(null),
    [invoice, setInvoice] = useState<Invoice | null>(null),
    [memberToRemove, setMemberToRemove] = useState<Membership | null>(null),
    [chartProperty, setChartProperty] = useState(""),
    [busy, setBusy] = useState(false),
    [documentTarget, setDocumentTarget] = useState<{
      kind: "invoice" | "contract";
      id: string;
      roomId: string;
    } | null>(null),
    [ownerIds, setOwnerIds] = useState<string[]>([]),
    [billingCycleId, setBillingCycleId] = useState("");
  const member =
    data.members.find((m) => m.user_id === session.user.id) ||
    memberships.find((m) => m.organization_id === org);
  const canWrite = member?.role === "admin" || member?.role === "manager";
  const admin = member?.role === "admin";
  const name =
    member?.display_name ||
    String(session.user.user_metadata.display_name || session.user.email || "");
  const currentProperties = data.properties.filter((p) => !p.deleted_at);
  const currentRooms = data.rooms.filter((r) =>
    currentProperties.some((p) => p.id === r.property_id),
  );
  const property = currentProperties.find((p) => p.id === propertyId),
    room = currentRooms.find((r) => r.id === roomId);
  const notify = (s: string) => setToast(s);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!modal && !mobile) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setModal("");
        setMobile(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", escape);
    };
  }, [modal, mobile, busy]);
  const refreshMemberships = useCallback(async () => {
    const { data: result, error } = await supabase!
      .from("memberships")
      .select("*")
      .eq("user_id", session.user.id)
      .order("organization_id");
    if (error) throw databaseError(error);
    const organizations = await supabase!
      .from("organizations")
      .select("id,name");
    if (organizations.error) throw databaseError(organizations.error);
    setOrgNames(
      Object.fromEntries(organizations.data.map((o) => [o.id, o.name])),
    );
    setMemberships(result as Membership[]);
    setOrg((current) =>
      result.some((m) => m.organization_id === current)
        ? current
        : result[0]?.organization_id || "",
    );
    return result as Membership[];
  }, [session.user.id]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    refreshMemberships()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshMemberships]);
  const orgRole = memberships.find((m) => m.organization_id === org)?.role;
  useEffect(() => {
    if (!org) return;
    let active = true;
    setLoading(true);
    setData(emptyData);
    setError("");
    loadData(org, orgRole === "admin")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [org, orgRole]);
  const refresh = async () => {
    const next = await refreshMemberships();
    const membership = next.find((m) => m.organization_id === org) || next[0];
    if (!membership) {
      setData(emptyData);
      return;
    }
    setData(
      await loadData(membership.organization_id, membership.role === "admin"),
    );
  };
  const save = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await operation();
      setModal("");
      try {
        await refresh();
        notify(message);
      } catch (e) {
        setError(
          "Đã lưu, nhưng chưa tải lại được dữ liệu. " +
            (e instanceof Error ? e.message : ""),
        );
      }
    } finally {
      setBusy(false);
    }
  };
  const act = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await save(operation, message);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thể thực hiện thao tác.",
      );
    } finally {
      setBusy(false);
    }
  };
  const nav = [
    ["dashboard", "Tổng quan", LayoutDashboard],
    ["properties", "Căn hộ", Building2],
    ["tenants", "Người thuê", Users],
    ["settings", "Cài đặt", Settings],
  ] as const;
  const navigate = (next: string) => {
    setPage(next);
    setMobile(false);
    setSearch("");
  };
  const openProperty = (p: Property) => {
    setPropertyId(p.id);
    navigate("property");
  };
  const openRoom = (r: Room) => {
    setRoomId(r.id);
    navigate("room");
  };
  const propertyRooms = (id: string) =>
    data.rooms.filter((r) => r.property_id === id);
  const activeTenants = (id: string) =>
    data.tenants.filter(
      (t) => t.room_id === id && tenantStatus(t) === "Đang ở",
    );
  const currentRoomContracts = room
    ? data.contracts.filter(
        (c) =>
          c.room_id === room.id && isCurrentDocument(data, "contract", c.id),
      )
    : [];
  const currentRoomInvoices = room
    ? data.invoices.filter(
        (i) =>
          i.room_id === room.id && isCurrentDocument(data, "invoice", i.id),
      )
    : [];
  const assignOwners = (
    kind: "invoice" | "contract",
    id: string,
    roomId: string,
  ) => {
    setDocumentTarget({ kind, id, roomId });
    setOwnerIds(documentTenants(data, kind, id).map((t) => t.id));
    setModal("document-owners");
  };
  const occupied = currentRooms.filter(
    (r) => activeTenants(r.id).length > 0,
  ).length;
  const outstanding = data.invoices.filter((i) => i.period.startsWith(period));
  const pending = outstanding.filter((i) => balance(i, data.payments) > 0);
  const income = (roomIds?: string[]) =>
    revenueSeries(period.slice(0, 4), data.invoices, data.payments, roomIds)[
      Number(period.slice(5)) - 1
    ]?.revenue || 0;
  const roomRates = room
    ? data.rates.find((r) => r.property_id === room.property_id)
    : undefined;
  const roomCycles = room
    ? data.billingCycles
        .filter(
          (c) =>
            c.room_id === room.id &&
            c.starts_on < nextMonth(period) &&
            data.tenants.some(
              (t) =>
                t.billing_cycle_id === c.id &&
                t.move_in < nextMonth(period) &&
                (!t.move_out ||
                  (t.move_out > period + "-01" && t.move_out > t.move_in)),
            ),
        )
        .sort((a, b) => b.starts_on.localeCompare(a.starts_on))
    : [];
  const billingCycle =
    roomCycles.find((c) => c.id === billingCycleId) || roomCycles[0];
  const previous =
    room && billingCycle
      ? data.invoices
          .filter(
            (i) =>
              i.room_id === room.id && i.billing_cycle_id === billingCycle.id,
          )
          .sort((a, b) => b.period.localeCompare(a.period))[0] || null
      : null;
  const titles: Record<string, string> = {
    dashboard: "Tổng quan",
    properties: "Căn hộ của bạn",
    property: property?.name || "Căn hộ",
    room: room?.name || "Phòng",
    tenants: "Người thuê",
    settings: "Cài đặt",
  };
  const tenantStayLocked =
    tenant &&
    modal === "tenant-edit" &&
    (!!tenant.billing_cycle_id ||
      data.invoiceTenants.some((l) => l.tenant_id === tenant.id) ||
      data.contractTenants.some((l) => l.tenant_id === tenant.id) ||
      data.properties.some(
        (p) =>
          p.deleted_at &&
          data.rooms.some(
            (r) => r.property_id === p.id && r.id === tenant.room_id,
          ),
      ));
  const tenantFields: Field[] = [
    {
      name: "room_id",
      label: "Phòng",
      options: (tenantStayLocked
        ? data.rooms.filter((r) => r.id === tenant!.room_id)
        : currentRooms
      ).map((r) => ({
        value: r.id,
        label: `${data.properties.find((p) => p.id === r.property_id)?.name} · ${r.name}`,
      })),
    },
    { name: "full_name", label: "Họ tên" },
    {
      name: "gender",
      label: "Giới tính",
      options: ["Nam", "Nữ", "Khác"].map((g) => ({ value: g, label: g })),
    },
    { name: "birth_date", label: "Ngày sinh", type: "date" },
    { name: "identity_number", label: "Số CCCD (12 chữ số)" },
    { name: "phone", label: "Số điện thoại" },
    { name: "email", label: "Email (không bắt buộc)", type: "email" },
    {
      name: "move_in",
      label: "Ngày vào ở",
      type: "date",
      readOnly: !!tenantStayLocked,
    },
  ];
  const logout = async () => {
    setBusy(true);
    const { error } = await supabase!.auth.signOut();
    if (error) {
      setError("Không thể đăng xuất. Vui lòng thử lại.");
      setBusy(false);
    }
  };
  if (!org && loading)
    return <Loading label="Đang tải không gian quản lý..." />;
  if (!org)
    return (
      <div className="auth-page">
        <section className="auth-card setup-card">
          <h1>Không gian quản lý đầu tiên</h1>
          <p>
            Tạo không gian mới, hoặc nhận quyền truy cập được quản trị viên cấp
            cho email của bạn.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <DataForm
            schema={workspaceSchema}
            fields={[
              { name: "workspace_name", label: "Tên không gian quản lý" },
              { name: "member_name", label: "Họ tên của bạn" },
            ]}
            defaults={{
              workspace_name: "HH HOME",
              member_name: String(
                session.user.user_metadata.display_name || "",
              ),
            }}
            submit="Tạo không gian"
            onSubmit={async (v) => {
              await rpc("create_workspace", v);
              await refreshMemberships();
            }}
          />
          <button
            className="secondary wide"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const n = await rpc("accept_invitations", {
                  member_name: String(
                    session.user.user_metadata.display_name ||
                      session.user.email,
                  ),
                });
                if (!n)
                  throw new Error(
                    "Chưa có lời mời cho email " + session.user.email,
                  );
                await refreshMemberships();
              }, "Đã nhận quyền truy cập")
            }
          >
            Nhận lời mời cho {session.user.email}
          </button>
          <button className="text-button wide" disabled={busy} onClick={logout}>
            Đăng xuất
          </button>
        </section>
      </div>
    );
  return (
    <div className="app">
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <a className="brand" onClick={() => navigate("dashboard")}>
          <span className="brand-icon">
            <Home size={23} />
          </span>
          <span>
            HH HOME<span className="brand-sub">PROPERTY MANAGEMENT</span>
          </span>
        </a>
        <div className="workspace">
          <div className="workspace-icon">H</div>
          <div>
            <label htmlFor="workspace">Không gian quản lý</label>
            <select
              id="workspace"
              value={org}
              disabled={loading || busy}
              onChange={(e) => {
                setOrg(e.target.value);
                setPage("dashboard");
                setPropertyId("");
                setRoomId("");
                setModal("");
                setChartProperty("");
              }}
            >
              {memberships.map((m) => (
                <option key={m.organization_id} value={m.organization_id}>
                  {orgNames[m.organization_id] || "Không gian quản lý"} ·{" "}
                  {roleNames[m.role]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={
                page === id ||
                (id === "properties" && ["property", "room"].includes(page))
                  ? "active"
                  : ""
              }
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              {label}
              {id === "properties" && (
                <span className="nav-count">{currentProperties.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="help-card">
            <Shield size={20} />
            <b>{member ? roleNames[member.role] : "Đang tải quyền"}</b>
          </div>
          <button className="profile" onClick={logout} disabled={busy}>
            <span className="avatar">
              {name
                .split(" ")
                .slice(-2)
                .map((s) => s[0])
                .join("")
                .slice(0, 2)}
            </span>
            <span>
              <b>{name}</b>
              <small>Đăng xuất</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="breadcrumb">
            <button
              className="mobile-menu"
              aria-label="Mở menu"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span>Không gian làm việc</span>
            <ChevronRight size={14} />
            <b>{titles[page]}</b>
          </div>
          <div className="header-right">
            <span className="demo">{member ? roleNames[member.role] : ""}</span>
            <Shield size={18} />
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              {["property", "room"].includes(page) && (
                <button
                  className="back"
                  onClick={() =>
                    navigate(page === "room" ? "property" : "properties")
                  }
                >
                  <ChevronLeft size={15} /> Quay lại
                </button>
              )}
              <div className="eyebrow">HH HOME · CHĂM SÓC TỪNG MÁI NHÀ</div>
              <h1>
                {page === "dashboard"
                  ? `Xin chào, ${name.split(" ").slice(-1)[0]}`
                  : titles[page]}
              </h1>
              {page === "property" && <p>{property?.address}</p>}
              {page === "room" && <p>{property?.name}</p>}
            </div>
            <div className="heading-actions">
              <label className="period">
                Kỳ xem
                <input
                  aria-label="Kỳ xem"
                  type="month"
                  value={period}
                  onChange={(e) => {
                    if (e.target.value) setPeriod(e.target.value);
                  }}
                />
              </label>
              {page === "property" && property && canWrite && (
                <button
                  className="danger-button"
                  disabled={loading || busy}
                  onClick={() => setModal("property-delete")}
                >
                  <Trash2 size={17} /> Xóa căn hộ
                </button>
              )}
              {page === "properties" && canWrite && (
                <button
                  className="primary"
                  disabled={loading}
                  onClick={() => setModal("property")}
                >
                  <Plus size={17} /> Thêm căn hộ
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="banner error" role="alert">
              {error}
              <button
                onClick={() => {
                  setLoading(true);
                  refresh()
                    .then(() => setError(""))
                    .catch((e) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
              >
                Tải lại
              </button>
            </div>
          )}
          {loading ? (
            <Loading label="Đang tải dữ liệu..." />
          ) : (
            <>
              {page === "dashboard" && (
                <>
                  <div className="stats">
                    <Stat
                      label="Doanh thu thực thu"
                      value={money(income())}
                      icon={<Wallet size={21} />}
                      foot={`Tiền nhận trong tháng ${period.slice(5)}`}
                    />
                    <Stat
                      label="Căn hộ đang quản lý"
                      value={String(currentProperties.length)}
                      icon={<Building2 size={21} />}
                      foot={`${currentRooms.length} phòng trong hệ thống`}
                    />
                    <Stat
                      label="Tỷ lệ lấp đầy"
                      value={
                        (currentRooms.length
                          ? (occupied / currentRooms.length) * 100
                          : 0
                        ).toLocaleString("vi-VN", {
                          maximumFractionDigits: 1,
                        }) + "%"
                      }
                      icon={<DoorOpen size={21} />}
                      foot={`${occupied} / ${currentRooms.length} phòng đang thuê`}
                    />
                    <Stat
                      label="Còn phải thu trong kỳ"
                      value={money(
                        pending.reduce(
                          (s, i) => s + balance(i, data.payments),
                          0,
                        ),
                      )}
                      icon={<ReceiptText size={21} />}
                      foot={`${pending.length} hóa đơn chưa thu đủ`}
                    />
                  </div>
                  <div className="analytics">
                    <section className="panel revenue">
                      <div className="panel-heading">
                        <div>
                          <h2>Doanh thu theo tháng · {period.slice(0, 4)}</h2>
                          <p>Theo ngày thanh toán thực tế, giờ Việt Nam</p>
                        </div>
                        <select
                          aria-label="Lọc doanh thu theo căn hộ"
                          className="chart-filter"
                          value={chartProperty}
                          onChange={(e) => setChartProperty(e.target.value)}
                        >
                          <option value="">Tất cả căn hộ</option>
                          {data.properties.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.deleted_at ? " (đã xóa)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <RevenueChart
                        data={revenueSeries(
                          period.slice(0, 4),
                          data.invoices,
                          data.payments,
                          chartProperty
                            ? propertyRooms(chartProperty).map((r) => r.id)
                            : undefined,
                        )}
                      />
                    </section>
                    <section className="panel occupancy">
                      <div className="panel-heading">
                        <div>
                          <h2>Tình trạng phòng</h2>
                        </div>
                        <DoorOpen size={19} />
                      </div>
                      <div
                        className="donut"
                        style={{
                          background: `conic-gradient(#2d6b52 0 ${currentRooms.length ? (occupied / currentRooms.length) * 100 : 0}%, #e7edde 0 100%)`,
                        }}
                      >
                        <div>
                          <b>{currentRooms.length}</b>
                          <span>Tổng số phòng</span>
                        </div>
                      </div>
                      <div className="occupancy-legend">
                        <div>
                          <i className="green" />
                          Đang thuê <b>{occupied} phòng</b>
                        </div>
                        <div>
                          <i className="pale" />
                          Còn trống{" "}
                          <b>{currentRooms.length - occupied} phòng</b>
                        </div>
                      </div>
                    </section>
                  </div>
                </>
              )}
              {["dashboard", "properties"].includes(page) && (
                <section className="property-section">
                  <div className="section-heading">
                    <div>
                      <h2>
                        Căn hộ của bạn{" "}
                        <span className="badge">
                          {currentProperties.length}
                        </span>
                      </h2>
                    </div>
                    {page === "dashboard" ? (
                      <button
                        className="text-button"
                        onClick={() => navigate("properties")}
                      >
                        Xem tất cả <ArrowRight size={16} />
                      </button>
                    ) : (
                      <label className="search">
                        <Search size={17} />
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Tìm căn hộ..."
                        />
                      </label>
                    )}
                  </div>
                  <div className="property-grid">
                    {currentProperties
                      .filter((p) =>
                        (p.name + " " + p.address)
                          .toLocaleLowerCase()
                          .includes(search.toLocaleLowerCase()),
                      )
                      .map((p) => {
                        const rooms = propertyRooms(p.id),
                          occupied = rooms.filter(
                            (r) => activeTenants(r.id).length,
                          ).length;
                        return (
                          <button
                            key={p.id}
                            className="property-card"
                            onClick={() => openProperty(p)}
                          >
                            <div className="property-image property-placeholder">
                              <Building2 size={68} />
                              <span className="image-arrow">
                                <ArrowUpRight size={18} />
                              </span>
                              <span className="image-title">{p.name}</span>
                            </div>
                            <div className="property-content">
                              <div className="address">
                                <MapPin size={14} />
                                {p.address}
                              </div>
                              <div className="property-numbers">
                                <span>
                                  <DoorOpen size={15} />
                                  <b>
                                    {occupied}/{rooms.length}
                                  </b>{" "}
                                  phòng đã thuê
                                </span>
                                <strong>
                                  {money(income(rooms.map((r) => r.id)))}
                                </strong>
                              </div>
                              <div className="progress">
                                <i
                                  style={{
                                    width:
                                      (rooms.length
                                        ? (occupied / rooms.length) * 100
                                        : 0) + "%",
                                  }}
                                />
                              </div>
                              <div className="property-foot">
                                <span>
                                  Chi tiết <ArrowRight size={13} />
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                  {!currentProperties.length ? (
                    <Empty
                      title="Chưa có căn hộ"
                      detail={
                        canWrite
                          ? "Mở trang Căn hộ và chọn “Thêm căn hộ” để bắt đầu."
                          : "Quản trị viên hoặc quản lý sẽ thêm căn hộ cho không gian này."
                      }
                    />
                  ) : (
                    search &&
                    !currentProperties.some((p) =>
                      (p.name + " " + p.address)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    ) && (
                      <Empty
                        title="Không tìm thấy căn hộ"
                        detail="Hãy thử tên hoặc địa chỉ khác."
                      />
                    )
                  )}
                </section>
              )}
              {page === "dashboard" && (
                <section className="panel payments">
                  <div className="panel-heading">
                    <div>
                      <h2>Hóa đơn chưa thu đủ</h2>
                      <p>Kỳ {period}</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("tenants")}
                    >
                      Xem hóa đơn <ArrowRight size={16} />
                    </button>
                  </div>
                  <Invoices
                    invoices={pending}
                    data={data}
                    canWrite={canWrite}
                    pay={(i) => {
                      setTenant(null);
                      setInvoice(i);
                      setModal("payment");
                    }}
                    detail={(i) => {
                      setTenant(null);
                      setInvoice(i);
                      setModal("invoice-detail");
                    }}
                  />
                </section>
              )}
              {page === "property" && property && (
                <>
                  <div className="stats property-stats">
                    <Stat
                      label="Số phòng"
                      value={String(propertyRooms(property.id).length)}
                      icon={<DoorOpen size={21} />}
                      foot="Phòng thuộc căn hộ"
                    />
                    <Stat
                      label="Doanh thu thực thu"
                      value={money(
                        income(propertyRooms(property.id).map((r) => r.id)),
                      )}
                      icon={<TrendingUp size={21} />}
                      foot={`Kỳ ${period}`}
                    />
                  </div>
                  <div className="section-heading">
                    <div>
                      <h2>Danh sách phòng</h2>
                    </div>
                    {canWrite && (
                      <button
                        className="primary"
                        onClick={() => setModal("room-add")}
                      >
                        <Plus size={17} /> Thêm phòng
                      </button>
                    )}
                  </div>
                  <div className="rooms">
                    {propertyRooms(property.id)
                      .sort((a, b) =>
                        a.name.localeCompare(b.name, "vi", { numeric: true }),
                      )
                      .map((r) => (
                        <button
                          className="room-card"
                          key={r.id}
                          onClick={() => openRoom(r)}
                        >
                          <div>
                            <span className="room-icon">
                              <DoorOpen size={23} />
                            </span>
                            <span
                              className={
                                "status " +
                                (!activeTenants(r.id).length ? "vacant" : "")
                              }
                            >
                              {activeTenants(r.id).length ? "Đang ở" : "Trống"}
                            </span>
                          </div>
                          <h2>{r.name}</h2>
                          <p>
                            {activeTenants(r.id).length
                              ? `${activeTenants(r.id).length} người đang ở`
                              : "Chưa có người thuê"}
                          </p>
                          <div className="room-foot">
                            <b>{money(r.monthly_rent)}/tháng</b>
                            <ArrowRight size={17} />
                          </div>
                        </button>
                      ))}
                  </div>
                </>
              )}
              {page === "room" && room && (
                <div className="room-layout">
                  <div>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>{room.name}</h2>
                          <p>Giá thuê: {money(room.monthly_rent)}/tháng</p>
                          <span
                            className={
                              "status " +
                              (!activeTenants(room.id).length ? "vacant" : "")
                            }
                          >
                            {activeTenants(room.id).length ? "Đang ở" : "Trống"}
                          </span>
                        </div>
                        {canWrite && (
                          <button
                            className="secondary"
                            onClick={() => setModal("room-edit")}
                          >
                            Sửa phòng
                          </button>
                        )}
                      </div>
                      <div className="panel-heading">
                        <h2>Người thuê ({activeTenants(room.id).length})</h2>
                        {canWrite && (
                          <button
                            className="text-button"
                            onClick={() => {
                              setTenant(null);
                              setModal("tenant-add");
                            }}
                          >
                            <Plus size={15} /> Thêm người thuê
                          </button>
                        )}
                      </div>
                      {activeTenants(room.id).map((t) => (
                        <button
                          key={t.id}
                          className="tenant-row"
                          onClick={() => {
                            setTenant(t);
                            setModal("tenant-detail");
                          }}
                        >
                          <span className="avatar">
                            {t.full_name
                              .split(" ")
                              .slice(-2)
                              .map((s) => s[0])
                              .join("")}
                          </span>
                          <span>
                            <b>{t.full_name}</b>
                            <small>
                              Ngày vào ở{" "}
                              {new Date(t.move_in).toLocaleDateString("vi-VN")}
                            </small>
                          </span>
                          <ChevronRight size={17} />
                        </button>
                      ))}
                      {!activeTenants(room.id).length && (
                        <Empty
                          title="Chưa có người thuê"
                          detail="Thêm hồ sơ khi có người vào ở."
                        />
                      )}
                    </section>
                    <section
                      className="panel contracts-panel"
                      aria-label="Hóa đơn người đang ở"
                    >
                      <div className="panel-heading">
                        <div>
                          <h2>Hóa đơn người đang ở</h2>
                          <p>
                            Hồ sơ đã chuyển đi được lưu tại trang Người thuê.
                          </p>
                        </div>
                      </div>
                      <Invoices
                        invoices={currentRoomInvoices}
                        data={data}
                        canWrite={canWrite}
                        pay={(i) => {
                          setTenant(null);
                          setInvoice(i);
                          setModal("payment");
                        }}
                        detail={(i) => {
                          setTenant(null);
                          setInvoice(i);
                          setModal("invoice-detail");
                        }}
                      />
                    </section>
                    <section className="panel contracts-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Hợp đồng thuê</h2>
                          <p>PDF, JPG hoặc PNG · tối đa 10 MB</p>
                        </div>
                        {canWrite && (
                          <button
                            className="secondary"
                            disabled={!activeTenants(room.id).length}
                            onClick={() => setModal("contract")}
                          >
                            <Upload size={15} /> Tải lên
                          </button>
                        )}
                      </div>
                      {currentRoomContracts.map((c) => (
                        <div className="contract" key={c.id}>
                          <FileText size={25} />
                          <div>
                            <b>{c.file_name}</b>
                            <small>
                              {c.starts_on} – {c.ends_on}
                            </small>
                            <small>
                              {documentTenants(data, "contract", c.id)
                                .map((t) => t.full_name)
                                .join(", ") || "Chưa gán người thuê"}
                            </small>
                          </div>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => viewContract(c, setError, setBusy)}
                          >
                            Xem
                          </button>
                          {canWrite && (
                            <button
                              className="text-button"
                              onClick={() =>
                                assignOwners("contract", c.id, c.room_id)
                              }
                            >
                              Gán người thuê
                            </button>
                          )}
                        </div>
                      ))}
                      {!currentRoomContracts.length && (
                        <Empty
                          title="Chưa có hợp đồng"
                          detail="Tải hợp đồng đã ký để lưu cùng phòng."
                        />
                      )}
                    </section>
                    <section className="panel" aria-label="Mốc nhận phòng">
                      <div className="panel-heading">
                        <div>
                          <h2>Mốc điện / nước lúc nhận phòng</h2>
                        </div>
                      </div>
                      {data.billingCycles
                        .filter(
                          (c) =>
                            c.room_id === room.id &&
                            (data.tenants.some(
                              (t) => t.billing_cycle_id === c.id,
                            ) ||
                              data.invoices.some(
                                (i) => i.billing_cycle_id === c.id,
                              )),
                        )
                        .sort((a, b) => b.starts_on.localeCompare(a.starts_on))
                        .map((c) => (
                          <div className="arrival-reading" key={c.id}>
                            <b>
                              {c.is_legacy ? "Lịch sử từ" : "Nhận phòng"}{" "}
                              {c.starts_on}
                            </b>
                            <span>
                              Điện:{" "}
                              {c.electricity_initial === null
                                ? "Chưa ghi"
                                : c.electricity_initial + " kWh"}{" "}
                              · Nước:{" "}
                              {c.water_meter_ready === false
                                ? "Không dùng chỉ số"
                                : c.water_initial === null
                                  ? "Chưa ghi"
                                  : c.water_initial + " m³"}
                            </span>
                          </div>
                        ))}
                    </section>
                  </div>
                  <section className="panel bill">
                    <div className="panel-heading">
                      <div>
                        <h2>Lập hóa đơn</h2>
                      </div>
                      <ReceiptText size={19} />
                    </div>
                    {roomCycles.length > 0 && (
                      <label className="billing-cycle-picker">
                        Đợt thuê
                        <select
                          aria-label="Đợt thuê lập hóa đơn"
                          value={billingCycle?.id || ""}
                          onChange={(e) => setBillingCycleId(e.target.value)}
                        >
                          {roomCycles.map((c) => (
                            <option key={c.id} value={c.id}>
                              Nhận phòng {c.starts_on}
                              {c.is_legacy ? " · Lịch sử trước cập nhật" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {canWrite &&
                      billingCycle &&
                      billingCycle.electricity_initial === null &&
                      !previous && (
                        <>
                          <h3>Ghi chỉ số nhận phòng còn thiếu</h3>
                          <DataForm
                            schema={
                              roomRates?.water_mode === "person"
                                ? initialReadingsSchema.omit({
                                    water_initial: true,
                                  })
                                : initialReadingsSchema
                            }
                            fields={[
                              {
                                name: "electricity_initial",
                                label: "Điện · chỉ số lúc nhận phòng",
                                type: "number",
                                min: 0,
                              },
                              {
                                name: "water_initial",
                                label: "Nước · chỉ số lúc nhận phòng",
                                type: "number",
                                min: 0,
                              },
                            ].filter(
                              (field) =>
                                field.name !== "water_initial" ||
                                roomRates?.water_mode !== "person",
                            )}
                            defaults={{
                              electricity_initial: "",
                              water_initial: "",
                            }}
                            submit="Lưu mốc nhận phòng"
                            onSubmit={(v) =>
                              save(
                                () =>
                                  rpc("set_arrival_readings", {
                                    org,
                                    target_cycle: billingCycle.id,
                                    electricity: v.electricity_initial,
                                    water:
                                      roomRates?.water_mode === "person"
                                        ? null
                                        : v.water_initial,
                                  }),
                                "Đã lưu mốc nhận phòng",
                              )
                            }
                          />
                        </>
                      )}
                    {canWrite &&
                      roomRates?.water_mode !== "person" &&
                      billingCycle?.water_meter_ready === false &&
                      billingCycle.electricity_initial !== null && (
                        <>
                          <h3>Ghi mốc nước khi tính theo m³</h3>
                          <DataForm
                            schema={initialReadingsSchema.pick({
                              water_initial: true,
                            })}
                            fields={[
                              {
                                name: "water_initial",
                                label: "Nước · mốc khi chuyển sang m³",
                                type: "number",
                                min: 0,
                              },
                            ]}
                            defaults={{ water_initial: "" }}
                            submit="Lưu mốc nước"
                            onSubmit={(v) =>
                              save(
                                () =>
                                  rpc("set_water_baseline", {
                                    org,
                                    target_cycle: billingCycle.id,
                                    water: v.water_initial,
                                  }),
                                "Đã lưu mốc nước",
                              )
                            }
                          />
                        </>
                      )}
                    {canWrite &&
                    roomRates &&
                    billingCycle &&
                    (roomRates.water_mode === "person" ||
                      billingCycle.water_meter_ready !== false) &&
                    (previous || billingCycle.electricity_initial !== null) ? (
                      <InvoiceForm
                        key={
                          room.id +
                          period +
                          billingCycle?.id +
                          (previous?.id || "")
                        }
                        period={period}
                        previous={previous || null}
                        baseline={billingCycle}
                        room={room}
                        rates={roomRates}
                        laundryPeople={
                          data.tenants.filter(
                            (t) =>
                              t.room_id === room.id &&
                              t.billing_cycle_id === billingCycle.id &&
                              t.move_in < nextMonth(period) &&
                              t.move_in <= localDay() &&
                              (!t.move_out ||
                                (t.move_out > period + "-01" &&
                                  t.move_out > t.move_in)),
                          ).length
                        }
                        onSubmit={(v) =>
                          save(
                            () =>
                              rpc("create_water_invoice", {
                                org,
                                target_room: room.id,
                                target_cycle: billingCycle!.id,
                                invoice_period: String(v.period) + "-01",
                                deadline: v.due_date,
                                e_old: v.electricity_old,
                                e_new: v.electricity_new,
                                w_old: v.water_old,
                                w_new: v.water_new,
                              }),
                            "Đã lập hóa đơn",
                          )
                        }
                      />
                    ) : (
                      <Empty
                        title={
                          !billingCycle
                            ? "Chưa có đợt thuê trong tháng"
                            : billingCycle.electricity_initial === null &&
                                !previous
                              ? "Chưa có mốc nhận phòng"
                              : roomRates?.water_mode !== "person" &&
                                  billingCycle.water_meter_ready === false
                                ? "Cần ghi mốc nước"
                                : canWrite
                                  ? "Chưa có đơn giá"
                                  : "Quyền chỉ xem"
                        }
                        detail={
                          !billingCycle
                            ? "Chọn tháng có người ở hoặc thêm người thuê khi phòng trống nhận người mới."
                            : billingCycle.electricity_initial === null &&
                                !previous
                              ? "Ghi mốc điện/nước trước khi lập hóa đơn đầu tiên của đợt thuê."
                              : roomRates?.water_mode !== "person" &&
                                  billingCycle.water_meter_ready === false
                                ? "Ghi mốc nước mới trước khi tính theo m³."
                                : canWrite
                                  ? "Thiết lập đơn giá của căn hộ này trong Cài đặt trước khi lập hóa đơn."
                                  : "Bạn có thể xem hóa đơn tại trang Người thuê."
                        }
                      />
                    )}
                  </section>
                </div>
              )}
              {page === "tenants" && (
                <TenantDirectory
                  data={data}
                  canWrite={canWrite}
                  add={() => {
                    setTenant(null);
                    setModal("tenant-add");
                  }}
                  detail={(t) => {
                    setTenant(t);
                    setModal("tenant-detail");
                  }}
                />
              )}
              {page === "tenants" && (
                <>
                  <section
                    className="panel tenant-invoices"
                    aria-label="Hóa đơn và thu tiền"
                  >
                    <div className="panel-heading">
                      <div>
                        <h2>Hóa đơn kỳ {period}</h2>
                      </div>
                      <button
                        className="secondary"
                        disabled={!outstanding.length}
                        onClick={() => exportInvoices(outstanding, data)}
                      >
                        <Download size={16} /> Xuất CSV
                      </button>
                    </div>
                    <Invoices
                      invoices={outstanding}
                      data={data}
                      canWrite={canWrite}
                      pay={(i) => {
                        setTenant(null);
                        setInvoice(i);
                        setModal("payment");
                      }}
                      detail={(i) => {
                        setTenant(null);
                        setInvoice(i);
                        setModal("invoice-detail");
                      }}
                    />
                  </section>
                </>
              )}
              {page === "settings" && (
                <>
                  <AppInstall />
                  {currentProperties.map((p) => (
                    <PropertyRates
                      key={p.id}
                      property={p}
                      rates={data.rates.find((r) => r.property_id === p.id)}
                      canWrite={canWrite}
                      onSave={(v) =>
                        save(async () => {
                          const { error } = await supabase!
                            .from("property_service_rates")
                            .upsert(
                              {
                                ...v,
                                property_id: p.id,
                                organization_id: org,
                                updated_at: new Date().toISOString(),
                              },
                              { onConflict: "property_id" },
                            );
                          if (error) throw databaseError(error);
                        }, "Đã lưu đơn giá cho " + p.name)
                      }
                    />
                  ))}
                  <section className="panel team-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Thành viên & phân quyền</h2>
                        <p>
                          Quản trị viên cấp quyền bằng email. Người được cấp
                          đăng ký bằng đúng email và chọn nhận lời mời.
                        </p>
                      </div>
                      {admin && (
                        <button
                          className="secondary"
                          onClick={() => setModal("invite")}
                        >
                          <Plus size={15} /> Cấp quyền
                        </button>
                      )}
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>THÀNH VIÊN</th>
                            <th>EMAIL</th>
                            <th>VAI TRÒ</th>
                            {admin && <th>THAO TÁC</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {data.members.map((m) => (
                            <tr key={m.user_id}>
                              <td>{m.display_name}</td>
                              <td>{m.email}</td>
                              <td>
                                {admin ? (
                                  <select
                                    aria-label={`Vai trò của ${m.display_name}`}
                                    value={m.role}
                                    disabled={busy}
                                    onChange={(e) =>
                                      act(
                                        () =>
                                          rpc("set_member_role", {
                                            org,
                                            target_user: m.user_id,
                                            new_role: e.target.value,
                                          }),
                                        "Đã cập nhật vai trò",
                                      )
                                    }
                                  >
                                    {Object.entries(roleNames).map(
                                      ([value, label]) => (
                                        <option key={value} value={value}>
                                          {label}
                                        </option>
                                      ),
                                    )}
                                  </select>
                                ) : (
                                  roleNames[m.role]
                                )}
                              </td>
                              {admin && (
                                <td>
                                  <button
                                    className="text-button danger-button"
                                    disabled={
                                      busy || m.user_id === session.user.id
                                    }
                                    aria-label={`Xóa người dùng ${m.display_name}`}
                                    onClick={() => {
                                      setMemberToRemove(m);
                                      setModal("member-remove");
                                    }}
                                  >
                                    Xóa người dùng
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {admin && data.invitations.length > 0 && (
                      <div className="invitations">
                        <h3>Đang chờ nhận quyền</h3>
                        {data.invitations.map((i) => (
                          <div className="bill-line" key={i.id}>
                            <span>
                              {i.email} · {roleNames[i.role]}
                            </span>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                act(async () => {
                                  const { error } = await supabase!
                                    .from("invitations")
                                    .delete()
                                    .eq("id", i.id)
                                    .eq("organization_id", org);
                                  if (error) throw databaseError(error);
                                }, "Đã hủy lời mời")
                              }
                            >
                              Hủy
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="team-actions">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            const n = await rpc("accept_invitations", {
                              member_name: name,
                            });
                            if (!n)
                              throw new Error(
                                "Chưa có lời mời mới cho tài khoản này",
                              );
                          }, "Đã nhận quyền truy cập mới")
                        }
                      >
                        Nhận lời mời mới
                      </button>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          <footer>
            <span>
              © {new Date().getFullYear()} HH HOME. Chăm sóc từng mái nhà.
            </span>
            <span>
              <i /> Không gian riêng tư · {member ? roleNames[member.role] : ""}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {mobile && (
        <button
          className="menu-backdrop"
          aria-label="Đóng menu"
          onClick={() => setMobile(false)}
        />
      )}
      {modal && (
        <div className="overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Thông tin và thao tác"
            className={
              "modal " + (modal === "property-delete" ? "delete-modal" : "")
            }
          >
            <button
              className="close"
              aria-label="Đóng"
              disabled={busy}
              onClick={() => setModal("")}
            >
              <X size={20} />
            </button>
            {modal === "member-remove" && memberToRemove && admin && (
              <>
                <h2>Xóa người dùng khỏi không gian</h2>
                <p>
                  {memberToRemove.display_name} · {memberToRemove.email}
                </p>
                <p>
                  Người này sẽ mất quyền truy cập không gian hiện tại. Tài khoản
                  đăng nhập, quyền ở không gian khác và mọi dữ liệu căn hộ,
                  người thuê, hóa đơn vẫn được giữ nguyên.
                </p>
                <DataForm
                  defaults={{ confirmation_email: "" }}
                  fields={[
                    {
                      name: "confirmation_email",
                      label: "Nhập email người dùng để xác nhận",
                      type: "email",
                    },
                  ]}
                  schema={z.object({
                    confirmation_email: z
                      .string()
                      .trim()
                      .email()
                      .refine(
                        (value) =>
                          value.toLowerCase() ===
                          memberToRemove.email.toLowerCase(),
                        "Email xác nhận không khớp",
                      ),
                  })}
                  submit="Xác nhận xóa người dùng"
                  onSubmit={(values) =>
                    save(
                      () =>
                        rpc("remove_workspace_member", {
                          org,
                          target_user: memberToRemove.user_id,
                          confirmation_email: values.confirmation_email,
                        }),
                      "Đã xóa quyền truy cập của người dùng",
                    )
                  }
                />
              </>
            )}
            {modal === "property-delete" && property && (
              <>
                <h2>Xóa căn hộ {property.name}?</h2>
                <p>
                  Căn hộ sẽ được gỡ khỏi danh sách quản lý. Hồ sơ người thuê,
                  hợp đồng, hóa đơn và thanh toán cũ vẫn được giữ lại.
                </p>
                <p>
                  Có thể xóa khi tất cả người thuê đã chuyển đi và không còn
                  lịch vào ở chưa kết thúc. Bạn vẫn có thể xem lịch sử và thu
                  công nợ tại hồ sơ người thuê.
                </p>
                <DataForm
                  schema={deletePropertySchema(property.name)}
                  fields={[
                    {
                      name: "confirmation_name",
                      label: "Nhập chính xác tên căn hộ để xác nhận",
                      placeholder: property.name,
                    },
                  ]}
                  defaults={{ confirmation_name: "" }}
                  submit="Xác nhận xóa căn hộ"
                  onSubmit={async (v) => {
                    await save(
                      () =>
                        rpc("delete_property", {
                          org,
                          target_property: property.id,
                          confirmation_name: v.confirmation_name,
                        }),
                      "Đã xóa căn hộ " + property.name,
                    );
                    setPropertyId("");
                    setRoomId("");
                    if (chartProperty === property.id) setChartProperty("");
                    navigate("properties");
                  }}
                />
                <button
                  className="secondary wide"
                  disabled={busy}
                  onClick={() => setModal("")}
                >
                  Hủy
                </button>
              </>
            )}
            {modal === "property" && (
              <>
                <h2>Thêm căn hộ</h2>
                <p>
                  Nhập căn hộ và số phòng. Giá thuê từng phòng có thể thiết lập
                  sau.
                </p>
                <DataForm
                  schema={propertySchema.omit({ monthly_rent: true })}
                  fields={propertyFields}
                  defaults={{
                    name: "",
                    address: "",
                    room_count: "",
                  }}
                  submit="Thêm căn hộ"
                  onSubmit={(v) =>
                    save(
                      () =>
                        rpc("create_property", {
                          org,
                          property_name: v.name,
                          property_address: v.address,
                          rent: 0,
                          room_count: v.room_count,
                        }),
                      "Đã thêm căn hộ",
                    )
                  }
                />
              </>
            )}
            {["room-add", "room-edit"].includes(modal) && (
              <>
                <h2>{modal === "room-edit" ? "Sửa phòng" : "Thêm phòng"}</h2>
                <DataForm
                  schema={roomSchema}
                  fields={roomFields}
                  defaults={
                    modal === "room-edit" && room
                      ? { name: room.name, monthly_rent: room.monthly_rent }
                      : { name: "", monthly_rent: "" }
                  }
                  submit="Lưu phòng"
                  onSubmit={(v) =>
                    save(
                      () =>
                        modal === "room-edit" && room
                          ? update("rooms", room.id, org, v)
                          : insert("rooms", {
                              ...v,
                              organization_id: org,
                              property_id: propertyId,
                            }),
                      "Đã lưu phòng",
                    )
                  }
                />
              </>
            )}
            {["tenant-add", "tenant-edit"].includes(modal) && (
              <>
                <h2>
                  {modal === "tenant-edit"
                    ? "Cập nhật người thuê"
                    : "Thêm người thuê"}
                </h2>
                {modal === "tenant-add" ? (
                  <TenantArrivalForm
                    data={data}
                    fields={
                      page === "room"
                        ? tenantFields.filter(
                            (field) => field.name !== "room_id",
                          )
                        : tenantFields
                    }
                    roomId={page === "room" ? roomId : ""}
                    onSubmit={(v) =>
                      save(async () => {
                        await insert("tenants", {
                          ...v,
                          room_id: page === "room" ? roomId : v.room_id,
                          email: v.email || null,
                          organization_id: org,
                        });
                        setBillingCycleId("");
                      }, "Đã lưu hồ sơ người thuê")
                    }
                  />
                ) : (
                  <DataForm
                    schema={tenantSchema}
                    fields={tenantFields}
                    defaults={
                      tenant
                        ? { ...tenant, email: tenant.email || "" }
                        : {
                            room_id: page === "room" ? roomId : "",
                            full_name: "",
                            gender: "",
                            birth_date: "",
                            identity_number: "",
                            phone: "",
                            email: "",
                            move_in: localDay(),
                          }
                    }
                    submit="Lưu người thuê"
                    onSubmit={(v) =>
                      save(
                        () =>
                          tenant
                            ? update("tenants", tenant.id, org, {
                                ...v,
                                email: v.email || null,
                              })
                            : insert("tenants", {
                                ...v,
                                email: v.email || null,
                                organization_id: org,
                              }),
                        "Đã lưu hồ sơ người thuê",
                      )
                    }
                  />
                )}
              </>
            )}
            {modal === "tenant-detail" && tenant && (
              <>
                <h2>{tenant.full_name}</h2>

                <div className="detail-list">
                  {[
                    ["Giới tính", tenant.gender],
                    ["Ngày sinh", tenant.birth_date],
                    ["CCCD", tenant.identity_number],
                    ["Số điện thoại", tenant.phone],
                    ["Email", tenant.email || "Chưa cung cấp"],
                    ["Ngày vào ở", tenant.move_in],
                    ["Ngày chuyển đi", tenant.move_out || "Đang ở"],
                    [
                      "Mốc điện đầu đợt thuê",
                      data.billingCycles
                        .find((c) => c.id === tenant.billing_cycle_id)
                        ?.electricity_initial?.toString() ?? "Chưa ghi",
                    ],
                    [
                      "Mốc nước đầu đợt thuê",
                      data.billingCycles.find(
                        (c) => c.id === tenant.billing_cycle_id,
                      )?.water_meter_ready === false
                        ? "Nước tính theo người"
                        : (data.billingCycles
                            .find((c) => c.id === tenant.billing_cycle_id)
                            ?.water_initial?.toString() ?? "Chưa ghi"),
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <b>{value}</b>
                    </div>
                  ))}
                </div>
                <h3 className="history-title">Hợp đồng của người thuê</h3>
                {data.contracts
                  .filter((c) =>
                    data.contractTenants.some(
                      (l) =>
                        l.contract_id === c.id && l.tenant_id === tenant.id,
                    ),
                  )
                  .map((c) => (
                    <div className="contract" key={c.id}>
                      <FileText size={20} />
                      <div>
                        <b>{c.file_name}</b>
                        <small>
                          {c.starts_on} – {c.ends_on}
                        </small>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => viewContract(c, setError, setBusy)}
                      >
                        Xem hợp đồng
                      </button>
                    </div>
                  ))}
                {!data.contractTenants.some(
                  (l) => l.tenant_id === tenant.id,
                ) && (
                  <p className="form-hint">
                    Chưa có hợp đồng được gán cho hồ sơ này.
                  </p>
                )}
                <h3 className="history-title">
                  Hóa đơn & thanh toán của người thuê
                </h3>
                <p className="form-hint">
                  Hóa đơn chung có một công nợ và lịch sử thanh toán dùng chung
                  cho các người thuê liên quan.
                </p>
                {data.invoices
                  .filter((i) =>
                    data.invoiceTenants.some(
                      (l) => l.invoice_id === i.id && l.tenant_id === tenant.id,
                    ),
                  )
                  .sort((a, b) => b.period.localeCompare(a.period))
                  .map((i) => (
                    <div className="tenant-invoice-history" key={i.id}>
                      <div>
                        <b>
                          Kỳ {i.period.slice(0, 7)} · {money(i.total)}
                        </b>
                        <small>
                          Còn phải thu: {money(balance(i, data.payments))}
                        </small>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => {
                          setInvoice(i);
                          setModal("invoice-detail");
                        }}
                      >
                        Xem hóa đơn
                      </button>
                      {canWrite && balance(i, data.payments) > 0 && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setInvoice(i);
                            setModal("payment");
                          }}
                        >
                          Thu tiền
                        </button>
                      )}
                    </div>
                  ))}
                {!data.invoiceTenants.some(
                  (l) => l.tenant_id === tenant.id,
                ) && (
                  <p className="form-hint">
                    Chưa có hóa đơn được gán cho hồ sơ này.
                  </p>
                )}
                {canWrite && (
                  <>
                    <button
                      className="primary wide"
                      onClick={() => setModal("tenant-edit")}
                    >
                      Sửa hồ sơ
                    </button>
                    {!tenant.move_out && (
                      <button
                        className="secondary wide"
                        onClick={() => setModal("move-out")}
                      >
                        Ghi nhận chuyển đi
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            {modal === "move-out" && tenant && (
              <>
                <h2>Ghi nhận chuyển đi</h2>
                <p>
                  Người thuê sẽ được chuyển sang trạng thái Đã chuyển đi. Hợp
                  đồng, hóa đơn và thanh toán được lưu trong hồ sơ người thuê,
                  không hiển thị ở phòng khi không còn người thuê liên quan đang
                  ở.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const date = String(
                      new FormData(e.currentTarget).get("move_out"),
                    );
                    await act(async () => {
                      await update("tenants", tenant.id, org, {
                        move_out: date,
                      });
                      navigate("tenants");
                    }, "Đã ghi nhận chuyển đi");
                  }}
                >
                  <label>
                    Ngày chuyển đi
                    <input
                      required
                      type="date"
                      name="move_out"
                      min={tenant.move_in}
                      defaultValue={localDay()}
                    />
                  </label>
                  <button className="primary wide" disabled={busy}>
                    Lưu
                  </button>
                </form>
              </>
            )}
            {modal === "document-owners" && documentTarget && (
              <>
                <h2>Gán tài liệu cho người thuê</h2>
                <p>
                  Chọn người thuộc đợt thuê liên quan. Với tài liệu chung, chọn
                  tất cả người liên quan. Hồ sơ đã gán được giữ lại.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await act(
                      () =>
                        rpc("link_tenant_document", {
                          org,
                          document_kind: documentTarget.kind,
                          target_document: documentTarget.id,
                          tenant_ids: ownerIds,
                        }),
                      "Đã gán tài liệu cho người thuê",
                    );
                  }}
                >
                  {data.tenants
                    .filter((t) => t.room_id === documentTarget.roomId)
                    .map((t) => (
                      <label className="owner-checkbox" key={t.id}>
                        <input
                          type="checkbox"
                          checked={ownerIds.includes(t.id)}
                          disabled={
                            busy ||
                            documentTenants(
                              data,
                              documentTarget.kind,
                              documentTarget.id,
                            ).some((o) => o.id === t.id)
                          }
                          onChange={(e) =>
                            setOwnerIds(
                              e.target.checked
                                ? [...ownerIds, t.id]
                                : ownerIds.filter((id) => id !== t.id),
                            )
                          }
                        />
                        <span>
                          {t.full_name}
                          <small>
                            {t.move_in} · {tenantStatus(t)}
                          </small>
                        </span>
                      </label>
                    ))}
                  <button
                    className="primary wide"
                    disabled={busy || !ownerIds.length}
                  >
                    Lưu người thuê liên quan
                  </button>
                </form>
              </>
            )}
            {modal === "payment" && invoice && (
              <>
                <h2>Ghi nhận thu tiền</h2>
                <p>
                  Còn phải thu: {money(balance(invoice, data.payments))}. Ngày
                  thanh toán là thời điểm ghi nhận.
                </p>
                <DataForm
                  schema={paymentSchema}
                  fields={[
                    {
                      name: "amount",
                      label: "Số tiền thanh toán (VNĐ)",
                      type: "number",
                      min: 1,
                      max: balance(invoice, data.payments),
                    },
                  ]}
                  defaults={{ amount: balance(invoice, data.payments) }}
                  submit="Ghi nhận thanh toán"
                  onSubmit={(v) =>
                    save(
                      () =>
                        rpc("record_payment", {
                          org,
                          target_invoice: invoice.id,
                          payment_amount: v.amount,
                        }),
                      "Đã ghi nhận thanh toán",
                    )
                  }
                />
              </>
            )}
            {modal === "invoice-detail" && invoice && (
              <>
                <h2>Hóa đơn · {invoice.period.slice(0, 7)}</h2>

                {invoice.billing_cycle_id && (
                  <p className="form-hint">
                    Đợt thuê nhận phòng{" "}
                    {
                      data.billingCycles.find(
                        (c) => c.id === invoice.billing_cycle_id,
                      )?.starts_on
                    }
                  </p>
                )}
                <div className="detail-list">
                  {[
                    ["Tiền phòng", money(invoice.room_rent)],
                    [
                      "Điện",
                      `${invoice.electricity_new - invoice.electricity_old} kWh × ${money(invoice.electricity_rate)}`,
                    ],
                    [
                      "Nước",
                      invoice.water_mode === "person"
                        ? `${invoice.water_count} người × ${money(invoice.water_unit_rate || 0)} = ${money(invoice.water_fee || 0)}`
                        : `${invoice.water_new - invoice.water_old} m³ × ${money(invoice.water_rate)}`,
                    ],
                    ["Dịch vụ", money(invoice.trash_fee + invoice.wifi_fee)],
                    [
                      invoice.laundry_count != null
                        ? `Máy giặt · ${invoice.laundry_count} người × ${money(invoice.laundry_rate || 0)}`
                        : "Máy giặt",
                      money(invoice.laundry_fee),
                    ],
                    ["Tổng hóa đơn", money(invoice.total)],
                    ["Còn phải thu", money(balance(invoice, data.payments))],
                    ["Hạn thanh toán", invoice.due_date],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span>{k}</span>
                      <b>{v}</b>
                    </div>
                  ))}
                </div>
                <div className="history-title">
                  Người thuê liên quan:{" "}
                  {documentTenants(data, "invoice", invoice.id)
                    .map((t) => t.full_name)
                    .join(", ") || "Chưa gán"}
                </div>
                {canWrite && (
                  <button
                    className="secondary wide"
                    onClick={() =>
                      assignOwners("invoice", invoice.id, invoice.room_id)
                    }
                  >
                    Gán người thuê
                  </button>
                )}
                {tenant && (
                  <button
                    className="text-button wide"
                    onClick={() => setModal("tenant-detail")}
                  >
                    Quay lại hồ sơ người thuê
                  </button>
                )}
                <h3 className="history-title">Lịch sử thanh toán</h3>
                {data.payments
                  .filter((p) => p.invoice_id === invoice.id)
                  .map((p) => (
                    <div className="bill-line" key={p.id}>
                      <span>
                        {new Date(p.paid_at).toLocaleString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                        })}
                      </span>
                      <b>{money(p.amount)}</b>
                    </div>
                  ))}
              </>
            )}
            {modal === "contract" && room && (
              <>
                <h2>Lưu hợp đồng · {room.name}</h2>
                <p>
                  Tệp được lưu riêng tư, chỉ thành viên có quyền mới có thể xem.
                </p>
                <ContractUpload
                  org={org}
                  room={room}
                  onSaved={async () => {
                    setModal("");
                    await refresh();
                    notify("Đã lưu hợp đồng");
                  }}
                />
              </>
            )}
            {modal === "invite" && (
              <>
                <h2>Cấp quyền truy cập</h2>
                <p>
                  Người được cấp quyền đăng ký bằng email này và chọn “Nhận lời
                  mời”. Ứng dụng không tự gửi email mời.
                </p>
                <DataForm
                  schema={inviteSchema}
                  fields={[
                    { name: "email", label: "Email", type: "email" },
                    {
                      name: "role",
                      label: "Vai trò",
                      options: [
                        { value: "manager", label: "Quản lý" },
                        { value: "viewer", label: "Chỉ xem" },
                      ],
                    },
                  ]}
                  defaults={{ email: "", role: "viewer" }}
                  submit="Lưu lời mời"
                  onSubmit={(v) =>
                    save(
                      () =>
                        insert("invitations", { ...v, organization_id: org }),
                      "Đã tạo lời mời",
                    )
                  }
                />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Loading({ label }: { label: string }) {
  return (
    <div className="loading">
      <LoaderCircle size={24} className="spinner" />
      {label}
    </div>
  );
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <Building2 size={28} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
  foot,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  foot: string;
}) {
  return (
    <section className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <div className="stat-foot">{foot}</div>
    </section>
  );
}
function Invoices({
  invoices,
  data,
  canWrite,
  pay,
  detail,
}: {
  invoices: Invoice[];
  data: Data;
  canWrite: boolean;
  pay: (i: Invoice) => void;
  detail: (i: Invoice) => void;
}) {
  return invoices.length ? (
    <div className="table-wrap">
      <table className="mobile-cards">
        <thead>
          <tr>
            <th>PHÒNG / CĂN HỘ</th>
            <th>TỔNG HÓA ĐƠN</th>
            <th>CÒN PHẢI THU</th>
            <th>HẠN THANH TOÁN</th>
            <th>TRẠNG THÁI</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => {
            const room = data.rooms.find((r) => r.id === i.room_id),
              remaining = balance(i, data.payments);
            return (
              <tr key={i.id}>
                <td data-label="Phòng / căn hộ">
                  <button className="text-button" onClick={() => detail(i)}>
                    {isCurrentDocument(data, "invoice", i.id) ? (
                      <>
                        {room?.name} ·{" "}
                        {
                          data.properties.find(
                            (p) => p.id === room?.property_id,
                          )?.name
                        }
                      </>
                    ) : (
                      <>
                        Hồ sơ:{" "}
                        {documentTenants(data, "invoice", i.id)
                          .map((t) => t.full_name)
                          .join(", ")}
                      </>
                    )}
                  </button>
                  <small>Kỳ {i.period.slice(0, 7)}</small>
                  {i.billing_cycle_id && (
                    <small>
                      Nhận phòng{" "}
                      {
                        data.billingCycles.find(
                          (c) => c.id === i.billing_cycle_id,
                        )?.starts_on
                      }
                    </small>
                  )}
                </td>
                <td data-label="Tổng hóa đơn">{money(i.total)}</td>
                <td data-label="Còn phải thu">{money(remaining)}</td>
                <td data-label="Hạn thanh toán">{i.due_date}</td>
                <td data-label="Trạng thái">
                  <span className={"status " + (remaining ? "pending" : "")}>
                    {remaining
                      ? i.due_date < localDay()
                        ? "Quá hạn"
                        : "Chưa thu đủ"
                      : "Đã thu đủ"}
                  </span>
                </td>
                <td data-label="Thao tác">
                  {canWrite && remaining > 0 && (
                    <button className="text-button" onClick={() => pay(i)}>
                      Thu tiền
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="Chưa có hóa đơn cần hiển thị"
      detail="Hóa đơn của kỳ được chọn sẽ xuất hiện tại đây."
    />
  );
}
function InvoiceForm({
  baseline,
  period,
  previous,
  room,
  rates,
  laundryPeople,
  onSubmit,
}: {
  period: string;
  previous: Invoice | null;
  baseline: BillingCycle;
  laundryPeople: number;
  room: Room;
  rates: Rates;
  onSubmit: (v: Record<string, unknown>) => Promise<void>;
}) {
  const eOld = previous?.electricity_new ?? baseline.electricity_initial ?? 0;
  const perPersonWater = rates.water_mode === "person";
  const wOld =
    previous?.water_mode === "person" && !perPersonWater
      ? (baseline.water_initial ?? 0)
      : (previous?.water_new ?? baseline.water_initial ?? 0);
  const deadline = nextMonth(period).slice(0, 7) + "-05";
  const [readings, setReadings] = useState<{
    electricity: number;
    water: number;
  } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <div
      onInput={(event) => {
        const form = (event.target as HTMLElement).closest("form");
        if (!form) return;
        const values = new FormData(form);
        const e = values.get("electricity_new"),
          w = perPersonWater ? String(wOld) : values.get("water_new");
        try {
          if (e === null || e === "" || w === null || w === "")
            throw new Error();
          const electricity = Number(e),
            water = Number(w);
          const total = calculateBill(
            room.monthly_rent,
            rates,
            eOld,
            electricity,
            wOld,
            water,
            laundryPeople,
          );
          setReadings({ electricity, water });
          setPreview(total);
        } catch {
          setReadings(null);
          setPreview(null);
        }
      }}
    >
      <DataForm
        schema={invoiceSchema}
        fields={[
          {
            name: "electricity_new",
            label: `Điện · chỉ số mới (${money(rates.electricity)}/kWh)`,
            type: "number",
            min: eOld,
          },
          {
            name: "water_new",
            label: `Nước · chỉ số mới (${money(rates.water)}/m³)`,
            type: "number",
            min: wOld,
          },
        ].filter((field) => field.name !== "water_new" || !perPersonWater)}
        defaults={{
          period,
          due_date: deadline,
          electricity_old: eOld,
          water_old: wOld,
          electricity_new: "",
          water_new: perPersonWater ? wOld : "",
        }}
        submit="Lập hóa đơn"
        onSubmit={(values) =>
          onSubmit({
            ...values,
            period,
            due_date: deadline,
            electricity_old: eOld,
            water_old: wOld,
          })
        }
      >
        <div className="bill-line">
          Điện · chỉ số cũ <output aria-label="Điện · chỉ số cũ">{eOld}</output>
        </div>
        {!perPersonWater && (
          <div className="bill-line">
            Nước · chỉ số cũ{" "}
            <output aria-label="Nước · chỉ số cũ">{wOld}</output>
          </div>
        )}
        <div className="invoice-formula" aria-label="Công thức tính hóa đơn">
          <h3>Công thức tính</h3>
          <p>
            Tổng tiền = (Số điện mới − Số điện cũ) × Đơn giá điện +{" "}
            {perPersonWater
              ? "Số người × Đơn giá nước/người/tháng"
              : "(Số nước mới − Số nước cũ) × Đơn giá nước"}{" "}
            + Tiền phòng + Dịch vụ + Số người × Đơn giá máy giặt.
          </p>
          {readings && (
            <>
              <p>
                Điện: ({readings.electricity} − {eOld}) ×{" "}
                {money(rates.electricity)} ={" "}
                <b>
                  {money((readings.electricity - eOld) * rates.electricity)}
                </b>
              </p>
              <p>
                Nước:{" "}
                {perPersonWater
                  ? `${laundryPeople} người`
                  : `(${readings.water} − ${wOld})`}{" "}
                × {money(rates.water)} ={" "}
                <b>
                  {money(
                    (perPersonWater ? laundryPeople : readings.water - wOld) *
                      rates.water,
                  )}
                </b>
              </p>
            </>
          )}
          <p>
            Tiền phòng: <b>{money(room.monthly_rent)}</b>
          </p>
          <p>
            Dịch vụ: <b>{money(rates.trash + rates.wifi)}</b>/phòng/tháng
          </p>
          <p>
            Máy giặt: {laundryPeople} người × {money(rates.laundry)}/người/tháng
            = <b>{money(rates.laundry * laundryPeople)}</b>
          </p>
          {readings && (
            <p>
              Tổng tiền ={" "}
              {money((readings.electricity - eOld) * rates.electricity)} +{" "}
              {money(
                (perPersonWater ? laundryPeople : readings.water - wOld) *
                  rates.water,
              )}{" "}
              + {money(room.monthly_rent)} + {money(rates.trash + rates.wifi)} +{" "}
              {money(rates.laundry * laundryPeople)} = <b>{money(preview!)}</b>
            </p>
          )}
        </div>
        <div className="bill-total" aria-live="polite">
          Tổng tiền phòng phải đóng{" "}
          <b>
            {preview === null ? "Nhập chỉ số điện và nước" : money(preview)}
          </b>
        </div>
        <p className="form-hint">
          Kỳ {period} · Hạn thanh toán tự đặt: {deadline}. Tiền phòng và phí
          tháng không tự chia theo ngày ở.
        </p>
      </DataForm>
    </div>
  );
}

function ContractUpload({
  org,
  room,
  onSaved,
}: {
  org: string;
  room: Room;
  onSaved: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [error, setError] = useState("");
  return (
    <>
      <label className="file-label">
        Tệp hợp đồng
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setError("");
          }}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <DataForm
        schema={contractSchema}
        fields={[
          { name: "starts_on", label: "Ngày bắt đầu", type: "date" },
          { name: "ends_on", label: "Ngày kết thúc", type: "date" },
        ]}
        defaults={{ starts_on: localDay(), ends_on: "" }}
        submit="Tải lên và lưu"
        onSubmit={async (v) => {
          if (!file) throw new Error("Vui lòng chọn tệp hợp đồng");
          if (
            !["application/pdf", "image/jpeg", "image/png"].includes(
              file.type,
            ) ||
            file.size > 10 * 1024 * 1024 ||
            !file.size
          )
            throw new Error("Tệp phải là PDF, JPG hoặc PNG và không quá 10 MB");
          const extension =
            file.type === "application/pdf"
              ? "pdf"
              : file.type === "image/jpeg"
                ? "jpg"
                : "png";
          const path = `${org}/${room.id}/${crypto.randomUUID()}.${extension}`;
          const { error } = await supabase!.storage
            .from("contracts")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (error)
            throw new Error("Không thể tải hợp đồng: " + error.message);
          try {
            await insert("contracts", {
              ...v,
              organization_id: org,
              room_id: room.id,
              file_name: file.name,
              storage_path: path,
            });
          } catch (e) {
            const cleanup = await supabase!.storage
              .from("contracts")
              .remove([path]);
            if (cleanup.error)
              setError(
                "Không lưu được thông tin hợp đồng; tệp chưa liên kết cần được dọn trong Storage.",
              );
            throw e;
          }
          await onSaved();
        }}
      />
    </>
  );
}
async function viewContract(
  c: Contract,
  setError: (s: string) => void,
  setBusy: (b: boolean) => void,
) {
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  setBusy(true);
  try {
    const { data, error } = await supabase!.storage
      .from("contracts")
      .createSignedUrl(c.storage_path, 60);
    if (error) throw error;
    if (tab) tab.location.href = data.signedUrl;
    else
      throw new Error(
        "Trình duyệt chặn cửa sổ mới. Hãy cho phép mở cửa sổ để xem hợp đồng.",
      );
  } catch (e) {
    tab?.close();
    setError(e instanceof Error ? e.message : "Không thể mở hợp đồng");
  } finally {
    setBusy(false);
  }
}
function exportInvoices(invoices: Invoice[], data: Data) {
  const escape = (v: string | number) =>
    '"' +
    String(v)
      .replace(/"/g, '""')
      .replace(/^[=+@-]/, "'$&") +
    '"';
  const lines = [
    ["Căn hộ", "Phòng", "Kỳ", "Tổng hóa đơn", "Còn phải thu", "Hạn thanh toán"],
    ...invoices.map((i) => {
      const r = data.rooms.find((r) => r.id === i.room_id);
      return [
        data.properties.find((p) => p.id === r?.property_id)?.name || "",
        r?.name || "",
        i.period,
        i.total,
        balance(i, data.payments),
        i.due_date,
      ];
    }),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF" + lines.map((line) => line.map(escape).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "HH-HOME-hoa-don.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function PropertyRates({
  property,
  rates,
  canWrite,
  onSave,
}: {
  property: Property;
  rates: Rates | undefined;
  canWrite: boolean;
  onSave: (v: Record<string, unknown>) => Promise<void>;
}) {
  const [waterMode, setWaterMode] = useState(rates?.water_mode || "meter");
  useEffect(
    () => setWaterMode(rates?.water_mode || "meter"),
    [rates?.water_mode],
  );
  const fields = rateFields.map((field) =>
    field.name === "water" && waterMode === "person"
      ? { ...field, label: "Nước (đ/người/tháng)" }
      : field,
  );
  return (
    <section
      onChange={(event) => {
        const input = event.target as HTMLInputElement;
        if (input.name === "water_mode")
          setWaterMode(input.value as "meter" | "person");
      }}
      className="panel settings property-rates"
      aria-label={"Đơn giá dịch vụ · " + property.name}
    >
      <div className="panel-heading">
        <div>
          <h2>Đơn giá dịch vụ · {property.name}</h2>
        </div>
      </div>
      {canWrite ? (
        <DataForm
          key={JSON.stringify(rates)}
          schema={ratesSchema
            .omit({ trash: true, wifi: true })
            .extend({ service: ratesSchema.shape.trash })}
          fields={fields}
          defaults={
            rates
              ? {
                  electricity: rates.electricity,
                  water: rates.water,
                  water_mode: rates.water_mode || "meter",
                  service: rates.trash + rates.wifi,
                  laundry: rates.laundry,
                }
              : {
                  electricity: "",
                  water: "",
                  water_mode: "meter",
                  service: "",
                  laundry: "",
                }
          }
          submit="Lưu đơn giá"
          onSubmit={({ service, ...values }) =>
            onSave({ ...values, trash: service, wifi: 0 })
          }
        />
      ) : rates ? (
        <div className="detail-list rate-list">
          {fields.map((f) => (
            <div key={f.name}>
              <span>{f.label}</span>
              <b>
                {f.name === "water_mode"
                  ? waterMode === "person"
                    ? "Theo người/tháng"
                    : "Theo m³"
                  : money(
                      f.name === "service"
                        ? rates.trash + rates.wifi
                        : Number(rates[f.name as keyof Rates]),
                    )}
              </b>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title="Chưa thiết lập đơn giá"
          detail="Quản lý sẽ thiết lập đơn giá riêng cho căn hộ này."
        />
      )}
    </section>
  );
}
