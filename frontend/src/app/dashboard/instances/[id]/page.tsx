"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { Send, Image as ImageIcon, File, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import api from "@/lib/api";
import io from "socket.io-client";

interface Message {
    id: string;
    isFromMe: boolean;
    content: string;
    status: string;
    timestamp: string;
}

export default function ChatInterface() {
    const { id } = useParams();
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [to, setTo] = useState("");
    const [sending, setSending] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    useEffect(() => {
        // In a real app we'd fetch historical messages from API
        // api.get(`/messages?instanceId=${id}`).then(res => setMessages(res.data.messages));

        const socket = io(process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:2992');

        socket.on('connect', () => {
            console.log('socket connected for chat');
        });

        socket.on(`message.new-${id}`, (data: Message) => {
            setMessages(prev => [...prev, data]);
        });

        return () => {
            socket.disconnect();
        };
    }, [id]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !to.trim()) return;

        setSending(true);
        try {
            // Optimistic UI update
            const tempMsg: Message = {
                id: Date.now().toString(),
                isFromMe: true,
                content: input,
                status: 'PENDING',
                timestamp: new Date().toISOString()
            };
            setMessages(prev => [...prev, tempMsg]);

            await api.post('/messages/send-text', {
                instanceId: id,
                to,
                text: input
            });

            setInput("");
            // Update real status via socket or interval, for now just stay PENDING/SENT
        } catch (err) {
            console.error(err);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col bg-card border border-border rounded-2xl shadow-sm overflow-hidden relative">
            {/* Dynamic Background */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")` }}
            />

            {/* Chat header area where user defines who to send to (since WhatsApp API goes to distinct chats) */}
            <div className="p-4 border-b border-border bg-card/80 backdrop-blur z-10 flex items-center gap-4">
                <div className="flex-1">
                    <input
                        type="text"
                        placeholder="Chat Target (Phone #, e.g. 1234567890)"
                        className="w-full max-w-sm bg-secondary border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary text-sm"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                    />
                </div>
            </div>

            {/* Messages area */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 relative z-10 scroll-smooth"
            >
                {messages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                        Send a message to start the conversation
                    </div>
                ) : (
                    <AnimatePresence initial={false}>
                        {messages.map((msg) => (
                            <motion.div
                                key={msg.id}
                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                className={`flex flex-col ${msg.isFromMe ? 'items-end' : 'items-start'}`}
                            >
                                <div
                                    className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm shadow-sm ${msg.isFromMe
                                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                                        : 'bg-secondary text-foreground rounded-tl-sm border border-border'
                                        }`}
                                >
                                    <p>{msg.content}</p>
                                </div>
                                <span className="text-[10px] text-muted-foreground mt-1 px-1">
                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}
            </div>

            {/* Input Form */}
            <form onSubmit={handleSend} className="p-4 bg-card/80 backdrop-blur border-t border-border z-10 flex items-center gap-2">
                <button type="button" className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full transition-colors">
                    <ImageIcon className="w-5 h-5" />
                </button>
                <button type="button" className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full transition-colors hidden sm:block">
                    <File className="w-5 h-5" />
                </button>
                <input
                    type="text"
                    placeholder="Type a message..."
                    className="flex-1 bg-secondary border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm transition-all shadow-inner"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                />
                <button
                    type="submit"
                    disabled={!input.trim() || !to.trim() || sending}
                    className="bg-primary text-primary-foreground p-3 rounded-xl hover:bg-primary/90 transition-all disabled:opacity-50 active:scale-95 flex items-center justify-center shadow-lg"
                >
                    {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 ml-0.5" />}
                </button>
            </form>
        </div>
    );
}
