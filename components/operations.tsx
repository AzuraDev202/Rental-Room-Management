"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
const FinanceChart = dynamic(() => import("./finance-chart"), {
  ssr: false,
  loading: () => <p>Đang tải biểu đồ...</p>,
});
import type { Data, Maintenance, Room, Invoice } from "../lib/types";
import { balance, localDay, money } from "../lib/business";
import {
  billingToPrepare,
  financialSeries,
  maintenanceStatuses,
  roomAlerts,
} from "../lib/operations";
import { expenseSchema, maintenanceSchema } from "../lib/forms";
import { insert, rpc, update } from "../lib/data";
import { DataForm } from "./data-form";
const priorities = { low: "Thấp", normal: "Bình thường", high: "Cao" };
const categories = {
  maintenance: "Sửa chữa",
  utilities: "Điện nước vận hành",
  operations: "Vận hành",
  other: "Khác",
};
function roomLabel(data: Data, id: string) {
  const r = data.rooms.find((r) => r.id === id);
  return `${r?.name || "Phòng"} · ${data.properties.find((p) => p.id === r?.property_id)?.name || "Căn hộ"}`;
}
function OperationDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overlay">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          className="close"
          aria-label="Đóng"
          onClick={(event) => {
            if (
              !event.currentTarget
                .closest(".modal")
                ?.querySelector("fieldset:disabled")
            )
              onClose();
          }}
        >
          ×
        </button>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
function ExpenseForm({
  data,
  org,
  maintenance,
  onCreated,
}: {
  data: Data;
  org: string;
  maintenance?: Maintenance;
  onCreated: () => Promise<void>;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const room =
    maintenance && data.rooms.find((r) => r.id === maintenance.room_id);
  return (
    <DataForm
      schema={expenseSchema}
      fields={[
        ...(!maintenance
          ? [
              {
                name: "property_id",
                label: "Căn hộ chi phí",
                options: data.properties
                  .filter((p) => !p.deleted_at)
                  .map((p) => ({ value: p.id, label: p.name })),
              },
              {
                name: "room_id",
                label: "Phòng chi phí (không bắt buộc)",
                options: data.rooms
                  .filter((r) =>
                    data.properties.some(
                      (p) => p.id === r.property_id && !p.deleted_at,
                    ),
                  )
                  .map((r) => ({ value: r.id, label: roomLabel(data, r.id) })),
              },
            ]
          : []),
        { name: "title", label: "Nội dung khoản chi" },
        {
          name: "category",
          label: "Loại khoản chi",
          options: Object.entries(categories).map(([value, label]) => ({
            value,
            label,
          })),
        },
        { name: "amount", label: "Số tiền chi (VNĐ)", type: "number", min: 1 },
        { name: "paid_on", label: "Ngày chi", type: "date" },
      ]}
      defaults={{
        property_id: room?.property_id || "",
        room_id: room?.id || "",
        title: maintenance?.title || "",
        category: maintenance ? "maintenance" : "operations",
        amount: "",
        paid_on: localDay(),
      }}
      submit="Lưu khoản chi"
      onSubmit={async (v) => {
        await insert("expenses", {
          ...v,
          id,
          organization_id: org,
          room_id: v.room_id || null,
          maintenance_id: maintenance?.id || null,
        });
        await onCreated();
      }}
    />
  );
}
export function FinancePanel({
  data,
  org,
  period,
  canWrite,
  onChanged,
}: {
  data: Data;
  org: string;
  period: string;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [property, setProperty] = useState("");
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const series = financialSeries(data, period.slice(0, 4), property);
  const month = series[Number(period.slice(5)) - 1];
  const expenses = data.expenses
    .filter(
      (e) =>
        e.paid_on.startsWith(period) &&
        (!property || e.property_id === property),
    )
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  return (
    <>
      <section className="panel operations-panel">
        <div className="panel-heading">
          <h2>Thu chi & lợi nhuận</h2>
        </div>
        <label className="form-field">
          Lọc căn hộ thu chi
          <select
            aria-label="Lọc căn hộ thu chi"
            value={property}
            onChange={(e) => setProperty(e.target.value)}
          >
            <option value="">Tất cả căn hộ</option>
            {data.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.deleted_at ? " · Đã xóa" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="operations-metrics">
          <div>
            Tiền thuê thực thu<strong>{money(month?.revenue || 0)}</strong>
          </div>
          <div>
            Chi phí thực chi<strong>{money(month?.expense || 0)}</strong>
          </div>
          <div>
            Lợi nhuận vận hành<strong>{money(month?.profit || 0)}</strong>
          </div>
        </div>
        <p className="muted">
          Lợi nhuận = tiền thuê thực thu − chi phí thực chi. Tiền đặt cọc và
          khấu trừ cọc theo dõi riêng; khoản chi đã hủy không được tính.
        </p>
        <div className="finance-chart">
          <FinanceChart data={series} />
        </div>
      </section>
      <section className="panel operations-panel">
        <div className="panel-heading">
          <h2>Khoản chi · {period}</h2>
          {canWrite && (
            <button className="primary" onClick={() => setAdding(true)}>
              Ghi khoản chi
            </button>
          )}
        </div>
        {expenses.map((e) => (
          <article key={e.id} className="operation-row">
            <strong>
              {e.title} · {money(e.amount)}
            </strong>
            <p>
              {e.paid_on} ·{" "}
              {data.properties.find((p) => p.id === e.property_id)?.name}
              {e.room_id
                ? ` · ${data.rooms.find((r) => r.id === e.room_id)?.name}`
                : ""}{" "}
              · {categories[e.category as keyof typeof categories]}
            </p>
            {e.voided_at ? (
              <span className="status vacant">Đã hủy</span>
            ) : (
              canWrite && (
                <button
                  className="text-button"
                  onClick={() => {
                    setError("");
                    setVoiding(e.id);
                  }}
                >
                  Hủy khoản chi
                </button>
              )
            )}
          </article>
        ))}
        {!expenses.length && <p>Chưa có khoản chi trong kỳ.</p>}
      </section>
      {adding && (
        <OperationDialog title="Ghi khoản chi" onClose={() => setAdding(false)}>
          <ExpenseForm
            data={data}
            org={org}
            onCreated={async () => {
              await onChanged();
              setAdding(false);
            }}
          />
        </OperationDialog>
      )}
      {voiding && (
        <OperationDialog
          title="Hủy khoản chi"
          onClose={() => !busy && setVoiding(null)}
        >
          <p>
            Hủy “{data.expenses.find((e) => e.id === voiding)?.title}”? Bản ghi
            vẫn được giữ trong lịch sử và không tính vào thực chi.
          </p>
          {error && <p role="alert">{error}</p>}
          <button
            className="danger-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await rpc("void_expense", { org, target_expense: voiding });
                await onChanged();
                setVoiding(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Không thể hủy");
              } finally {
                setBusy(false);
              }
            }}
          >
            Xác nhận hủy khoản chi
          </button>
        </OperationDialog>
      )}
    </>
  );
}
export function MaintenancePanel({
  data,
  org,
  canWrite,
  onChanged,
  roomId,
}: {
  data: Data;
  org: string;
  canWrite: boolean;
  onChanged: () => Promise<void>;
  roomId?: string;
}) {
  const [status, setStatus] = useState(roomId ? "all" : "open");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [expense, setExpense] = useState<Maintenance | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = data.rooms.filter((r) =>
    data.properties.some((p) => p.id === r.property_id && !p.deleted_at),
  );
  const visible = data.maintenance
    .filter(
      (m) =>
        (!roomId || m.room_id === roomId) &&
        (status === "all" ||
          (status === "open"
            ? ["new", "in_progress"].includes(m.status)
            : m.status === status)) &&
        (m.title + " " + roomLabel(data, m.room_id))
          .toLocaleLowerCase("vi")
          .includes(query.toLocaleLowerCase("vi")),
    )
    .sort(
      (a, b) =>
        ({ high: 0, normal: 1, low: 2 })[a.priority] -
          { high: 0, normal: 1, low: 2 }[b.priority] ||
        b.created_at.localeCompare(a.created_at),
    );
  return (
    <section className="panel operations-panel">
      <div className="panel-heading">
        <h2>{roomId ? "Lịch sử sửa chữa" : "Sự cố & bảo trì"}</h2>
        {canWrite && current.some((r) => !roomId || r.id === roomId) && (
          <button className="primary" onClick={() => setAdding(true)}>
            Thêm sự cố
          </button>
        )}
      </div>
      <div className="operations-filters">
        <label>
          Tìm sự cố
          <input
            aria-label="Tìm sự cố"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tên sự cố, phòng hoặc căn hộ"
          />
        </label>
        <label>
          Trạng thái sự cố
          <select
            aria-label="Trạng thái sự cố"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">Chưa hoàn thành</option>
            <option value="all">Tất cả</option>
            {Object.entries(maintenanceStatuses).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {visible.map((m) => {
        const active = current.some((r) => r.id === m.room_id);
        const costs = data.expenses
          .filter((e) => e.maintenance_id === m.id && !e.voided_at)
          .reduce((sum, e) => sum + e.amount, 0);
        return (
          <article className="operation-row" key={m.id}>
            <h3>{m.title}</h3>
            <p>
              {roomLabel(data, m.room_id)} · Ưu tiên {priorities[m.priority]} ·{" "}
              {m.created_at.slice(0, 10)}
            </p>
            <p>{m.description}</p>
            <p>Đã chi: {money(costs)}</p>
            {canWrite && active ? (
              <div className="operation-actions">
                <select
                  aria-label={"Trạng thái · " + m.title}
                  disabled={busy}
                  value={m.status}
                  onChange={async (e) => {
                    setBusy(true);
                    setError("");
                    try {
                      await update("maintenance_requests", m.id, org, {
                        status: e.target.value,
                      });
                      await onChanged();
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Không thể cập nhật",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {Object.entries(maintenanceStatuses).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <button className="secondary" onClick={() => setExpense(m)}>
                  Ghi chi phí sửa chữa
                </button>
              </div>
            ) : (
              <span className="status">{maintenanceStatuses[m.status]}</span>
            )}
          </article>
        );
      })}
      {!visible.length && <p>Không có sự cố phù hợp.</p>}
      {adding && (
        <OperationDialog title="Thêm sự cố" onClose={() => setAdding(false)}>
          <DataForm
            schema={maintenanceSchema}
            fields={[
              ...(!roomId
                ? [
                    {
                      name: "room_id",
                      label: "Phòng xảy ra sự cố",
                      options: current.map((r) => ({
                        value: r.id,
                        label: roomLabel(data, r.id),
                      })),
                    },
                  ]
                : []),
              { name: "title", label: "Tên sự cố" },
              { name: "description", label: "Mô tả sự cố" },
              {
                name: "priority",
                label: "Mức độ ưu tiên",
                options: Object.entries(priorities).map(([value, label]) => ({
                  value,
                  label,
                })),
              },
            ]}
            defaults={{
              room_id: roomId || "",
              title: "",
              description: "",
              priority: "normal",
            }}
            submit="Lưu sự cố"
            onSubmit={async (v) => {
              await insert("maintenance_requests", {
                ...v,
                organization_id: org,
              });
              await onChanged();
              setAdding(false);
            }}
          />
        </OperationDialog>
      )}
      {expense && (
        <OperationDialog
          title="Ghi chi phí sửa chữa"
          onClose={() => setExpense(null)}
        >
          <p>
            {roomLabel(data, expense.room_id)} · {expense.title}
          </p>
          <ExpenseForm
            data={data}
            org={org}
            maintenance={expense}
            onCreated={async () => {
              await onChanged();
              setExpense(null);
            }}
          />
        </OperationDialog>
      )}
    </section>
  );
}
export function RemindersPanel({
  data,
  canWrite,
  onRoom,
  onInvoice,
}: {
  data: Data;
  canWrite: boolean;
  onRoom: (r: Room) => void;
  onInvoice: (i: Invoice) => void;
}) {
  const day = localDay();
  const unpaid = data.invoices
    .filter((i) => balance(i, data.payments) > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const contracts = data.rooms
    .filter((r) =>
      data.properties.some((p) => p.id === r.property_id && !p.deleted_at),
    )
    .flatMap((r) => {
      const alert = roomAlerts(data, r.id, day);
      return [...alert.expired, ...alert.expiring];
    });
  const prepare = billingToPrepare(data, day);
  return (
    <section className="panel operations-panel">
      <div className="panel-heading">
        <h2>Nhắc việc</h2>
      </div>
      <p className="muted">
        Cập nhật theo dữ liệu hiện tại. Nhắc hợp đồng trước 30 ngày; thông báo
        hiển thị trong app.
      </p>
      <h3>Thu tiền · {unpaid.length} hóa đơn</h3>
      {unpaid.map((i) => (
        <article className="operation-row" key={i.id}>
          <strong>
            {roomLabel(data, i.room_id)} · Kỳ {i.period.slice(0, 7)}
          </strong>
          <p>
            {i.due_date < day ? "Quá hạn" : "Còn phải thu"}:{" "}
            {money(balance(i, data.payments))} · Hạn {i.due_date}
          </p>
          <button className="secondary" onClick={() => onInvoice(i)}>
            {canWrite ? "Thu tiền" : "Xem hóa đơn"}
          </button>
        </article>
      ))}
      {!unpaid.length && <p>Không có hóa đơn cần thu.</p>}
      <h3>Gia hạn hợp đồng · {contracts.length}</h3>
      {contracts.map((c) => (
        <article className="operation-row" key={c.id}>
          <strong>{roomLabel(data, c.room_id)}</strong>
          <p>
            {c.ends_on < day ? "Đã hết hạn" : "Sắp hết hạn"} · {c.ends_on} ·{" "}
            {c.file_name}
          </p>
          <button
            className="secondary"
            onClick={() => {
              const r = data.rooms.find((r) => r.id === c.room_id);
              if (r) onRoom(r);
            }}
          >
            Xem phòng
          </button>
        </article>
      ))}
      {!contracts.length && <p>Không có hợp đồng cần gia hạn.</p>}
      <h3>Chuẩn bị hóa đơn · {day.slice(0, 7)}</h3>
      {prepare.map((r) => (
        <article className="operation-row" key={r.id}>
          <strong>{roomLabel(data, r.id)}</strong>
          <p>
            Chưa lập hóa đơn tháng này. Ghi chỉ số mới và xác nhận trước khi
            phát hành.
          </p>
          <button className="secondary" onClick={() => onRoom(r)}>
            Mở phòng
          </button>
        </article>
      ))}
      {!prepare.length && <p>Không có phòng đang ở cần chuẩn bị hóa đơn.</p>}
    </section>
  );
}
