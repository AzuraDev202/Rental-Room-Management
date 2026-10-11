"use client";

import { useRef, useState } from "react";
import { Bell, Copy, X } from "lucide-react";
import { balance, money, previousMonth } from "../lib/business";
import type { Data, Invoice } from "../lib/types";

export function InvoiceNotification({
  invoice,
  data,
}: {
  invoice: Invoice;
  data: Data;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState("");
  const room = data.rooms.find((r) => r.id === invoice.room_id);
  const property = data.properties.find((p) => p.id === room?.property_id);
  const fixedPeriod = (invoice.fixed_period || invoice.period).slice(0, 7);
  const usagePeriod = (
    invoice.service_period || previousMonth(invoice.period)
  ).slice(0, 7);
  const electricity =
    (invoice.electricity_new - invoice.electricity_old) *
    invoice.electricity_rate;
  const water =
    invoice.water_fee ??
    (invoice.water_new - invoice.water_old) * invoice.water_rate;
  const remaining = balance(invoice, data.payments);
  const message = [
    `HH HOME · THÔNG BÁO HÓA ĐƠN`,
    `${property?.name || "Căn hộ"} · ${room?.name || "Phòng"}`,
    `Kỳ hóa đơn: ${invoice.period.slice(0, 7)}`,
    `Tiền phòng (${fixedPeriod}): ${money(invoice.room_rent)}`,
    `Dịch vụ: ${money(invoice.trash_fee + invoice.wifi_fee)}`,
    `Nước: ${money(water)}`,
    `Máy giặt: ${money(invoice.laundry_fee)}`,
    `Điện${invoice.arrival_bill ? "" : ` (${usagePeriod})`}: ${money(electricity)}`,
    `Tổng tiền: ${money(invoice.total)}`,
    `Đã thu: ${money(invoice.total - remaining)}`,
    `Còn phải thu: ${money(remaining)}`,
    `Hạn thanh toán: ${invoice.due_date.split("-").reverse().join("/")}`,
  ].join("\n");

  return (
    <>
      <button
        className="text-button invoice-notify-button"
        onClick={() => {
          setStatus("");
          dialog.current?.showModal();
        }}
      >
        <Bell size={15} /> Gửi thông báo
      </button>
      <dialog
        ref={dialog}
        className="modal invoice-notification-dialog"
        aria-label="Thông báo hóa đơn Zalo"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const box = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom
            )
              event.currentTarget.close();
          }
        }}
      >
        <button
          className="close"
          aria-label="Đóng thông báo"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
        <h2>Thông báo hóa đơn</h2>
        <p>
          Chưa kết nối Zalo OA và nhóm GMF của căn hộ. Bạn có thể sao chép nội
          dung để gửi thủ công.
        </p>
        <textarea
          className="invoice-notification-preview"
          aria-label="Nội dung thông báo"
          value={message}
          readOnly
          rows={14}
        />
        <button
          className="primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message);
              setStatus("Đã sao chép. Bạn có thể dán vào Zalo để gửi.");
            } catch {
              setStatus(
                "Không thể sao chép tự động. Hãy chọn nội dung phía trên và sao chép thủ công.",
              );
            }
          }}
        >
          <Copy size={16} /> Sao chép thông báo
        </button>
        <p role="status">{status}</p>
      </dialog>
    </>
  );
}
