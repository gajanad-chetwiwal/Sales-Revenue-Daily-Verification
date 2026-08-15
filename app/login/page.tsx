import { loginAction } from './actions';

export const metadata = { title: 'Sign in · Daily Sales Verification' };

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next = '/', error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">Daily Sales Verification</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Internal dashboard — enter the access password to continue.
        </p>

        <form action={loginAction} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={next} />

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-slate-100"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              Incorrect password.
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
