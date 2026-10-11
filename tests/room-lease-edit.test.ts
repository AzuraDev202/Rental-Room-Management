import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { emptyData, type Data } from "../lib/types";
import { financialSeries, heldDeposit, roomAlerts } from "../lib/operations";
const owner = "00000000-0000-0000-0000-000000000011",
  viewer = "00000000-0000-0000-0000-000000000012",
  other = "00000000-0000-0000-0000-000000000013";
test("room lease edits preserve invoices and deposit history", async () => {
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
    for (const file of ["011_monthly_billing_schedule", "012_edit_room_lease"])
      await db.exec(
        readFileSync(`supabase/migrations/202610080${file}.sql`, "utf8"),
      );
    await actor(owner);
    await db.query(
      "insert into property_service_rates(organization_id,property_id,electricity,water,trash,wifi,laundry) values($1,$2,10,20,0,0,0)",
      [org, prop],
    );
    const tenant = await id(
      "insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Lease','Nam','1990-01-01','123456789012','0901234567','2020-01-15',100,200) returning id",
      [org, room],
    );
    const cycle = await id(
      "select billing_cycle_id as id from tenants where id=$1",
      [tenant],
    );
    const edit = (end: string, deposit: number, e: number, w: number | null) =>
      db.query("select edit_room_lease($1,$2,$3,$4,$5,$6)", [
        org,
        cycle,
        end,
        deposit,
        e,
        w,
      ]);
    const contract = await id(
      "insert into contracts(organization_id,room_id,file_name,storage_path,starts_on,ends_on) values($1,$2,'lease.pdf',$3,'2020-01-15','2020-12-01') returning id",
      [org, room, org + "/" + room + "/lease.pdf"],
    );
    await edit("2020-12-31", 1000, 110, 210);
    const saved = (
      await db.query<Record<string, unknown>>(
        "select * from room_billing_cycles where id=$1",
        [cycle],
      )
    ).rows[0];
    assert.equal(saved.electricity_initial, 110);
    assert.equal(saved.water_initial, 210);
    assert.equal(
      new Date(String(saved.lease_ends_on)).toISOString().slice(0, 10),
      "2020-12-31",
    );
    const contractEnd = (
      await db.query<{ ends_on: Date }>(
        "select ends_on from contracts where id=$1",
        [contract],
      )
    ).rows[0].ends_on;
    assert.equal(
      new Date(contractEnd).toISOString().slice(0, 10),
      "2020-12-31",
    );
    await edit("2020-12-31", 1000, 110, 210);
    assert.equal(
      (await db.query("select * from deposit_entries")).rows.length,
      1,
    );
    await edit("2021-01-31", 600, 115, 215);
    assert.equal(
      (await db.query("select * from deposit_entries")).rows.length,
      2,
    );
    const held = (
      await db.query<{ held: string }>(
        "select sum(case when kind='receive' then amount else -amount end) as held from deposit_entries",
      )
    ).rows[0].held;
    assert.equal(Number(held), 600);
    await assert.rejects(edit("2019-12-01", 900, 120, 220), /trước ngày vào ở/);
    const invoice = await id(
      "select create_monthly_invoice($1,$2,$3,'2020-02-01','2020-02-05',115,125,215,225) as id",
      [org, room, cycle],
    );
    const before = (
      await db.query("select total from invoices where id=$1", [invoice])
    ).rows;
    await assert.rejects(edit("2021-02-01", 800, 116, 215), /đã có hóa đơn/);
    await edit("2021-02-01", 800, 115, 215);
    assert.deepEqual(
      (await db.query("select total from invoices where id=$1", [invoice]))
        .rows,
      before,
    );
    await db.query(
      "update property_service_rates set water_mode='person' where property_id=$1",
      [prop],
    );
    await edit("2021-03-01", 800, 115, null);
    const water = (
      await db.query<{ water_initial: number }>(
        "select water_initial from room_billing_cycles where id=$1",
        [cycle],
      )
    ).rows[0].water_initial;
    assert.equal(water, 215);
    assert.deepEqual(
      (await db.query("select total from invoices where id=$1", [invoice]))
        .rows,
      before,
    );
    await db.exec("reset role");
    await db.query(
      "insert into memberships(organization_id,user_id,role,display_name,email) values($1,$2,'viewer','Viewer','viewer@test.invalid')",
      [org, viewer],
    );
    await actor(viewer);
    await assert.rejects(edit("2021-03-01", 800, 115, 215), /không có quyền/);
    await actor(other);
    await assert.rejects(edit("2021-03-01", 800, 115, 215), /không có quyền/);
  } finally {
    await db.close();
  }
});
