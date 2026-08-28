/**
 * The signed-out shell: no rail, no top bar, nothing to navigate to.
 *
 * A separate route group rather than a flag on the app shell, because the shell
 * mounts the connections, dashboards and flagged providers - all of which fetch
 * immediately and all of which 401 for somebody who is not signed in. Putting
 * the login screen inside it would mean three failing requests behind every
 * login form, and a rail rendering "Engine unreachable" next to it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return <div className="min-h-dvh bg-bg">{children}</div>;
}
