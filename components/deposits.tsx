"use client";
import { useState } from "react";
import type { Data } from "../lib/types";
import { depositLabels, heldDeposit } from "../lib/operations";
import { localDay, money } from "../lib/business";
import { depositSchema } from "../lib/forms";
import { rpc } from "../lib/data";
import { DataForm } from "./data-form";
export function Deposits({
  data,
  tenantId,
  org,
  canWrite,
  onChanged,
}: {
  data: Data;
  tenantId: string;
  org: string;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [request, setRequest] = useState("");
  const entries = data.deposits
    .filter((d) => d.tenant_id === tenantId)
    .sort((a, b) => b.happened_on.localeCompare(a.happened_on));
  return (
    <section className="deposit-section">
      <h3>Đặt cọc</h3>
      <p>
        Cọc còn giữ: <strong>{money(heldDeposit(data, tenantId))}</strong>
      </p>
      <p className="muted">
        Tiền cọc được theo dõi riêng, không tính vào doanh thu tiền thuê.
      </p>
      {canWrite && !editing && (
        <button
          className="secondary"
          onClick={() => {
            setRequest(crypto.randomUUID());
            setEditing(true);
          }}
        >
          Ghi nhận đặt cọc
        </button>
      )}
      {editing && (
        <>
          <DataForm
            schema={depositSchema}
            fields={[
              {
                name: "kind",
                label: "Loại giao dịch cọc",
                options: Object.entries(depositLabels).map(
                  ([value, label]) => ({ value, label }),
                ),
              },
              {
                name: "amount",
                label: "Số tiền cọc (VNĐ)",
                type: "number",
                min: 1,
              },
              {
                name: "happened_on",
                label: "Ngày giao dịch cọc",
                type: "date",
              },
              { name: "note", label: "Nội dung giao dịch cọc" },
            ]}
            defaults={{
              kind: "receive",
              amount: "",
              happened_on: localDay(),
              note: "",
            }}
            submit="Lưu giao dịch cọc"
            onSubmit={async (v) => {
              await rpc("record_deposit", {
                org,
                target_tenant: tenantId,
                event_kind: v.kind,
                event_amount: v.amount,
                event_date: v.happened_on,
                event_note: v.note,
                request,
              });
              await onChanged();
              setEditing(false);
            }}
          />
          <button className="text-button" onClick={() => setEditing(false)}>
            Hủy ghi nhận cọc
          </button>
        </>
      )}
      {entries.map((d) => (
        <article className="operation-row" key={d.id}>
          <strong>
            {depositLabels[d.kind]} · {money(d.amount)}
          </strong>
          <p>
            {d.happened_on} · {d.note}
          </p>
        </article>
      ))}
      {!entries.length && <p>Chưa ghi nhận đặt cọc.</p>}
    </section>
  );
}
