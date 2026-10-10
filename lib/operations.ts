import {
  balance,
  isCurrentDocument,
  localDay,
  revenueSeries,
  tenantStatus,
} from "./business";
import type { Data } from "./types";
export const depositLabels = {
  receive: "Nhận cọc",
  refund: "Hoàn cọc",
  deduct: "Khấu trừ cọc",
};
export const maintenanceStatuses = {
  new: "Chờ xử lý",
  in_progress: "Đang xử lý",
  done: "Hoàn thành",
  cancelled: "Đã hủy",
};
export function heldDeposit(data: Data, tenant: string) {
  return data.deposits
    .filter((d) => d.tenant_id === tenant)
    .reduce((sum, d) => sum + (d.kind === "receive" ? d.amount : -d.amount), 0);
}
export function roomAlerts(data: Data, room: string, day = localDay()) {
  const unpaid = data.invoices.filter(
    (i) =>
      i.room_id === room &&
      isCurrentDocument(data, "invoice", i.id) &&
      balance(i, data.payments) > 0,
  );
  const overdue = unpaid.filter((i) => i.due_date < day);
  const end = new Date(day + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 30);
  const cutoff = end.toISOString().slice(0, 10);
  const contracts = data.contracts.filter(
    (c) => c.room_id === room && isCurrentDocument(data, "contract", c.id),
  );
  return {
    debt: unpaid.reduce((sum, i) => sum + balance(i, data.payments), 0),
    overdue: overdue.length,
    expiring: contracts.filter((c) => c.ends_on >= day && c.ends_on <= cutoff),
    expired: contracts.filter((c) => c.ends_on < day),
  };
}
export function financialSeries(data: Data, year: string, property = "") {
  const rooms = data.rooms
    .filter((r) => !property || r.property_id === property)
    .map((r) => r.id);
  return revenueSeries(year, data.invoices, data.payments, rooms).map(
    (row, index) => {
      const month = `${year}-${String(index + 1).padStart(2, "0")}`;
      const expense = data.expenses
        .filter(
          (e) =>
            !e.voided_at &&
            e.paid_on.startsWith(month) &&
            (!property || e.property_id === property),
        )
        .reduce((sum, e) => sum + e.amount, 0);
      return { ...row, expense, profit: row.revenue - expense };
    },
  );
}
export function billingToPrepare(data: Data, day = localDay()) {
  const period = day.slice(0, 7) + "-01";
  return data.rooms.filter(
    (r) =>
      data.properties.some((p) => p.id === r.property_id && !p.deleted_at) &&
      data.tenants.some(
        (t) => t.room_id === r.id && tenantStatus(t, day) === "Đang ở",
      ) &&
      !data.invoices.some(
        (i) =>
          i.room_id === r.id &&
          i.period === period &&
          isCurrentDocument(data, "invoice", i.id),
      ),
  );
}
