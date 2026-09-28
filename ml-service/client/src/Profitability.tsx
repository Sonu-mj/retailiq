import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
Bar,
BarChart,
CartesianGrid,
Legend,
Line,
LineChart,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis,
} from "recharts";
import { ArrowDown, ArrowUp, ChevronRight, Package, RotateCcw, TrendingUp, WalletCards, X } from "lucide-react";
import { api, type ApiResponse } from "./api";
import type { Role } from "./types";
import { formatINR } from "./utils";

type Catalog = ApiResponse<typeof api, "getCatalog">;
type ProfitResponse = ApiResponse<typeof api, "getProfitability">;
type Profit = ProfitResponse["outlets"][number];
type ProductMetric = Profit["top_revenue"][number];
type ProductView = "revenue" | "profit" | "margin" | "returns" | "wastage";
type OutletSort = "gross_sales" | "net_sales" | "gross_profit" | "operating_costs" | "net_profit" | "net_margin";
type ProductSort = "revenue" | "grossProfit" | "margin" | "returns" | "wastage";
type Direction = "asc" | "desc";
type ProductRow = {
  productId: string;
  name: string;
  categoryId: string;
  category: string;
  unitsSold: number | null;
  revenue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  margin: number | null;
  returns: number | null;
  wastage: number | null;
};

const pad = (value: number) => String(value).padStart(2, "0");
const inputDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dateBounds = (start: string, end: string) => ({ start: `${start}T00:00:00.000Z`, end: `${end}T23:59:59.999Z` });
const exactMoney = (value: number) => formatINR(value);
const compactMoney = (value: number) => {
  const sign = value < 0 ? "−" : "";
  const amount = Math.abs(value);
  if (amount >= 10_000_000) return `${sign}₹${(amount / 10_000_000).toFixed(amount >= 100_000_000 ? 0 : 1)}Cr`;
  if (amount >= 100_000) return `${sign}₹${(amount / 100_000).toFixed(amount >= 1_000_000 ? 1 : 2)}L`;
  if (amount >= 1_000) return `${sign}₹${(amount / 1_000).toFixed(amount >= 100_000 ? 0 : 1)}K`;
  return `${sign}₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
const shortDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const nullableNumber = (value: number | null) => value ?? Number.NEGATIVE_INFINITY;

function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={className} title={exactMoney(value)}>{compactMoney(value)}</span>;
}

function EmptyValue({ text = "Not available" }: { text?: string }) {
  return <span className="pf-na" title={text}>—</span>;
}

function SortLabel({ label, active, direction, onClick }: { label: string; active: boolean; direction: Direction; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{label}{active ? direction === "desc" ? <ArrowDown size={12}/> : <ArrowUp size={12}/> : null}</button>;
}

function Kpi({ label, value, tone = "", context }: { label: string; value: number; tone?: "positive" | "negative" | ""; context?: string }) {
  return <article className={`pf-kpi ${tone}`}>
    <span>{label}</span>
    <strong title={exactMoney(value)}>{compactMoney(value)}</strong>
    {context ? <small>{context}</small> : null}
  </article>;
}

function buildProducts(source: Profit, catalog: Catalog): ProductRow[] {
  const rows = new Map<string, ProductRow>();
  const ensure = (metric: ProductMetric) => {
    const product = catalog.products.find(item => item.id === metric.product_id);
    const category = catalog.categories.find(item => item.id === product?.category_id);
    const existing = rows.get(metric.product_id);
    if (existing) return existing;
    const row: ProductRow = {
      productId: metric.product_id,
      name: metric.product_name,
      categoryId: product?.category_id ?? "",
      category: category?.name ?? product?.category_name ?? "Uncategorized",
      unitsSold: null,
      revenue: null,
      cogs: null,
      grossProfit: null,
      margin: null,
      returns: null,
      wastage: null,
    };
    rows.set(metric.product_id, row);
    return row;
  };
  for (const metric of source.top_revenue) ensure(metric).revenue = metric.value;
  for (const metric of source.top_gross_profit) ensure(metric).grossProfit = metric.value;
  for (const metric of source.top_returns) ensure(metric).returns = metric.value;
  for (const metric of source.top_wastage) ensure(metric).wastage = metric.value;
  return [...rows.values()].map(row => {
    if (row.revenue !== null && row.grossProfit !== null) {
      row.cogs = row.revenue - row.grossProfit;
      row.margin = row.revenue > 0 ? row.grossProfit / row.revenue * 100 : 0;
    }
    return row;
  });
}

function ProductDrawer({ row, catalog, inventory, onClose }: {
  row: ProductRow;
  catalog: Catalog;
  inventory: ApiResponse<typeof api, "getInventory"> | undefined;
  onClose: () => void;
}) {
  const product = catalog.products.find(item => item.id === row.productId);
  const stock = inventory?.items.filter(item => item.product_id === row.productId) ?? [];
  const currentInventory = stock.reduce((sum, item) => sum + item.current_quantity, 0);
  const demandForecast = stock.reduce((sum, item) => sum + item.forecast_demand, 0);
  return <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="pf-drawer" role="dialog" aria-modal="true" aria-label={`${row.name} profitability details`}>
      <header>
        <div><span>PRODUCT DETAIL</span><h2>{row.name}</h2><p>{row.category}</p></div>
        <button aria-label="Close product details" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="pf-detail-grid">
        <div><span>Units sold</span>{row.unitsSold === null ? <EmptyValue/> : <strong>{row.unitsSold}</strong>}</div>
        <div><span>Revenue</span>{row.revenue === null ? <EmptyValue/> : <strong>{exactMoney(row.revenue)}</strong>}</div>
        <div><span>COGS</span>{row.cogs === null ? <EmptyValue/> : <strong>{exactMoney(row.cogs)}</strong>}</div>
        <div><span>Gross profit</span>{row.grossProfit === null ? <EmptyValue/> : <strong>{exactMoney(row.grossProfit)}</strong>}</div>
        <div><span>Margin</span>{row.margin === null ? <EmptyValue/> : <strong>{row.margin.toFixed(1)}%</strong>}</div>
        <div><span>Returns</span>{row.returns === null ? <EmptyValue text="Not in the five highest return values"/> : <strong>{exactMoney(row.returns)}</strong>}</div>
        <div><span>Return rate</span>{row.returns === null || row.revenue === null || row.revenue <= 0 ? <EmptyValue/> : <strong>{(row.returns / row.revenue * 100).toFixed(1)}%</strong>}</div>
        <div><span>Wastage cost</span>{row.wastage === null ? <EmptyValue text="Not in the five highest wastage values"/> : <strong>{exactMoney(row.wastage)}</strong>}</div>
        <div><span>Current inventory</span><strong>{inventory ? currentInventory.toLocaleString("en-IN") : "—"}</strong></div>
        <div><span>Demand forecast</span><strong>{inventory ? demandForecast.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}</strong></div>
      </div>
      <p className="pf-data-note">Values shown come from the selected profitability period. Inventory and forecast values are the latest available for {product?.name ?? row.name}.</p>
    </aside>
  </div>;
}

export function ProfitabilityView({ catalog, role, onNavigate }: { catalog: Catalog; role: Role; onNavigate: (view: "wastage" | "history") => void }) {
  const today = new Date();
  const [start, setStart] = useState(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`);
  const [end, setEnd] = useState(inputDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [outlet, setOutlet] = useState("");
  const [category, setCategory] = useState("");
  const [product, setProduct] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);
  const [productView, setProductView] = useState<ProductView>("revenue");
  const [outletSort, setOutletSort] = useState<OutletSort>("net_profit");
  const [outletDirection, setOutletDirection] = useState<Direction>("desc");
  const [productSort, setProductSort] = useState<ProductSort>("revenue");
  const [productDirection, setProductDirection] = useState<Direction>("desc");
  const bounds = useMemo(() => dateBounds(start, end), [start, end]);
  const query = useQuery({ queryKey: ["profitability", bounds.start, bounds.end, outlet], queryFn: () => api.getProfitability({ ...bounds, outlet_id: outlet || null }), enabled: role !== "cashier" });
  const trend = useQuery({ queryKey: ["profitability-trend", bounds.start, bounds.end, outlet], queryFn: () => api.getCommandCenter({ ...bounds, outlet_id: outlet || null }), enabled: role !== "cashier" });
  const inventory = useQuery({ queryKey: ["profitability-inventory", outlet], queryFn: () => api.getInventory({ outlet_id: outlet || null, product_id: null }), enabled: role !== "cashier", staleTime: 60_000 });

  const applyPreset = (preset: "today" | "week" | "month" | "previous") => {
    const now = new Date();
    if (preset === "today") { setStart(inputDate(now)); setEnd(inputDate(now)); }
    else if (preset === "week") { const date = new Date(now); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); setStart(inputDate(date)); setEnd(inputDate(now)); }
    else if (preset === "month") { setStart(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`); setEnd(inputDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))); }
    else { setStart(`${now.getFullYear()}-${pad(now.getMonth())}-01`); setEnd(inputDate(new Date(now.getFullYear(), now.getMonth(), 0))); }
  };
  const setOutletSortKey = (key: OutletSort) => { if (outletSort === key) setOutletDirection(value => value === "desc" ? "asc" : "desc"); else { setOutletSort(key); setOutletDirection("desc"); } };
  const setProductSortKey = (key: ProductSort) => { if (productSort === key) setProductDirection(value => value === "desc" ? "asc" : "desc"); else { setProductSort(key); setProductDirection("desc"); } };

  if (role === "cashier") return <main className="ops-view"><div className="page-state"><strong>Profitability is restricted</strong><span>Manager or owner access is required.</span></div></main>;
  if (query.isPending) return <main className="profit-view"><div className="page-state">Calculating profitability…</div></main>;
  if (query.isError || !query.data) return <main className="profit-view"><div className="page-state error">Profitability data is unavailable.</div></main>;

  const totals = query.data.totals;
  const selectedOutlet = query.data.outlets.find(item => item.outlet_id === outlet) ?? totals;
  const allProducts = buildProducts(selectedOutlet, catalog);
  const filteredProducts = allProducts.filter(row => (!category || row.categoryId === category) && (!product || row.productId === product));
  const productMetric: Record<ProductView, ProductSort> = { revenue: "revenue", profit: "grossProfit", margin: "margin", returns: "returns", wastage: "wastage" };
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    const av = nullableNumber(a[productSort]); const bv = nullableNumber(b[productSort]);
    return productDirection === "desc" ? bv - av : av - bv;
  });
  const viewProducts = [...filteredProducts].sort((a, b) => nullableNumber(b[productMetric[productView]]) - nullableNumber(a[productMetric[productView]]));
  const sortedOutlets = [...query.data.outlets].sort((a, b) => outletDirection === "desc" ? b[outletSort] - a[outletSort] : a[outletSort] - b[outletSort]);
  const chartRows = trend.data?.trend ?? [];
  const costRows = [
    { name: "COGS", value: totals.cogs }, { name: "Rent", value: totals.rent }, { name: "Staff cost", value: totals.staff_cost },
    { name: "Utilities", value: totals.utilities }, { name: "Other costs", value: totals.other_costs }, { name: "Wastage", value: totals.wastage }, { name: "Returns", value: totals.returns },
  ];
  const categoryRows = catalog.categories.map(item => {
    const rows = filteredProducts.filter(row => row.categoryId === item.id);
    const knownRevenue = rows.filter(row => row.revenue !== null);
    const knownProfit = rows.filter(row => row.grossProfit !== null);
    const revenue = knownRevenue.reduce((sum, row) => sum + (row.revenue ?? 0), 0);
    const grossProfit = knownProfit.reduce((sum, row) => sum + (row.grossProfit ?? 0), 0);
    return { id: item.id, name: item.name, productCount: catalog.products.filter(value => value.category_id === item.id).length, revenue, grossProfit, margin: revenue > 0 && knownProfit.length ? grossProfit / revenue * 100 : null, hasData: rows.length > 0 };
  }).filter(row => row.hasData);
  const highestRevenue = [...allProducts].filter(row => row.revenue !== null).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0];
  const highestProfit = [...allProducts].filter(row => row.grossProfit !== null).sort((a, b) => (b.grossProfit ?? 0) - (a.grossProfit ?? 0))[0];
  const highestReturn = [...allProducts].filter(row => row.returns !== null).sort((a, b) => (b.returns ?? 0) - (a.returns ?? 0))[0];
  const highestWaste = [...allProducts].filter(row => row.wastage !== null).sort((a, b) => (b.wastage ?? 0) - (a.wastage ?? 0))[0];
  const returnRate = totals.gross_sales > 0 ? totals.returns / totals.gross_sales * 100 : 0;
  const wasteRate = totals.net_sales > 0 ? totals.wastage / totals.net_sales * 100 : 0;

  return <main className="profit-view pf-page">
    <section className="pf-heading">
      <div><span>PROFITABILITY</span><h1>Profitability</h1><p>Understand revenue, costs, margins and profit across your outlets.</p></div>
      <div className="pf-filter-bar" aria-label="Profitability filters">
        <label><span>Outlet</span><select aria-label="Profitability outlet" value={outlet} onChange={event => setOutlet(event.target.value)}><option value="">All outlets</option>{catalog.outlets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="pf-presets"><button onClick={() => applyPreset("today")}>Today</button><button onClick={() => applyPreset("week")}>This week</button><button className="active" onClick={() => applyPreset("month")}>This month</button><button onClick={() => applyPreset("previous")}>Previous month</button></div>
        <label><span>From</span><input aria-label="Profitability start date" type="date" value={start} onChange={event => setStart(event.target.value)}/></label>
        <label><span>To</span><input aria-label="Profitability end date" type="date" value={end} onChange={event => setEnd(event.target.value)}/></label>
      </div>
    </section>

    <section className="pf-kpi-grid" aria-label="Profitability summary">
      <Kpi label="Gross revenue" value={totals.gross_sales} context="Before returns"/>
      <Kpi label="Net sales" value={totals.net_sales} context={`Returns ${compactMoney(totals.returns)}`}/>
      <Kpi label="COGS" value={totals.cogs} context="After returned units"/>
      <Kpi label="Gross profit" value={totals.gross_profit} tone={totals.gross_profit < 0 ? "negative" : "positive"} context={`${totals.gross_margin.toFixed(1)}% gross margin`}/>
      <Kpi label="Operating costs" value={totals.operating_costs} context="Rent, staff, utilities, other"/>
      <Kpi label="Net profit" value={totals.net_profit} tone={totals.net_profit < 0 ? "negative" : "positive"} context={totals.net_sales > 0 ? `${totals.net_margin.toFixed(1)}% net margin` : "No net sales"}/>
    </section>

    {query.data.alerts.length > 0 ? <section className="pf-alerts" aria-label="Profitability notices">{query.data.alerts.map(alert => <p key={alert}>{alert}</p>)}</section> : null}

    <section className="pf-panel pf-trend">
      <header><div><span>REVENUE &amp; PROFIT TREND</span><h2>How profit is changing</h2><p>Revenue and gross profit by day for the selected period. Net profit is shown as the period total above.</p></div><div className="pf-legend-note"><TrendingUp size={16}/>{outlet ? selectedOutlet.outlet_name : "All outlets"}</div></header>
      {chartRows.length ? <div className="pf-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows} margin={{ top: 18, right: 12, left: 0, bottom: 6 }}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" tickFormatter={shortDate} fontSize={10}/><YAxis tickFormatter={(value: number) => compactMoney(value)} width={66} fontSize={10}/><Tooltip labelFormatter={(value: string) => shortDate(value)} formatter={(value: number, name: string) => [exactMoney(value), name === "contribution" ? "Gross profit" : "Revenue"]}/><Legend formatter={value => value === "contribution" ? "Gross profit" : "Revenue"}/><Line type="monotone" dataKey="revenue" stroke="var(--chart-revenue)" strokeWidth={2.5} dot={false}/><Line type="monotone" dataKey="contribution" stroke="var(--chart-profit)" strokeWidth={2.5} dot={false}/></LineChart></ResponsiveContainer></div> : <div className="pf-empty">No dated sales are available for this period.</div>}
    </section>

    <section className="pf-panel pf-outlets">
      <header><div><span>OUTLET PERFORMANCE</span><h2>Which outlets are contributing?</h2><p>Select a row to focus the dashboard on that outlet.</p></div></header>
      <div className="pf-outlet-table">
        <div className="pf-outlet-row head"><span>Outlet</span><SortLabel label="Revenue" active={outletSort === "gross_sales"} direction={outletDirection} onClick={() => setOutletSortKey("gross_sales")}/><SortLabel label="Net sales" active={outletSort === "net_sales"} direction={outletDirection} onClick={() => setOutletSortKey("net_sales")}/><SortLabel label="Gross profit" active={outletSort === "gross_profit"} direction={outletDirection} onClick={() => setOutletSortKey("gross_profit")}/><SortLabel label="Operating cost" active={outletSort === "operating_costs"} direction={outletDirection} onClick={() => setOutletSortKey("operating_costs")}/><SortLabel label="Net profit" active={outletSort === "net_profit"} direction={outletDirection} onClick={() => setOutletSortKey("net_profit")}/><SortLabel label="Net margin" active={outletSort === "net_margin"} direction={outletDirection} onClick={() => setOutletSortKey("net_margin")}/></div>
        {sortedOutlets.map(row => <button className={`pf-outlet-row ${outlet === row.outlet_id ? "selected" : ""}`} key={row.outlet_id} onClick={() => setOutlet(row.outlet_id)}>
          <strong>{row.outlet_name}<small>View outlet</small></strong><Money value={row.gross_sales}/><Money value={row.net_sales}/><Money value={row.gross_profit}/><Money value={row.operating_costs}/><Money className={row.net_profit < 0 ? "negative" : "positive"} value={row.net_profit}/><span className={row.net_sales > 0 && row.net_margin < 0 ? "negative" : ""}>{row.net_sales <= 0 ? "N/A" : `${row.net_margin.toFixed(1)}%`}</span>
        </button>)}
      </div>
    </section>

    <section className="pf-products-section">
      <div className="pf-section-title"><div><span>PRODUCT PERFORMANCE</span><h2>What products are actually performing?</h2><p>Leading products returned by the existing profitability dataset for this period.</p></div><div className="pf-product-filters"><select aria-label="Profitability category" value={category} onChange={event => { setCategory(event.target.value); setProduct(""); }}><option value="">All categories</option>{catalog.categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Profitability product" value={product} onChange={event => setProduct(event.target.value)}><option value="">All products</option>{catalog.products.filter(item => !category || item.category_id === category).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></div>
      <div className="pf-product-tabs" role="tablist" aria-label="Product performance views">{([['revenue','Top revenue products'],['profit','Top gross profit'],['margin','Highest margin'],['returns','High return products'],['wastage','High wastage products']] as const).map(([key, label]) => <button role="tab" aria-selected={productView === key} className={productView === key ? "active" : ""} key={key} onClick={() => { setProductView(key); setProductSort(productMetric[key]); setProductDirection("desc"); }}>{label}</button>)}</div>
      <div className="pf-product-layout">
        <div className="pf-panel pf-product-table-wrap">
          <div className="pf-product-row head"><span>Product</span><span>Units sold</span><SortLabel label="Revenue" active={productSort === "revenue"} direction={productDirection} onClick={() => setProductSortKey("revenue")}/><span>COGS</span><SortLabel label="Gross profit" active={productSort === "grossProfit"} direction={productDirection} onClick={() => setProductSortKey("grossProfit")}/><SortLabel label="Margin" active={productSort === "margin"} direction={productDirection} onClick={() => setProductSortKey("margin")}/><SortLabel label="Returns" active={productSort === "returns"} direction={productDirection} onClick={() => setProductSortKey("returns")}/><SortLabel label="Wastage" active={productSort === "wastage"} direction={productDirection} onClick={() => setProductSortKey("wastage")}/></div>
          {sortedProducts.length ? sortedProducts.map(row => <button className="pf-product-row" key={row.productId} onClick={() => setSelectedProduct(row)}><strong>{row.name}<small>{row.category}</small></strong><EmptyValue text="Units sold are not returned by the existing profitability aggregate"/>{row.revenue === null ? <EmptyValue/> : <Money value={row.revenue}/>} {row.cogs === null ? <EmptyValue/> : <Money value={row.cogs}/>} {row.grossProfit === null ? <EmptyValue/> : <Money value={row.grossProfit}/>}<span>{row.margin === null ? "—" : `${row.margin.toFixed(1)}%`}</span>{row.returns === null ? <EmptyValue/> : <Money value={row.returns}/>} {row.wastage === null ? <EmptyValue/> : <Money value={row.wastage}/>}</button>) : <div className="pf-empty">No leading product metrics match these filters.</div>}
        </div>
        <div className="pf-panel pf-product-chart-panel"><header><span>PRODUCT REVENUE vs PROFIT</span><h3>Leading products</h3></header>{viewProducts.some(row => row.revenue !== null || row.grossProfit !== null) ? <div className="pf-product-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={viewProducts.slice(0, 6)} layout="vertical" margin={{ top: 8, right: 12, bottom: 8, left: 8 }}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" tickFormatter={(value: number) => compactMoney(value)} fontSize={9}/><YAxis type="category" dataKey="name" width={92} fontSize={10}/><Tooltip formatter={(value: number, name: string) => [exactMoney(value), name === "grossProfit" ? "Gross profit" : "Revenue"]}/><Legend formatter={value => value === "grossProfit" ? "Gross profit" : "Revenue"}/><Bar dataKey="revenue" fill="var(--chart-revenue)" radius={[0, 3, 3, 0]}/><Bar dataKey="grossProfit" fill="var(--chart-profit)" radius={[0, 3, 3, 0]}/></BarChart></ResponsiveContainer></div> : <div className="pf-empty">No product revenue is available for this view.</div>}</div>
      </div>
    </section>

    <section className="pf-lower-grid">
      <div className="pf-panel pf-category"><header><span>CATEGORY PERFORMANCE</span><h2>Category contribution</h2><p>Actual values represented by the leading products above.</p></header><div>{categoryRows.length ? categoryRows.map(row => <article key={row.id}><div><strong>{row.name}</strong><small>{row.productCount} active products</small></div><span><small>Revenue</small><b>{compactMoney(row.revenue)}</b></span><span><small>Gross profit</small><b>{compactMoney(row.grossProfit)}</b></span><span><small>Margin</small><b>{row.margin === null ? "—" : `${row.margin.toFixed(1)}%`}</b></span></article>) : <div className="pf-empty">No category metrics are available for this period.</div>}</div></div>
      <div className="pf-panel pf-signals"><header><span>PRODUCT SIGNALS</span><h2>Metric leaders</h2><p>Each statement names the metric used.</p></header><div>{highestRevenue ? <article><TrendingUp size={16}/><div><small>Highest revenue</small><strong>{highestRevenue.name}</strong><span>{highestRevenue.revenue === null ? "—" : exactMoney(highestRevenue.revenue)}</span></div></article> : null}{highestProfit ? <article><WalletCards size={16}/><div><small>Highest gross profit</small><strong>{highestProfit.name}</strong><span>{highestProfit.grossProfit === null ? "—" : exactMoney(highestProfit.grossProfit)}</span></div></article> : null}{highestReturn ? <article><RotateCcw size={16}/><div><small>Highest return value</small><strong>{highestReturn.name}</strong><span>{highestReturn.returns === null ? "—" : exactMoney(highestReturn.returns)}</span></div></article> : null}{highestWaste ? <article><Package size={16}/><div><small>Highest wastage cost</small><strong>{highestWaste.name}</strong><span>{highestWaste.wastage === null ? "—" : exactMoney(highestWaste.wastage)}</span></div></article> : null}</div></div>
    </section>

    <section className="pf-lower-grid pf-cost-row">
      <div className="pf-panel pf-cost"><header><span>COST STRUCTURE</span><h2>Where the money is going</h2></header><div className="pf-cost-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={costRows} layout="vertical" margin={{ top: 6, right: 14, bottom: 6, left: 8 }}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" tickFormatter={(value: number) => compactMoney(value)} fontSize={9}/><YAxis type="category" dataKey="name" width={76} fontSize={10}/><Tooltip formatter={(value: number) => exactMoney(value)}/><Bar dataKey="value" name="Cost" fill="var(--chart-cost)" radius={[0, 3, 3, 0]}/></BarChart></ResponsiveContainer></div></div>
      <div className="pf-panel pf-waterfall"><header><span>PROFIT WATERFALL</span><h2>How revenue becomes profit</h2></header><div className="pf-waterfall-list"><p><span>Gross revenue</span><b>{exactMoney(totals.gross_sales)}</b></p><i><ArrowDown size={13}/></i><p className="deduction"><span>Returns</span><b>− {exactMoney(totals.returns)}</b></p><i><ArrowDown size={13}/></i><p className="subtotal"><span>Net sales</span><b>{exactMoney(totals.net_sales)}</b></p><i><ArrowDown size={13}/></i><p className="deduction"><span>COGS</span><b>− {exactMoney(totals.cogs)}</b></p><i><ArrowDown size={13}/></i><p className="subtotal"><span>Gross profit</span><b>{exactMoney(totals.gross_profit)}</b></p><i><ArrowDown size={13}/></i><p className="deduction"><span>Wastage + operating costs</span><b>− {exactMoney(totals.wastage + totals.operating_costs)}</b></p><i><ArrowDown size={13}/></i><p className={`total ${totals.net_profit < 0 ? "negative" : "positive"}`}><span>Net profit</span><b>{exactMoney(totals.net_profit)}</b></p></div><details><summary>Detailed calculation</summary><div><p><span>Wastage</span><b>{exactMoney(totals.wastage)}</b></p><p><span>Rent</span><b>{exactMoney(totals.rent)}</b></p><p><span>Staff cost</span><b>{exactMoney(totals.staff_cost)}</b></p><p><span>Utilities</span><b>{exactMoney(totals.utilities)}</b></p><p><span>Other costs</span><b>{exactMoney(totals.other_costs)}</b></p></div></details></div>
    </section>

    <section className="pf-panel pf-operations"><header><div><span>RETURNS &amp; WASTAGE</span><h2>Operational impact</h2><p>How much returns and wastage reduced the selected period.</p></div></header><div className="pf-ops-grid"><button onClick={() => onNavigate("history")}><RotateCcw size={18}/><span>Return amount<strong>{compactMoney(totals.returns)}</strong><small>{returnRate.toFixed(1)}% of gross revenue</small></span><ChevronRight size={16}/></button><button onClick={() => onNavigate("wastage")}><Package size={18}/><span>Wastage cost<strong>{compactMoney(totals.wastage)}</strong><small>{wasteRate.toFixed(1)}% of net sales</small></span><ChevronRight size={16}/></button></div></section>

    {selectedProduct ? <ProductDrawer row={selectedProduct} catalog={catalog} inventory={inventory.data} onClose={() => setSelectedProduct(null)}/> : null}
  </main>;
}
