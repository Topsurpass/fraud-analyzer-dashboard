// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { itemKey } from "@/components/lists/items";

/**
 * The mock engine is what the smoke lanes and a designer's screenshots run
 * against, so a mock that is kinder than the real engine hides the pages'
 * error paths. These pin the list behaviour to the real engine's contract:
 * status and error_code for each refusal, and the same duplicate rule as the
 * form's live count.
 */

const processes: ChildProcess[] = [];

async function start(port: number, env: Record<string, string> = {}): Promise<string> {
  const child = spawn("node", ["scripts/mock-engine.mjs", `--port=${port}`], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  processes.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout?.on("data", (chunk) => {
      if (String(chunk).includes("mock engine on")) resolve();
    });
  });
  return `http://127.0.0.1:${port}`;
}

afterAll(() => {
  for (const child of processes) child.kill();
});

async function call(base: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

describe("mock engine lists, signed in as an admin", () => {
  let base = "";
  beforeAll(async () => {
    base = await start(8311, { MOCK_MAX_LIST_ITEMS: "5" });
  });

  it("creates with the received/kept/duplicates report", async () => {
    const { status, json } = await call(base, "POST", "/lists", {
      name: "Mine",
      items: ["a", "A ", "b"],
    });
    expect(status).toBe(201);
    expect(json).toMatchObject({ received: 3, kept: 2, duplicates_dropped: 1, items: ["a", "b"] });
  });

  it("refuses a name that is taken, ignoring case", async () => {
    const { status, json } = await call(base, "POST", "/lists", { name: "blocked TERMINALS", items: ["x"] });
    expect(status).toBe(409);
    expect(json.error_code).toBe("LIST_NAME_TAKEN");
  });

  it("answers validation errors with the engine's code and status", async () => {
    const { status, json } = await call(base, "POST", "/lists", { name: " ", items: ["x"] });
    expect(status).toBe(422);
    expect(json.error_code).toBe("REQUEST_VALIDATION_ERROR");
  });

  it("refuses more items than the limit", async () => {
    const { status, json } = await call(base, "POST", "/lists", {
      name: "Big",
      items: ["1", "2", "3", "4", "5", "6"],
    });
    expect(status).toBe(422);
    expect(json.error_code).toBe("REQUEST_VALIDATION_ERROR");
    expect(json.message).toMatch(/at most 5 items; this one has 6/);
  });

  it("lets an admin change a list somebody else made", async () => {
    const { status } = await call(base, "PUT", "/lists/l2", { name: "High-risk countries", items: ["KP"] });
    expect(status).toBe(200);
  });

  it("answers 404 LIST_NOT_FOUND when a rule PUT names an unknown list", async () => {
    const { status, json } = await call(base, "PUT", "/queries/q_table/flag-rules", {
      rules: [
        {
          name: "R",
          severity: "high",
          enabled: true,
          conditions: [{ column_name: "t", operator: "in_list", list_id: "nope" }],
        },
      ],
    });
    expect(status).toBe(404);
    expect(json.error_code).toBe("LIST_NOT_FOUND");
    expect(json.message).toBe("No list with id 'nope'.");
  });

  it("blocks deleting a list a saved rule uses, then allows it once the rule is gone", async () => {
    const rule = {
      name: "R",
      severity: "high",
      enabled: true,
      conditions: [{ column_name: "t", operator: "in_list", list_id: "l1" }],
    };
    expect((await call(base, "PUT", "/queries/q_table/flag-rules", { rules: [rule] })).status).toBe(200);
    const blocked = await call(base, "DELETE", "/lists/l1");
    expect(blocked.status).toBe(409);
    expect(blocked.json.error_code).toBe("LIST_IN_USE");
    expect(blocked.json.detail.rules[0]).toMatchObject({ rule_name: "R", query_id: "q_table" });
    expect(blocked.json.detail).toMatchObject({ list_id: "l1", hidden_rule_count: 0 });
    expect(blocked.json.message).toBe("List 'Blocked terminals' is used by: R. Remove it from those rules first.");

    await call(base, "PUT", "/queries/q_table/flag-rules", { rules: [] });
    expect((await call(base, "DELETE", "/lists/l1")).status).toBe(204);
  });
});

describe("mock engine list item limit", () => {
  it("defaults to the engine's 20000", async () => {
    const base = await start(8317);
    const items = Array.from({ length: 20_001 }, (_, i) => `item-${i}`);
    const over = await call(base, "POST", "/lists", { name: "Over", items });
    expect(over.status).toBe(422);
    expect(over.json.message).toMatch(/at most 20000 items; this one has 20001/);
    const ok = await call(base, "POST", "/lists", { name: "At limit", items: items.slice(0, 20_000) });
    expect(ok.status).toBe(201);
  });
});

describe("mock engine lists, signed in as an analyst", () => {
  it("answers 403 FORBIDDEN for a list somebody else made, on both write paths", async () => {
    const base = await start(8312, { MOCK_ROLE: "analyst" });
    const put = await call(base, "PUT", "/lists/l2", { name: "x", items: ["a"] });
    expect(put.status).toBe(403);
    expect(put.json.error_code).toBe("FORBIDDEN");
    const del = await call(base, "DELETE", "/lists/l2");
    expect(del.status).toBe(403);
    // Reading and using it stays open to everyone.
    expect((await call(base, "GET", "/lists/l2")).status).toBe(200);
  });
});

describe("mock engine LIST_IN_USE visibility", () => {
  const ruleOn = (name: string) => ({
    name,
    severity: "high",
    enabled: true,
    conditions: [{ column_name: "t", operator: "in_list", list_id: "l1" }],
  });

  it("names every rule to an admin, and hides none", async () => {
    const base = await start(8314);
    await call(base, "PUT", "/queries/q_kpi/flag-rules", { rules: [ruleOn("Theirs")] });
    const { status, json } = await call(base, "DELETE", "/lists/l1");
    expect(status).toBe(409);
    expect(json.detail.hidden_rule_count).toBe(0);
    expect(json.detail.rules.map((r: { rule_name: string }) => r.rule_name)).toEqual(["Theirs"]);
  });

  it("counts rules on other people's queries for an analyst, without naming them", async () => {
    const base = await start(8315, { MOCK_ROLE: "analyst" });
    await call(base, "PUT", "/queries/q_kpi/flag-rules", { rules: [ruleOn("Theirs")] });
    await call(base, "PUT", "/queries/q_table/flag-rules", { rules: [ruleOn("Mine")] });
    const { json } = await call(base, "DELETE", "/lists/l1");
    expect(json.detail.rules).toEqual([
      expect.objectContaining({ rule_name: "Mine", query_id: "q_table" }),
    ]);
    expect(json.detail.hidden_rule_count).toBe(1);
    expect(json.message).toBe(
      "List 'Blocked terminals' is used by: Mine and 1 rule on queries you cannot see. Remove it from those rules first.",
    );
    // The summary still counts every rule, so "used by" is honest in the table.
    const summary = (await call(base, "GET", "/lists")).json.find((l: { id: string }) => l.id === "l1");
    expect(summary.rule_count).toBe(2);
  });

  it("reports hidden-only use with an empty rules list", async () => {
    const base = await start(8316, { MOCK_ROLE: "analyst" });
    await call(base, "PUT", "/queries/q_kpi/flag-rules", { rules: [ruleOn("A"), ruleOn("B")] });
    const { status, json } = await call(base, "DELETE", "/lists/l1");
    expect(status).toBe(409);
    expect(json.detail).toEqual({ list_id: "l1", rules: [], hidden_rule_count: 2 });
    expect(json.message).toBe(
      "List 'Blocked terminals' is used by: 2 rules on queries you cannot see. Remove it from those rules first.",
    );
  });
});

describe("the mock and the form agree on what a duplicate is", () => {
  it("drops the same items the form predicts, including the decimal-only rule", async () => {
    const base = await start(8313);
    const items = ["NG", "ng", " NG ", "2", "2.0", "02", "0x1A", "26", "1e3", "1000", "-0", "0", "ß", "SS", "1_0", "10"];
    const { json } = await call(base, "POST", "/lists", { name: "Parity", items });
    const predicted = new Set(items.map(itemKey)).size;
    expect(json.kept).toBe(predicted);
    expect(json.duplicates_dropped).toBe(items.length - predicted);
    // 0x1A is text, not 26: both spellings survive.
    expect(json.items).toContain("0x1A");
    expect(json.items).toContain("26");
  });
});
