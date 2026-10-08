import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("existing organization rates migrate to properties without changing historical invoices", async () => {
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
  } finally {
    await db.close();
  }
});
