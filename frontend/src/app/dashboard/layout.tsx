"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { LogOut, LayoutDashboard, MessageSquare, Key, Link as LinkIcon, Menu, X, ChevronDown, ChevronRight, Network, Bot, Database, Server, Users, PanelLeftClose, PanelLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { user, isAuthenticated, logout, hasHydrated } = useAuthStore();
    const pathname = usePathname();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [networksExpanded, setNetworksExpanded] = useState(true);
    const [aiExpanded, setAiExpanded] = useState(true);

    useEffect(() => {
        if (hasHydrated && !isAuthenticated) {
            router.replace('/login');
        }
    }, [isAuthenticated, hasHydrated, router]);

    if (!hasHydrated || !isAuthenticated) return null;

    const handleLogout = () => {
        logout();
        router.push('/login');
    };

    const navLinks = [
        { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        {
            name: 'Networks',
            icon: Network,
            isGroup: true,
            children: [
                { name: 'WhatsApp', href: '/dashboard/whatsapp', icon: MessageSquare }
            ]
        },
        { name: 'CRM / Clients', href: '/dashboard/crm', icon: Users },
        {
            name: 'AI Workspace',
            icon: Bot,
            isGroup: true,
            children: [
                { name: 'AI Agents', href: '/dashboard/ai/agents', icon: Bot },
                { name: 'Data Tables', href: '/dashboard/ai/tables', icon: Database },
                { name: 'AI Providers', href: '/dashboard/ai/providers', icon: Server }
            ]
        },
        { name: 'API Keys', href: '/dashboard/api-keys', icon: Key },
        { name: 'Webhooks', href: '/dashboard/webhooks', icon: LinkIcon },
    ];

    return (
        <div className="min-h-screen bg-background flex">
            {/* Mobile Sidebar overlay */}
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <motion.aside
                animate={{ width: collapsed ? 72 : 256 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className={`fixed inset-y-0 left-0 z-50 bg-card border-r border-border transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static flex flex-col overflow-hidden ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
            >
                <div className="h-16 flex items-center justify-between px-4 border-b border-border min-w-0">
                    {!collapsed ? (
                        <>
                            <div className="flex items-center gap-2 text-primary font-bold text-xl whitespace-nowrap">
                                <MessageSquare className="w-6 h-6 flex-shrink-0" />
                                alChatBot
                            </div>
                            <div className="flex items-center gap-1">
                                <button className="hidden lg:block p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors" onClick={() => setCollapsed(true)}>
                                    <PanelLeftClose className="w-4 h-4" />
                                </button>
                                <button className="lg:hidden text-muted-foreground" onClick={() => setSidebarOpen(false)}>
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </>
                    ) : (
                        <button className="w-full flex justify-center p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors" onClick={() => setCollapsed(false)}>
                            <PanelLeft className="w-5 h-5" />
                        </button>
                    )}
                </div>

                <div className="p-2 flex-1 overflow-y-auto overflow-x-hidden">
                    <nav className="space-y-1">
                        {navLinks.map((item) => {
                            if (item.isGroup) {
                                const expanded = item.name === 'Networks' ? networksExpanded : aiExpanded;
                                const setExpanded = item.name === 'Networks' ? setNetworksExpanded : setAiExpanded;

                                if (collapsed) {
                                    // Collapsed: show only group icon
                                    const hasActiveChild = item.children?.some(c => pathname.startsWith(c.href));
                                    return (
                                        <div key={item.name} className="space-y-1">
                                            <div className={`flex justify-center p-2.5 rounded-xl ${hasActiveChild ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`} title={item.name}>
                                                <item.icon className="w-5 h-5" />
                                            </div>
                                            {item.children?.map(child => {
                                                const isChildActive = pathname.startsWith(child.href);
                                                return (
                                                    <Link key={child.name} href={child.href} title={child.name}
                                                        className={`flex justify-center p-2.5 rounded-xl transition-colors ${isChildActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}>
                                                        <child.icon className="w-4 h-4" />
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    );
                                }

                                return (
                                    <div key={item.name} className="space-y-1">
                                        <button
                                            onClick={() => setExpanded(!expanded)}
                                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors font-medium"
                                        >
                                            <div className="flex items-center gap-3">
                                                <item.icon className="w-5 h-5 flex-shrink-0" />
                                                <span className="truncate">{item.name}</span>
                                            </div>
                                            {expanded ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
                                        </button>
                                        <AnimatePresence>
                                            {expanded && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    className="overflow-hidden pl-10 space-y-1"
                                                >
                                                    {item.children?.map(child => {
                                                        const isChildActive = pathname.startsWith(child.href);
                                                        return (
                                                            <Link
                                                                key={child.name}
                                                                href={child.href}
                                                                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors font-medium text-sm ${isChildActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
                                                            >
                                                                <child.icon className="w-4 h-4 flex-shrink-0" />
                                                                <span className="truncate">{child.name}</span>
                                                            </Link>
                                                        )
                                                    })}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                );
                            }

                            const isActive = pathname === item.href;
                            const Icon = item.icon;

                            if (collapsed) {
                                return (
                                    <Link key={item.name} href={item.href!} title={item.name}
                                        className={`flex justify-center p-2.5 rounded-xl transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}>
                                        <Icon className="w-5 h-5" />
                                    </Link>
                                );
                            }

                            return (
                                <Link
                                    key={item.name}
                                    href={item.href!}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors font-medium ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
                                >
                                    <Icon className="w-5 h-5 flex-shrink-0" />
                                    <span className="truncate">{item.name}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </div>

                <div className="p-2 border-t border-border">
                    {!collapsed ? (
                        <>
                            <div className="px-3 py-3 rounded-xl bg-secondary/30 mb-2">
                                <p className="text-sm font-medium text-foreground truncate">{user?.name || 'User'}</p>
                                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                            </div>
                            <button
                                onClick={handleLogout}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-destructive hover:bg-destructive/10 transition-colors font-medium"
                            >
                                <LogOut className="w-5 h-5 flex-shrink-0" />
                                Sign out
                            </button>
                        </>
                    ) : (
                        <div className="space-y-1">
                            <div className="flex justify-center p-2.5 rounded-xl bg-secondary/30" title={user?.email || ''}>
                                <div className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">
                                    {(user?.name || 'U')[0].toUpperCase()}
                                </div>
                            </div>
                            <button onClick={handleLogout} title="Sign out"
                                className="w-full flex justify-center p-2.5 rounded-xl text-destructive hover:bg-destructive/10 transition-colors">
                                <LogOut className="w-5 h-5" />
                            </button>
                        </div>
                    )}
                </div>
            </motion.aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <header className="h-16 border-b border-border bg-card/50 backdrop-blur flex items-center px-4 lg:hidden sticky top-0 z-30">
                    <button onClick={() => setSidebarOpen(true)} className="p-2 text-foreground">
                        <Menu className="w-6 h-6" />
                    </button>
                    <div className="ml-4 font-bold text-lg">alChatBot</div>
                </header>

                <main className="flex-1 overflow-y-auto p-4 md:p-8">
                    {children}
                </main>
            </div>
        </div>
    );
}
