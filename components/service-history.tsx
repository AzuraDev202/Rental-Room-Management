"use client";
import { useState } from "react";
import type { Data, Invoice } from "../lib/types";
import { money } from "../lib/business";
export function ServiceHistory({
  data,
  roomId,
  detail,
}: {
  data: Data;
  roomId?: string;
  detail: (i: Invoice) => void;
}) {
  const [propertyId, setPropertyId] = useState(""),
    [selectedRoom, setSelectedRoom] = useState(""),
    [month, setMonth] = useState("");
  const invoices = data.invoices
    .filter(
      (i) =>
        (!roomId || i.room_id === roomId) &&
        (!selectedRoom || i.room_id === selectedRoom) &&
        (!propertyId ||
          data.rooms.some(
            (r) => r.id === i.room_id && r.property_id === propertyId,
          )) &&
        (!month || i.period.startsWith(month)),
    )
    .sort((a, b) => b.period.localeCompare(a.period));
  const months = [
    ...new Set(
      data.invoices
        .filter((i) => !roomId || i.room_id === roomId)
        .map((i) => i.period.slice(0, 7)),
    ),
  ]
    .sort()
    .reverse();
  return (
    <section
      className="panel service-history"
      aria-label="Lịch sử sử dụng dịch vụ"
    >
      <div className="panel-heading">
        <div>
          <h2>Lịch sử sử dụng dịch vụ</h2>
          <p>Chỉ số cũ → mới, lượng tiêu thụ và phí đã chốt theo từng tháng.</p>
        </div>
      </div>
      <div className="service-history-filters">
        {!roomId && (
          <>
            <label>
              Căn hộ
              <select
                aria-label="Căn hộ lịch sử dịch vụ"
                value={propertyId}
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  setSelectedRoom("");
                }}
              >
                <option value="">Tất cả căn hộ</option>
                {data.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.deleted_at ? " (đã xóa)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Phòng
              <select
                aria-label="Phòng lịch sử dịch vụ"
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value)}
              >
                <option value="">Tất cả phòng</option>
                {data.rooms
                  .filter((r) => !propertyId || r.property_id === propertyId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {
                        data.properties.find((p) => p.id === r.property_id)
                          ?.name
                      }{" "}
                      · {r.name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        <label>
          Tháng
          <select
            aria-label="Tháng lịch sử dịch vụ"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            <option value="">Tất cả tháng</option>
            {months.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>
      {invoices.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>THÁNG / PHÒNG / CĂN HỘ</th>
                <th>ĐIỆN</th>
                <th>NƯỚC</th>
                <th>PHÍ THEO THÁNG</th>
                <th>TỔNG DỊCH VỤ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const r = data.rooms.find((r) => r.id === i.room_id);
                return (
                  <tr key={i.id}>
                    <td>
                      <button className="text-button" onClick={() => detail(i)}>
                        {i.period.slice(0, 7)} · {r?.name} ·{" "}
                        {
                          data.properties.find((p) => p.id === r?.property_id)
                            ?.name
                        }
                      </button>
                    </td>
                    <td>
                      {i.electricity_old} → {i.electricity_new}
                      <small>
                        {i.electricity_new - i.electricity_old} kWh ×{" "}
                        {money(i.electricity_rate)}
                      </small>
                    </td>
                    <td>
                      {i.water_old} → {i.water_new}
                      <small>
                        {i.water_new - i.water_old} m³ × {money(i.water_rate)}
                      </small>
                    </td>
                    <td>
                      <small>Rác: {money(i.trash_fee)}</small>
                      <small>Wifi: {money(i.wifi_fee)}</small>
                      <small>Máy giặt: {money(i.laundry_fee)}</small>
                    </td>
                    <td>{money(i.total - i.room_rent)}</td>
                    <td>
                      <button className="text-button" onClick={() => detail(i)}>
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="form-hint">
          Chưa có hóa đơn cho lựa chọn này. Tháng chưa lập hóa đơn chưa có số
          liệu để tổng kết.
        </p>
      )}
    </section>
  );
}
