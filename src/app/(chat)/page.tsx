export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-xl text-accent">
        💬
      </span>
      <h2 className="text-base font-semibold">Select a conversation</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Choose a chat from the sidebar, or start a new direct message or group
        conversation with the <span className="font-medium">+</span> button.
      </p>
    </div>
  );
}
