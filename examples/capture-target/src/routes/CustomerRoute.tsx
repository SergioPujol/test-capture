import { PageHeader } from "../components/layout/PageHeader";
import { CustomerProfileForm } from "../features/customer/CustomerProfileForm";

export function CustomerRoute() {
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Customer profile" title="Edit account details" />
      <CustomerProfileForm />
    </div>
  );
}
