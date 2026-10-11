"use client";
import { useState } from "react";
import type { BillingCycle, Invoice, Rates, Room, Tenant } from "../lib/types";
import {
  advanceBill,
  fixedFeeAllocation,
  money,
  previousMonth,
} from "../lib/business";
import { invoiceSchema } from "../lib/forms";
import { DataForm } from "./data-form";
export function AdvanceInvoiceForm({
  baseline,
  period,
  previous,
  room,
  rates,
  tenants,
  onSubmit,
}: {
  baseline: BillingCycle;
  period: string;
  previous: Invoice | null;
  room: Room;
  rates: Rates;
  tenants: Tenant[];
  onSubmit: (v: Record<string, unknown>) => Promise<void>;
}) {
  const arrival = baseline.starts_on.slice(0, 7) === period;
  const perPerson = true;
  rates = { ...rates, water_mode: "person" };
  const eOld = previous?.electricity_new ?? baseline.electricity_initial ?? 0;
  const wOld =
    previous?.water_mode === "person" && !perPerson
      ? (baseline.water_initial ?? 0)
      : (previous?.water_new ?? baseline.water_initial ?? 0);
  const deadline =
    arrival && baseline.starts_on > period + "-05"
      ? baseline.starts_on
      : period + "-05";
  const allocation = fixedFeeAllocation(period, baseline.starts_on, tenants);
  const [readings, setReadings] = useState<{ e: number; w: number } | null>(
    arrival ? { e: eOld, w: wOld } : null,
  );
  const bill = readings
    ? advanceBill(
        room.monthly_rent,
        rates,
        allocation,
        eOld,
        readings.e,
        wOld,
        readings.w,
        arrival,
      )
    : null;
  const fixed = advanceBill(
    room.monthly_rent,
    rates,
    allocation,
    eOld,
    eOld,
    wOld,
    wOld,
    arrival,
  );
  return (
    <div
      onInput={(event) => {
        if (arrival) return;
        const form = (event.target as HTMLElement).closest("form");
        if (!form) return;
        const values = new FormData(form);
        const e = values.get("electricity_new"),
          w = perPerson ? String(wOld) : values.get("water_new");
        try {
          if (e === null || e === "" || w === null || w === "")
            throw new Error();
          const next = { e: Number(e), w: Number(w) };
          advanceBill(
            room.monthly_rent,
            rates,
            allocation,
            eOld,
            next.e,
            wOld,
            next.w,
          );
          setReadings(next);
        } catch {
          setReadings(null);
        }
      }}
    >
      <DataForm
        schema={invoiceSchema}
        fields={
          arrival
            ? []
            : [
                {
                  name: "electricity_new",
                  label: `Điện · chỉ số mới (${money(rates.electricity)}/kWh)`,
                  type: "number",
                  min: eOld,
                },
                ...(!perPerson
                  ? [
                      {
                        name: "water_new",
                        label: `Nước · chỉ số mới (${money(rates.water)}/m³)`,
                        type: "number",
                        min: wOld,
                      },
                    ]
                  : []),
              ]
        }
        defaults={{
          period,
          due_date: deadline,
          electricity_old: eOld,
          water_old: wOld,
          electricity_new: arrival ? eOld : "",
          water_new: arrival || perPerson ? wOld : "",
        }}
        submit="Lập hóa đơn"
        onSubmit={(v) =>
          onSubmit({
            ...v,
            period,
            due_date: deadline,
            electricity_old: eOld,
            water_old: wOld,
          })
        }
      >
        <p>
          Kỳ {period} · Hạn thu tiền: {deadline}.
        </p>
        {arrival ? (
          <p>
            Hóa đơn nhận phòng từ {baseline.starts_on} đến cuối tháng:{" "}
            {allocation.roomDays}/{allocation.monthDays} ngày. Chưa thu điện và
            nước theo chỉ số.
          </p>
        ) : (
          <p>
            Thu trước tiền phòng và phí cố định tháng {period}; điện và nước
            theo chỉ số tháng {previousMonth(period)}.
          </p>
        )}
        {!arrival && (
          <div className="bill-line">
            Điện · chỉ số cũ{" "}
            <output aria-label="Điện · chỉ số cũ">{eOld}</output>
          </div>
        )}
        {!arrival && !perPerson && (
          <div className="bill-line">
            Nước · chỉ số cũ{" "}
            <output aria-label="Nước · chỉ số cũ">{wOld}</output>
          </div>
        )}
        <div className="invoice-formula" aria-label="Công thức tính hóa đơn">
          <h3>Công thức tính</h3>
          <p>
            Tổng tiền = Tiền phòng + Dịch vụ + Máy giặt + Nước + Điện. Các khoản
            theo ngày được làm tròn đến đồng.
          </p>
          <p>
            Tiền phòng tháng {period}: {money(room.monthly_rent)} ×{" "}
            {allocation.roomDays}/{allocation.monthDays} ngày ={" "}
            <b>{money(fixed.room)}</b>.
          </p>
          <p>
            Dịch vụ tháng {period}: ({money(rates.trash)} + {money(rates.wifi)})
            × {allocation.roomDays}/{allocation.monthDays} ngày ={" "}
            <b>{money(fixed.service)}</b>.
          </p>
          <p>
            Máy giặt tháng {period}: {money(rates.laundry)}/người/tháng ×{" "}
            {allocation.personDays} ngày-người / {allocation.monthDays} ngày ={" "}
            <b>{money(fixed.laundry)}</b>.
          </p>
          {perPerson ? (
            <p>
              Nước tháng {period}: {money(rates.water)}/người/tháng ×{" "}
              {allocation.personDays} ngày-người / {allocation.monthDays} ngày ={" "}
              <b>{money(fixed.water)}</b>.
            </p>
          ) : arrival ? (
            <p>Nước theo chỉ số: 0 đ, chưa thu trong hóa đơn nhận phòng.</p>
          ) : (
            <p>
              Nước tháng {previousMonth(period)} = (Số nước mới − {wOld}) ×{" "}
              {money(rates.water)}
              {bill && readings
                ? ` = (${readings.w} − ${wOld}) × ${money(rates.water)} = ${money(bill.water)}`
                : ""}
              .
            </p>
          )}
          {arrival ? (
            <p>Điện: 0 đ, chưa thu trong hóa đơn nhận phòng.</p>
          ) : (
            <p>
              Điện tháng {previousMonth(period)} = (Số điện mới − {eOld}) ×{" "}
              {money(rates.electricity)}
              {bill && readings
                ? ` = (${readings.e} − ${eOld}) × ${money(rates.electricity)} = ${money(bill.electricity)}`
                : ""}
              .
            </p>
          )}
          <p>
            {allocation.people} người, tổng {allocation.personDays} ngày-người;
            mỗi người tính từ ngày vào ở đến cuối tháng hoặc ngày chuyển đi đã
            ghi nhận.
          </p>
          {bill && (
            <p>
              Tổng tiền = {money(bill.room)} + {money(bill.service)} +{" "}
              {money(bill.laundry)} + {money(bill.water)} +{" "}
              {money(bill.electricity)} = <b>{money(bill.total)}</b>.
            </p>
          )}
        </div>
        <div className="bill-total" aria-live="polite">
          Tổng tiền phòng phải đóng{" "}
          <b>{bill ? money(bill.total) : "Nhập chỉ số điện và nước"}</b>
        </div>
      </DataForm>
    </div>
  );
}
