import { NextResponse } from "next/server";

/**
 * Which build is answering, and whether it was configured the way the app needs.
 *
 * Added after a deployment kept showing a bug that had already been fixed and
 * pushed: from the browser there was no way to tell whether the new build was
 * live or an old one was still being served ("Redeploy" on an old Vercel
 * deployment rebuilds the old commit). `curl <site>/version` answers that.
 *
 * Booleans for the two settings that matter, never their values: this is public.
 * `apiBaseUrlOverrideSet` is true when `NEXT_PUBLIC_API_BASE_URL` was present at
 * build time, which is the setting that once sent browsers straight to the
 * engine; the app ignores an absolute one now, but it is still worth removing.
 */
export const dynamic = "force-dynamic";

export function GET() {
	return NextResponse.json(
		{
			commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
			branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
			environment: process.env.VERCEL_ENV ?? null,
			engineConfigured: Boolean(process.env.ENGINE_BASE_URL?.trim()),
			apiBaseUrlOverrideSet: Boolean(process.env.NEXT_PUBLIC_API_BASE_URL?.trim()),
		},
		{ headers: { "cache-control": "no-store" } },
	);
}
