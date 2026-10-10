export type Role = "admin" | "manager" | "viewer";
export type Membership = {
  organization_id: string;
  user_id: string;
  role: Role;
  display_name: string;
  email: string;
};
export type Property = {
  deleted_at: string | null;
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
  was_scheduled: boolean;
  billing_cycle_id: string | null;
  electricity_initial: number | null;
  water_meter_on_arrival?: boolean;
  water_initial: number | null;
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
  water_mode?: "meter" | "person";
  trash: number;
  wifi: number;
  laundry: number;
};
export type Invoice = {
  billing_cycle_id: string | null;
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
  water_mode?: "meter" | "person";
  water_count?: number | null;
  water_unit_rate?: number | null;
  water_fee?: number;
  laundry_fee: number;
  laundry_rate?: number | null;
  laundry_count?: number | null;
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
export type InvoiceTenant = {
  id: string;
  organization_id: string;
  invoice_id: string;
  tenant_id: string;
};
export type ContractTenant = {
  id: string;
  organization_id: string;
  contract_id: string;
  tenant_id: string;
};
export type BillingCycle = {
  id: string;
  organization_id: string;
  room_id: string;
  starts_on: string;
  electricity_initial: number | null;
  water_initial: number | null;
  water_meter_ready?: boolean;
  is_legacy: boolean;
};
export type Data = {
  billingCycles: BillingCycle[];
  invoiceTenants: InvoiceTenant[];
  contractTenants: ContractTenant[];
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
  billingCycles: [],
  invoiceTenants: [],
  contractTenants: [],
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
