import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { emptyData, type Data } from "../lib/types";
import { financialSeries, heldDeposit, roomAlerts } from "../lib/operations";
const owner = "00000000-0000-0000-0000-000000000011",
  viewer = "00000000-0000-0000-0000-000000000012",
  other = "00000000-0000-0000-0000-000000000013";
test("manager-only workspace access", async () => {
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

  try {
    await db.exec("reset role");
    await db.query(
      "insert into memberships(organization_id,user_id,role,display_name,email) values($1,$2,'viewer','Viewer','viewer@test.invalid')",
      [org, viewer],
    );
    for (const name of [
      "011_monthly_billing_schedule",
      "012_edit_room_lease",
      "013_advance_fixed_fees",
      "014_water_person_only",
      "015_manager_only",
    ])
      await db.exec(
        readFileSync(`supabase/migrations/202610080${name}.sql`, "utf8"),
      );
    await actor(viewer);
    assert.equal(
      (
        await db.query<{ role: string }>(
          "select role from memberships where user_id=$1",
          [viewer],
        )
      ).rows[0].role,
      "admin",
    );
    await db.query("update rooms set monthly_rent=1234 where id=$1", [room]);
    assert.equal(
      Number(
        (
          await db.query<{ monthly_rent: string }>(
            "select monthly_rent from rooms where id=$1",
            [room],
          )
        ).rows[0].monthly_rent,
      ),
      1234,
    );
    await db.query(
      "insert into invitations(organization_id,email,role) values($1,'new@test.invalid','viewer')",
      [org],
    );
    assert.equal(
      (
        await db.query<{ role: string }>(
          "select role from invitations where email='new@test.invalid'",
        )
      ).rows[0].role,
      "admin",
    );
    await assert.rejects(
      db.query("select set_member_role($1,$2,'viewer')", [org, owner]),
      /permission denied/,
    );
    await actor(other);
    assert.equal(
      (await db.query("select * from rooms where id=$1", [room])).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select create_property($1,'Forbidden','Address',0,1)", [org]),
      /quyền/,
    );
  } finally {
    await db.close();
  }
});
