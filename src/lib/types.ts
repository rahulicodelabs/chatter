export type ConversationType = "dm" | "group";

export type Profile = {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
};

/** Public profile fields — lighter than full Profile (no created_at needed in embeds). */
export type PublicProfile = Pick<Profile, "id" | "username" | "full_name" | "avatar_url">;

/** Row from the `conversation_summaries` view (one row per conversation per member). */
export type ConversationSummary = {
  id: string;
  type: ConversationType;
  title: string | null;
  created_at: string;
  user_id: string;
  last_read_at: string;
  last_message: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  last_activity: string;
  unread_count: number;
};

export type Conversation = {
  id: string;
  type: ConversationType;
  title: string | null;
  created_at: string;
  created_by: string;
};

export type ConversationMember = {
  conversation_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
  profile: PublicProfile;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  /** Photo attachment (public URL in the `attachments` bucket). */
  image_url?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  created_at: string;
  sender?: PublicProfile;
  /** Client-only flag for messages appended before the DB confirms them. */
  pending?: boolean;
};

/** One row per (message, recipient): when they received and read it. */
export type MessageDelivery = {
  message_id: string;
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
};

export type ChatContextValue = {
  user: PublicProfile;
  conversations: ConversationSummary[];
  membersByConversation: Record<string, ConversationMember[]>;
  /** Display name of a conversation for the current user. */
  conversationLabel: (c: Pick<ConversationSummary, "id" | "type" | "title">) => string;
  markRead: (conversationId: string) => void;
  addConversation: (
    conversation: ConversationSummary,
    members: ConversationMember[]
  ) => void;
  refreshConversations: () => Promise<void>;
};
