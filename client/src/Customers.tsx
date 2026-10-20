import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Search, UserPlus, Users } from "lucide-react";
import { api, type ApiResponse } from "./api";

type Customer = ApiResponse<typeof api, "getCatalog">["customers"][number];

export function CustomersView({ customers, onBillCustomer }: { customers: Customer[]; onBillCustomer: (customerId: string) => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const addCustomer = useMutation({
    mutationFn: (input: { name: string; phone: string; email?: string }) => api.addCustomer(input),
    onSuccess: data => {
      if (!data.ok) { setError(data.error ?? "Customer could not be saved."); return; }
      setError("");
      setAdding(false);
      qc.invalidateQueries();
    },
    onError: () => setError("Customer could not be saved."),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    addCustomer.mutate({ name: String(fd.get("name") ?? ""), phone: String(fd.get("phone") ?? ""), email: String(fd.get("email") ?? "") });
  };
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q) || (c.email ?? "").toLowerCase().includes(q));
  }, [customers, search]);
  return (
    <main className="history-view customers-view">
      <div className="history-head">
        <div>
          <span>CUSTOMER DIRECTORY</span>
          <h1>Customers</h1>
          <p>{customers.length} saved customer{customers.length === 1 ? "" : "s"}. Select one to start a bill in their name, or add a new customer.</p>
        </div>
        <div className="history-search">
          <Search size={17} />
          <input aria-label="Search customers" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, or email" />
        </div>
        <button className="primary" onClick={() => setAdding(v => !v)}><UserPlus size={16} /> Add customer</button>
      </div>
      {adding && (
        <section className="customers-add">
          <form className="customer-form" onSubmit={submit}>
            <input name="name" aria-label="Customer name" placeholder="Customer name" required minLength={2} />
            <input name="phone" aria-label="Customer phone" placeholder="10-digit phone" required pattern="[0-9]{10}" />
            <input name="email" type="email" aria-label="Customer email" placeholder="Email (optional)" />
            <button type="submit" disabled={addCustomer.isPending}>{addCustomer.isPending ? "Saving…" : "Save customer"}</button>
          </form>
          {error && <div className="inline-error">{error}</div>}
        </section>
      )}
      {!adding && error && <div className="inline-error">{error}</div>}
      {visible.length === 0 ? (
        <div className="empty-history">
          <Users size={26} />
          <strong>{customers.length === 0 ? "No customers yet" : "No matching customer"}</strong>
          <span>{customers.length === 0 ? "Add your first customer here, or save one while billing." : "Try a different name, phone number, or email."}</span>
        </div>
      ) : (
        <div className="bill-list">
          {visible.map(customer => (
            <button key={customer.id} className="bill-record customer-record" onClick={() => onBillCustomer(customer.id)} aria-label={`Start a bill for ${customer.name}`}>
              <div className="bill-primary">
                <strong>{customer.name}</strong>
                <span>{customer.phone ?? "No phone saved"}</span>
              </div>
              <div>
                <small>Email</small>
                <strong>{customer.email ?? "Not provided"}</strong>
              </div>
              <span className="customer-bill-hint">New bill <ArrowRight size={14} /></span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
