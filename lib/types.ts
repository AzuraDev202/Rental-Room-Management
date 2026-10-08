export type Role = "admin" | "manager" | "viewer";
export type Membership = {
  organization_id: string;
  user_id: string;
  role: Role;
  display_name: string;
  email: string;
};
export type Property = {
  id: string;
  organization_id: string;
  name: string;
  address: string;
  monthly_rent: number;
};
export type Room = {
  id: string;
  organization_id: string;
  property_id: string;
  name: string;
  monthly_rent: number;
};
export type Tenant = {
  id: string;
  organization_id: string;
  room_id: string;
  full_name: string;
  gender: string;
  birth_date: string;
  identity_number: string;
  phone: string;
  email: string | null;
  move_in: string;
  move_out: string | null;
};
export type Rates = {
  property_id: string;
  organization_id: string;
  electricity: number;
  water: number;
  trash: number;
  wifi: number;
  laundry: number;
};
export type Invoice = {
  id: string;
  organization_id: string;
  room_id: string;
  period: string;
  due_date: string;
  total: number;
  electricity_old: number;
  electricity_new: number;
  water_old: number;
  water_new: number;
  electricity_rate: number;
  water_rate: number;
  room_rent: number;
  trash_fee: number;
  wifi_fee: number;
  laundry_fee: number;
};
export type Payment = {
  id: string;
  invoice_id: string;
  amount: number;
  paid_at: string;
};
export type Contract = {
  id: string;
  organization_id: string;
  room_id: string;
  file_name: string;
  storage_path: string;
  starts_on: string;
  ends_on: string;
};
export type Invitation = {
  id: string;
  email: string;
  role: "manager" | "viewer";
};
export type Data = {
  properties: Property[];
  rooms: Room[];
  tenants: Tenant[];
  rates: Rates[];
  invoices: Invoice[];
  payments: Payment[];
  contracts: Contract[];
  members: Membership[];
  invitations: Invitation[];
};
export const emptyData: Data = {
  properties: [],
  rooms: [],
  tenants: [],
  rates: [],
  invoices: [],
  payments: [],
  contracts: [],
  members: [],
  invitations: [],
};
