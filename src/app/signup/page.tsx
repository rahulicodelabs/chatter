import Image from "next/image";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata = { title: "Create account" };

export default function SignupPage() {
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
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start messaging in seconds
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <SignupForm />
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
