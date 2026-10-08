"use client";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { money } from "../lib/business";
export function RevenueChart({
  data,
}: {
  data: { month: string; revenue: number }[];
}) {
  return (
    <div className="real-chart">
      <ResponsiveContainer width="100%" height={270}>
        <AreaChart
          data={data}
          margin={{ top: 15, right: 18, left: 2, bottom: 5 }}
        >
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#27755c" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#27755c" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="#e5eae2"
          />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fill: "#8b9788" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, (max: number) => Math.max(1000000, max)]}
            tickFormatter={(n) =>
              `${(Number(n) / 1000000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}tr`
            }
            tick={{ fontSize: 10, fill: "#8b9788" }}
            axisLine={false}
            tickLine={false}
            width={58}
          />
          <Tooltip
            formatter={(v) => [money(Number(v)), "Thực thu"]}
            contentStyle={{
              borderRadius: 9,
              borderColor: "#e8ece6",
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            isAnimationActive={false}
            dataKey="revenue"
            stroke="#27755c"
            strokeWidth={2.5}
            fill="url(#revenueFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
      {!data.some((d) => d.revenue > 0) && (
        <p className="chart-empty">
          Chưa có khoản thu trong năm này. Biểu đồ sẽ cập nhật khi ghi nhận
          thanh toán.
        </p>
      )}
    </div>
  );
}
