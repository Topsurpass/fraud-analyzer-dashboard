import { NextResponse } from "next/server";

/**
 * Readiness: can this dashboard actually reach the engine it proxies to?
 *
 * Every useful page here is a proxied engine call, so a dashboard that renders
 * but cannot reach `ENGINE_BASE_URL` is a dashboard that shows a login form and
 * then fails on submit. That failure looks like bad credentials to whoever hits
 * it, which is the wrong thing to spend an afternoon on. This route names it
 * directly.
 *
 * Nothing restarts on this answer - see the note in `/healthz` on why a
 * dependency check must not drive a container healthcheck. It exists for the
 * deploy verification script and for a human with a question.
 *
 * The engine's `/health` is the target rather than `/ready`: this route is
 * asking "is the engine reachable from this container", and `/ready` folds in
 * the engine's own database, which has its own answer and its own fix.
 */
export const dynamic = "force-dynamic";

/** Bounded so a hung engine returns an answer here rather than hanging too. */
const TIMEOUT_MS = 4000;

export async function GET() {
	const base = process.env.ENGINE_BASE_URL?.trim();
	if (!base) {
		return NextResponse.json(
			{
				status: "not_ready",
				reason: "ENGINE_BASE_URL is not set in this container's environment.",
			},
			{ status: 503, headers: { "cache-control": "no-store" } },
		);
	}

	const url = `${base.replace(/\/+$/, "")}/health`;

	try {
		const upstream = await fetch(url, {
			cache: "no-store",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!upstream.ok) {
			return NextResponse.json(
				{
					status: "not_ready",
					reason: `The engine answered ${upstream.status} at /health.`,
				},
				{ status: 503, headers: { "cache-control": "no-store" } },
			);
		}
	} catch (error) {
		// The message, not the stack, and never the URL: ENGINE_BASE_URL is a
		// private address this service exists to keep off the public internet.
		return NextResponse.json(
			{
				status: "not_ready",
				reason: `The engine is unreachable: ${
					error instanceof Error ? error.name : "unknown error"
				}.`,
			},
			{ status: 503, headers: { "cache-control": "no-store" } },
		);
	}

	return NextResponse.json(
		{ status: "ready" },
		{ headers: { "cache-control": "no-store" } },
	);
}
