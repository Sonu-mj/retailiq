export type SaleLine = { outletId:string; productId:string; productName:string; categoryName:string; quantity:number; sellingPrice:number; costPrice:number; revenue:number };
export type ReturnLine = { outletId:string; productId:string; quantity:number; amount:number; unitCost:number };
export type WasteLine = { outletId:string; productId:string; productName:string; cost:number };
export type CostLine = { outletId:string; rent:number; staffCost:number; utilities:number; otherCosts:number; allocation:number };

export type ProductMetric = { product_id:string; product_name:string; value:number };
export type OutletProfit = {
  outlet_id:string; outlet_name:string; gross_sales:number; returns:number; net_sales:number; cogs:number; gross_profit:number; gross_margin:number; wastage:number;
  rent:number; staff_cost:number; utilities:number; other_costs:number; operating_costs:number; net_profit:number; net_margin:number;
  top_revenue:ProductMetric[]; top_gross_profit:ProductMetric[]; top_returns:ProductMetric[]; top_wastage:ProductMetric[];
};

const money=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const percent=(part:number,total:number)=>total===0?0:money(part/total*100);
const top=(values:Map<string,{name:string;value:number}>)=>[...values.entries()].map(([product_id,row])=>({product_id,product_name:row.name,value:money(row.value)})).sort((a,b)=>b.value-a.value).slice(0,5);

export function calculateOutletProfitability(outlets:{id:string;name:string}[], sales:SaleLine[], returns:ReturnLine[], waste:WasteLine[], costs:CostLine[]):OutletProfit[]{
  return outlets.map(outlet=>{
    const outletSales=sales.filter(row=>row.outletId===outlet.id);
    const outletReturns=returns.filter(row=>row.outletId===outlet.id);
    const outletWaste=waste.filter(row=>row.outletId===outlet.id);
    const outletCosts=costs.filter(row=>row.outletId===outlet.id);
    const grossSales=money(outletSales.reduce((sum,row)=>sum+row.revenue,0));
    const returnAmount=money(outletReturns.reduce((sum,row)=>sum+row.amount,0));
    const grossCogs=outletSales.reduce((sum,row)=>sum+row.costPrice*row.quantity,0);
    const returnedCogs=outletReturns.reduce((sum,row)=>sum+row.unitCost*row.quantity,0);
    const cogs=money(grossCogs-returnedCogs);
    const netSales=money(grossSales-returnAmount);
    const grossProfit=money(netSales-cogs);
    const wastageCost=money(outletWaste.reduce((sum,row)=>sum+row.cost,0));
    const rent=money(outletCosts.reduce((sum,row)=>sum+row.rent*row.allocation,0));
    const staffCost=money(outletCosts.reduce((sum,row)=>sum+row.staffCost*row.allocation,0));
    const utilities=money(outletCosts.reduce((sum,row)=>sum+row.utilities*row.allocation,0));
    const otherCosts=money(outletCosts.reduce((sum,row)=>sum+row.otherCosts*row.allocation,0));
    const operatingCosts=money(rent+staffCost+utilities+otherCosts);
    const netProfit=money(grossProfit-wastageCost-operatingCosts);
    const revenueMap=new Map<string,{name:string;value:number}>(); const profitMap=new Map<string,{name:string;value:number}>(); const returnMap=new Map<string,{name:string;value:number}>(); const wasteMap=new Map<string,{name:string;value:number}>();
    for(const row of outletSales){const rev=revenueMap.get(row.productId)??{name:row.productName,value:0};rev.value+=row.revenue;revenueMap.set(row.productId,rev);const gp=profitMap.get(row.productId)??{name:row.productName,value:0};gp.value+=(row.sellingPrice-row.costPrice)*row.quantity;profitMap.set(row.productId,gp);}
    for(const row of outletReturns){const name=outletSales.find(s=>s.productId===row.productId)?.productName??row.productId;const current=returnMap.get(row.productId)??{name,value:0};current.value+=row.amount;returnMap.set(row.productId,current);const gp=profitMap.get(row.productId);if(gp)gp.value-=row.amount-row.unitCost*row.quantity;}
    for(const row of outletWaste){const current=wasteMap.get(row.productId)??{name:row.productName,value:0};current.value+=row.cost;wasteMap.set(row.productId,current);}
    return {outlet_id:outlet.id,outlet_name:outlet.name,gross_sales:grossSales,returns:returnAmount,net_sales:netSales,cogs,gross_profit:grossProfit,gross_margin:percent(grossProfit,netSales),wastage:wastageCost,rent,staff_cost:staffCost,utilities,other_costs:otherCosts,operating_costs:operatingCosts,net_profit:netProfit,net_margin:percent(netProfit,netSales),top_revenue:top(revenueMap),top_gross_profit:top(profitMap),top_returns:top(returnMap),top_wastage:top(wasteMap)};
  });
}
