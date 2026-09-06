import { NextResponse } from "next/server";

/**
 * Liveness. Answers as long as the Node process is serving.
 *
 * Deliberately checks nothing downstream. This is what the container
 * healthcheck calls, and a healthcheck that fails when the engine is down
 * makes Docker kill and restart a dashboard that was working correctly -
 * turning a dependency outage into a restart loop on top of it. That is the
 * same split the engine draws between `/health` and `/ready`, and it is drawn
 * here for the same reason.
 *
 * `/readyz` is the one that looks downstream. Nothing restarts on its answer.
 */
export const dynamic = "force-dynamic";

export function GET() {
	return NextResponse.json(
		{ status: "ok" },
		{ headers: { "cache-control": "no-store" } },
	);
}
