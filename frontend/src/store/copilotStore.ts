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
    /** Which model actually answered, and on which rail. */
    servedModel?: string;
    engine?: "subscription" | "api";
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
    // Per-session picker state. Persisted in localStorage so it survives
    // reloads; server-side defaults fill it on first mount.
    provider: string | null;
    model: string | null;
    language: string | null;

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
    setProvider: (p: string | null) => void;
    setModel: (m: string | null) => void;
    setLanguage: (l: string | null) => void;
    reset: () => void;
};

// Small localStorage helper for the picker state — the messages array
// deliberately stays in memory (session-scoped), but the user's picked
// model + language + provider should persist across reloads.
const readLS = (k: string): string | null => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(k); } catch { return null; }
};
const writeLS = (k: string, v: string | null) => {
    if (typeof window === "undefined") return;
    try {
        if (v == null) window.localStorage.removeItem(k);
        else window.localStorage.setItem(k, v);
    } catch { /* ignore */ }
};

export const useCopilotStore = create<State>((set) => ({
    isOpen: false,
    isSending: false,
    voiceActive: false,
    sessionId: null,
    messages: [],
    actions: [],
    draft: "",
    provider: readLS("copilot.provider"),
    model: readLS("copilot.model"),
    language: readLS("copilot.language"),

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
    setProvider: (provider) => { writeLS("copilot.provider", provider); set({ provider }); },
    setModel: (model) => { writeLS("copilot.model", model); set({ model }); },
    setLanguage: (language) => { writeLS("copilot.language", language); set({ language }); },
    reset: () => set({ sessionId: null, messages: [], actions: [], draft: "" }),
}));
