"use client";
import { useState } from "react";
import { z } from "zod";
import { DataForm } from "./data-form";
import { rpc } from "../lib/data";
import { localDay, money } from "../lib/business";
import { heldDeposit } from "../lib/operations";
import type { BillingCycle, Data, Tenant } from "../lib/types";

export function TenancySummary({
  data,
  tenants,
}: {
  data: Data;
  tenants: Tenant[];
}) {
  const today = localDay();
  const date = (value: string) =>
    new Date(value + "T00:00:00Z").toLocaleDateString("vi-VN", {
      timeZone: "UTC",
    });
  return (
    <div className="tenancy-summaries">
      {tenants.map((tenant) => {
        const end =
          tenant.move_out && tenant.move_out < today ? tenant.move_out : today;
        const days = Math.max(
          0,
          Math.round((Date.parse(end) - Date.parse(tenant.move_in)) / 86400000),
        );
        const entries = data.deposits.filter(
          (entry) => entry.tenant_id === tenant.id,
        );
        const received = entries
          .filter((entry) => entry.kind === "receive")
          .reduce((total, entry) => total + entry.amount, 0);
        return (
          <div className="tenancy-summary" key={tenant.id}>
            <b>{tenant.full_name}</b>
            <dl>
              <div>
                <dt>Ngày vào ở</dt>
                <dd>{date(tenant.move_in)}</dd>
              </div>
              <div>
                <dt>Ngày chuyển đi</dt>
                <dd>
                  {tenant.move_out ? date(tenant.move_out) : "Chưa chuyển đi"}
                </dd>
              </div>
              <div>
                <dt>Thời gian ở</dt>
                <dd>
                  {tenant.move_in > today
                    ? "Chưa vào ở"
                    : `${days} ngày${!tenant.move_out || tenant.move_out > today ? " (đến hôm nay)" : ""}`}
                </dd>
              </div>
              <div>
                <dt>Tiền đặt cọc đã nhận</dt>
                <dd>
                  {data.operationsMigrationRequired
                    ? "Chưa cập nhật dữ liệu đặt cọc"
                    : entries.length
                      ? money(received)
                      : "Chưa ghi nhận"}
                </dd>
                {!data.operationsMigrationRequired && entries.length > 0 && (
                  <small>Còn giữ: {money(heldDeposit(data, tenant.id))}</small>
                )}
              </div>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

export function RoomLeaseSummary({
  data,
  roomId,
  org,
  canWrite,
  onChanged,
}: {
  data: Data;
  roomId: string;
  org: string;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const today = localDay();
  const occupants = data.tenants.filter(
    (t) =>
      t.room_id === roomId &&
      t.move_in <= today &&
      (!t.move_out || t.move_out > today),
  );
  const cycle = data.billingCycles
    .filter(
      (c) =>
        c.room_id === roomId &&
        occupants.some((t) => t.billing_cycle_id === c.id),
    )
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0];
  const tenants = cycle
    ? data.tenants.filter(
        (t) => t.room_id === roomId && t.billing_cycle_id === cycle.id,
      )
    : occupants;
  const start = cycle?.starts_on || tenants.map((t) => t.move_in).sort()[0];
  const ids = new Set(tenants.map((t) => t.id));
  const contracts = data.contracts
    .filter(
      (c) =>
        c.room_id === roomId &&
        data.contractTenants.some(
          (link) =>
            link.contract_id === c.id &&
            occupants.some((t) => t.id === link.tenant_id),
        ),
    )
    .sort(
      (a, b) =>
        b.starts_on.localeCompare(a.starts_on) ||
        b.ends_on.localeCompare(a.ends_on),
    );
  const entries = data.deposits.filter((d) => ids.has(d.tenant_id));
  const received = entries
    .filter((d) => d.kind === "receive")
    .reduce((sum, d) => sum + d.amount, 0);
  const held = entries.reduce(
    (sum, d) => sum + (d.kind === "receive" ? d.amount : -d.amount),
    0,
  );
  const date = (value: string) =>
    new Date(value + "T00:00:00Z").toLocaleDateString("vi-VN", {
      timeZone: "UTC",
    });
  return (
    <div className="tenancy-summaries">
      <div className="tenancy-summary">
        <dl>
          <div>
            <dt>Ngày đầu tiên vào ở</dt>
            <dd>{start ? date(start) : "Chưa có người ở"}</dd>
          </div>
          <div>
            <dt>Ngày kết thúc hợp đồng</dt>
            <dd>
              {cycle?.lease_ends_on
                ? date(cycle.lease_ends_on)
                : contracts[0]
                  ? date(contracts[0].ends_on)
                  : "Chưa ghi ngày kết thúc"}
            </dd>
          </div>
          <div>
            <dt>Tiền cọc của phòng</dt>
            <dd>
              {data.operationsMigrationRequired
                ? "Chưa cập nhật dữ liệu đặt cọc"
                : entries.length
                  ? money(held)
                  : "Chưa ghi nhận"}
            </dd>
            {!data.operationsMigrationRequired && entries.length > 0 && (
              <small>Tổng đã nhận: {money(received)}</small>
            )}
          </div>
        </dl>
        {canWrite && cycle && !data.operationsMigrationRequired && (
          <RoomLeaseEditor
            data={data}
            cycle={cycle}
            org={org}
            onChanged={onChanged}
            endDate={cycle.lease_ends_on || contracts[0]?.ends_on || ""}
          />
        )}
      </div>
    </div>
  );
}

export function RoomLeaseEditor({
  data,
  cycle,
  org,
  onChanged,
  endDate,
}: {
  data: Data;
  cycle: BillingCycle;
  org: string;
  onChanged: () => Promise<void>;
  endDate?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ids = new Set(
    data.tenants
      .filter((t) => t.billing_cycle_id === cycle.id)
      .map((t) => t.id),
  );
  const held = data.deposits
    .filter((d) => ids.has(d.tenant_id))
    .reduce((sum, d) => sum + (d.kind === "receive" ? d.amount : -d.amount), 0);
  const room = data.rooms.find((r) => r.id === cycle.room_id);
  const perPerson =
    data.rates.find((r) => r.property_id === room?.property_id)?.water_mode ===
    "person";
  const locked = data.invoices.some((i) => i.billing_cycle_id === cycle.id);
  const fallbackEnd = data.contracts
    .filter((c) =>
      data.contractTenants.some(
        (l) => l.contract_id === c.id && ids.has(l.tenant_id),
      ),
    )
    .sort(
      (a, b) =>
        b.starts_on.localeCompare(a.starts_on) ||
        b.ends_on.localeCompare(a.ends_on),
    )[0]?.ends_on;
  const initialEnd = endDate ?? cycle.lease_ends_on ?? fallbackEnd ?? "";
  if (!editing)
    return (
      <button className="secondary" onClick={() => setEditing(true)}>
        Sửa thông tin hợp đồng
      </button>
    );
  const schema = z.object({
    end_date: z
      .string()
      .refine(
        (v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= cycle.starts_on),
        "Ngày kết thúc phải từ ngày vào ở trở đi",
      ),
    deposit_amount: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    electricity: z.coerce.number().int().min(0).max(2147483647),
    water: perPerson
      ? z.null().optional()
      : z.coerce.number().int().min(0).max(2147483647),
  });
  return (
    <div className="lease-editor">
      <DataForm
        key={cycle.id}
        schema={schema}
        fields={[
          { name: "end_date", label: "Ngày kết thúc hợp đồng", type: "date" },
          {
            name: "deposit_amount",
            label: "Tiền cọc còn giữ của phòng (VNĐ)",
            type: "number",
            min: 0,
          },
          {
            name: "electricity",
            label: "Số điện ban đầu (kWh)",
            type: "number",
            min: 0,
            readOnly: locked,
          },
          ...(!perPerson
            ? [
                {
                  name: "water",
                  label: "Số nước ban đầu (m³)",
                  type: "number",
                  min: 0,
                  readOnly: locked,
                },
              ]
            : []),
        ]}
        defaults={{
          end_date: initialEnd,
          deposit_amount: held,
          electricity: cycle.electricity_initial ?? "",
          water: perPerson ? null : (cycle.water_initial ?? 0),
        }}
        submit="Lưu thông tin hợp đồng"
        onSubmit={async (v) => {
          await rpc("edit_room_lease", {
            org,
            target_cycle: cycle.id,
            end_date: v.end_date || null,
            deposit_amount: v.deposit_amount,
            electricity: v.electricity,
            water: perPerson ? null : v.water,
          });
          await onChanged();
          setEditing(false);
        }}
      >
        {perPerson && (
          <p className="form-hint">
            Nước tính theo đ/người/tháng, không cần số nước ban đầu.
          </p>
        )}
        {locked && (
          <p className="form-hint">
            Đã có hóa đơn: chỉ số ban đầu được giữ nguyên. Bạn vẫn có thể sửa
            ngày kết thúc và tiền cọc.
          </p>
        )}
        <p className="form-hint">
          Sửa tiền cọc sẽ ghi giao dịch điều chỉnh và giữ lịch sử cũ.
        </p>
      </DataForm>
      <button className="text-button" onClick={() => setEditing(false)}>
        Hủy sửa
      </button>
    </div>
  );
}
