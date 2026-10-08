import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const users = {
  owner: "00000000-0000-0000-0000-000000000001",
  manager: "00000000-0000-0000-0000-000000000002",
  viewer: "00000000-0000-0000-0000-000000000003",
  outsider: "00000000-0000-0000-0000-000000000004",
  unverified: "00000000-0000-0000-0000-000000000005",
};
let foreignProperty: string;
let org: string,
  otherOrg: string,
  property: string,
  room: string,
  otherRoom: string,
  invoice: string;
async function as(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
async function query<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function reject(sql: string, params: unknown[] = [], pattern?: RegExp) {
  if (pattern) await assert.rejects(db.query(sql, params), pattern);
  else await assert.rejects(db.query(sql, params));
}
after(async () => {
  await db.close();
});
test("migration, authorization and billing integration", async (t) => {
  await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
 alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;
 insert into auth.users values('${users.owner}','owner@test.invalid',now()),('${users.manager}','manager@test.invalid',now()),('${users.viewer}','viewer@test.invalid',now()),('${users.outsider}','other@test.invalid',now()),('${users.unverified}','pending@test.invalid',null);`);
  // PGlite supplies gen_random_uuid natively; Supabase enables pgcrypto in production.
  await db.exec(
    readFileSync(
      "supabase/migrations/202610080001_hh_home.sql",
      "utf8",
    ).replace("create extension if not exists pgcrypto;", ""),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202610080002_property_service_rates.sql",
      "utf8",
    ),
  );
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
  await db.exec(
    readFileSync(
      "supabase/migrations/202610080006_room_move_in_readings.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202610080007_remove_workspace_member.sql",
      "utf8",
    ),
  );
  await t.test("fresh database contains no example business data", async () => {
    for (const table of [
      "organizations",
      "properties",
      "rooms",
      "tenants",
      "contracts",
      "invoices",
      "payments",
      "property_service_rates",
    ])
      assert.equal(
        (
          await query<{ count: number }>(
            `select count(*)::int as count from public.${table}`,
          )
        )[0].count,
        0,
      );
  });
  await t.test(
    "verified user creates workspace and becomes admin",
    async () => {
      await as(users.unverified);
      await reject(
        `select public.create_workspace('Test','Pending')`,
        [],
        /xác nhận email/,
      );
      await as(users.owner);
      org = (
        await query<{ id: string }>(
          `select public.create_workspace('Workspace A','Owner') as id`,
        )
      )[0].id;
      assert.equal(
        (
          await query<{ role: string }>(
            `select role from memberships where user_id=$1`,
            [users.owner],
          )
        )[0].role,
        "admin",
      );
      property = (
        await query<{ id: string }>(
          `select public.create_property($1,'Building A','Address A',18000000,2) as id`,
          [org],
        )
      )[0].id;
      room = (
        await query<{ id: string }>(
          `select id from rooms where property_id=$1 order by name`,
          [property],
        )
      )[0].id;
      await reject(
        `select public.create_property($1,'Bad','Address',0,101)`,
        [org],
        /Số phòng/,
      );
    },
  );
  await t.test("invitation accepts only matching verified email", async () => {
    await db.query(
      `insert into invitations(organization_id,email,role) values($1,'manager@test.invalid','manager'),($1,'viewer@test.invalid','viewer')`,
      [org],
    );
    await as(users.outsider);
    assert.equal(
      (
        await query<{ n: number }>(
          `select public.accept_invitations('Outsider') as n`,
        )
      )[0].n,
      0,
    );
    otherOrg = (
      await query<{ id: string }>(
        `select public.create_workspace('Workspace B','Other') as id`,
      )
    )[0].id;
    const otherProperty = (
      await query<{ id: string }>(
        `select public.create_property($1,'Building B','Address B',0,1) as id`,
        [otherOrg],
      )
    )[0].id;
    foreignProperty = otherProperty;
    otherRoom = (
      await query<{ id: string }>(`select id from rooms where property_id=$1`, [
        otherProperty,
      ])
    )[0].id;
    await as(users.manager);
    assert.equal(
      (
        await query<{ n: number }>(
          `select public.accept_invitations('Manager') as n`,
        )
      )[0].n,
      1,
    );
    await as(users.viewer);
    assert.equal(
      (
        await query<{ n: number }>(
          `select public.accept_invitations('Viewer') as n`,
        )
      )[0].n,
      1,
    );
  });
  await t.test("cross-workspace reads and mutations are denied", async () => {
    await as(users.outsider);
    assert.equal(
      (await query("select * from properties where organization_id=$1", [org]))
        .length,
      0,
    );
    assert.equal(
      (await query("select * from memberships where organization_id=$1", [org]))
        .length,
      0,
    );
    await reject(
      `select public.create_property($1,'Attack','Address',0,1)`,
      [org],
      /quyền/,
    );
    await as(users.owner);
    await reject(
      `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Tenant','Nam','1998-01-01','012345678901','0901234567','2026-01-01',0,0)`,
      [org, otherRoom],
      /không thuộc không gian/,
    );
  });
  await t.test("viewer cannot modify data or escalate role", async () => {
    await as(users.viewer);
    assert.equal((await query("select * from properties")).length, 1);
    await reject(
      `insert into rooms(organization_id,property_id,name,monthly_rent) values($1,$2,'Attack',0)`,
      [org, property],
      /row-level security/,
    );
    assert.equal(
      (
        await query(
          `update rooms set monthly_rent=1 where id=$1 returning id`,
          [room],
        )
      ).length,
      0,
    );
    await reject(
      `update memberships set role='admin' where user_id=$1`,
      [users.viewer],
      /permission denied/,
    );
    await reject(
      `select public.set_member_role($1,$2,'admin')`,
      [org, users.viewer],
      /quyền/,
    );
    await reject(
      `select public.record_payment($1,gen_random_uuid(),1)`,
      [org],
      /quyền/,
    );
  });
  await t.test(
    "manager can operate but cannot grant access; last admin preserved",
    async () => {
      await as(users.manager);
      await reject(
        `insert into invitations(organization_id,email,role) values($1,'attack@test.invalid','manager')`,
        [org],
        /row-level security/,
      );
      await db.query(`update rooms set monthly_rent=3800000 where id=$1`, [
        room,
      ]);
      await db.query(
        `insert into property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry) values($1,$2,3500,20000,30000,70000,50000)`,
        [property, org],
      );
      await as(users.owner);
      await reject(
        `select public.set_member_role($1,$2,'viewer')`,
        [org, users.owner],
        /quản trị viên/,
      );
    },
  );
  await t.test(
    "invoice computed from server-side rates with immutable history",
    async () => {
      await as(users.manager);
      invoice = (
        await query<{ id: string }>(
          `select public.create_invoice($1,$2,'2020-01-01','2020-01-05',1240,1325,86,92) as id`,
          [org, room],
        )
      )[0].id;
      assert.equal(
        Number(
          (
            await query<{ total: number }>(
              `select total from invoices where id=$1`,
              [invoice],
            )
          )[0].total,
        ),
        4367500,
      );
      await reject(
        `update invoices set electricity_rate=1 where id=$1`,
        [invoice],
        /permission denied/,
      );
      await db.query(
        `update property_service_rates set electricity=4000 where property_id=$1`,
        [property],
      );
      assert.equal(
        Number(
          (
            await query<{ total: number }>(
              `select total from invoices where id=$1`,
              [invoice],
            )
          )[0].total,
        ),
        4367500,
      );
      await reject(
        `select public.create_invoice($1,$2,'2020-01-01','2020-01-05',1240,1325,86,92)`,
        [org, room],
        /tồn tại/,
      );
      await reject(
        `select public.create_invoice($1,$2,'2020-02-01','2020-02-05',0,1,0,1)`,
        [org, room],
        /Chỉ số cũ/,
      );
      await reject(
        `select public.create_invoice($1,$2,'2020-02-01','2020-02-05',1325,1300,92,93)`,
        [org, room],
        /check constraint/,
      );
      await reject(
        `select public.create_invoice($1,$2,'2099-01-01','2099-01-05',1325,1326,92,93)`,
        [org, room],
        /tương lai/,
      );
    },
  );
  await t.test(
    "rates are property-specific, scoped and required for invoices",
    async () => {
      await as(users.manager);
      const otherProperty = (
        await query<{ id: string }>(
          `select public.create_property($1,'Building C','Address C',0,1) as id`,
          [org],
        )
      )[0].id;
      const newRoom = (
        await query<{ id: string }>(
          `select id from rooms where property_id=$1`,
          [otherProperty],
        )
      )[0].id;
      await reject(
        `select public.create_invoice($1,$2,'2020-01-01','2020-01-05',0,10,0,1)`,
        [org, newRoom],
        /Chưa thiết lập đơn giá/,
      );
      await db.query(
        `insert into property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry) values($1,$2,1000,5000,0,0,0)`,
        [otherProperty, org],
      );
      const id = (
        await query<{ id: string }>(
          `select public.create_invoice($1,$2,'2020-01-01','2020-01-05',0,10,0,1) as id`,
          [org, newRoom],
        )
      )[0].id;
      assert.equal(
        Number(
          (
            await query<{ total: number }>(
              `select total from invoices where id=$1`,
              [id],
            )
          )[0].total,
        ),
        15000,
      );
      assert.equal(
        Number(
          (
            await query<{ electricity: number }>(
              `select electricity from property_service_rates where property_id=$1`,
              [property],
            )
          )[0].electricity,
        ),
        4000,
      );
      await reject(
        `insert into property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry) values($1,$2,1,1,0,0,0)`,
        [foreignProperty, org],
        /foreign key/,
      );
      await as(users.viewer);
      assert.equal(
        (
          await query(
            `update property_service_rates set electricity=1 where property_id=$1 returning property_id`,
            [property],
          )
        ).length,
        0,
      );
      await reject(
        `insert into property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry) values($1,$2,1,1,0,0,0)`,
        [otherRoom, org],
        /row-level security/,
      );
      await as(users.outsider);
      assert.equal(
        (
          await query(
            `select * from property_service_rates where organization_id=$1`,
            [org],
          )
        ).length,
        0,
      );
      await as(users.manager);
    },
  );
  await t.test(
    "payments allow partial collection, prevent overpayment and replay",
    async () => {
      await db.query(`select public.record_payment($1,$2,1000000)`, [
        org,
        invoice,
      ]);
      await reject(
        `select public.record_payment($1,$2,4367500)`,
        [org, invoice],
        /công nợ/,
      );
      await db.query(`select public.record_payment($1,$2,3367500)`, [
        org,
        invoice,
      ]);
      await reject(
        `select public.record_payment($1,$2,1)`,
        [org, invoice],
        /công nợ/,
      );
      await reject(
        `insert into payments(organization_id,invoice_id,amount,recorded_by) values($1,$2,1,$3)`,
        [org, invoice, users.manager],
        /permission denied/,
      );
      await as(users.outsider);
      assert.equal(
        (await query("select * from invoices where id=$1", [invoice])).length,
        0,
      );
      await reject(
        `select public.record_payment($1,$2,1)`,
        [org, invoice],
        /quyền/,
      );
    },
  );
  await t.test(
    "contract storage private and scoped by organization AND room",
    async () => {
      await as(users.manager);
      const path = `${org}/${room}/contract.pdf`;
      await db.query(
        `insert into storage.objects(bucket_id,name) values('contracts',$1)`,
        [path],
      );
      await db.query(
        `insert into contracts(organization_id,room_id,file_name,storage_path,starts_on,ends_on) values($1,$2,'contract.pdf',$3,'2026-01-01','2026-12-31')`,
        [org, room, path],
      );
      await reject(
        `insert into storage.objects(bucket_id,name) values('contracts',$1)`,
        [`${org}/${otherRoom}/attack.pdf`],
        /row-level security/,
      );
      await as(users.viewer);
      assert.equal((await query("select * from storage.objects")).length, 1);
      await reject(
        `insert into storage.objects(bucket_id,name) values('contracts',$1)`,
        [`${org}/${room}/viewer.pdf`],
        /row-level security/,
      );
      await as(users.outsider);
      assert.equal((await query("select * from storage.objects")).length, 0);
      assert.equal((await query("select * from contracts")).length, 0);
      await db.exec("reset role");
      assert.equal(
        (
          await query<{ public: boolean }>(
            `select public from storage.buckets where id='contracts'`,
          )
        )[0].public,
        false,
      );
    },
  );
  await t.test(
    "property deletion requires authorization and preserves history",
    async () => {
      await as(users.manager);
      const target = (
        await query<{ id: string }>(
          `select public.create_property($1,'Delete test','Address',0,2) as id`,
          [org],
        )
      )[0].id;
      await db.query(
        `insert into property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry) values($1,$2,1,1,0,0,0)`,
        [target, org],
      );
      await as(users.viewer);
      await reject(
        `select public.delete_property($1,$2,'Delete test')`,
        [org, target],
        /quyền/,
      );
      await as(users.outsider);
      await reject(
        `select public.delete_property($1,$2,'Delete test')`,
        [org, target],
        /quyền/,
      );
      await as(users.manager);
      await reject(
        `delete from properties where id=$1`,
        [target],
        /permission denied/,
      );
      await reject(
        `select public.delete_property($1,$2,'wrong')`,
        [org, target],
        /khớp/,
      );
      await db.query(
        `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Remaining tenant','Nam','1990-01-01','123456780001','0901234567','2000-01-01',0,0)`,
        [org, room],
      );
      await reject(
        `select public.delete_property($1,$2,'Building A')`,
        [org, property],
        /còn người/,
      );
      await db.query(`select public.delete_property($1,$2,'Delete test')`, [
        org,
        target,
      ]);
      assert.equal(
        (await query(`select * from properties where id=$1`, [target])).length,
        0,
      );
      assert.equal(
        (await query(`select * from rooms where property_id=$1`, [target]))
          .length,
        0,
      );
      assert.equal(
        (
          await query(
            `select * from property_service_rates where property_id=$1`,
            [target],
          )
        ).length,
        0,
      );
      assert.equal(
        (await query(`select * from invoices where id=$1`, [invoice])).length,
        1,
      );
      assert.equal(
        (await query(`select * from payments where invoice_id=$1`, [invoice]))
          .length,
        2,
      );
      const scheduledProperty = (
        await query<{ id: string }>(
          `select public.create_property($1,'Scheduled','Address',0,1) as id`,
          [org],
        )
      )[0].id;
      const scheduledRoom = (
        await query<{ id: string }>(
          `select id from rooms where property_id=$1`,
          [scheduledProperty],
        )
      )[0].id;
      await db.query(
        `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Scheduled tenant','Nam','1990-01-01','123456780002','0901234567','2099-01-01',0,0)`,
        [org, scheduledRoom],
      );
      await reject(
        `select public.delete_property($1,$2,'Scheduled')`,
        [org, scheduledProperty],
        /lịch vào ở/,
      );
      const files = (
        await query<{ id: string }>(
          `select public.create_property($1,'Files','Address',0,1) as id`,
          [org],
        )
      )[0].id;
      const fileRoom = (
        await query<{ id: string }>(
          `select id from rooms where property_id=$1`,
          [files],
        )
      )[0].id;
      const path = org + "/" + fileRoom + "/orphan.pdf";
      await db.query(
        `insert into storage.objects(bucket_id,name) values('contracts',$1)`,
        [path],
      );
      await db.query(`select public.delete_property($1,$2,'Files')`, [
        org,
        files,
      ]);
      assert.equal(
        (
          await query(
            `select * from properties where id=$1 and deleted_at is not null`,
            [files],
          )
        ).length,
        1,
      );
      assert.equal(
        (await query(`select * from rooms where id=$1`, [fileRoom])).length,
        1,
      );
      assert.equal(
        (await query(`select * from storage.objects where name=$1`, [path]))
          .length,
        1,
      );
      assert.equal(
        (
          await query(
            `delete from storage.objects where name=$1 returning id`,
            [path],
          )
        ).length,
        0,
      );
      await reject(
        `insert into storage.objects(bucket_id,name) values('contracts',$1)`,
        [path],
        /row-level security/,
      );
    },
  );
  await t.test(
    "shared document history survives departures and never transfers to newcomers",
    async () => {
      await as(users.owner);
      const prop = (
        await query<{ id: string }>(
          `select public.create_property($1,'Archive tests','Address',0,1) as id`,
          [org],
        )
      )[0].id;
      const archiveRoom = (
        await query<{ id: string }>(
          `select id from rooms where property_id=$1`,
          [prop],
        )
      )[0].id;
      await db.query(
        `insert into property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry) values($1,$2,1000,5000,0,0,0)`,
        [prop, org],
      );
      const participants = await query<{ id: string }>(
        `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Archive A','Nam','1990-01-01','123456789001','0901234567','2000-01-01',0,0),($1,$2,'Archive B','Nữ','1990-01-01','123456789002','0901234568','2000-01-01',0,0) returning id`,
        [org, archiveRoom],
      );
      const bill = (
        await query<{ id: string }>(
          `select public.create_invoice($1,$2,'2020-01-01','2020-01-05',0,10,0,1) as id`,
          [org, archiveRoom],
        )
      )[0].id;
      const path = org + "/" + archiveRoom + "/archive.pdf";
      await db.query(
        `insert into storage.objects(bucket_id,name) values('contracts',$1)`,
        [path],
      );
      const contract = (
        await query<{ id: string }>(
          `insert into contracts(organization_id,room_id,file_name,storage_path,starts_on,ends_on) values($1,$2,'archive.pdf',$3,'2000-01-01','2099-01-01') returning id`,
          [org, archiveRoom, path],
        )
      )[0].id;
      assert.equal(
        (
          await query(`select * from invoice_tenants where invoice_id=$1`, [
            bill,
          ])
        ).length,
        2,
      );
      assert.equal(
        (
          await query(`select * from contract_tenants where contract_id=$1`, [
            contract,
          ])
        ).length,
        2,
      );
      await db.query(`select public.record_payment($1,$2,1000)`, [org, bill]);
      await db.query(`update tenants set move_out='2020-02-01' where id=$1`, [
        participants[0].id,
      ]);
      assert.equal(
        (
          await query(
            `select 1 from invoice_tenants l join tenants t on t.id=l.tenant_id where l.invoice_id=$1 and t.move_out is null`,
            [bill],
          )
        ).length,
        1,
      );
      await db.query(`update tenants set move_out='2020-02-01' where id=$1`, [
        participants[1].id,
      ]);
      const newcomer = (
        await query<{ id: string }>(
          `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'New occupant','Nam','1990-01-01','123456789003','0901234569','2021-01-01',20,2) returning id`,
          [org, archiveRoom],
        )
      )[0].id;
      assert.equal(
        (
          await query(`select * from invoice_tenants where tenant_id=$1`, [
            newcomer,
          ])
        ).length,
        0,
      );
      assert.equal(
        (
          await query(`select * from contract_tenants where tenant_id=$1`, [
            newcomer,
          ])
        ).length,
        0,
      );
      for (const participant of participants) {
        assert.equal(
          (
            await query(`select * from invoice_tenants where tenant_id=$1`, [
              participant.id,
            ])
          ).length,
          1,
        );
        assert.equal(
          (
            await query(`select * from contract_tenants where tenant_id=$1`, [
              participant.id,
            ])
          ).length,
          1,
        );
        await reject(
          `update tenants set move_out=null where id=$1`,
          [participant.id],
          /đợt ở đã kết thúc/,
        );
        await reject(
          `update tenants set room_id=$1 where id=$2`,
          [room, participant.id],
          /đã có hợp đồng/,
        );
      }
      assert.equal(
        (await query(`select * from payments where invoice_id=$1`, [bill]))
          .length,
        1,
      );
      assert.equal(
        (await query(`select * from storage.objects where name=$1`, [path]))
          .length,
        1,
      );
      await reject(
        `delete from invoice_tenants where invoice_id=$1`,
        [bill],
        /permission denied/,
      );
      await reject(
        `select public.link_tenant_document($1,'invoice',$2,array[gen_random_uuid()])`,
        [org, bill],
        /đúng phòng/,
      );
      const wrongRoomTenant = (
        await query<{ id: string }>(
          `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Correction Tenant','Nam','1990-01-01','123456789004','0901234567','2021-01-01',0,0) returning id`,
          [org, room],
        )
      )[0].id;
      await reject(
        `select public.link_tenant_document($1,'contract',$2,array[$3::uuid])`,
        [org, contract, wrongRoomTenant],
        /đúng phòng/,
      );
      await reject(
        `select public.delete_property($1,$2,'Archive tests')`,
        [org, prop],
        /còn người/,
      );
      await db.query(`update tenants set move_out='2022-01-01' where id=$1`, [
        newcomer,
      ]);
      await db.query(`select public.delete_property($1,$2,'Archive tests')`, [
        org,
        prop,
      ]);
      assert.equal(
        (
          await query(
            `select * from properties where id=$1 and deleted_at is not null`,
            [prop],
          )
        ).length,
        1,
      );
      assert.equal(
        (await query(`select * from invoices where id=$1`, [bill])).length,
        1,
      );
      assert.equal(
        (await query(`select * from payments where invoice_id=$1`, [bill]))
          .length,
        1,
      );
      assert.equal(
        (await query(`select * from contracts where id=$1`, [contract])).length,
        1,
      );
      assert.equal(
        (await query(`select * from storage.objects where name=$1`, [path]))
          .length,
        1,
      );
      await reject(
        `update properties set deleted_at=null where id=$1`,
        [prop],
        /permission denied/,
      );
      await reject(
        `update rooms set monthly_rent=1 where id=$1`,
        [archiveRoom],
        /Căn hộ đã xóa/,
      );
      await reject(
        `update rooms set property_id=$1 where id=$2`,
        [property, archiveRoom],
        /Căn hộ đã xóa/,
      );
      await reject(
        `update property_service_rates set electricity=1 where property_id=$1`,
        [prop],
        /Căn hộ đã xóa/,
      );
      await reject(
        `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Blocked','Nam','1990-01-01','123456789005','0901234567','2000-01-01',0,0)`,
        [org, archiveRoom],
        /Căn hộ đã xóa/,
      );
      await reject(
        `select public.create_invoice($1,$2,'2020-02-01','2020-02-05',10,11,1,2)`,
        [org, archiveRoom],
        /Căn hộ đã xóa/,
      );
      await reject(
        `insert into storage.objects(bucket_id,name) values('contracts',$1)`,
        [org + "/" + archiveRoom + "/blocked.pdf"],
        /row-level security/,
      );
      assert.equal(
        (
          await query(`delete from contracts where id=$1 returning id`, [
            contract,
          ])
        ).length,
        0,
      );
      await db.query(`select public.record_payment($1,$2,1000)`, [org, bill]);
      await db.query(`update tenants set phone='0901234560' where id=$1`, [
        participants[0].id,
      ]);
      await db.query(
        `select public.create_property($1,'Archive tests','New Address',0,1)`,
        [org],
      );
      await as(users.viewer);
      assert.equal(
        (
          await query(`select * from invoice_tenants where invoice_id=$1`, [
            bill,
          ])
        ).length,
        2,
      );
      await reject(
        `select public.link_tenant_document($1,'invoice',$2,array[$3::uuid])`,
        [org, bill, newcomer],
        /không có quyền/,
      );
      await as(users.outsider);
      assert.equal(
        (
          await query(`select * from invoice_tenants where invoice_id=$1`, [
            bill,
          ])
        ).length,
        0,
      );
      assert.equal(
        (
          await query(`select * from contract_tenants where contract_id=$1`, [
            contract,
          ])
        ).length,
        0,
      );
      await as(users.manager);
      await db.query(
        `select public.link_tenant_document($1,'invoice',$2,array[$3::uuid])`,
        [org, invoice, wrongRoomTenant],
      );
      await db.query(
        `select public.link_tenant_document($1,'invoice',$2,array[$3::uuid])`,
        [org, invoice, wrongRoomTenant],
      );
      assert.equal(
        (
          await query(`select * from invoice_tenants where invoice_id=$1`, [
            invoice,
          ])
        ).length,
        1,
      );
    },
  );
  await t.test(
    "vacant-room arrivals require a new baseline; roommates keep the same cycle and same-month bills remain separate",
    async () => {
      await as(users.manager);
      const propertyId = (
        await query<{ id: string }>(
          `select public.create_property($1,'Meter cycles','Address',0,2) as id`,
          [org],
        )
      )[0].id;
      const rooms = await query<{ id: string }>(
        `select id from rooms where property_id=$1 order by name`,
        [propertyId],
      );
      const target = rooms[0].id;
      await db.query(
        `insert into property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry) values($1,$2,1000,5000,0,0,0)`,
        [propertyId, org],
      );
      await reject(
        `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in) values($1,$2,'Missing baseline','Nam','1990-01-01','223456789001','0901234567','2020-01-03')`,
        [org, target],
        /cần ghi chỉ số/,
      );
      assert.equal(
        (
          await query(`select * from room_billing_cycles where room_id=$1`, [
            target,
          ])
        ).length,
        0,
      );
      const first = (
        await query<{ id: string; billing_cycle_id: string }>(
          `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'First occupant','Nam','1990-01-01','223456789001','0901234567','2020-01-03',100,10) returning id,billing_cycle_id`,
          [org, target],
        )
      )[0];
      const shared = (
        await query<{
          id: string;
          billing_cycle_id: string;
          electricity_initial: null;
        }>(
          `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in) values($1,$2,'Roommate','Nữ','1990-01-01','223456789002','0901234568','2020-01-04') returning id,billing_cycle_id,electricity_initial`,
          [org, target],
        )
      )[0];
      assert.equal(shared.billing_cycle_id, first.billing_cycle_id);
      assert.equal(shared.electricity_initial, null);
      await db.query(`update tenants set move_out='2020-01-10' where id=$1`, [
        first.id,
      ]);
      const joined = (
        await query<{ id: string; billing_cycle_id: string }>(
          `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in) values($1,$2,'Joined roommate','Nam','1990-01-01','223456789003','0901234569','2020-01-11') returning id,billing_cycle_id`,
          [org, target],
        )
      )[0];
      assert.equal(joined.billing_cycle_id, first.billing_cycle_id);
      for (const t of [shared, joined])
        await db.query(`update tenants set move_out='2020-01-17' where id=$1`, [
          t.id,
        ]);
      await reject(
        `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in) values($1,$2,'New stay','Nam','1990-01-01','223456789004','0901234560','2020-01-20')`,
        [org, target],
        /cần ghi chỉ số/,
      );
      const next = (
        await query<{ id: string; billing_cycle_id: string }>(
          `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'New stay','Nam','1990-01-01','223456789004','0901234560','2020-01-20',200,20) returning id,billing_cycle_id`,
          [org, target],
        )
      )[0];
      assert.notEqual(next.billing_cycle_id, first.billing_cycle_id);
      await reject(
        `select public.create_cycle_invoice($1,$2,$3,'2020-01-01','2020-02-01',0,140,0,15)`,
        [org, target, first.billing_cycle_id],
        /khớp mốc/,
      );
      await reject(
        `select public.create_cycle_invoice($1,$2,null,'2020-01-01','2020-02-01',0,140,0,15)`,
        [org, target],
        /chọn đợt thuê/,
      );
      await reject(
        `select public.create_cycle_invoice($1,$2,$3,'2020-01-01','2020-02-01',200,220,20,22)`,
        [org, rooms[1].id, next.billing_cycle_id],
        /không thuộc đúng phòng/,
      );
      await reject(
        `select public.create_cycle_invoice($1,$2,$3,'2020-01-01','2020-02-01',100,201,10,21)`,
        [org, target, first.billing_cycle_id],
        /mốc nhận phòng của đợt sau/,
      );
      const oldBill = (
        await query<{ id: string }>(
          `select public.create_cycle_invoice($1,$2,$3,'2020-01-01','2020-02-01',100,140,10,15) as id`,
          [org, target, first.billing_cycle_id],
        )
      )[0].id;
      await reject(
        `select public.create_cycle_invoice($1,$2,$3,'2020-01-01','2020-02-01',140,220,15,22)`,
        [org, target, next.billing_cycle_id],
        /khớp mốc/,
      );
      const newBill = (
        await query<{ id: string }>(
          `select public.create_cycle_invoice($1,$2,$3,'2020-01-01','2020-02-01',200,220,20,22) as id`,
          [org, target, next.billing_cycle_id],
        )
      )[0].id;
      assert.equal(
        Number(
          (
            await query<{ total: number }>(
              `select total from invoices where id=$1`,
              [newBill],
            )
          )[0].total,
        ),
        30000,
      );
      assert.equal(
        (
          await query(
            `select * from invoices where room_id=$1 and period='2020-01-01'`,
            [target],
          )
        ).length,
        2,
      );
      assert.equal(
        (
          await query(`select * from invoice_tenants where invoice_id=$1`, [
            oldBill,
          ])
        ).length,
        3,
      );
      assert.deepEqual(
        await query(
          `select tenant_id from invoice_tenants where invoice_id=$1`,
          [newBill],
        ),
        [{ tenant_id: next.id }],
      );
      await reject(
        `select public.create_invoice($1,$2,'2020-01-01','2020-02-01',200,220,20,22)`,
        [org, target],
        /chọn đợt thuê/,
      );
      await reject(
        `select public.create_cycle_invoice($1,$2,$3,'2020-02-01','2020-02-05',200,250,20,25)`,
        [org, target, next.billing_cycle_id],
        /khớp kỳ hóa đơn trước/,
      );
      await db.query(
        `select public.create_cycle_invoice($1,$2,$3,'2020-02-01','2020-02-05',220,250,22,25)`,
        [org, target, next.billing_cycle_id],
      );
      await reject(
        `select public.set_initial_room_readings($1,$2,999,999)`,
        [org, next.billing_cycle_id],
        /Mốc nhận phòng đã lưu/,
      );
      await reject(
        `update tenants set electricity_initial=999 where id=$1`,
        [first.id],
        /permission denied/,
      );
      await reject(
        `update room_billing_cycles set electricity_initial=999 where id=$1`,
        [first.billing_cycle_id],
        /permission denied/,
      );
      const scheduled = (
        await query<{ billing_cycle_id: string }>(
          `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in) values($1,$2,'Future booking','Nam','1990-01-01','223456789005','0901234561','2099-01-01') returning billing_cycle_id`,
          [org, rooms[1].id],
        )
      )[0];
      assert.equal(
        (
          await query<{ electricity_initial: null }>(
            `select electricity_initial from room_billing_cycles where id=$1`,
            [scheduled.billing_cycle_id],
          )
        )[0].electricity_initial,
        null,
      );
      await reject(
        `select public.set_initial_room_readings($1,$2,0,0)`,
        [org, scheduled.billing_cycle_id],
        /Chưa đến ngày/,
      );
      await as(users.viewer);
      assert.equal(
        (
          await query(`select * from room_billing_cycles where room_id=$1`, [
            target,
          ])
        ).length,
        2,
      );
      await reject(
        `select public.create_cycle_invoice($1,$2,$3,'2020-03-01','2020-03-05',250,260,25,26)`,
        [org, target, next.billing_cycle_id],
        /không có quyền/,
      );
      await as(users.outsider);
      assert.equal(
        (
          await query(`select * from room_billing_cycles where room_id=$1`, [
            target,
          ])
        ).length,
        0,
      );
      await as(users.manager);
      const futureShared = (
        await query<{ id: string; billing_cycle_id: string }>(
          `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in) values($1,$2,'Future roommate','Nam','1990-01-01','223456789006','0901234562','2099-01-01') returning id,billing_cycle_id`,
          [org, target],
        )
      )[0];
      assert.equal(futureShared.billing_cycle_id, next.billing_cycle_id);
      await db.query(`update tenants set move_out='2021-01-01' where id=$1`, [
        next.id,
      ]);
      const reassigned = (
        await query<{ billing_cycle_id: string }>(
          `select billing_cycle_id from tenants where id=$1`,
          [futureShared.id],
        )
      )[0].billing_cycle_id;
      assert.notEqual(reassigned, next.billing_cycle_id);
      assert.equal(
        (
          await query<{ electricity_initial: null }>(
            `select electricity_initial from room_billing_cycles where id=$1`,
            [reassigned],
          )
        )[0].electricity_initial,
        null,
      );
      await reject(
        `update tenants set billing_cycle_id=$1 where id=$2`,
        [next.billing_cycle_id, futureShared.id],
        /permission denied/,
      );
    },
  );
  await t.test(
    "admin removes workspace access while preserving users, history and last admin",
    async () => {
      await as(users.manager);
      await reject(
        `select public.remove_workspace_member($1,$2,'viewer@test.invalid')`,
        [org, users.viewer],
        /quyền quản trị/,
      );
      await as(users.viewer);
      await reject(
        `select public.remove_workspace_member($1,$2,'manager@test.invalid')`,
        [org, users.manager],
        /quyền quản trị/,
      );
      await as(users.owner);
      await reject(
        `select public.remove_workspace_member($1,$2,'owner@test.invalid')`,
        [org, users.owner],
        /ít nhất một quản trị viên/,
      );
      await reject(
        `select public.remove_workspace_member($1,$2,'other@test.invalid')`,
        [otherOrg, users.outsider],
        /quyền quản trị/,
      );
      await reject(
        `select public.remove_workspace_member($1,$2,'wrong@test.invalid')`,
        [org, users.viewer],
        /Email xác nhận/,
      );
      await db.query(
        `insert into invitations(organization_id,email,role) values($1,'viewer@test.invalid','viewer') on conflict do nothing`,
        [org],
      );
      const before = await query(
        `select id,total from invoices where organization_id=$1 order by id`,
        [org],
      );
      await db.query(
        `select public.remove_workspace_member($1,$2,'viewer@test.invalid')`,
        [org, users.viewer],
      );
      assert.equal(
        (
          await query(
            `select * from memberships where organization_id=$1 and user_id=$2`,
            [org, users.viewer],
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await query(
            `select * from invitations where organization_id=$1 and email='viewer@test.invalid'`,
            [org],
          )
        ).length,
        0,
      );
      assert.deepEqual(
        await query(
          `select id,total from invoices where organization_id=$1 order by id`,
          [org],
        ),
        before,
      );
      await as(users.viewer);
      assert.equal(
        (
          await query(`select * from properties where organization_id=$1`, [
            org,
          ])
        ).length,
        0,
      );
      await db.exec("reset role");
      assert.equal(
        (await query(`select * from auth.users where id=$1`, [users.viewer]))
          .length,
        1,
      );
    },
  );
  await t.test(
    "anonymous users cannot access application data or bootstrap RPCs",
    async () => {
      await db.exec(
        `reset role;set role anon;select set_config('request.jwt.claim.sub','',false)`,
      );
      await reject("select * from properties", [], /permission denied/);
      await reject(
        `select public.create_workspace('Attack','Attacker')`,
        [],
        /permission denied/,
      );
    },
  );
});
