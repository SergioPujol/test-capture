import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ShieldCheck, Wifi } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";

const cards = [
  {
    title: "Customer profile",
    text: "Edit the billing email, plan, and account notes through a normal async save flow.",
    to: "/customer",
    icon: CheckCircle2,
  },
  {
    title: "Privacy capture",
    text: "Type password and token-like values, then confirm Test Capture masks sensitive data.",
    to: "/billing",
    icon: ShieldCheck,
  },
  {
    title: "Network evidence",
    text: "Generate successful, slow, and failing API calls from one predictable test surface.",
    to: "/error-lab",
    icon: Wifi,
  },
];

export function DashboardRoute() {
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Fixture overview" title="Modern app surface for capture testing" />

      <section className="hero-band">
        <div>
          <p className="eyebrow">Northstar Foods</p>
          <h2>Admin workflows with real routing, async state, forms, tables, modals, and failure modes.</h2>
        </div>
        <Link className="button button--primary" data-testid="start-customer-flow" to="/customer">
          <span>Start customer flow</span>
          <ArrowRight size={18} />
        </Link>
      </section>

      <section className="metric-grid" aria-label="Capture surface summary">
        <div className="metric">
          <strong>5</strong>
          <span>Routes</span>
        </div>
        <div className="metric">
          <strong>8</strong>
          <span>API paths</span>
        </div>
        <div className="metric">
          <strong>3</strong>
          <span>Failure types</span>
        </div>
      </section>

      <section className="feature-grid">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link className="feature-card" key={card.title} to={card.to}>
              <Icon size={22} />
              <h3>{card.title}</h3>
              <p>{card.text}</p>
              <span>Open <ArrowRight size={14} /></span>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
