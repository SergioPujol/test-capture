import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

type Customer = {
  id: string;
  name: string;
  billingEmail: string;
  plan: "starter" | "growth" | "enterprise";
  status: "active" | "paused";
  notes: string;
};

type ActivityItem = {
  id: string;
  actor: string;
  action: string;
  target: string;
  severity: "info" | "warning" | "critical";
  createdAt: string;
};

const customer: Customer = {
  id: "cus_1042",
  name: "Northstar Foods",
  billingEmail: "finance@northstar.example",
  plan: "growth",
  status: "active",
  notes: "Prefers invoices on the first business day.",
};

const activity: ActivityItem[] = [
  {
    id: "act_001",
    actor: "Mara Chen",
    action: "updated billing contact",
    target: "finance@northstar.example",
    severity: "info",
    createdAt: "2026-05-21T10:42:00.000Z"
  },
  {
    id: "act_002",
    actor: "Billing Bot",
    action: "payment retry scheduled",
    target: "Invoice INV-2408",
    severity: "warning",
    createdAt: "2026-05-22T08:15:00.000Z"
  },
  {
    id: "act_003",
    actor: "Sam Rivera",
    action: "changed account status",
    target: "Active",
    severity: "critical",
    createdAt: "2026-05-23T14:05:00.000Z"
  }
];

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function parseBody(req: any): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function captureTargetApi(): Plugin {
  return {
    name: "capture-target-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) {
          next();
          return;
        }

        const url = new URL(req.url, "http://capture-target.local");
        let response: Response;

        try {
          if (req.method === "GET" && url.pathname === "/api/customer") {
            response = json(customer);
          } else if (req.method === "PATCH" && url.pathname === "/api/customer") {
            const body = await parseBody(req) as Partial<Customer>;
            Object.assign(customer, {
              billingEmail: body.billingEmail ?? customer.billingEmail,
              plan: body.plan ?? customer.plan,
              notes: body.notes ?? customer.notes,
            });
            activity.unshift({
              id: `act_${Date.now()}`,
              actor: "Current User",
              action: "saved customer profile",
              target: customer.billingEmail,
              severity: "info",
              createdAt: new Date().toISOString(),
            });
            response = json(customer);
          } else if (req.method === "GET" && url.pathname === "/api/activity") {
            const query = url.searchParams.get("query")?.toLowerCase() ?? "";
            const items = query
              ? activity.filter((item) => `${item.actor} ${item.action} ${item.target}`.toLowerCase().includes(query))
              : activity;
            response = json({ items });
          } else if (req.method === "POST" && url.pathname === "/api/login") {
            await parseBody(req);
            response = json({ ok: true, role: "admin", sessionToken: "server-token-is-redacted-by-test-capture" });
          } else if (req.method === "GET" && url.pathname === "/api/private") {
            response = json({ ok: true, message: "Private token endpoint reached" });
          } else if (req.method === "GET" && url.pathname === "/api/slow") {
            await new Promise((resolve) => setTimeout(resolve, 900));
            response = json({ ok: true, delayMs: 900 });
          } else if (req.method === "GET" && url.pathname === "/api/fail") {
            response = json({ error: "Synthetic billing gateway failure" }, { status: 502 });
          } else {
            response = json({ error: "Not found" }, { status: 404 });
          }
        } catch (error) {
          response = json({ error: error instanceof Error ? error.message : "Unknown API error" }, { status: 500 });
        }

        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), captureTargetApi()],
});
