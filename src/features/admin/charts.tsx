"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";

/** Daily gross sales from stored, non-cancelled orders. */
export function SalesChart({
  data,
  currency,
  locale,
}: {
  data: { day: string; orders: number; grossMinor: number }[];
  currency: string;
  locale: string;
}) {
  const total = data.reduce((sum, point) => sum + point.grossMinor, 0);
  if (total === 0) return <p className="py-10 text-center text-sm text-stone-500">No sales recorded in this period.</p>;
  const rows = data.map((point) => ({ ...point, label: point.day.slice(5) }));
  return (
    <figure>
      <div className="h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#78716c" }} />
            <YAxis
              tick={{ fontSize: 12, fill: "#78716c" }}
              tickFormatter={(value: number) => formatMoney(value, currency, locale).replace(/\.\d+$/, "")}
              width={80}
            />
            <Tooltip
              formatter={(value) => [formatMoney(Number(value), currency, locale), "Gross sales"]}
              labelFormatter={(label) => `Date: ${String(label)}`}
            />
            <Line type="monotone" dataKey="grossMinor" stroke="#b4462a" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        Daily gross sales: {data.map((point) => `${point.day} ${formatMoney(point.grossMinor, currency, locale)}`).join("; ")}
      </figcaption>
    </figure>
  );
}

/** Top items by quantity sold. */
export function TopItemsChart({ data }: { data: { name: string; quantity: number }[] }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-stone-500">No items sold in this period.</p>;
  return (
    <figure>
      <div className="h-72" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#78716c" }} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12, fill: "#44403c" }} />
            <Tooltip formatter={(value) => [String(value), "Quantity"]} />
            <Bar dataKey="quantity" fill="#d45a32" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">Top items: {data.map((item) => `${item.name} ${item.quantity}`).join("; ")}</figcaption>
    </figure>
  );
}
