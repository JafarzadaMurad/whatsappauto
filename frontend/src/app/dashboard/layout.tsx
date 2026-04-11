"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { LogOut, LayoutDashboard, MessageSquare, Key, Link as LinkIcon, Menu, X, ChevronDown, ChevronRight, Network } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { user, isAuthenticated, logout } = useAuthStore();
    const pathname = usePathname();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [networksExpanded, setNetworksExpanded] = useState(true);

    useEffect(() => {
        if (!isAuthenticated) {
            router.replace('/login');
        }
    }, [isAuthenticated, router]);

    if (!isAuthenticated) return null;

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
                className={`fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:w-64 flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <div className="h-16 flex items-center justify-between px-6 border-b border-border">
                    <div className="flex items-center gap-2 text-primary font-bold text-xl">
                        <MessageSquare className="w-6 h-6" />
                        WazzupAuto
                    </div>
                    <button className="lg:hidden text-muted-foreground" onClick={() => setSidebarOpen(false)}>
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 flex-1 overflow-y-auto">
                    <nav className="space-y-1">
                        {navLinks.map((item) => {
                            if (item.isGroup) {
                                return (
                                    <div key={item.name} className="space-y-1">
                                        <button
                                            onClick={() => setNetworksExpanded(!networksExpanded)}
                                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors font-medium"
                                        >
                                            <div className="flex items-center gap-3">
                                                <item.icon className="w-5 h-5" />
                                                {item.name}
                                            </div>
                                            {networksExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </button>
                                        <AnimatePresence>
                                            {networksExpanded && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    className="overflow-hidden pl-10 space-y-1"
                                                >
                                                    {item.children?.map(child => {
                                                        const isChildActive = pathname === child.href;
                                                        return (
                                                            <Link
                                                                key={child.name}
                                                                href={child.href}
                                                                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors font-medium text-sm ${isChildActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
                                                            >
                                                                <child.icon className="w-4 h-4" />
                                                                {child.name}
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
                            return (
                                <Link
                                    key={item.name}
                                    href={item.href!}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors font-medium ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
                                >
                                    <Icon className="w-5 h-5" />
                                    {item.name}
                                </Link>
                            );
                        })}
                    </nav>
                </div>

                <div className="p-4 border-t border-border">
                    <div className="px-3 py-3 rounded-xl bg-secondary/30 mb-2">
                        <p className="text-sm font-medium text-foreground truncate">{user?.name || 'User'}</p>
                        <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-destructive hover:bg-destructive/10 transition-colors font-medium"
                    >
                        <LogOut className="w-5 h-5" />
                        Sign out
                    </button>
                </div>
            </motion.aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <header className="h-16 border-b border-border bg-card/50 backdrop-blur flex items-center px-4 lg:hidden sticky top-0 z-30">
                    <button onClick={() => setSidebarOpen(true)} className="p-2 text-foreground">
                        <Menu className="w-6 h-6" />
                    </button>
                    <div className="ml-4 font-bold text-lg">WazzupAuto</div>
                </header>

                <main className="flex-1 overflow-y-auto p-4 md:p-8">
                    {children}
                </main>
            </div>
        </div>
    );
}
