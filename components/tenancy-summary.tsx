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
