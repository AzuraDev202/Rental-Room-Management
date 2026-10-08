import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("existing rates and tenant document history migrate without changing financial records", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon nologin;create role authenticated nologin;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;insert into auth.users values('00000000-0000-0000-0000-000000000001','migration@test.invalid',now());`,
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/202610080001_hh_home.sql",
        "utf8",
      ).replace("create extension if not exists pgcrypto;", ""),
    );
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)`,
    );
    const org = (
      await db.query<{ id: string }>(
        `select public.create_workspace('Existing','Owner') as id`,
      )
    ).rows[0].id;
    const property = (
      await db.query<{ id: string }>(
        `select public.create_property($1,'A','Address A',0,1) as id`,
        [org],
      )
    ).rows[0].id;
    await db.query(`select public.create_property($1,'B','Address B',0,1)`, [
      org,
    ]);
    const room = (
      await db.query<{ id: string }>(
        `select id from rooms where property_id=$1`,
        [property],
      )
    ).rows[0].id;
    await db.query(
      `update service_rates set electricity=2500,water=15000,trash=30000,wifi=50000,laundry=0 where organization_id=$1`,
      [org],
    );
    const invoice = (
      await db.query<{ id: string }>(
        `select public.create_invoice($1,$2,'2020-01-01','2020-01-05',0,10,0,2) as id`,
        [org, room],
      )
    ).rows[0].id;
    await db.query(`select public.record_payment($1,$2,50000)`, [org, invoice]);
    // Existing documents predate the new resident, despite a long contract end date.
    const originalTenant = (
      await db.query<{ id: string }>(
        `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,move_out) values($1,$2,'Original','Nam','1990-01-01','123456789001','0901234567','2000-01-01','2020-02-01') returning id`,
        [org, room],
      )
    ).rows[0].id;
    const newcomer = (
      await db.query<{ id: string }>(
        `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in) values($1,$2,'Newcomer','Nam','1990-01-01','123456789002','0901234568','2021-01-01') returning id`,
        [org, room],
      )
    ).rows[0].id;
    const contract = (
      await db.query<{ id: string }>(
        `insert into contracts(organization_id,room_id,file_name,storage_path,starts_on,ends_on) values($1,$2,'Existing.pdf',$3,'2020-01-01','2099-01-01') returning id`,
        [org, room, org + "/" + room + "/existing.pdf"],
      )
    ).rows[0].id;
    await db.exec("reset role");
    await db.query(`update invoices set created_at='2020-01-05' where id=$1`, [
      invoice,
    ]);
    await db.query(`update contracts set created_at='2020-01-05' where id=$1`, [
      contract,
    ]);
    await db.exec("set role authenticated");

    const before = (
      await db.query(`select * from invoices where id=$1`, [invoice])
    ).rows[0];
    await db.exec("reset role");
    await db.exec(
      readFileSync(
        "supabase/migrations/202610080002_property_service_rates.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    const rates = (
      await db.query<{
        electricity: number;
        water: number;
        trash: number;
        wifi: number;
        laundry: number;
      }>(`select * from property_service_rates where organization_id=$1`, [org])
    ).rows;
    assert.equal(rates.length, 2);
    rates.forEach((r) => {
      assert.equal(Number(r.electricity), 2500);
      assert.equal(Number(r.water), 15000);
      assert.equal(Number(r.trash), 30000);
      assert.equal(Number(r.wifi), 50000);
    });
    assert.deepEqual(
      (await db.query(`select * from invoices where id=$1`, [invoice])).rows[0],
      before,
    );
    assert.equal(
      (await db.query(`select * from payments where invoice_id=$1`, [invoice]))
        .rows.length,
      1,
    );
    await assert.rejects(
      db.query("select * from legacy_organization_service_rates"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.exec(
      readFileSync(
        "supabase/migrations/202610080003_delete_property.sql",
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/202610080004_tenant_document_history.sql",
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/202610080005_delete_vacant_property.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    assert.deepEqual(
      (
        await db.query(
          `select tenant_id from invoice_tenants where invoice_id=$1`,
          [invoice],
        )
      ).rows,
      [{ tenant_id: originalTenant }],
    );
    assert.deepEqual(
      (
        await db.query(
          `select tenant_id from contract_tenants where contract_id=$1`,
          [contract],
        )
      ).rows,
      [{ tenant_id: originalTenant }],
    );
    assert.equal(
      (
        await db.query(`select * from invoice_tenants where tenant_id=$1`, [
          newcomer,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(`select * from contract_tenants where tenant_id=$1`, [
          newcomer,
        ])
      ).rows.length,
      0,
    );
    assert.deepEqual(
      (await db.query(`select * from invoices where id=$1`, [invoice])).rows[0],
      before,
    );
    assert.equal(
      (await db.query(`select * from payments where invoice_id=$1`, [invoice]))
        .rows.length,
      1,
    );
    const newOrg = (
      await db.query<{ id: string }>(
        `select public.create_workspace('Empty','Owner') as id`,
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query(
          `select * from property_service_rates where organization_id=$1`,
          [newOrg],
        )
      ).rows.length,
      0,
    );
    const unbilledRoom = (
      await db.query<{ id: string }>(
        `select r.id from rooms r join properties p on p.id=r.property_id where p.name='B' and p.organization_id=$1`,
        [org],
      )
    ).rows[0].id;
    await db.query(
      `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in) values($1,$2,'Unbilled legacy','Nam','1990-01-01','123456789003','0901234569','2000-01-01')`,
      [org, unbilledRoom],
    );
    await db.exec("reset role");
    await db.exec(
      readFileSync(
        "supabase/migrations/202610080006_room_move_in_readings.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    const upgraded = (
      await db.query<Record<string, unknown>>(
        "select * from invoices where id=$1",
        [invoice],
      )
    ).rows[0];
    const legacyCycle = upgraded.billing_cycle_id;
    delete upgraded.billing_cycle_id;
    assert.deepEqual(upgraded, before);
    const cycle = (
      await db.query<{
        electricity_initial: number;
        water_initial: number;
        is_legacy: boolean;
      }>("select * from room_billing_cycles where id=$1", [legacyCycle])
    ).rows[0];
    assert.equal(cycle.electricity_initial, 0);
    assert.equal(cycle.water_initial, 0);
    assert.equal(cycle.is_legacy, true);
    assert.equal(
      (
        await db.query("select * from invoice_tenants where invoice_id=$1", [
          invoice,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from payments where invoice_id=$1", [invoice]))
        .rows.length,
      1,
    );
    const unbilledCycle = (
      await db.query<{ id: string; electricity_initial: null }>(
        `select * from room_billing_cycles where room_id=$1`,
        [unbilledRoom],
      )
    ).rows[0];
    assert.equal(unbilledCycle.electricity_initial, null);
    await assert.rejects(
      db.query(
        `select public.create_cycle_invoice($1,$2,$3,'2020-01-01','2020-01-05',100,110,20,22)`,
        [org, unbilledRoom, unbilledCycle.id],
      ),
      /Cần ghi chỉ số nhận phòng/,
    );
    await db.query(`select public.set_initial_room_readings($1,$2,100,20)`, [
      org,
      unbilledCycle.id,
    ]);
    await db.query(
      `select public.create_cycle_invoice($1,$2,$3,'2020-01-01','2020-01-05',100,110,20,22)`,
      [org, unbilledRoom, unbilledCycle.id],
    );
    assert.equal(
      (
        await db.query(`select * from invoices where room_id=$1`, [
          unbilledRoom,
        ])
      ).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
