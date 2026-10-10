import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { emptyData, type Data } from "../lib/types";
import { financialSeries, heldDeposit, roomAlerts } from "../lib/operations";
const owner = "00000000-0000-0000-0000-000000000011",
  viewer = "00000000-0000-0000-0000-000000000012",
  other = "00000000-0000-0000-0000-000000000013";
test("operations ledger, workspace isolation and retained history", async (t) => {
  const db = new PGlite();
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;insert into auth.users values('${owner}','owner@test.invalid',now()),('${viewer}','viewer@test.invalid',now()),('${other}','other@test.invalid',now());`,
  );
  for (const file of [
    "001_hh_home",
    "002_property_service_rates",
    "003_delete_property",
    "004_tenant_document_history",
    "005_delete_vacant_property",
    "006_room_move_in_readings",
    "007_remove_workspace_member",
    "008_laundry_per_person",
    "009_water_billing_modes",
    "010_operations",
  ])
    await db.exec(
      readFileSync(`supabase/migrations/202610080${file}.sql`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  const actor = async (id: string) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  const id = async (sql: string, args: unknown[]) =>
    String((await db.query<{ id: string }>(sql, args)).rows[0].id);
  await actor(owner);
  const org = await id(
    "select create_workspace('Operations','Owner') as id",
    [],
  );
  const prop = await id(
    "select create_property($1,'Operations Property','Address',0,1) as id",
    [org],
  );
  const room = await id("select id from rooms where property_id=$1", [prop]);
  const tenant = await id(
    "insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Tenant','Nam','1990-01-01','123456789012','0901234567','2020-01-01',0,0) returning id",
    [org, room],
  );
  await db.exec("reset role");
  await db.query(
    "insert into memberships(organization_id,user_id,role,display_name,email) values($1,$2,'viewer','Viewer','viewer@test.invalid')",
    [org, viewer],
  );
  await actor(owner);
  await t.test(
    "deposit replay cannot collect twice; withdrawals cannot exceed held cash",
    async () => {
      const request = "10000000-0000-0000-0000-000000000001";
      const sql = "select record_deposit($1,$2,$3,$4,'2020-01-01',$5,$6) as id";
      const first = await id(sql, [
        org,
        tenant,
        "receive",
        1000000,
        "Nhận cọc",
        request,
      ]);
      assert.equal(
        await id(sql, [org, tenant, "receive", 1000000, "Nhận cọc", request]),
        first,
      );
      await assert.rejects(
        db.query(sql, [org, tenant, "receive", 2000000, "Nhận cọc", request]),
        /Mã ghi nhận/,
      );
      await id(sql, [
        org,
        tenant,
        "deduct",
        200000,
        "Hỏng cửa",
        "10000000-0000-0000-0000-000000000002",
      ]);
      await assert.rejects(
        db.query(sql, [
          org,
          tenant,
          "refund",
          900000,
          "Hoàn",
          "10000000-0000-0000-0000-000000000003",
        ]),
        /vượt số cọc/,
      );
      await id(sql, [
        org,
        tenant,
        "refund",
        800000,
        "Hoàn cọc",
        "10000000-0000-0000-0000-000000000004",
      ]);
      const deposits = (await db.query("select * from deposit_entries")).rows;
      assert.equal(heldDeposit({ ...emptyData, deposits } as Data, tenant), 0);
      await assert.rejects(
        db.query("update deposit_entries set amount=1 where tenant_id=$1", [
          tenant,
        ]),
        /permission denied/,
      );
    },
  );
  let ticket = "",
    expense = "";
  await t.test(
    "maintenance expenses link to the correct room and voiding retains audit history",
    async () => {
      ticket = await id(
        "insert into maintenance_requests(organization_id,room_id,title,priority) values($1,$2,'Rò nước','high') returning id",
        [org, room],
      );
      expense = await id(
        "insert into expenses(organization_id,property_id,room_id,maintenance_id,title,category,amount,paid_on) values($1,$2,$3,$4,'Sửa ống','maintenance',150000,'2020-01-02') returning id",
        [org, prop, room, ticket],
      );
      await db.query(
        "update maintenance_requests set status='done' where id=$1",
        [ticket],
      );
      await db.query("select void_expense($1,$2)", [org, expense]);
      assert.ok(
        (
          await db.query<{ voided_at: string }>(
            "select voided_at from expenses where id=$1",
            [expense],
          )
        ).rows[0].voided_at,
      );
      assert.equal((await db.query("select * from expenses")).rows.length, 1);
      await assert.rejects(
        db.query(
          "insert into expenses(organization_id,property_id,title,category,amount,paid_on) values($1,$2,'Future','other',1,'2999-01-01')",
          [org, prop],
        ),
        /tương lai/,
      );
    },
  );
  await t.test(
    "viewer can read but cannot alter deposits, repairs or costs",
    async () => {
      await actor(viewer);
      assert.equal(
        (await db.query("select * from deposit_entries")).rows.length,
        3,
      );
      await assert.rejects(
        db.query(
          "select record_deposit($1,$2,'receive',1,'2020-01-01','note',gen_random_uuid())",
          [org, tenant],
        ),
        /quyền/,
      );
      await assert.rejects(
        db.query(
          "insert into expenses(organization_id,property_id,title,category,amount,paid_on) values($1,$2,'Cost','other',1,'2020-01-01')",
          [org, prop],
        ),
        /row-level security/,
      );
      await assert.rejects(
        db.query("select void_expense($1,$2)", [org, expense]),
        /quyền/,
      );
      assert.equal(
        (
          await db.query(
            "update maintenance_requests set status='new' where id=$1 returning id",
            [ticket],
          )
        ).rows.length,
        0,
      );
    },
  );
  await t.test(
    "other workspace is isolated and cannot link its costs to this room",
    async () => {
      await actor(other);
      const org2 = await id(
        "select create_workspace('Other','Other') as id",
        [],
      );
      const prop2 = await id(
        "select create_property($1,'Other','Other',0,1) as id",
        [org2],
      );
      assert.equal(
        (await db.query("select * from deposit_entries")).rows.length,
        0,
      );
      assert.equal((await db.query("select * from expenses")).rows.length, 0);
      await assert.rejects(
        db.query(
          "select record_deposit($1,$2,'receive',1,'2020-01-01','note',gen_random_uuid())",
          [org2, tenant],
        ),
        /Không tìm thấy/,
      );
      await assert.rejects(
        db.query(
          "insert into expenses(organization_id,property_id,room_id,title,category,amount,paid_on) values($1,$2,$3,'Wrong','other',1,'2020-01-01')",
          [org2, prop2, room],
        ),
        /Phòng không thuộc/,
      );
    },
  );
  await t.test(
    "deleting a vacant property retains maintenance-only history",
    async () => {
      await actor(owner);
      const p = await id(
        "select create_property($1,'Vacant Repair','Address',0,1) as id",
        [org],
      );
      const r = await id("select id from rooms where property_id=$1", [p]);
      const m = await id(
        "insert into maintenance_requests(organization_id,room_id,title,priority) values($1,$2,'Hỏng đèn','normal') returning id",
        [org, r],
      );
      await db.query("select delete_property($1,$2,'Vacant Repair')", [org, p]);
      assert.ok(
        (
          await db.query<{ deleted_at: string }>(
            "select deleted_at from properties where id=$1",
            [p],
          )
        ).rows[0].deleted_at,
      );
      assert.equal(
        (await db.query("select * from maintenance_requests where id=$1", [m]))
          .rows.length,
        1,
      );
    },
  );
  await db.close();
});
test("operating profit excludes deposits and voided costs; room debt excludes archived invoices", () => {
  const data = {
    ...emptyData,
    rooms: [{ id: "r", property_id: "p" }],
    invoices: [{ id: "i", room_id: "r", total: 1000 }],
    payments: [
      {
        id: "x",
        invoice_id: "i",
        amount: 1000,
        paid_at: "2020-01-01T00:00:00Z",
      },
    ],
    expenses: [
      { property_id: "p", amount: 300, paid_on: "2020-01-02", voided_at: null },
      {
        property_id: "p",
        amount: 500,
        paid_on: "2020-01-02",
        voided_at: "2020-01-03",
      },
    ],
    deposits: [{ tenant_id: "t", kind: "receive", amount: 5000 }],
  } as Data;
  const month = financialSeries(data, "2020", "p")[0];
  assert.equal(month.revenue, 1000);
  assert.equal(month.expense, 300);
  assert.equal(month.profit, 700);
  assert.equal(roomAlerts(data, "r", "2020-01-02").debt, 0);
});

test("room warnings retain occupancy and separate current debt from departed tenant history", () => {
  const data = {
    ...emptyData,
    tenants: [
      { id: "active", move_in: "2019-01-01", move_out: null },
      { id: "left", move_in: "2018-01-01", move_out: "2019-01-01" },
    ],
    invoices: [
      { id: "current", room_id: "r", total: 100, due_date: "2020-01-01" },
      { id: "archive", room_id: "r", total: 1000, due_date: "2019-01-01" },
    ],
    invoiceTenants: [
      { invoice_id: "current", tenant_id: "active" },
      { invoice_id: "archive", tenant_id: "left" },
    ],
    contracts: [
      { id: "soon", room_id: "r", ends_on: "2020-02-01" },
      { id: "expired", room_id: "r", ends_on: "2019-12-31" },
    ],
    contractTenants: [
      { contract_id: "soon", tenant_id: "active" },
      { contract_id: "expired", tenant_id: "active" },
    ],
  } as Data;
  const warnings = roomAlerts(data, "r", "2020-01-02");
  assert.equal(warnings.debt, 100);
  assert.equal(warnings.overdue, 1);
  assert.equal(warnings.expiring.length, 1);
  assert.equal(warnings.expired.length, 1);
});
