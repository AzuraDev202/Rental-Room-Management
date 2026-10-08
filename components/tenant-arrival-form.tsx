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
              ]
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
              ? "Sắp vào ở: ghi chỉ số điện/nước tại ngày nhận phòng trước khi lập hóa đơn đầu tiên."
              : vacant
                ? "Phòng trống tại ngày vào ở: bắt buộc ghi điện/nước để làm mốc hóa đơn cho đợt thuê mới."
                : "Phòng vẫn có người ở tại ngày vào ở: tiếp tục mốc hóa đơn chung, không cần ghi chỉ số nhận phòng mới."}
        </p>
      </DataForm>
    </div>
  );
}
