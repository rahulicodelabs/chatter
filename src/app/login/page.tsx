import Image from "next/image";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={48}
            height={48}
            className="mx-auto mb-3 h-12 w-12 rounded-2xl"
          />
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to continue to Chatter
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          No account?{" "}
          <a href="/signup" className="font-medium text-accent hover:underline">
            Create one
          </a>
        </p>
      </div>
    </main>
  );
}
