import type { Invoice, Payment, Rates, Tenant } from "./types";
export const money = (n: number) =>
  new Intl.NumberFormat("vi-VN").format(n) + " ₫";
export const localDay = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const currentMonth = () => localDay().slice(0, 7);
export function balance(invoice: Invoice, payments: Payment[]) {
  return Math.max(
    0,
    invoice.total -
      payments
        .filter((p) => p.invoice_id === invoice.id)
        .reduce((sum, p) => sum + Number(p.amount), 0),
  );
}
export function calculateBill(
  rent: number,
  rates: Rates,
  eOld: number,
  eNew: number,
  wOld: number,
  wNew: number,
) {
  if (
    ![
      rent,
      rates.electricity,
      rates.water,
      rates.trash,
      rates.wifi,
      rates.laundry,
      eOld,
      eNew,
      wOld,
      wNew,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    eNew < eOld ||
    wNew < wOld
  )
    throw new Error("Chỉ số hoặc đơn giá không hợp lệ");
  const total =
    rent +
    (eNew - eOld) * rates.electricity +
    (wNew - wOld) * rates.water +
    rates.trash +
    rates.wifi +
    rates.laundry;
  if (!Number.isSafeInteger(total)) throw new Error("Số tiền vượt giới hạn");
  return total;
}
export function revenueSeries(
  year: string,
  invoices: Invoice[],
  payments: Payment[],
  roomIds?: string[],
) {
  const allowed = new Set(
    invoices
      .filter((i) => !roomIds || roomIds.includes(i.room_id))
      .map((i) => i.id),
  );
  return Array.from({ length: 12 }, (_, index) => {
    const period = `${year}-${String(index + 1).padStart(2, "0")}`;
    return {
      month: `T${index + 1}`,
      revenue: payments
        .filter(
          (p) =>
            allowed.has(p.invoice_id) &&
            localDay(new Date(p.paid_at)).startsWith(period),
        )
        .reduce((s, p) => s + Number(p.amount), 0),
    };
  });
}

export function tenantStatus(
  tenant: Pick<Tenant, "move_in" | "move_out">,
  day = localDay(),
) {
  if (tenant.move_out && tenant.move_out <= day) return "Đã chuyển đi";
  if (tenant.move_in > day) return "Sắp vào ở";
  return "Đang ở";
}

export function documentTenants(
  data: import("./types").Data,
  kind: "invoice" | "contract",
  id: string,
) {
  const ids = new Set(
    kind === "invoice"
      ? data.invoiceTenants
          .filter((l) => l.invoice_id === id)
          .map((l) => l.tenant_id)
      : data.contractTenants
          .filter((l) => l.contract_id === id)
          .map((l) => l.tenant_id),
  );
  return data.tenants.filter((t) => ids.has(t.id));
}
export function isCurrentDocument(
  data: import("./types").Data,
  kind: "invoice" | "contract",
  id: string,
) {
  const owners = documentTenants(data, kind, id);
  return !owners.length || owners.some((t) => tenantStatus(t) === "Đang ở");
}
