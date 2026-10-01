import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-4xl" aria-hidden>
        👋
      </p>
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page or conversation doesn&apos;t exist, or you don&apos;t have access
        to it.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover"
      >
        Back to chats
      </Link>
    </main>
  );
}
