import { z } from "zod";
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Vui lòng nhập thông tin")
    .max(max, `Tối đa ${max} ký tự`);
const amount = z.preprocess(
  (v) => (v === "" || v === null ? NaN : v),
  z.coerce
    .number({ invalid_type_error: "Vui lòng nhập số hợp lệ" })
    .int("Nhập số nguyên VNĐ")
    .min(0, "Không được âm")
    .max(1_000_000_000_000, "Số tiền quá lớn"),
);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Chọn ngày hợp lệ")
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Ngày không hợp lệ",
  );
export const propertySchema = z.object({
  name: text(120),
  address: text(500),
  monthly_rent: amount,
  room_count: z.coerce
    .number({ invalid_type_error: "Vui lòng nhập số hợp lệ" })
    .int()
    .min(1, "Ít nhất 1 phòng")
    .max(100, "Tối đa 100 phòng"),
});
export const roomSchema = z.object({ name: text(80), monthly_rent: amount });
export const tenantSchema = z
  .object({
    room_id: z.string().uuid("Chọn phòng"),
    full_name: text(120),
    gender: z.enum(["Nam", "Nữ", "Khác"]),
    birth_date: date,
    identity_number: z.string().regex(/^\d{12}$/, "CCCD gồm 12 chữ số"),
    phone: z
      .string()
      .regex(/^0\d{9}$/, "Số điện thoại gồm 10 chữ số, bắt đầu bằng 0"),
    email: z.union([z.literal(""), z.string().email("Email không hợp lệ")]),
    move_in: date,
  })
  .refine((v) => v.birth_date <= v.move_in, {
    path: ["birth_date"],
    message: "Ngày sinh không được sau ngày vào ở",
  });
export const ratesSchema = z.object({
  electricity: amount,
  water: amount,
  water_mode: z.enum(["meter", "person"]).default("meter"),
  trash: amount,
  wifi: amount,
  laundry: amount,
});
const meter = z.preprocess(
  (v) => (v === "" || v === null ? NaN : v),
  z.coerce
    .number({ invalid_type_error: "Vui lòng nhập số hợp lệ" })
    .int("Chỉ số phải là số nguyên")
    .min(0, "Không được âm")
    .max(2147483647, "Chỉ số quá lớn"),
);
export const initialReadingsSchema = z.object({
  electricity_initial: meter,
  water_initial: meter,
});
export const addTenantSchema = (
  occupied: (room: string, day: string) => boolean,
  waterRequired: (room: string) => boolean = () => true,
) =>
  z.preprocess(
    (value) => {
      const v = value as Record<string, unknown>;
      if (
        v &&
        typeof v === "object" &&
        typeof v.room_id === "string" &&
        typeof v.move_in === "string" &&
        occupied(v.room_id, v.move_in)
      )
        return {
          ...v,
          electricity_initial: undefined,
          water_initial: undefined,
        };
      if (v && typeof v.room_id === "string" && !waterRequired(v.room_id))
        return { ...v, water_initial: 0 };
      return value;
    },
    tenantSchema
      .and(
        z.object({
          electricity_initial: z.preprocess(
            (v) => (v === "" || v === null ? undefined : v),
            meter.optional(),
          ),
          water_initial: z.preprocess(
            (v) => (v === "" || v === null ? undefined : v),
            meter.optional(),
          ),
        }),
      )
      .superRefine((v, ctx) => {
        if (!occupied(v.room_id, v.move_in))
          for (const key of ["electricity_initial", "water_initial"] as const)
            if (v[key] === undefined)
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [key],
                message: "Phòng trống cần ghi chỉ số lúc nhận phòng",
              });
      }),
  );
export const invoiceSchema = z
  .object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Chọn kỳ hóa đơn"),
    due_date: date,
    electricity_old: meter,
    electricity_new: meter,
    water_old: meter,
    water_new: meter,
  })
  .refine((v) => v.electricity_new >= v.electricity_old, {
    path: ["electricity_new"],
    message: "Chỉ số mới phải lớn hơn hoặc bằng chỉ số cũ",
  })
  .refine((v) => v.water_new >= v.water_old, {
    path: ["water_new"],
    message: "Chỉ số mới phải lớn hơn hoặc bằng chỉ số cũ",
  })
  .refine((v) => v.due_date >= v.period + "-01", {
    path: ["due_date"],
    message: "Hạn thanh toán không được trước kỳ hóa đơn",
  });
export const paymentSchema = z.object({
  amount: amount.refine((v) => v > 0, "Số tiền phải lớn hơn 0"),
});
export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Email không hợp lệ")
    .transform((s) => s.toLowerCase()),
  role: z.enum(["manager", "viewer"]),
});
export const workspaceSchema = z.object({
  workspace_name: text(120),
  member_name: text(120),
});
export const contractSchema = z
  .object({ starts_on: date, ends_on: date })
  .refine((v) => v.ends_on >= v.starts_on, {
    path: ["ends_on"],
    message: "Ngày kết thúc không được trước ngày bắt đầu",
  });

export const deletePropertySchema = (name: string) =>
  z.object({
    confirmation_name: z
      .string()
      .refine((v) => v === name, "Tên xác nhận phải khớp chính xác tên căn hộ"),
  });

export const depositSchema = z.object({
  kind: z.enum(["receive", "refund", "deduct"]),
  amount: amount.refine((v) => v > 0, "Số tiền phải lớn hơn 0"),
  happened_on: date.refine(
    (v) =>
      v <=
      new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }),
    "Ngày không được ở tương lai",
  ),
  note: text(500),
});
export const expenseSchema = z.object({
  property_id: z.string().uuid("Chọn căn hộ"),
  room_id: z.union([z.literal(""), z.string().uuid()]),
  amount: amount.refine((v) => v > 0, "Số tiền phải lớn hơn 0"),
  category: z.enum(["maintenance", "utilities", "operations", "other"]),
  title: text(120),
  paid_on: date,
});
export const maintenanceSchema = z.object({
  room_id: z.string().uuid("Chọn phòng"),
  title: text(120),
  description: z.string().max(2000),
  priority: z.enum(["low", "normal", "high"]),
});
