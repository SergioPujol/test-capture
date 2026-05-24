import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ActivityRoute } from "./routes/ActivityRoute";
import { BillingRoute } from "./routes/BillingRoute";
import { CustomerRoute } from "./routes/CustomerRoute";
import { DashboardRoute } from "./routes/DashboardRoute";
import { ErrorLabRoute } from "./routes/ErrorLabRoute";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardRoute />} />
        <Route path="customer" element={<CustomerRoute />} />
        <Route path="billing" element={<BillingRoute />} />
        <Route path="activity" element={<ActivityRoute />} />
        <Route path="error-lab" element={<ErrorLabRoute />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Route>
    </Routes>
  );
}
