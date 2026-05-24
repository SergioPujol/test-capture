import { NavLink, Outlet } from "react-router-dom";
import { Activity, AlertTriangle, CreditCard, LayoutDashboard, UserRound } from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/customer", label: "Customer", icon: UserRound },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/error-lab", label: "Error Lab", icon: AlertTriangle },
];

export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand" data-testid="app-brand">
          <span className="brand__mark">TC</span>
          <div>
            <strong>Capture Target</strong>
            <span>Customer admin lab</span>
          </div>
        </div>
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link--active" : ""}`} end={item.to === "/"} key={item.to} to={item.to}>
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <main className="main-panel">
        <Outlet />
      </main>
    </div>
  );
}
