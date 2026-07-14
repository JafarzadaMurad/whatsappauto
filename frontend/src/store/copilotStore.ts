import { create } from "zustand";

// Global copilot chat state. Held OUTSIDE the React tree so mounting
// the panel inside `dashboard/layout.tsx` keeps its message history,
// draft text, and open/close flag intact across route changes.

export type CopilotToolCall = {
    name: string;
    args: any;
};

export type CopilotMessage = {
    role: "user" | "assistant";
    content: string;
    toolCalls?: CopilotToolCall[];
    at: string;
};

// Ephemeral action-card entries — populated from `copilot.action`
// socket events + rendered inline in the panel below the message
// they belong to. Cleared when the user starts a new session.
export type CopilotActionCard = {
    tool: string;
    entity: string;
    verb: string;
    title: string;
    id: string | null;
    at: string;
};

type State = {
    isOpen: boolean;
    isSending: boolean;
    voiceActive: boolean;
    sessionId: string | null;
    messages: CopilotMessage[];
    actions: CopilotActionCard[];
    draft: string;

    open: () => void;
    close: () => void;
    toggle: () => void;
    setDraft: (d: string) => void;
    setSending: (b: boolean) => void;
    setVoiceActive: (b: boolean) => void;
    setSession: (id: string | null) => void;
    setMessages: (msgs: CopilotMessage[]) => void;
    pushMessage: (m: CopilotMessage) => void;
    pushAction: (a: CopilotActionCard) => void;
    reset: () => void;
};

export const useCopilotStore = create<State>((set) => ({
    isOpen: false,
    isSending: false,
    voiceActive: false,
    sessionId: null,
    messages: [],
    actions: [],
    draft: "",

    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
    toggle: () => set((s) => ({ isOpen: !s.isOpen })),
    setDraft: (draft) => set({ draft }),
    setSending: (isSending) => set({ isSending }),
    setVoiceActive: (voiceActive) => set({ voiceActive }),
    setSession: (sessionId) => set({ sessionId }),
    setMessages: (messages) => set({ messages }),
    pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
    pushAction: (a) => set((s) => ({ actions: [...s.actions, a].slice(-20) })),
    reset: () => set({ sessionId: null, messages: [], actions: [], draft: "" }),
}));
