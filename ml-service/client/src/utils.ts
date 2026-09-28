import type { CartItem } from "./types";
export const roundMoney = (value:number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const calculateBill = (items:CartItem[], discount:number, taxRate:number) => {
  const subtotal = roundMoney(items.reduce((sum,item)=>sum + item.product.selling_price * item.quantity,0));
  const safeDiscount = roundMoney(Math.max(0,Math.min(discount,subtotal)));
  const tax = roundMoney((subtotal-safeDiscount) * Math.max(0,taxRate) / 100);
  return {subtotal,discount:safeDiscount,tax,total:roundMoney(subtotal-safeDiscount+tax)};
};
export const formatINR = (value:number) => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(value);
export const formatDateTime = (iso:string) => new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"short"}).format(new Date(iso));
