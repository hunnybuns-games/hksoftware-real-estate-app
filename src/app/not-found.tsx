import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-5">
        <Link href="/">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-20">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-slate-900">We couldn&apos;t find that</h1>
          <p className="mt-2 text-sm text-slate-500">
            The page may have moved, or it belongs to a different account.
          </p>
          <Link href="/" className="btn-primary mt-6 inline-flex">
            Back to start
          </Link>
        </div>
      </main>
    </div>
  );
}
