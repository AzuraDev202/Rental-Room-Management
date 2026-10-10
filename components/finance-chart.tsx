"use client";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { money } from "../lib/business";
export default function FinanceChart({
  data,
}: {
  data: { month: string; revenue: number; expense: number; profit: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis tickFormatter={(v) => `${Number(v) / 1000000}tr`} />
        <Tooltip formatter={(v) => money(Number(v))} />
        <Legend />
        <Bar dataKey="revenue" name="Thực thu" fill="#3b8e70" />
        <Bar dataKey="expense" name="Thực chi" fill="#ca8157" />
        <Line dataKey="profit" name="Lợi nhuận" stroke="#7b85cc" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
