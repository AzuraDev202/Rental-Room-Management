import { supabase } from "./supabase";
import { emptyData, type Data } from "./types";
export function databaseError(error: {
  message: string;
  code?: string;
}): Error {
  if (error.code === "23505")
    return new Error("Thông tin đã tồn tại (tên, CCCD hoặc kỳ hóa đơn).");
  if (error.code === "23503")
    return new Error(
      "Thông tin liên quan không tồn tại hoặc không cùng không gian quản lý.",
    );
  if (error.code === "42501")
    return new Error("Bạn không có quyền thực hiện thao tác này.");
  if (error.code === "23514")
    return new Error("Dữ liệu không hợp lệ. Vui lòng kiểm tra lại các trường.");
  return new Error(error.message);
}
export async function rows(table: string, org: string) {
  const output: Record<string, unknown>[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabase!
      .from(table)
      .select("*")
      .eq("organization_id", org)
      .order(
        table === "memberships"
          ? "user_id"
          : table === "property_service_rates"
            ? "property_id"
            : "id",
      )
      .range(start, start + 499);
    if (error) throw databaseError(error);
    output.push(...data);
    if (data.length < 500) break;
  }
  return output;
}
export async function loadData(org: string, admin: boolean): Promise<Data> {
  const tables = [
    "properties",
    "rooms",
    "tenants",
    "property_service_rates",
    "invoices",
    "payments",
    "contracts",
    "memberships",
    ...(admin ? ["invitations"] : []),
  ];
  const result = await Promise.all(tables.map((t) => rows(t, org)));
  return {
    properties: result[0],
    rooms: result[1],
    tenants: result[2],
    rates: result[3],
    invoices: result[4],
    payments: result[5],
    contracts: result[6],
    members: result[7],
    invitations: result[8] || [],
  } as unknown as Data;
}
export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase!.rpc(name, args);
  if (error) throw databaseError(error);
  return data;
}
export async function insert(table: string, values: Record<string, unknown>) {
  const { error } = await supabase!.from(table).insert(values);
  if (error) throw databaseError(error);
}
export async function update(
  table: string,
  id: string,
  org: string,
  values: Record<string, unknown>,
) {
  const { data, error } = await supabase!
    .from(table)
    .update(values)
    .eq("id", id)
    .eq("organization_id", org)
    .select("id");
  if (error) throw databaseError(error);
  if (!data?.length)
    throw new Error(
      "Không thể cập nhật: dữ liệu không tồn tại hoặc bạn không có quyền.",
    );
}
export { emptyData };
