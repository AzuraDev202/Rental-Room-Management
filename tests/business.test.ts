import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balance,
  calculateBill,
  revenueSeries,
  localDay,
  tenantStatus,
} from "../lib/business";
import { propertySchema, tenantSchema, invoiceSchema } from "../lib/forms";
import type { Invoice, Payment } from "../lib/types";
test("bill calculation and invalid readings", () => {
  const rates = {
    organization_id: "org",
    property_id: "property",
    electricity: 3500,
    water: 20000,
    trash: 30000,
    wifi: 70000,
    laundry: 50000,
  };
  assert.equal(calculateBill(3800000, rates, 1240, 1325, 86, 92), 4367500);
  assert.throws(() => calculateBill(3800000, rates, 10, 9, 0, 1));
  assert.throws(() => calculateBill(3800000, rates, 0, 1.5, 0, 1));
});
test("balance and real revenue use payment time in Vietnam, not invoice month", () => {
  const invoices = [
    { id: "invoice", room_id: "room", total: 1000000, period: "2025-12-01" },
  ] as Invoice[];
  const payments = [
    {
      id: "payment",
      invoice_id: "invoice",
      amount: 400000,
      paid_at: "2025-12-31T18:00:00Z",
    },
  ] as Payment[];
  assert.equal(balance(invoices[0], payments), 600000);
  assert.equal(localDay(new Date(payments[0].paid_at)), "2026-01-01");
  assert.equal(revenueSeries("2026", invoices, payments)[0].revenue, 400000);
  assert.equal(revenueSeries("2025", invoices, payments)[11].revenue, 0);
  assert.equal(
    revenueSeries("2026", invoices, payments, ["different-room"])[0].revenue,
    0,
  );
});
test("empty database produces 12 zero months", () => {
  const series = revenueSeries("2026", [], []);
  assert.equal(series.length, 12);
  assert.equal(
    series.reduce((s, m) => s + m.revenue, 0),
    0,
  );
});
test("forms reject invalid amounts, dates and readings", () => {
  assert.equal(
    propertySchema.safeParse({
      name: "A",
      address: "B",
      room_count: 1,
      monthly_rent: "",
    }).success,
    false,
  );
  assert.equal(
    invoiceSchema.safeParse({
      period: "2026-01",
      due_date: "2026-01-05",
      electricity_old: "",
      electricity_new: "",
      water_old: "",
      water_new: "",
    }).success,
    false,
  );
  assert.equal(
    propertySchema.safeParse({
      name: "A",
      address: "B",
      room_count: 0,
      monthly_rent: 1,
    }).success,
    false,
  );
  assert.equal(
    propertySchema.safeParse({
      name: "A",
      address: "B",
      room_count: 1,
      monthly_rent: -1,
    }).success,
    false,
  );
  assert.equal(
    invoiceSchema.safeParse({
      period: "2026-01",
      due_date: "2026-01-05",
      electricity_old: 10,
      electricity_new: 9,
      water_old: 0,
      water_new: 1,
    }).success,
    false,
  );
  assert.equal(
    tenantSchema.safeParse({
      room_id: "00000000-0000-0000-0000-000000000001",
      full_name: "Tenant",
      gender: "Nam",
      birth_date: "2000-02-30",
      identity_number: "123456789012",
      phone: "0901234567",
      email: "",
      move_in: "2026-01-01",
    }).success,
    false,
  );
});

test("occupancy follows actual move-in and move-out dates", () => {
  assert.equal(
    tenantStatus({ move_in: "2026-10-10", move_out: null }, "2026-10-08"),
    "Sắp vào ở",
  );
  assert.equal(
    tenantStatus(
      { move_in: "2026-01-01", move_out: "2026-10-10" },
      "2026-10-08",
    ),
    "Đang ở",
  );
  assert.equal(
    tenantStatus(
      { move_in: "2026-01-01", move_out: "2026-10-08" },
      "2026-10-08",
    ),
    "Đã chuyển đi",
  );
});
