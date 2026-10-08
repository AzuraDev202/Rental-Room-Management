"use client";
import { useState } from "react";
import {
  Users,
  Plus,
  Search,
  ArrowRight,
  Building2,
  DoorOpen,
} from "lucide-react";
import type { Data, Tenant } from "../lib/types";
import { tenantStatus, localDay } from "../lib/business";
const statuses = ["Đang ở", "Sắp vào ở", "Đã chuyển đi", "Tất cả"] as const;
export function TenantDirectory({
  data,
  canWrite,
  add,
  detail,
}: {
  data: Data;
  canWrite: boolean;
  add: () => void;
  detail: (tenant: Tenant) => void;
}) {
  const [status, setStatus] = useState<string>("Đang ở"),
    [propertyId, setPropertyId] = useState(""),
    [roomId, setRoomId] = useState(""),
    [search, setSearch] = useState("");
  const day = localDay();
  const rooms = data.rooms
    .filter((r) => !propertyId || r.property_id === propertyId)
    .sort((a, b) => a.name.localeCompare(b.name, "vi", { numeric: true }));
  const groups = data.properties
    .filter((p) => !propertyId || p.id === propertyId)
    .sort((a, b) => a.name.localeCompare(b.name, "vi", { numeric: true }))
    .map((property) => ({
      property,
      rooms: rooms
        .filter(
          (r) => r.property_id === property.id && (!roomId || r.id === roomId),
        )
        .map((room) => ({
          room,
          tenants: data.tenants
            .filter(
              (t) =>
                t.room_id === room.id &&
                (status === "Tất cả" || tenantStatus(t, day) === status) &&
                `${t.full_name} ${t.phone} ${room.name} ${property.name}`
                  .toLocaleLowerCase("vi")
                  .includes(search.trim().toLocaleLowerCase("vi")),
            )
            .sort((a, b) => a.full_name.localeCompare(b.full_name, "vi")),
        }))
        .filter((r) => r.tenants.length),
    }))
    .filter((p) => p.rooms.length);
  const count = groups.reduce(
    (sum, p) => sum + p.rooms.reduce((s, r) => s + r.tenants.length, 0),
    0,
  );
  return (
    <section className="panel tenant-directory">
      <div className="panel-heading">
        <div>
          <h2>
            Danh sách người thuê <span className="badge">{count}</span>
          </h2>
          <p>Phân nhóm theo căn hộ và phòng · {status}</p>
        </div>
        {canWrite && (
          <button
            className="secondary"
            disabled={!data.rooms.length}
            onClick={add}
          >
            <Plus size={15} /> Thêm người thuê
          </button>
        )}
      </div>
      <div className="tenant-filters">
        <label>
          Trạng thái
          <select
            aria-label="Lọc trạng thái người thuê"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Căn hộ
          <select
            aria-label="Lọc căn hộ người thuê"
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setRoomId("");
            }}
          >
            <option value="">Tất cả căn hộ</option>
            {data.properties
              .slice()
              .sort((a, b) =>
                a.name.localeCompare(b.name, "vi", { numeric: true }),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Phòng
          <select
            aria-label="Lọc phòng người thuê"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          >
            <option value="">Tất cả phòng</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {!propertyId
                  ? " · " +
                    data.properties.find((p) => p.id === r.property_id)?.name
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="tenant-search-label">
          Tìm kiếm
          <span className="search">
            <Search size={17} />
            <input
              aria-label="Tìm người thuê"
              placeholder="Tên, điện thoại, phòng..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </span>
        </label>
      </div>
      {groups.map(({ property, rooms }) => (
        <section
          key={property.id}
          className="tenant-property"
          aria-label={"Người thuê · " + property.name}
        >
          <div className="tenant-property-heading">
            <Building2 size={20} />
            <div>
              <h3>{property.name}</h3>
              <p>{property.address}</p>
            </div>
            <span className="badge">
              {rooms.reduce((s, r) => s + r.tenants.length, 0)} người
            </span>
          </div>
          {rooms.map(({ room, tenants }) => (
            <section
              className="tenant-room"
              key={room.id}
              aria-label={property.name + " · " + room.name}
            >
              <div className="tenant-room-heading">
                <DoorOpen size={16} />
                <h4>{room.name}</h4>
                <span>{tenants.length} người</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>NGƯỜI THUÊ</th>
                      <th>SỐ ĐIỆN THOẠI</th>
                      <th>NGÀY VÀO Ở</th>
                      <th>TRẠNG THÁI</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <b>{t.full_name}</b>
                        </td>
                        <td>{t.phone}</td>
                        <td>
                          {new Date(t.move_in).toLocaleDateString("vi-VN", {
                            timeZone: "Asia/Ho_Chi_Minh",
                          })}
                        </td>
                        <td>
                          <span
                            className={
                              "status " +
                              (tenantStatus(t, day) !== "Đang ở"
                                ? "vacant"
                                : "")
                            }
                          >
                            {tenantStatus(t, day)}
                          </span>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => detail(t)}
                          >
                            Chi tiết <ArrowRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </section>
      ))}
      {!groups.length && (
        <div className="empty">
          <Users size={28} />
          <h3>
            {!data.tenants.length
              ? "Chưa có người thuê"
              : "Không có người thuê phù hợp"}
          </h3>
          <p>
            {!data.tenants.length
              ? "Thêm căn hộ, phòng và hồ sơ người thuê để bắt đầu."
              : `Không tìm thấy người thuê ${status === "Tất cả" ? "" : status.toLocaleLowerCase("vi")} với bộ lọc hiện tại.`}
          </p>
        </div>
      )}
    </section>
  );
}
