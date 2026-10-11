import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { emptyData, type Data } from "../lib/types";
import { financialSeries, heldDeposit, roomAlerts } from "../lib/operations";
const owner = "00000000-0000-0000-0000-000000000011",
  viewer = "00000000-0000-0000-0000-000000000012",
  other = "00000000-0000-0000-0000-000000000013";
test("monthly billing: advance rent and previous-month services", async () => {
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
    await db.query<Record<string, string | number | null>>(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [id],
    );
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

  try {
    await db.query<Record<string, string | number | null>>(
      "update rooms set monthly_rent=1000 where id=$1",
      [room],
    );
    await db.query<Record<string, string | number | null>>(
      "insert into property_service_rates(organization_id,property_id,electricity,water,trash,wifi,laundry,water_mode) values($1,$2,10,50,30,0,40,'person')",
      [org, prop],
    );
    const first = await id(
      "insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial) values($1,$2,'First','Nam','1990-01-01','123456789012','0901234567','2020-01-15',100) returning id",
      [org, room],
    );
    const cycle = await id(
      "select billing_cycle_id as id from tenants where id=$1",
      [first],
    );
    // Preserve old bills when installing the new schedule.
    const legacy = await id(
      "select create_water_invoice($1,$2,$3,'2020-01-01','2020-02-05',100,105,0,0) as id",
      [org, room, cycle],
    );
    const oldTotal = (
      await db.query<Record<string, string | number | null>>(
        "select total from invoices where id=$1",
        [legacy],
      )
    ).rows[0].total;
    await db.exec("reset role");
    await db.exec(
      readFileSync(
        "supabase/migrations/202610080011_monthly_billing_schedule.sql",
        "utf8",
      ),
    );
    await actor(owner);
    const unchanged = (
      await db.query<Record<string, string | number | null>>(
        "select total,service_period from invoices where id=$1",
        [legacy],
      )
    ).rows[0];
    assert.equal(unchanged.total, oldTotal);
    assert.equal(unchanged.service_period, null);
    const bill = (
      period: string,
      deadline: string,
      old: number,
      next: number,
    ) =>
      id("select create_monthly_invoice($1,$2,$3,$4,$5,$6,$7,0,0) as id", [
        org,
        room,
        cycle,
        period,
        deadline,
        old,
        next,
      ]);
    await assert.rejects(
      bill("2020-01-01", "2020-01-05", 105, 110),
      /tháng sau/,
    );
    await assert.rejects(bill("2020-02-01", "2020-03-05", 105, 110), /ngày 5/);
    await assert.rejects(bill("2020-02-02", "2020-02-05", 105, 110), /ngày 1/);
    await id(
      "insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in) values($1,$2,'Second','Nam','1990-01-01','123456789013','0901234568','2020-02-10') returning id",
      [org, room],
    );
    const invoice = await bill("2020-02-01", "2020-02-05", 105, 115);
    const row = (
      await db.query<Record<string, string | number | null>>(
        "select * from invoices where id=$1",
        [invoice],
      )
    ).rows[0];
    assert.equal(
      new Date(String(row.service_period)).toISOString().slice(0, 10),
      "2020-01-01",
    );
    assert.equal(Number(row.room_rent), 1000);
    assert.equal(row.laundry_count, 1);
    assert.equal(row.water_count, 1);
    assert.equal(Number(row.total), 1220);
    await db.query<Record<string, string | number | null>>(
      "update tenants set move_out='2020-03-01' where billing_cycle_id=$1",
      [cycle],
    );
    const final = await bill("2020-03-01", "2020-03-05", 115, 120);
    const settlement = (
      await db.query<Record<string, string | number | null>>(
        "select * from invoices where id=$1",
        [final],
      )
    ).rows[0];
    assert.equal(Number(settlement.room_rent), 0);
    assert.equal(settlement.laundry_count, 2);
    assert.equal(Number(settlement.total), 260);
    assert.equal(
      (
        await db.query<Record<string, string | number | null>>(
          "select * from invoice_tenants where invoice_id=$1",
          [final],
        )
      ).rows.length,
      2,
    );
    await assert.rejects(
      bill("2020-04-01", "2020-04-05", 120, 121),
      /không có người/,
    );
  } finally {
    await db.close();
  }
});

test("new-room reminders start next month; January services belong to December", async () => {
  const { previousMonth } = await import("../lib/business");
  const { billingToPrepare } = await import("../lib/operations");
  assert.equal(previousMonth("2026-01"), "2025-12");
  const data = {
    ...emptyData,
    properties: [{ id: "p", deleted_at: null }],
    rooms: [{ id: "r", property_id: "p" }],
    tenants: [
      {
        id: "t",
        room_id: "r",
        billing_cycle_id: "c",
        move_in: "2026-10-10",
        move_out: null,
      },
    ],
    billingCycles: [{ id: "c", room_id: "r", starts_on: "2026-10-10" }],
  } as Data;
  assert.equal(billingToPrepare(data, "2026-10-11").length, 0);
  assert.equal(billingToPrepare(data, "2026-11-01").length, 1);
});
