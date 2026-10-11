import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { emptyData, type Data } from "../lib/types";
import { financialSeries, heldDeposit, roomAlerts } from "../lib/operations";
const owner = "00000000-0000-0000-0000-000000000011",
  viewer = "00000000-0000-0000-0000-000000000012",
  other = "00000000-0000-0000-0000-000000000013";
test("advance fixed fees and prorated arrival bills", async () => {
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
    await db.exec("reset role");
    for (const file of [
      "011_monthly_billing_schedule",
      "012_edit_room_lease",
      "013_advance_fixed_fees",
    ])
      await db.exec(
        readFileSync(`supabase/migrations/202610080${file}.sql`, "utf8"),
      );
    await actor(owner);
    await db.query("update rooms set monthly_rent=3100 where id=$1", [room]);
    await db.query(
      "insert into property_service_rates(organization_id,property_id,electricity,water,trash,wifi,laundry,water_mode) values($1,$2,10,310,310,0,310,'person')",
      [org, prop],
    );
    const first = await id(
      "insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial) values($1,$2,'First','Nam','1990-01-01','123456789012','0901234567','2020-01-10',100) returning id",
      [org, room],
    );
    const cycle = await id(
      "select billing_cycle_id as id from tenants where id=$1",
      [first],
    );
    const bill = (period: string, due: string, eOld: number, eNew: number) =>
      id("select create_advance_invoice($1,$2,$3,$4,$5,$6,$7,0,0) as id", [
        org,
        room,
        cycle,
        period,
        due,
        eOld,
        eNew,
      ]);
    await assert.rejects(bill("2020-01-01", "2020-01-05", 100, 100), /Hạn thu/);
    await assert.rejects(
      bill("2020-01-01", "2020-01-10", 100, 105),
      /không tính chi phí/,
    );
    const arrival = await bill("2020-01-01", "2020-01-10", 100, 100);
    const a = (
      await db.query<Record<string, unknown>>(
        "select * from invoices where id=$1",
        [arrival],
      )
    ).rows[0];
    assert.equal(a.arrival_bill, true);
    assert.equal(a.fixed_room_days, 22);
    assert.equal(a.fixed_person_days, 22);
    assert.equal(Number(a.room_rent), 2200);
    assert.equal(Number(a.trash_fee), 220);
    assert.equal(Number(a.water_fee), 220);
    assert.equal(Number(a.laundry_fee), 220);
    assert.equal(Number(a.total), 2860);
    await assert.rejects(
      bill("2020-01-01", "2020-01-10", 100, 100),
      /đã tồn tại/,
    );
    await id(
      "insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in) values($1,$2,'Second','Nam','1990-01-01','123456789013','0901234568','2020-02-10') returning id",
      [org, room],
    );
    const feb = await bill("2020-02-01", "2020-02-05", 100, 105);
    const b = (
      await db.query<Record<string, unknown>>(
        "select * from invoices where id=$1",
        [feb],
      )
    ).rows[0];
    // 2020 is leap year: 29 days, new resident stays 20 days.
    assert.equal(b.fixed_month_days, 29);
    assert.equal(b.fixed_person_days, 49);
    assert.equal(Number(b.water_fee), 524);
    assert.equal(Number(b.laundry_fee), 524);
    assert.equal(Number(b.room_rent), 3100);
    assert.equal(Number(b.total), 4508);
    await db.query(
      "update tenants set move_out='2020-03-01' where billing_cycle_id=$1",
      [cycle],
    );
    const final = await bill("2020-03-01", "2020-03-05", 105, 110);
    const c = (
      await db.query<Record<string, unknown>>(
        "select * from invoices where id=$1",
        [final],
      )
    ).rows[0];
    assert.equal(Number(c.room_rent), 0);
    assert.equal(Number(c.water_fee), 0);
    assert.equal(Number(c.laundry_fee), 0);
    assert.equal(Number(c.trash_fee), 0);
    assert.equal(Number(c.total), 50);
    assert.equal(
      (
        await db.query("select * from invoice_tenants where invoice_id=$1", [
          final,
        ])
      ).rows.length,
      2,
    );
    // Metered water is also excluded from the first bill.
    const prop2 = await id(
      "select create_property($1,'Meter','Address',0,1) as id",
      [org],
    );
    const room2 = await id("select id from rooms where property_id=$1", [
      prop2,
    ]);
    await db.query("update rooms set monthly_rent=3100 where id=$1", [room2]);
    await db.query(
      "insert into property_service_rates(organization_id,property_id,electricity,water,trash,wifi,laundry) values($1,$2,10,20,310,0,310)",
      [org, prop2],
    );
    const tenant2 = await id(
      "insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Meter','Nam','1990-01-01','123456789014','0901234569','2020-01-10',200,300) returning id",
      [org, room2],
    );
    const cycle2 = await id(
      "select billing_cycle_id as id from tenants where id=$1",
      [tenant2],
    );
    const meter = await id(
      "select create_advance_invoice($1,$2,$3,'2020-01-01','2020-01-10',200,200,300,300) as id",
      [org, room2, cycle2],
    );
    assert.equal(
      Number(
        (
          await db.query<{ total: string }>(
            "select total from invoices where id=$1",
            [meter],
          )
        ).rows[0].total,
      ),
      2640,
    );
  } finally {
    await db.close();
  }
});

test("UI allocation matches SQL across full, partial and leap-year months", async () => {
  const { fixedFeeAllocation, advanceBill } = await import("../lib/business");
  const tenants = [
    { move_in: "2020-01-10", move_out: null },
  ] as import("../lib/types").Tenant[];
  const rates = {
    electricity: 10,
    water: 310,
    trash: 310,
    wifi: 0,
    laundry: 310,
    water_mode: "person",
  } as import("../lib/types").Rates;
  const jan = fixedFeeAllocation(
    "2020-01",
    "2020-01-10",
    tenants,
    "2020-01-10",
  );
  assert.deepEqual(jan, {
    roomDays: 22,
    monthDays: 31,
    personDays: 22,
    people: 1,
  });
  assert.equal(advanceBill(3100, rates, jan, 100, 100, 0, 0, true).total, 2860);
  const feb = fixedFeeAllocation(
    "2020-02",
    "2020-01-10",
    [
      ...tenants,
      {
        move_in: "2020-02-10",
        move_out: null,
      } as import("../lib/types").Tenant,
    ],
    "2020-02-10",
  );
  assert.equal(advanceBill(3100, rates, feb, 100, 105, 0, 0).total, 4508);
});
