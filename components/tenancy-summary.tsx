import { localDay, money } from "../lib/business";
import { heldDeposit } from "../lib/operations";
import type { Data, Tenant } from "../lib/types";

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
}: {
  data: Data;
  roomId: string;
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
              {contracts[0] ? date(contracts[0].ends_on) : "Chưa có hợp đồng"}
            </dd>
          </div>
          <div>
            <dt>Tiền cọc đã cọc cho phòng</dt>
            <dd>
              {data.operationsMigrationRequired
                ? "Chưa cập nhật dữ liệu đặt cọc"
                : entries.length
                  ? money(received)
                  : "Chưa ghi nhận"}
            </dd>
            {!data.operationsMigrationRequired && entries.length > 0 && (
              <small>Còn giữ: {money(held)}</small>
            )}
          </div>
        </dl>
      </div>
    </div>
  );
}
