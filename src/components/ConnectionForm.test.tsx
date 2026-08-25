import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionRead } from "@/contracts/api";
import { ConnectionForm } from "./ConnectionForm";

/**
 * The TLS control exists because the engine used to send no `sslmode` at all,
 * which meant libpq's "prefer": offer plaintext first and accept it silently.
 * A managed target that requires TLS was unreachable, and every other target
 * could be downgraded without anyone being told. The form's job is to make the
 * choice explicit and to never send a certificate nothing will read.
 */

function connection(over: Partial<ConnectionRead> = {}): ConnectionRead {
  return {
    id: "c1",
    name: "Payments",
    db_type: "postgres",
    host: "db.example.test",
    port: 5432,
    database: "fraud",
    username: "ro_user",
    sqlite_path: null,
    ssl_mode: "require",
    ssl_root_cert: null,
    paused: false,
    status: "ok",
    last_tested_at: null,
    last_test_error: null,
    created_at: "2026-08-24T09:00:00Z",
    updated_at: "2026-08-24T09:00:00Z",
    ...over,
  };
}

async function submitted(onSubmit: ReturnType<typeof vi.fn>) {
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  return onSubmit.mock.calls[0][0];
}

describe("TLS mode", () => {
  it("defaults a new connection to require, not to libpq's prefer", async () => {
    const onSubmit = vi.fn();
    render(<ConnectionForm submitLabel="Save" busy={false} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Name"), "Payments");
    await userEvent.type(screen.getByLabelText("Host"), "db.example.test");
    expect(screen.getByLabelText("TLS")).toHaveValue("require");
    expect((await submitted(onSubmit)).ssl_mode).toBe("require");
  });

  it("shows the mode the connection already has when editing", () => {
    render(
      <ConnectionForm
        initial={connection({ ssl_mode: "verify-full", ssl_root_cert: "/ca/mine.crt" })}
        submitLabel="Save"
        busy={false}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByLabelText("TLS")).toHaveValue("verify-full");
    expect(screen.getByLabelText("Root certificate")).toHaveValue("/ca/mine.crt");
  });

  it("offers no TLS control for a SQLite file", async () => {
    render(<ConnectionForm submitLabel="Save" busy={false} onSubmit={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText("Database type"), "sqlite");
    // A local file has no wire to encrypt.
    expect(screen.queryByLabelText("TLS")).toBeNull();
  });

  it("sends no TLS fields for a SQLite file", async () => {
    const onSubmit = vi.fn();
    render(<ConnectionForm submitLabel="Save" busy={false} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Database type"), "sqlite");
    await userEvent.type(screen.getByLabelText("Name"), "local");
    await userEvent.type(screen.getByLabelText("SQLite file path"), "/data/t.db");

    const values = await submitted(onSubmit);
    expect(values.ssl_mode).toBeUndefined();
    expect(values.ssl_root_cert).toBeUndefined();
  });

  it("asks for a certificate only once a mode would read one", async () => {
    render(<ConnectionForm submitLabel="Save" busy={false} onSubmit={() => {}} />);
    expect(screen.queryByLabelText("Root certificate")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("TLS"), "verify-full");
    expect(screen.getByLabelText("Root certificate")).toBeInTheDocument();
  });

  it("drops a certificate the chosen mode would never read", async () => {
    // The engine rejects this combination outright, so sending it would turn a
    // stale field the user cannot see into a failed save.
    const onSubmit = vi.fn();
    render(
      <ConnectionForm
        initial={connection({ ssl_mode: "verify-full", ssl_root_cert: "/ca/mine.crt" })}
        submitLabel="Save"
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("TLS"), "require");
    expect(screen.queryByLabelText("Root certificate")).toBeNull();

    const values = await submitted(onSubmit);
    expect(values.ssl_mode).toBe("require");
    expect(values.ssl_root_cert).toBeNull();
  });

  it("explains what the selected mode actually does", async () => {
    // require and verify-full both read as "secure". The difference is whether
    // the server's identity is checked, and nothing else on screen says so.
    render(<ConnectionForm submitLabel="Save" busy={false} onSubmit={() => {}} />);
    expect(screen.getByText(/identity is not checked/i)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("TLS"), "verify-full");
    expect(screen.getByText(/hostname must match/i)).toBeInTheDocument();
  });

  it("sends an empty certificate as null so the engine picks the system bundle", async () => {
    const onSubmit = vi.fn();
    render(<ConnectionForm submitLabel="Save" busy={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Name"), "Payments");
    await userEvent.type(screen.getByLabelText("Host"), "db.example.test");
    await userEvent.selectOptions(screen.getByLabelText("TLS"), "verify-ca");

    expect((await submitted(onSubmit)).ssl_root_cert).toBeNull();
  });
});
