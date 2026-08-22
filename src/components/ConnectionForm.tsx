"use client";

import { useState } from "react";
import type { ConnectionCreate, ConnectionRead, DbType } from "@/contracts/api";
import { DB_TYPES, DEFAULT_PORTS } from "@/contracts/api";
import { Button, Field, Input, Select } from "./ui";

/**
 * Create/edit form for a connection.
 *
 * The engine tests a connection as part of creating or updating it, so this
 * form's job is to collect credentials and then get out of the way - the result
 * of that test is the thing the analyst actually needs to see, and it is
 * reported by the page rather than hidden behind a toast.
 */
export interface ConnectionFormValues extends ConnectionCreate {
  password: string;
}

export function ConnectionForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  passwordHint,
}: {
  initial?: ConnectionRead | null;
  submitLabel: string;
  busy: boolean;
  onSubmit: (values: ConnectionFormValues) => void;
  onCancel?: () => void;
  passwordHint?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [dbType, setDbType] = useState<DbType>(initial?.db_type ?? "postgres");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState<string>(
    initial?.port != null ? String(initial.port) : String(DEFAULT_PORTS.postgres ?? ""),
  );
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [sqlitePath, setSqlitePath] = useState(initial?.sqlite_path ?? "");
  const [touched, setTouched] = useState(false);

  const isSqlite = dbType === "sqlite";
  const nameError = touched && !name.trim() ? "A name is required." : null;
  const targetError =
    touched && isSqlite && !sqlitePath.trim()
      ? "A file path is required for SQLite."
      : touched && !isSqlite && !host.trim()
        ? "A host is required."
        : null;

  const changeDbType = (next: DbType) => {
    setDbType(next);
    // Carry the conventional port across so the field is never left wrong.
    const suggested = DEFAULT_PORTS[next];
    setPort(suggested === null ? "" : String(suggested));
  };

  return (
    <form
      className="max-w-lg space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!name.trim()) return;
        if (isSqlite ? !sqlitePath.trim() : !host.trim()) return;

        onSubmit({
          name: name.trim(),
          db_type: dbType,
          host: isSqlite ? null : host.trim() || null,
          port: isSqlite || !port.trim() ? null : Number(port),
          database: isSqlite ? null : database.trim() || null,
          username: isSqlite ? null : username.trim() || null,
          sqlite_path: isSqlite ? sqlitePath.trim() : null,
          password: password,
        });
      }}
    >
      <Field label="Name" htmlFor="conn-name" error={nameError}>
        <Input
          id="conn-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Payments DB"
          autoComplete="off"
        />
      </Field>

      <Field label="Database type" htmlFor="conn-type">
        <Select
          id="conn-type"
          value={dbType}
          disabled={Boolean(initial)}
          onChange={(event) => changeDbType(event.target.value as DbType)}
        >
          {DB_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </Field>
      {initial ? (
        <p className="-mt-1 text-[11px] text-muted">
          The engine does not allow changing a connection&apos;s type after creation.
        </p>
      ) : null}

      {isSqlite ? (
        <Field
          label="SQLite file path"
          htmlFor="conn-path"
          error={targetError}
          hint="An absolute path on the machine running the engine."
        >
          <Input
            id="conn-path"
            value={sqlitePath}
            onChange={(event) => setSqlitePath(event.target.value)}
            placeholder="/srv/data/payments.db"
            className="tnum"
          />
        </Field>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <Field label="Host" htmlFor="conn-host" error={targetError}>
              <Input
                id="conn-host"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="db.internal"
                className="tnum"
              />
            </Field>
            <Field label="Port" htmlFor="conn-port">
              <Input
                id="conn-port"
                value={port}
                inputMode="numeric"
                onChange={(event) => setPort(event.target.value.replace(/[^\d]/g, ""))}
                className="tnum"
              />
            </Field>
          </div>

          <Field label="Database" htmlFor="conn-db">
            <Input
              id="conn-db"
              value={database}
              onChange={(event) => setDatabase(event.target.value)}
              placeholder="payments"
              className="tnum"
            />
          </Field>

          <Field label="Username" htmlFor="conn-user">
            <Input
              id="conn-user"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              className="tnum"
            />
          </Field>

          <Field
            label="Password"
            htmlFor="conn-pass"
            hint={passwordHint ?? "Stored encrypted by the engine and never returned."}
          >
            <Input
              id="conn-pass"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" tone="primary" disabled={busy}>
          {busy ? "Testing…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
