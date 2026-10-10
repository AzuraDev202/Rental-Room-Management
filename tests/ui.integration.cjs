// UI integration against an in-memory PostgreSQL backend. Auth and Storage HTTP are simulated.
// Start the dev server on port 3001 with the TEST public URL/key documented in tests/README.md.
const { chromium } = require("playwright");
const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const assert = require("node:assert/strict");
const root = require("node:path").resolve(__dirname, "..");
const uid = "00000000-0000-0000-0000-000000000001",
  vid = "00000000-0000-0000-0000-000000000002";
(async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;insert into auth.users values('${uid}','owner@test.invalid',now()),('${vid}','viewer@test.invalid',now());`,
  );
  await db.exec(
    fs
      .readFileSync(
        root + "/supabase/migrations/202610080001_hh_home.sql",
        "utf8",
      )
      .replace("create extension if not exists pgcrypto;", ""),
  );
  await db.exec(
    fs.readFileSync(
      root + "/supabase/migrations/202610080002_property_service_rates.sql",
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      root + "/supabase/migrations/202610080003_delete_property.sql",
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      root + "/supabase/migrations/202610080004_tenant_document_history.sql",
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      root + "/supabase/migrations/202610080005_delete_vacant_property.sql",
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      root + "/supabase/migrations/202610080006_room_move_in_readings.sql",
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      root + "/supabase/migrations/202610080007_remove_workspace_member.sql",
      "utf8",
    ),
  );
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  const user = (id) => ({
    id,
    aud: "authenticated",
    role: "authenticated",
    email: id === uid ? "owner@test.invalid" : "viewer@test.invalid",
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { display_name: id === uid ? "Test Owner" : "Test Viewer" },
  });
  const token = (id) =>
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({
        sub: id,
        aud: "authenticated",
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url") +
    ".test";
  const json = (v) =>
    JSON.stringify(v, (key, x) => {
      if (
        [
          "period",
          "due_date",
          "birth_date",
          "move_in",
          "move_out",
          "starts_on",
          "ends_on",
        ].includes(key) &&
        typeof x === "string"
      )
        return x.slice(0, 10);
      return typeof x === "bigint" ? Number(x) : x;
    });
  await context.route("https://hh-home-test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      method = req.method(),
      body = req.postDataJSON?.bind(req);
    let who = uid;
    const bearer = req.headers().authorization?.split(" ")[1];
    if (bearer && bearer.split(".").length === 3)
      try {
        who = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url")).sub;
      } catch {}
    try {
      if (url.pathname.startsWith("/auth/")) {
        if (url.pathname.endsWith("/token")) {
          const v = body();
          who = v.email === "viewer@test.invalid" ? vid : uid;
          return route.fulfill({
            json: {
              access_token: token(who),
              refresh_token: "test-refresh",
              token_type: "bearer",
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user: user(who),
            },
          });
        }
        if (url.pathname.endsWith("/logout"))
          return route.fulfill({ status: 204 });
        return route.fulfill({ json: user(who) });
      }
      await db.exec(
        `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${who}',false)`,
      );
      if (url.pathname.startsWith("/storage/v1/object/sign/")) {
        if (method === "GET")
          return route.fulfill({
            status: 200,
            contentType: "text/plain",
            body: "Test contract",
          });
        assert.equal(body().expiresIn, 60);
        const path = url.pathname.split("/contracts/")[1];
        const found = (
          await db.query("select * from storage.objects where name=$1", [path])
        ).rows;
        assert.equal(found.length, 1);
        return route.fulfill({
          json: { signedURL: "/object/sign/contracts/" + path + "?token=test" },
        });
      }
      if (url.pathname.startsWith("/storage/v1/object/contracts/")) {
        const path = url.pathname.split("/contracts/")[1];
        await db.query(
          "insert into storage.objects(bucket_id,name) values('contracts',$1)",
          [path],
        );
        return route.fulfill({
          json: { Key: "contracts/" + path, Id: "object-id" },
        });
      }
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.split("/").pop();
        assert.match(name, /^[a-z_]+$/);
        const v = body(),
          keys = Object.keys(v);
        keys.forEach((k) => assert.match(k, /^[a-z_]+$/));
        const r = await db.query(
          `select public.${name}(${keys.map((k, i) => k + " => $" + (i + 1)).join(",")}) as value`,
          Object.values(v),
        );
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: json(r.rows[0].value),
        });
      }
      const table = url.pathname.split("/").pop();
      assert(
        [
          "organizations",
          "memberships",
          "room_billing_cycles",
          "invoice_tenants",
          "contract_tenants",
          "properties",
          "rooms",
          "tenants",
          "property_service_rates",
          "invoices",
          "payments",
          "contracts",
          "invitations",
        ].includes(table),
      );
      const params = [],
        where = [];
      for (const [k, v] of url.searchParams) {
        if (v.startsWith("eq.")) {
          assert.match(k, /^[a-z_]+$/);
          params.push(v.slice(3));
          where.push(k + "=$" + params.length);
        }
      }
      const condition = where.length ? " where " + where.join(" and ") : "";
      let result;
      if (method === "GET") {
        const order = (url.searchParams.get("order") || "").split(".")[0];
        assert(!order || /^[a-z_]+$/.test(order));
        result = await db.query(
          "select * from public." +
            table +
            condition +
            (order ? " order by " + order : ""),
          params,
        );
      } else if (method === "POST") {
        const v = body(),
          item = Array.isArray(v) ? v[0] : v,
          keys = Object.keys(item);
        keys.forEach((k) => assert.match(k, /^[a-z_]+$/));
        let sql =
          "insert into public." +
          table +
          "(" +
          keys.join(",") +
          ") values(" +
          keys.map((_, i) => "$" + (i + 1)).join(",") +
          ")";
        if (req.headers().prefer?.includes("resolution=merge-duplicates"))
          sql +=
            " on conflict(" +
            (url.searchParams.get("on_conflict") || "organization_id") +
            ") do update set " +
            keys
              .filter((k) => k !== "organization_id")
              .map((k) => k + "=excluded." + k)
              .join(",");
        result = await db.query(sql + " returning *", Object.values(item));
      } else if (method === "PATCH") {
        const v = body(),
          keys = Object.keys(v);
        keys.forEach((k) => assert.match(k, /^[a-z_]+$/));
        const offset = keys.length;
        const renamed = condition.replace(
          /\$(\d+)/g,
          (_, n) => "$" + (+n + offset),
        );
        result = await db.query(
          "update public." +
            table +
            " set " +
            keys.map((k, i) => k + "=$" + (i + 1)).join(",") +
            renamed +
            " returning *",
          [...Object.values(v), ...params],
        );
      } else throw new Error("Unsupported API method " + method);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: json(result.rows),
      });
    } catch (e) {
      console.error("API error", url.pathname, e.message);
      await route.fulfill({
        status: 400,
        json: { message: e.message, code: e.code || "P0001" },
      });
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("Browser error", e.stack || e.message);
  });
  await page.goto("http://localhost:3001", { waitUntil: "networkidle" });
  // Prevent Safari focus zoom: verify the final cascaded size on auth controls.
  for (const width of [320, 390, 430, 844]) {
    await page.setViewportSize({ width, height: 844 });
    for (const label of ["Email", "Mật khẩu"]) {
      const input = page.getByLabel(label, { exact: true });
      await input.focus();
      assert.ok(
        Number.parseFloat(
          await input.evaluate((el) => getComputedStyle(el).fontSize),
        ) >= 16,
        `auth ${label} at ${width}`,
      );
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  const viewportMeta = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  assert.match(viewportMeta, /initial-scale=1/);
  assert.doesNotMatch(viewportMeta, /user-scalable=no|maximum-scale=1/);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByLabel("Email", { exact: true }).fill("owner@test.invalid");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByLabel("Tên không gian quản lý").fill("HH HOME test");
  await page
    .getByRole("button", { name: "Tạo không gian", exact: true })
    .click();
  await page.getByRole("heading", { name: "Chưa có căn hộ" }).waitFor();
  console.log("Workspace initialized");
  assert.equal(
    await page
      .getByRole("button", { name: "Thêm căn hộ", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Cài đặt", exact: true }).click();
  assert.equal(
    await page.getByRole("heading", { name: /Đơn giá dịch vụ/ }).count(),
    0,
  );
  await page.getByRole("button", { name: "Tổng quan", exact: true }).click();
  await page.screenshot({
    path: "/tmp/hh-empty-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /^Căn hộ/ }).click();
  await page.getByRole("button", { name: "Thêm căn hộ", exact: true }).click();
  await page.getByLabel("Tên căn hộ", { exact: true }).fill("Test Building");
  await page.getByLabel("Địa chỉ", { exact: true }).fill("Test Address");
  await page.getByLabel("Số phòng", { exact: true }).fill("1");
  await page
    .getByLabel("Giá thuê căn hộ / tháng (VNĐ)", { exact: true })
    .fill("18000000");
  await page
    .getByRole("button", { name: "Thêm căn hộ", exact: true })
    .last()
    .click();
  await page
    .getByRole("heading", { name: "Thêm căn hộ" })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: /Test Building Test Address/ })
    .click();
  await page
    .getByRole("button", { name: /Phòng 1 Chưa có người thuê/ })
    .click();
  await page.getByRole("button", { name: "Sửa phòng", exact: true }).click();
  await page.getByLabel("Tên phòng", { exact: true }).fill("Room 101");
  await page
    .getByLabel("Giá thuê phòng / tháng (VNĐ)", { exact: true })
    .fill("3800000");
  await page.getByRole("button", { name: "Lưu phòng", exact: true }).click();
  await page
    .getByRole("heading", { name: "Sửa phòng" })
    .waitFor({ state: "hidden" });
  console.log("Property and room saved");
  await db.query(
    `insert into property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry) select id,organization_id,3500,20000,30000,70000,50000 from properties where name='Test Building'`,
  );
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Cài đặt", exact: true }).click();
  assert.equal(
    await page
      .getByLabel("Dịch vụ (đ/phòng/tháng)", { exact: true })
      .inputValue(),
    "100000",
  );
  assert.equal(
    await page.getByLabel("Rác (₫/phòng/tháng)", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByLabel("Wifi (₫/phòng/tháng)", { exact: true }).count(),
    0,
  );
  for (const [label, v] of [
    ["Điện (₫/kWh)", "3500"],
    ["Nước (₫/m³)", "20000"],
    ["Dịch vụ (đ/phòng/tháng)", "100000"],
    ["Máy giặt (₫/phòng/tháng)", "50000"],
  ])
    await page.getByLabel(label, { exact: true }).fill(v);
  await page.getByRole("button", { name: "Lưu đơn giá", exact: true }).click();
  await page
    .getByText("Đã lưu đơn giá cho Test Building", { exact: true })
    .waitFor();
  const mergedRate = (
    await db.query(
      `select trash,wifi from property_service_rates r join properties p on p.id=r.property_id where p.name='Test Building'`,
    )
  ).rows[0];
  assert.equal(Number(mergedRate.trash), 100000);
  assert.equal(Number(mergedRate.wifi), 0);
  await page.getByRole("button", { name: "Cấp quyền", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("viewer@test.invalid");
  await page.getByRole("button", { name: "Lưu lời mời" }).click();
  await page
    .getByRole("heading", { name: "Cấp quyền truy cập" })
    .waitFor({ state: "hidden" });
  console.log("Rates and invitation saved");
  await page.getByRole("button", { name: /^Căn hộ/ }).click();
  await page
    .getByRole("button", { name: /Test Building Test Address/ })
    .click();
  await page
    .getByRole("button", { name: /Room 101 Chưa có người thuê/ })
    .click();
  await page
    .getByRole("button", { name: "Thêm người thuê", exact: true })
    .click();
  await page.getByLabel("Họ tên", { exact: true }).fill("Test Tenant");
  await page.getByLabel("Giới tính", { exact: true }).selectOption("Nam");
  await page.getByLabel("Ngày sinh", { exact: true }).fill("1998-01-01");
  await page
    .getByLabel("Số CCCD (12 chữ số)", { exact: true })
    .fill("012345678901");
  await page.getByLabel("Số điện thoại", { exact: true }).fill("0901234567");
  await page
    .getByRole("button", { name: "Lưu người thuê", exact: true })
    .click();
  await page
    .getByText("Phòng trống cần ghi chỉ số lúc nhận phòng", { exact: true })
    .first()
    .waitFor();
  await page
    .getByLabel("Điện · chỉ số lúc nhận phòng", { exact: true })
    .fill("1240");
  await page
    .getByLabel("Nước · chỉ số lúc nhận phòng", { exact: true })
    .fill("86");
  await page
    .getByRole("button", { name: "Lưu người thuê", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Thêm người thuê" })
    .waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Tải lên", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "test-contract.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF"),
  });
  await page.getByLabel("Ngày kết thúc", { exact: true }).fill("2027-12-31");
  await page
    .getByRole("button", { name: "Tải lên và lưu", exact: true })
    .click();
  await page
    .getByRole("heading", { name: /Lưu hợp đồng/ })
    .waitFor({ state: "hidden" });
  await page.getByText("test-contract.pdf", { exact: true }).waitFor();
  console.log("Tenant and contract saved");
  const groupingProperty = (
    await db.query(
      "select id,organization_id from properties where name='Test Building'",
    )
  ).rows[0];
  const groupingRoom = (
    await db.query("select id from rooms where property_id=$1", [
      groupingProperty.id,
    ])
  ).rows[0].id;
  await db.query(
    `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,move_out,electricity_initial,water_initial) values($1,$2,'Past Tenant','Nam','1998-01-01','012345678902','0909876543','2000-01-01','2000-02-01',0,0),($1,$2,'Future Tenant','Nữ','1998-01-01','012345678903','0901234568','2099-01-01',null,0,0)`,
    [groupingProperty.organization_id, groupingRoom],
  );
  const groupPropertyId = (
    await db.query(
      `select public.create_property($1,'Grouping Building','Group Address',0,1) as id`,
      [groupingProperty.organization_id],
    )
  ).rows[0].id;
  const groupRoomId = (
    await db.query("select id from rooms where property_id=$1", [
      groupPropertyId,
    ])
  ).rows[0].id;
  await db.query(
    `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Group Tenant','Nam','1998-01-01','012345678904','0901234569','2000-01-01',0,0)`,
    [groupingProperty.organization_id, groupRoomId],
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Người thuê", exact: true }).click();
  await page.getByText("Group Tenant", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Lọc trạng thái người thuê").inputValue(),
    "Đang ở",
  );
  assert.equal(await page.getByText("Past Tenant", { exact: true }).count(), 0);
  assert.equal(
    await page.getByText("Future Tenant", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("region", { name: "Test Building · Room 101", exact: true })
    .getByText("Test Tenant", { exact: true })
    .waitFor();
  await page
    .getByRole("region", { name: "Grouping Building · Phòng 1", exact: true })
    .getByText("Group Tenant", { exact: true })
    .waitFor();
  await page
    .getByLabel("Lọc căn hộ người thuê")
    .selectOption(groupingProperty.id);
  assert.equal(
    await page.getByText("Group Tenant", { exact: true }).count(),
    0,
  );
  await page.getByLabel("Lọc phòng người thuê").selectOption(groupingRoom);
  await page
    .getByLabel("Lọc trạng thái người thuê")
    .selectOption("Đã chuyển đi");
  await page.getByText("Past Tenant", { exact: true }).waitFor();
  assert.equal(await page.getByText("Test Tenant", { exact: true }).count(), 0);
  await page.getByLabel("Lọc trạng thái người thuê").selectOption("Sắp vào ở");
  await page.getByText("Future Tenant", { exact: true }).waitFor();
  await page.getByLabel("Lọc trạng thái người thuê").selectOption("Tất cả");
  await page.getByLabel("Tìm người thuê").fill("090987");
  await page.getByText("Past Tenant", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("Future Tenant", { exact: true }).count(),
    0,
  );
  await page.getByLabel("Tìm người thuê").fill("no-matching-tenant");
  await page
    .getByRole("heading", { name: "Không có người thuê phù hợp" })
    .waitFor();
  await page.getByLabel("Tìm người thuê").fill("");
  await page.getByLabel("Lọc căn hộ người thuê").selectOption(groupPropertyId);
  assert.equal(await page.getByLabel("Lọc phòng người thuê").inputValue(), "");
  await page.getByLabel("Lọc trạng thái người thuê").selectOption("Đang ở");
  await page.getByText("Group Tenant", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /^Căn hộ/ }).click();
  await page
    .getByRole("button", { name: /Test Building Test Address/ })
    .click();
  await page.getByRole("button", { name: /Room 101 1 người đang ở/ }).click();
  console.log("Tenant status filters and property/room grouping passed");

  assert.equal(
    await page.getByLabel("Điện · chỉ số cũ", { exact: true }).inputValue(),
    "1240",
  );
  assert.equal(
    await page.getByLabel("Nước · chỉ số cũ", { exact: true }).inputValue(),
    "86",
  );
  assert.equal(
    await page
      .getByLabel("Điện · chỉ số cũ", { exact: true })
      .getAttribute("readonly"),
    "",
  );
  for (const [label, v] of [
    ["Điện · chỉ số mới (3.500 ₫/kWh)", "1325"],
    ["Nước · chỉ số mới (20.000 ₫/m³)", "92"],
  ])
    await page.getByLabel(label, { exact: true }).fill(v);
  await page.getByRole("button", { name: "Lập hóa đơn", exact: true }).click();
  await page.getByText("Đã lập hóa đơn", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Người thuê", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Hóa đơn", exact: true }).count(),
    0,
  );
  await page
    .getByRole("region", { name: "Hóa đơn và thu tiền", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Thu tiền", exact: true }).click();
  await page
    .getByLabel("Số tiền thanh toán (VNĐ)", { exact: true })
    .fill("1000000");
  await page
    .getByRole("button", { name: "Ghi nhận thanh toán", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Ghi nhận thu tiền" })
    .waitFor({ state: "hidden" });
  await page.getByText("3.367.500 ₫", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "Lịch sử sử dụng dịch vụ", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Tổng quan", exact: true }).click();
  await page.getByText("1.000.000 ₫", { exact: true }).first().waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("1.000.000 ₫", { exact: true }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "/tmp/hh-real-dashboard-mobile.png",
    fullPage: true,
  });
  // Real account data across compact phones, Android/iPhone sizes, landscape and tablet.
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    for (const label of ["Tổng quan", "Người thuê", "Cài đặt", "Căn hộ"]) {
      if (
        await page
          .getByRole("button", { name: "Mở menu", exact: true })
          .isVisible()
      ) {
        await page
          .getByRole("button", { name: "Mở menu", exact: true })
          .click();
        await page.locator(".sidebar.open").waitFor();
        await page.waitForTimeout(250);
      }
      await page
        .getByRole("button", {
          name: label === "Căn hộ" ? /^Căn hộ/ : label,
          exact: true,
        })
        .click();
      await page.waitForTimeout(250);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${label} overflow at ${viewport.width}`,
      );
    }
    await page
      .getByRole("button", { name: "Thêm căn hộ", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page.evaluate(() => {
        const r = document
          .querySelector('[role="dialog"]')
          .getBoundingClientRect();
        return (
          r.left >= 0 &&
          r.right <= innerWidth &&
          r.top >= 0 &&
          r.bottom <= innerHeight
        );
      }),
      true,
      `dialog bounds at ${viewport.width}`,
    );
    const input = page.getByRole("dialog").locator("input").first();
    if (viewport.width <= 700)
      assert.ok(
        Number.parseFloat(
          await input.evaluate((el) => getComputedStyle(el).fontSize),
        ) >= 16,
      );
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  console.log(
    "PASS: mobile layouts at 320/360/375/390/430px, landscape 844px, tablet 768px; forms, navigation, invoices and settings",
  );
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("button", { name: /Test Owner Đăng xuất/ }).click();
  await page.getByLabel("Email", { exact: true }).fill("viewer@test.invalid");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: /Nhận lời mời cho viewer/ }).click();
  await page.getByRole("heading", { name: "Xin chào, Viewer" }).waitFor();
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("button", { name: /^Căn hộ/ }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Thêm căn hộ", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: /Test Building Test Address/ })
    .click();
  assert.equal(
    await page.getByRole("button", { name: "Thêm phòng", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: /Room 101 1 người đang ở/ }).click();
  assert.equal(
    await page.getByRole("button", { name: "Sửa phòng", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Tải lên", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Lập hóa đơn", exact: true })
      .count(),
    0,
  );
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Xem", exact: true }).click();
  const popup = await opened;
  await popup.waitForURL(/object\/sign\/contracts/);
  await popup.close();
  await page.getByRole("button", { name: "Quay lại", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Xóa căn hộ", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("button", { name: /Test Viewer Đăng xuất/ }).click();
  await page.getByLabel("Email", { exact: true }).fill("owner@test.invalid");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("heading", { name: "Xin chào, Owner" }).waitFor();
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("button", { name: /^Căn hộ/ }).click();
  await page.getByRole("button", { name: "Thêm căn hộ", exact: true }).click();
  await page.getByLabel("Tên căn hộ", { exact: true }).fill("Delete UI");
  await page.getByLabel("Địa chỉ", { exact: true }).fill("Address");
  await page.getByLabel("Số phòng", { exact: true }).fill("1");
  await page
    .getByLabel("Giá thuê căn hộ / tháng (VNĐ)", { exact: true })
    .fill("0");
  await page
    .getByRole("button", { name: "Thêm căn hộ", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: /Delete UI Address/ }).click();
  await page.getByRole("button", { name: "Xóa căn hộ", exact: true }).click();
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  await page.getByRole("heading", { name: "Delete UI", exact: true }).waitFor();
  await page.getByRole("button", { name: "Xóa căn hộ", exact: true }).click();
  await page.getByLabel("Nhập chính xác tên căn hộ để xác nhận").fill("wrong");
  await page.getByRole("button", { name: "Xác nhận xóa căn hộ" }).click();
  await page.getByText("Tên xác nhận phải khớp chính xác tên căn hộ").waitFor();
  await page
    .getByLabel("Nhập chính xác tên căn hộ để xác nhận")
    .fill("Delete UI");
  await page.getByRole("button", { name: "Xác nhận xóa căn hộ" }).click();
  await page
    .getByRole("heading", { name: "Căn hộ của bạn", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: /Delete UI Address/ }).count(),
    0,
  );
  // Two original occupants share documents; leaving archives their own access without
  // removing the remaining occupant's room documents or transferring them to a newcomer.
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false)`,
  );
  const archiveOrg = (await db.query(`select id from organizations limit 1`))
    .rows[0].id;
  const archiveProperty = (
    await db.query(
      `select public.create_property($1,'Archive Building','History Address',0,1) as id`,
      [archiveOrg],
    )
  ).rows[0].id;
  const archiveRoom = (
    await db.query(`select id from rooms where property_id=$1`, [
      archiveProperty,
    ])
  ).rows[0].id;
  await db.query(
    `insert into property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry) values($1,$2,1000,5000,0,0,0)`,
    [archiveProperty, archiveOrg],
  );
  const participants = (
    await db.query(
      `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Archive A','Nam','1990-01-01','123456789001','0901234567','2000-01-01',0,0),($1,$2,'Archive B','Nữ','1990-01-01','123456789002','0901234568','2000-01-01',0,0) returning id`,
      [archiveOrg, archiveRoom],
    )
  ).rows;
  const archiveInvoice = (
    await db.query(
      `select public.create_invoice($1,$2,'2020-01-01','2020-01-05',0,10,0,1) as id`,
      [archiveOrg, archiveRoom],
    )
  ).rows[0].id;
  const archivePath = archiveOrg + "/" + archiveRoom + "/shared-history.pdf";
  await db.query(
    `insert into storage.objects(bucket_id,name) values('contracts',$1)`,
    [archivePath],
  );
  await db.query(
    `insert into contracts(organization_id,room_id,file_name,storage_path,starts_on,ends_on) values($1,$2,'shared-history.pdf',$3,'2000-01-01','2099-01-01')`,
    [archiveOrg, archiveRoom, archivePath],
  );
  await db.query(`select public.record_payment($1,$2,1000)`, [
    archiveOrg,
    archiveInvoice,
  ]);
  await page.reload();
  await page.getByRole("heading", { name: "Xin chào, Owner" }).waitFor();
  const goToArchiveRoom = async (people) => {
    await page.getByRole("button", { name: "Mở menu" }).click();
    await page.getByRole("button", { name: /^Căn hộ/ }).click();
    await page
      .getByRole("button", { name: /Archive Building History Address/ })
      .click();
    await page
      .getByRole("button", {
        name: people
          ? new RegExp("Phòng 1 " + people + " người đang ở")
          : /Phòng 1 Chưa có người thuê/,
      })
      .click();
  };
  const leave = async (name) => {
    await page.locator(".tenant-row").filter({ hasText: name }).click();
    await page
      .getByRole("button", { name: "Ghi nhận chuyển đi", exact: true })
      .click();
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await page
      .getByRole("heading", { name: "Người thuê", exact: true })
      .waitFor();
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .waitFor({ state: "hidden" });
    await page
      .getByRole("heading", { name: "Ghi nhận chuyển đi", exact: true })
      .waitFor({ state: "hidden" });
  };
  const inspectArchive = async (name) => {
    await page
      .getByLabel("Lọc trạng thái người thuê")
      .selectOption("Đã chuyển đi");
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Chi tiết" })
      .click();
    await page
      .getByRole("button", { name: "Xem hợp đồng", exact: true })
      .waitFor();
    const opened = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Xem hợp đồng", exact: true })
      .click();
    const popup = await opened;
    await popup.waitForURL(/object\/sign\/contracts/);
    await popup.close();
    await page
      .getByRole("button", { name: "Xem hóa đơn", exact: true })
      .click();
    await page.getByRole("heading", { name: "Lịch sử thanh toán" }).waitFor();
    await page
      .getByRole("button", { name: "Quay lại hồ sơ người thuê" })
      .click();
    await page.getByRole("button", { name: "Đóng" }).click();
  };
  await goToArchiveRoom(2);
  await leave("Archive A");
  assert.equal(await page.getByText("Archive A", { exact: true }).count(), 0);
  await inspectArchive("Archive A");
  await goToArchiveRoom(1);
  await page.getByText("shared-history.pdf", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Hóa đơn người đang ở" }).waitFor();
  await page
    .getByRole("region", { name: "Hóa đơn người đang ở", exact: true })
    .getByRole("button", { name: /Phòng 1 · Archive Building/ })
    .waitFor();
  assert.equal(
    await page.locator(".tenant-row").filter({ hasText: "Archive A" }).count(),
    0,
  );
  await leave("Archive B");
  await inspectArchive("Archive B");
  await goToArchiveRoom(0);
  assert.equal(
    await page.getByText("shared-history.pdf", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("region", { name: "Hóa đơn người đang ở", exact: true })
      .getByRole("button", { name: /Phòng 1 · Archive Building/ })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Tải lên", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    (
      await db.query(`select * from payments where invoice_id=$1`, [
        archiveInvoice,
      ])
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(`select * from storage.objects where name=$1`, [
        archivePath,
      ])
    ).rows.length,
    1,
  );
  const newcomer = (
    await db.query(
      `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Archive New','Nam','1990-01-01','123456789003','0901234569','2001-01-01',0,0) returning id`,
      [archiveOrg, archiveRoom],
    )
  ).rows[0].id;
  await page.reload();
  await page.getByRole("heading", { name: "Xin chào, Owner" }).waitFor();
  await goToArchiveRoom(1);
  assert.equal(
    await page.getByText("shared-history.pdf", { exact: true }).count(),
    0,
  );
  await page.locator(".tenant-row").filter({ hasText: "Archive New" }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Xem hợp đồng", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Xem hóa đơn", exact: true })
      .count(),
    0,
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
  await page.getByRole("button", { name: "Đóng" }).click();
  await page.getByRole("button", { name: "Quay lại", exact: true }).click();
  await page.getByRole("button", { name: "Xóa căn hộ", exact: true }).click();
  await page
    .getByLabel("Nhập chính xác tên căn hộ để xác nhận")
    .fill("Archive Building");
  await page.getByRole("button", { name: "Xác nhận xóa căn hộ" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Căn hộ còn người đang ở" })
    .waitFor();
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  await page.getByRole("button", { name: /Phòng 1 1 người đang ở/ }).click();
  await leave("Archive New");
  await goToArchiveRoom(0);
  await page.getByRole("button", { name: "Quay lại", exact: true }).click();
  await page.getByRole("button", { name: "Xóa căn hộ", exact: true }).click();
  await page
    .getByLabel("Nhập chính xác tên căn hộ để xác nhận")
    .fill("Archive Building");
  await page.getByRole("button", { name: "Xác nhận xóa căn hộ" }).click();
  await page
    .getByRole("heading", { name: "Căn hộ của bạn", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /Archive Building History Address/ })
      .count(),
    0,
  );
  assert.equal(
    (
      await db.query(
        `select * from properties where id=$1 and deleted_at is not null`,
        [archiveProperty],
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (await db.query(`select * from invoices where id=$1`, [archiveInvoice]))
      .rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(`select * from payments where invoice_id=$1`, [
        archiveInvoice,
      ])
    ).rows.length,
    1,
  );
  await page.reload();
  await page.getByRole("heading", { name: "Xin chào, Owner" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /Archive Building History Address/ })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("button", { name: "Cài đặt", exact: true }).click();
  assert.equal(
    await page
      .getByRole("region", { name: "Đơn giá dịch vụ · Archive Building" })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("button", { name: "Người thuê", exact: true }).click();
  await inspectArchive("Archive A");
  await page
    .getByRole("heading", { name: "Archive Building · Đã xóa" })
    .waitFor();
  await page
    .getByRole("row")
    .filter({ hasText: "Archive A" })
    .getByRole("button", { name: "Chi tiết" })
    .click();
  await page.getByRole("button", { name: "Sửa hồ sơ", exact: true }).click();
  assert.equal(
    await page.getByLabel("Phòng", { exact: true }).inputValue(),
    archiveRoom,
  );
  await page.getByLabel("Số điện thoại", { exact: true }).fill("0901234560");
  await page
    .getByRole("button", { name: "Lưu người thuê", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Cập nhật người thuê", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(
    (
      await db.query(`select phone from tenants where id=$1`, [
        participants[0].id,
      ])
    ).rows[0].phone,
    "0901234560",
  );
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("button", { name: "Người thuê", exact: true }).click();
  assert.equal(
    await page
      .getByRole("region", { name: "Lịch sử sử dụng dịch vụ", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.getByLabel("Ảnh điện", { exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const arrivalProperty = (
    await db.query(
      `select public.create_property($1,'Arrival Building','Meter Address',0,1) as id`,
      [archiveOrg],
    )
  ).rows[0].id;
  const arrivalRoom = (
    await db.query(`select id from rooms where property_id=$1`, [
      arrivalProperty,
    ])
  ).rows[0].id;
  await db.query(
    `insert into property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry) values($1,$2,1000,5000,0,0,0)`,
    [arrivalProperty, archiveOrg],
  );
  const firstArrival = (
    await db.query(
      `insert into tenants(organization_id,room_id,full_name,gender,birth_date,identity_number,phone,move_in,electricity_initial,water_initial) values($1,$2,'Arrival First','Nam','1990-01-01','323456789001','0901234567','2000-01-01',0,0) returning id,billing_cycle_id`,
      [archiveOrg, arrivalRoom],
    )
  ).rows[0];
  await db.query(
    `select public.create_cycle_invoice($1,$2,$3,'2020-01-01','2020-01-05',0,10,0,1)`,
    [archiveOrg, arrivalRoom, firstArrival.billing_cycle_id],
  );
  await page.reload();
  await page.getByRole("heading", { name: "Xin chào, Owner" }).waitFor();
  const goToArrivalRoom = async (count) => {
    if (await page.getByRole("button", { name: "Mở menu" }).isVisible())
      await page.getByRole("button", { name: "Mở menu" }).click();
    await page.getByRole("button", { name: /^Căn hộ/ }).click();
    await page
      .getByRole("button", { name: /Arrival Building Meter Address/ })
      .click();
    await page
      .getByRole("button", {
        name: count
          ? new RegExp("Phòng 1 " + count + " người đang ở")
          : /Phòng 1 Chưa có người thuê/,
      })
      .click();
  };
  const enterPerson = async (name, identity) => {
    await page
      .getByRole("button", { name: "Thêm người thuê", exact: true })
      .click();
    await page.getByLabel("Họ tên", { exact: true }).fill(name);
    await page.getByLabel("Giới tính", { exact: true }).selectOption("Nam");
    await page.getByLabel("Ngày sinh", { exact: true }).fill("1990-01-01");
    await page
      .getByLabel("Số CCCD (12 chữ số)", { exact: true })
      .fill(identity);
    await page.getByLabel("Số điện thoại", { exact: true }).fill("0901234567");
  };
  await goToArrivalRoom(1);
  await enterPerson("Arrival Shared", "323456789002");
  assert.equal(
    await page
      .getByLabel("Điện · chỉ số lúc nhận phòng", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByLabel("Nước · chỉ số lúc nhận phòng", { exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Lưu người thuê", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Thêm người thuê", exact: true })
    .waitFor({ state: "hidden" });
  await page
    .locator(".tenant-row")
    .filter({ hasText: "Arrival Shared" })
    .waitFor();
  assert.equal(
    (
      await db.query(
        `select billing_cycle_id from tenants where full_name='Arrival Shared'`,
      )
    ).rows[0].billing_cycle_id,
    firstArrival.billing_cycle_id,
  );
  await leave("Arrival Shared");
  await goToArrivalRoom(1);
  await leave("Arrival First");
  await goToArrivalRoom(0);
  await page.getByText("Trống", { exact: true }).waitFor();
  await page
    .getByLabel("Đợt thuê lập hóa đơn")
    .selectOption(firstArrival.billing_cycle_id);
  await enterPerson("Arrival New", "323456789003");
  await page
    .getByLabel("Điện · chỉ số lúc nhận phòng", { exact: true })
    .fill("20");
  await page
    .getByLabel("Nước · chỉ số lúc nhận phòng", { exact: true })
    .fill("2");
  await page
    .getByRole("button", { name: "Lưu người thuê", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Thêm người thuê", exact: true })
    .waitFor({ state: "hidden" });
  await page
    .locator(".tenant-row")
    .filter({ hasText: "Arrival New" })
    .waitFor();
  const newArrival = (
    await db.query(
      `select id,billing_cycle_id from tenants where full_name='Arrival New'`,
    )
  ).rows[0];
  assert.notEqual(newArrival.billing_cycle_id, firstArrival.billing_cycle_id);
  assert.equal(
    await page.getByLabel("Điện · chỉ số cũ", { exact: true }).inputValue(),
    "20",
  );
  assert.equal(
    await page.getByLabel("Nước · chỉ số cũ", { exact: true }).inputValue(),
    "2",
  );
  // Settle the old cycle, then the new cycle in the same calendar month.
  await page
    .getByLabel("Đợt thuê lập hóa đơn")
    .selectOption(firstArrival.billing_cycle_id);
  assert.equal(
    await page.getByLabel("Điện · chỉ số cũ", { exact: true }).inputValue(),
    "10",
  );
  await page
    .getByLabel("Điện · chỉ số mới (1.000 ₫/kWh)", { exact: true })
    .fill("20");
  await page
    .getByLabel("Nước · chỉ số mới (5.000 ₫/m³)", { exact: true })
    .fill("2");
  await page.getByRole("button", { name: "Lập hóa đơn", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("input[name=electricity_old]")?.value === "20",
  );
  await page
    .getByLabel("Đợt thuê lập hóa đơn")
    .selectOption(newArrival.billing_cycle_id);
  assert.equal(
    await page.getByLabel("Điện · chỉ số cũ", { exact: true }).inputValue(),
    "20",
  );
  await page
    .getByLabel("Điện · chỉ số mới (1.000 ₫/kWh)", { exact: true })
    .fill("23");
  await page
    .getByLabel("Nước · chỉ số mới (5.000 ₫/m³)", { exact: true })
    .fill("3");
  await page.getByRole("button", { name: "Lập hóa đơn", exact: true }).click();
  await page.getByText("Đã lập hóa đơn", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "Lịch sử sử dụng dịch vụ", exact: true })
      .count(),
    0,
  );
  const newArrivalBill = (
    await db.query(`select * from invoices where billing_cycle_id=$1`, [
      newArrival.billing_cycle_id,
    ])
  ).rows[0];
  assert.equal(Number(newArrivalBill.total), 8000);
  assert.deepEqual(
    (
      await db.query(
        `select tenant_id from invoice_tenants where invoice_id=$1`,
        [newArrivalBill.id],
      )
    ).rows,
    [{ tenant_id: newArrival.id }],
  );
  const periodBills = (
    await db.query(`select * from invoices where room_id=$1 and period=$2`, [
      arrivalRoom,
      newArrivalBill.period,
    ])
  ).rows;
  assert.equal(periodBills.length, 2);
  await db.exec("reset role");
  await db.query(
    `insert into memberships(organization_id,user_id,role,display_name,email) values($1,$2,'viewer','Delete Test','viewer@test.invalid') on conflict(organization_id,user_id) do update set display_name='Delete Test'`,
    [archiveOrg, vid],
  );
  await db.exec("set role authenticated");
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByLabel("Không gian quản lý", { exact: true })
    .selectOption(archiveOrg);
  await page.getByRole("button", { name: "Cài đặt", exact: true }).click();
  await page
    .getByRole("button", { name: "Xóa người dùng Delete Test", exact: true })
    .click();
  await page
    .getByLabel("Nhập email người dùng để xác nhận")
    .fill("wrong@test.invalid");
  await page
    .getByRole("button", { name: "Xác nhận xóa người dùng", exact: true })
    .click();
  await page.getByText("Email xác nhận không khớp", { exact: true }).waitFor();
  await page
    .getByLabel("Nhập email người dùng để xác nhận")
    .fill("viewer@test.invalid");
  await page
    .getByRole("button", { name: "Xác nhận xóa người dùng", exact: true })
    .click();
  await page
    .getByText("Đã xóa quyền truy cập của người dùng", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Xóa người dùng Delete Test", exact: true })
      .count(),
    0,
  );
  assert.equal(
    (
      await db.query(
        `select * from memberships where organization_id=$1 and user_id=$2`,
        [archiveOrg, vid],
      )
    ).rows.length,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: login, empty database, workspace, property rent, room rent, service rates, invitation, tenant, contract upload, invoice, partial payment, reload persistence, mobile layout, viewer permissions, shared document archive after departure, newcomer isolation, vacant property deletion with retained tenant/payment history, service history panel removed, vacancy states and move-in baselines, shared occupancy without reset, same-month separate cycles. Backend = local PostgreSQL with real migration; Auth/Storage HTTP simulated.",
  );
  await browser.close();
  await db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
