export type CustomerPlan = "starter" | "growth" | "enterprise";

export type CustomerStatus = "active" | "paused";

export type Customer = {
  id: string;
  name: string;
  billingEmail: string;
  plan: CustomerPlan;
  status: CustomerStatus;
  notes: string;
};

export type CustomerUpdate = Pick<Customer, "billingEmail" | "plan" | "notes">;
