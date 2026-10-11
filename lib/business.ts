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
export function previousMonth(period: string) {
  const date = new Date(period.slice(0, 7) + "-01T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}
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
  laundryPeople = 1,
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
      laundryPeople,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    eNew < eOld ||
    wNew < wOld
  )
    throw new Error("Chỉ số hoặc đơn giá không hợp lệ");
  const total =
    rent +
    (eNew - eOld) * rates.electricity +
    (rates.water_mode === "person" ? laundryPeople : wNew - wOld) *
      rates.water +
    rates.trash +
    rates.wifi +
    rates.laundry * laundryPeople;
  if (!Number.isSafeInteger(total)) throw new Error("Số tiền vượt giới hạn");
  return total;
}
export function fixedFeeAllocation(
  period: string,
  startsOn: string,
  tenants: Tenant[],
  day = localDay(),
) {
  const first = period.slice(0, 7) + "-01";
  const next = nextMonth(period);
  const daysBetween = (a: string, b: string) =>
    Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const monthDays = daysBetween(first, next);
  const residents = tenants.filter(
    (t) =>
      t.move_in < next &&
      t.move_in <= day &&
      (!t.move_out || (t.move_out > first && t.move_out > t.move_in)),
  );
  const personDays = residents.reduce(
    (sum, t) =>
      sum +
      Math.max(
        0,
        daysBetween(
          t.move_in > first ? t.move_in : first,
          t.move_out && t.move_out < next ? t.move_out : next,
        ),
      ),
    0,
  );
  const roomDays = residents.length
    ? daysBetween(startsOn > first ? startsOn : first, next)
    : 0;
  return { monthDays, personDays, roomDays, people: residents.length };
}
export function advanceBill(
  rent: number,
  rates: Rates,
  allocation: ReturnType<typeof fixedFeeAllocation>,
  eOld: number,
  eNew: number,
  wOld: number,
  wNew: number,
  arrival = false,
) {
  calculateBill(
    0,
    { ...rates, trash: 0, wifi: 0, laundry: 0, water_mode: "meter" },
    eOld,
    eNew,
    wOld,
    wNew,
    0,
  );
  const roundRoom = (rate: number) =>
    Math.round((rate * allocation.roomDays) / allocation.monthDays);
  const roundPeople = (rate: number) =>
    Math.round((rate * allocation.personDays) / allocation.monthDays);
  const room = roundRoom(rent),
    service = roundRoom(rates.trash) + roundRoom(rates.wifi),
    laundry = roundPeople(rates.laundry);
  const electricity = arrival ? 0 : (eNew - eOld) * rates.electricity;
  const water =
    rates.water_mode === "person"
      ? roundPeople(rates.water)
      : arrival
        ? 0
        : (wNew - wOld) * rates.water;
  return {
    room,
    service,
    laundry,
    electricity,
    water,
    total: room + service + laundry + electricity + water,
  };
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

export function roomOccupiedOn(
  data: import("./types").Data,
  roomId: string,
  day: string,
) {
  return data.tenants.some(
    (t) =>
      t.room_id === roomId &&
      t.move_in <= day &&
      (!t.move_out || t.move_out > day),
  );
}
export function nextMonth(period: string) {
  const [year, month] = period.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}
