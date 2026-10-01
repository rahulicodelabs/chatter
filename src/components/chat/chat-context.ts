import { createContext, useContext } from "react";
import type { ChatContextValue } from "@/lib/types";

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within a ChatContext.Provider");
  }
  return ctx;
}
