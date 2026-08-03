import clsx from "clsx";
import { signOutAction } from "@/app/(auth)/actions";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOutAction} className={className}>
      <button type="submit" className="text-xs font-medium text-slate-500 hover:text-slate-900">
        Sign out
      </button>
    </form>
  );
}
