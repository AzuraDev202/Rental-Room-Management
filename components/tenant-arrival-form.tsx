"use client";
import { useState } from "react";
import { DataForm, type Field } from "./data-form";
import { addTenantSchema } from "../lib/forms";
import { localDay, roomOccupiedOn } from "../lib/business";
import type { Data } from "../lib/types";
export function TenantArrivalForm({
  data,
  fields,
  roomId,
  onSubmit,
}: {
  data: Data;
  fields: Field[];
  roomId: string;
  onSubmit: (v: Record<string, unknown>) => Promise<void>;
}) {
  const [selectedRoom, setSelectedRoom] = useState(roomId),
    [day, setDay] = useState(localDay());
  const needsWater = (id: string) =>
    data.rates.find(
      (rate) =>
        rate.property_id ===
        data.rooms.find((room) => room.id === id)?.property_id,
    )?.water_mode !== "person";
  const meteredWater = needsWater(selectedRoom);
  const scheduled = day > localDay();
  const vacant = !!selectedRoom && !roomOccupiedOn(data, selectedRoom, day);
  return (
    <div
      onChange={(e) => {
        const input = e.target as HTMLInputElement;
        if (input.name === "room_id") setSelectedRoom(input.value);
        if (input.name === "move_in") setDay(input.value);
      }}
    >
      <DataForm
        schema={addTenantSchema(
          (room, date) => date > localDay() || roomOccupiedOn(data, room, date),
          needsWater,
        )}
        fields={[
          ...fields,
          ...(vacant && !scheduled
            ? [
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
                (field) => field.name !== "water_initial" || meteredWater,
              )
            : []),
        ]}
        defaults={{
          room_id: roomId,
          full_name: "",
          gender: "",
          birth_date: "",
          identity_number: "",
          phone: "",
          email: "",
          move_in: localDay(),
          electricity_initial: "",
          water_initial: "",
        }}
        submit="Lưu người thuê"
        onSubmit={onSubmit}
      >
        <p className="form-hint">
          {!selectedRoom
            ? "Chọn phòng để kiểm tra trạng thái."
            : scheduled
              ? meteredWater
                ? "Ghi chỉ số điện/nước khi đến ngày nhận phòng."
                : "Ghi chỉ số điện khi đến ngày nhận phòng; nước tính theo người."
              : vacant
                ? meteredWater
                  ? "Phòng trống: ghi chỉ số điện và nước lúc nhận phòng."
                  : "Phòng trống: ghi chỉ số điện lúc nhận phòng. Nước tính theo người/tháng."
                : "Phòng vẫn có người ở tại ngày vào ở: tiếp tục mốc hóa đơn chung, không cần ghi chỉ số nhận phòng mới."}
        </p>
      </DataForm>
    </div>
  );
}
