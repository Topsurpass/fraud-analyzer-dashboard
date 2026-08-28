import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Rail } from "./Rail";

vi.mock("next/navigation", () => ({
  usePathname: () => "/connections/c1",
  // The account chip at the foot navigates after a sign-out.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const useConnections = vi.hoisted(() => vi.fn());
const useDashboards = vi.hoisted(() => vi.fn());

vi.mock("@/services/connections/ConnectionsContext", () => ({ useConnections }));
vi.mock("@/services/dashboards", () => ({ useDashboards }));

const signedInAs = vi.hoisted(() => ({ role: "admin" as "admin" | "analyst" }));

vi.mock("@/services/auth/AuthContext", async () => {
  const permissions =
    await vi.importActual<typeof import("@/services/auth/permissions")>(
      "@/services/auth/permissions",
    );
  const account = () => ({
    id: "u1",
    email: "ada@example.com",
    full_name: "Ada Lovelace",
    role: signedInAs.role,
    is_active: true,
    must_change_password: false,
    last_login_at: null,
    created_at: "2026-08-01T00:00:00Z",
  });
  return {
    useAuth: () => ({
      status: "signedIn",
      user: account(),
      busy: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      changeOwnPassword: vi.fn(),
      refresh: vi.fn(),
      can: (capability: Parameters<typeof permissions.can>[1]) =>
        permissions.can(account(), capability),
    }),
  };
});

beforeEach(() => {
  signedInAs.role = "admin";
  useConnections.mockReturnValue({
    connections: [
      { id: "c1", name: "Payments DB", status: "ok" },
      { id: "c2", name: "Ledger", status: "failed" },
    ],
    initial: false,
    loading: false,
    error: null,
    reload: vi.fn(),
  });
  useDashboards.mockReturnValue({
    dashboards: [{ id: "d1", name: "Card testing", chart_ids: ["q1", "q2"] }],
    initial: false,
    loading: false,
    error: null,
    reload: vi.fn(),
  });
});

describe("Rail", () => {
  it("shows names and both sections when expanded", () => {
    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByText("Payments DB")).toBeInTheDocument();
    expect(screen.getByText("Card testing")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connections" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
  });

  it("marks the current connection as the active page", () => {
    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Payments DB/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps every status light when collapsed, and drops only the labels", () => {
    render(<Rail collapsed onToggleCollapse={vi.fn()} />);

    // The instrument's status lights are the one thing collapsing must not cost.
    expect(screen.getByRole("img", { name: "Connected" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Connection failed" })).toBeInTheDocument();
    expect(screen.queryByText("Payments DB")).not.toBeInTheDocument();
  });

  it("still links each connection when collapsed", () => {
    render(<Rail collapsed onToggleCollapse={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Connected/ })).toHaveAttribute(
      "href",
      "/connections/c1",
    );
  });

  it("reports its own state on the toggle", async () => {
    const onToggleCollapse = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Rail collapsed={false} onToggleCollapse={onToggleCollapse} />);

    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    await user.click(collapse);
    expect(onToggleCollapse).toHaveBeenCalled();

    rerender(<Rail collapsed onToggleCollapse={onToggleCollapse} />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("has no toggle at all when the shell does not offer one", () => {
    render(<Rail collapsed={false} />);
    expect(screen.queryByRole("button", { name: /sidebar/ })).not.toBeInTheDocument();
  });
});

/**
 * The rail is where a role becomes visible, so this is where the absent-versus-
 * disabled decision is locked down. A disabled control in a nav rail is a
 * permanent reminder of something you will never be allowed to do.
 */
describe("what each role sees in the rail", () => {
  it("gives an administrator the administration section", () => {
    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Administration" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /People/ })).toHaveAttribute("href", "/admin/users");
    expect(screen.getByRole("link", { name: /Audit log/ })).toHaveAttribute(
      "href",
      "/admin/audit-log",
    );
  });

  it("does not show an analyst a section they cannot open", () => {
    signedInAs.role = "analyst";
    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Audit log/ })).not.toBeInTheDocument();
  });

  it("offers a new connection only to somebody who may create one", () => {
    // Both sections carry a "+ New", so the href is what tells them apart.
    const newConnectionLinks = () =>
      screen
        .queryAllByRole("link", { name: "+ New" })
        .filter((link) => link.getAttribute("href") === "/connections/new");

    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(newConnectionLinks()).toHaveLength(1);

    signedInAs.role = "analyst";
    cleanup();
    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(newConnectionLinks()).toHaveLength(0);
    // Dashboards are every role's to build, so that one stays.
    expect(screen.getByRole("link", { name: "+ New" })).toHaveAttribute(
      "href",
      "/dashboards/new",
    );
  });

  it("still lets an analyst see and open every connection", () => {
    // Listing is not managing. Analysts query these databases, so they have to
    // be able to see which ones exist - the engine takes the same position.
    signedInAs.role = "analyst";
    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Payments DB/ })).toHaveAttribute(
      "href",
      "/connections/c1",
    );
  });

  it("tells an analyst with no connections that there are none, without a dead link", () => {
    signedInAs.role = "analyst";
    useConnections.mockReturnValue({
      connections: [],
      initial: false,
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByText("No connections yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Connect a database/ })).not.toBeInTheDocument();
  });

  it("keeps the administration section reachable when the rail is collapsed", () => {
    render(<Rail collapsed onToggleCollapse={vi.fn()} />);
    expect(screen.getByRole("link", { name: "People" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audit log" })).toBeInTheDocument();
  });

  it("names who is signed in, and how to leave", async () => {
    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Ada Lovelace/ }));
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Account" })).toHaveAttribute("href", "/account");
  });
});
