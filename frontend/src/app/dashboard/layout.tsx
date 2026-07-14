"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { LogOut, LayoutDashboard, MessageSquare, Key, Link as LinkIcon, ChevronDown, ChevronRight, Network, Bot, Database, Server, Users, PanelLeftClose, PanelLeft, Send, Camera, Workflow, Inbox, Shield, CreditCard, LogIn, Mail, Plug, Brain, GitBranch, BarChart3, Megaphone, Blocks, BookOpen, ExternalLink, Briefcase, Lock, EyeOff, UserCog, Coins, KeyRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import VerifyEmailBanner from "@/components/VerifyEmailBanner";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import Copilot from "@/components/copilot/Copilot";
import api from "@/lib/api";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { user, isAuthenticated, logout, hasHydrated } = useAuthStore();
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        Networks: true, 'AI Workspace': true, CRM: true
    });
    const [oversightUnread, setOversightUnread] = useState(0);

    // Restore the user's preferred sidebar width on mount, then keep
    // localStorage in sync. Without this every reload reset collapsed to
    // false, so two people on the same account could see different widths
    // depending on whether they had clicked the chevron in this session.
    useEffect(() => {
        try {
            const saved = localStorage.getItem('sidebar:collapsed');
            if (saved === '1') setCollapsed(true);
            else if (saved === '0') setCollapsed(false);
        } catch { /* localStorage may be unavailable */ }
    }, []);
    useEffect(() => {
        try { localStorage.setItem('sidebar:collapsed', collapsed ? '1' : '0'); } catch {}
    }, [collapsed]);

    // Lightweight poll for the oversight unread badge — every 60s while
    // the dashboard is mounted. Backend computes the count from
    // suggestions with readAt = null on rows the operator hasn't seen.
    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;
        const tick = async () => {
            try {
                const r = await api.get('/oversight/suggestions/unread');
                if (!cancelled && r.data?.success) setOversightUnread(r.data.count || 0);
            } catch { /* not critical */ }
        };
        tick();
        const id = setInterval(tick, 60_000);
        return () => { cancelled = true; clearInterval(id); };
    }, [isAuthenticated, pathname]);

    useEffect(() => {
        if (hasHydrated && !isAuthenticated) {
            router.replace('/login');
        }
    }, [isAuthenticated, hasHydrated, router]);

    // Permissions for the active workspace come down with the workspaces
    // list — see WorkspaceSwitcher → /workspaces. Owners get null perms
    // and bypass every gate. NOTE: these hooks must run BEFORE the early
    // return below, otherwise React's rule-of-hooks ordering breaks on the
    // first authed render and the page crashes.
    const wsList = useWorkspaceStore(s => s.workspaces);
    const wsActive = useWorkspaceStore(s => s.activeWorkspaceId);
    const activeWs = wsList.find(w => w.id === wsActive);
    const canSection = useMemo(() => {
        return (section: string): boolean => {
            if (!activeWs) return false;
            if (activeWs.isOwner) return true;
            return !!activeWs.permissions?.sections?.[section]?.view;
        };
    }, [activeWs]);

    if (!hasHydrated || !isAuthenticated) return null;

    const handleLogout = () => {
        logout();
        router.push('/login');
    };

    const navLinks = [
        { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, section: 'dashboard' },
        { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, section: 'analytics' },
        { name: 'Inbox', href: '/dashboard/inbox', icon: Inbox, section: 'inbox' },
        {
            name: 'Networks',
            icon: Network,
            isGroup: true,
            children: [
                { name: 'WhatsApp', href: '/dashboard/whatsapp', icon: MessageSquare, section: 'whatsapp' },
                { name: 'Instagram', href: '/dashboard/instagram', icon: Camera, section: 'instagram' },
                // No section key — owner-defined role permissions don't
                // yet include this; gating would hide it on shared
                // workspaces. Owner-only writes are enforced backend-side.
                { name: 'Facebook Ads', href: '/dashboard/meta', icon: Megaphone },
            ]
        },
        {
            name: 'CRM',
            icon: Users,
            isGroup: true,
            children: [
                { name: 'Contacts', href: '/dashboard/contacts', icon: Users, section: 'contacts' },
                { name: 'Deals', href: '/dashboard/crm/deals', icon: Briefcase, section: 'deals' },
            ]
        },
        {
            name: 'AI Workspace',
            icon: Bot,
            isGroup: true,
            children: [
                { name: 'AI Agents', href: '/dashboard/ai/agents', icon: Bot, section: 'agents' },
                { name: 'Router Agents', href: '/dashboard/ai/routers', icon: GitBranch, section: 'agents' },
                { name: 'Oversight', href: '/dashboard/oversight', icon: Brain, section: 'oversight', badge: oversightUnread },
                { name: 'Data Tables', href: '/dashboard/ai/tables', icon: Database, section: 'tables' },
                { name: 'AI Providers', href: '/dashboard/ai/providers', icon: Server, section: 'providers' }
            ]
        },
        { name: 'Automations', href: '/dashboard/automations', icon: Workflow, section: 'automations' },
        { name: 'Connectors', href: '/dashboard/connectors', icon: Blocks },
        // Opens the public docs site in a new tab so operators can keep
        // their workspace open while reading. `external` flag tells the
        // renderer below to use <a target="_blank"> instead of <Link>.
        { name: 'Docs', href: '/docs', icon: BookOpen, external: true },
        { name: 'Campaigns', href: '/dashboard/campaigns', icon: Send, section: 'campaigns' },
        { name: 'API Keys', href: '/dashboard/api-keys', icon: Key, section: 'apikeys' },
        { name: 'MCP', href: '/dashboard/mcp', icon: Plug, section: 'mcp' },
        { name: 'Webhooks', href: '/dashboard/webhooks', icon: LinkIcon, section: 'webhooks' },
        { name: 'Billing', href: '/dashboard/billing', icon: CreditCard, section: 'billing' },
        { name: 'Usage', href: '/dashboard/usage', icon: Coins },
        ...(user?.role === 'ADMIN' ? [{
            name: 'Admin',
            icon: Shield,
            isGroup: true,
            children: [
                { name: 'Users', href: '/dashboard/admin/users', icon: Users },
                { name: 'User Access', href: '/dashboard/admin/user-access', icon: UserCog },
                { name: 'Plans', href: '/dashboard/admin/plans', icon: CreditCard },
                { name: 'Payments', href: '/dashboard/admin/payments', icon: CreditCard },
                { name: 'AI Models', href: '/dashboard/admin/ai-models', icon: Bot },
                { name: 'AI Pricing', href: '/dashboard/admin/ai-pricing', icon: Coins },
                { name: 'Platform Keys', href: '/dashboard/admin/platform-keys', icon: KeyRound },
                { name: 'Copilot', href: '/dashboard/admin/copilot', icon: Bot },
                { name: 'Sign-in', href: '/dashboard/admin/auth', icon: LogIn },
                { name: 'Email', href: '/dashboard/admin/email', icon: Mail },
            ]
        }] : []),
    ];

    return (
        <div className="h-screen overflow-hidden bg-background flex">
            {/* Sidebar — always in the flex flow, never a fixed overlay.
                That keeps the main content beside it regardless of viewport
                width or browser zoom; on very narrow screens the user can
                collapse it to a 72px icon-only rail. */}
            <motion.aside
                animate={{ width: collapsed ? 72 : 256 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="relative z-30 bg-card border-r border-border flex flex-col flex-shrink-0 overflow-hidden h-screen"
            >
                <div className="h-16 flex items-center justify-between px-4 border-b border-border min-w-0">
                    {!collapsed ? (
                        <>
                            <div className="flex items-center gap-2 text-primary font-bold text-xl whitespace-nowrap">
                                <MessageSquare className="w-6 h-6 flex-shrink-0" />
                                alChatBot
                            </div>
                            <button className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors" onClick={() => setCollapsed(true)}>
                                <PanelLeftClose className="w-4 h-4" />
                            </button>
                        </>
                    ) : (
                        <button className="w-full flex justify-center p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors" onClick={() => setCollapsed(false)}>
                            <PanelLeft className="w-5 h-5" />
                        </button>
                    )}
                </div>

                <div className="p-2 border-b border-border">
                    <WorkspaceSwitcher collapsed={collapsed} />
                </div>

                <div className="p-2 flex-1 overflow-y-auto overflow-x-hidden">
                    <nav className="space-y-1">
                        {navLinks.map((item: any) => {
                            // Admin-managed per-user visibility overrides.
                            // `hiddenSections` removes the leaf entirely;
                            // `lockedSections` still renders it with a lock
                            // icon (routes 403 server-side). Admins bypass.
                            const hidden = new Set((user?.hiddenSections || []) as string[]);
                            const locked = new Set((user?.lockedSections || []) as string[]);
                            const isAdmin = user?.role === 'ADMIN';
                            const isHidden = (section?: string) => !isAdmin && !!section && hidden.has(section);
                            const isLocked = (section?: string) => !isAdmin && !!section && locked.has(section);

                            // Hide leaf entries whose section the active member can't view.
                            // Group entries are hidden when every child is hidden.
                            // The Admin group (no section keys) is left untouched since
                            // it's already gated on User.role === 'ADMIN'.
                            if (!item.isGroup && item.section && !canSection(item.section)) return null;
                            if (!item.isGroup && isHidden(item.section)) return null;
                            if (item.isGroup && item.children) {
                                const visibleChildren = item.children.filter((c: any) => (!c.section || canSection(c.section)) && !isHidden(c.section));
                                if (visibleChildren.length === 0 && item.name !== 'Admin') return null;
                                item = { ...item, children: visibleChildren };
                            }
                            // Add lock hint to leaf/child items whose section is locked.
                            const itemLocked = !item.isGroup && isLocked(item.section);
                            if (item.isGroup) {
                                const expanded = expandedGroups[item.name] ?? true;
                                const setExpanded = (v: boolean) => setExpandedGroups(p => ({ ...p, [item.name]: v }));

                                if (collapsed) {
                                    // Collapsed: show only group icon
                                    const hasActiveChild = item.children?.some((c: any) => pathname.startsWith(c.href));
                                    return (
                                        <div key={item.name} className="space-y-1">
                                            <div className={`flex justify-center p-2.5 rounded-xl ${hasActiveChild ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`} title={item.name}>
                                                <item.icon className="w-5 h-5" />
                                            </div>
                                            {item.children?.map((child: any) => {
                                                const isChildActive = pathname.startsWith(child.href);
                                                const badge = (child as any).badge as number | undefined;
                                                return (
                                                    <Link key={child.name} href={child.href} title={child.name}
                                                        className={`relative flex justify-center p-2.5 rounded-xl transition-colors ${isChildActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}>
                                                        <child.icon className="w-4 h-4" />
                                                        {badge && badge > 0 ? (
                                                            <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-card" />
                                                        ) : null}
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
                                                    {item.children?.map((child: any) => {
                                                        const isChildActive = pathname.startsWith(child.href);
                                                        const badge = (child as any).badge as number | undefined;
                                                        const childLocked = isLocked(child.section);
                                                        if (childLocked) {
                                                            return (
                                                                <div key={child.name} title="Locked by admin"
                                                                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm text-muted-foreground/50 cursor-not-allowed">
                                                                    <child.icon className="w-4 h-4 flex-shrink-0" />
                                                                    <span className="truncate flex-1">{child.name}</span>
                                                                    <Lock className="w-3 h-3 flex-shrink-0 text-amber-400/80" />
                                                                </div>
                                                            );
                                                        }
                                                        return (
                                                            <Link
                                                                key={child.name}
                                                                href={child.href}
                                                                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors font-medium text-sm ${isChildActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
                                                            >
                                                                <child.icon className="w-4 h-4 flex-shrink-0" />
                                                                <span className="truncate flex-1">{child.name}</span>
                                                                {badge && badge > 0 ? (
                                                                    <span className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                                                                        {badge > 99 ? '99+' : badge}
                                                                    </span>
                                                                ) : null}
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
                            // External items open in a new tab so operators
                            // can flip between the docs and their workspace
                            // without losing context.
                            const external = (item as any).external === true;

                            if (collapsed) {
                                if (external) {
                                    return (
                                        <a key={item.name} href={item.href!} title={item.name}
                                            target="_blank" rel="noreferrer"
                                            className="flex justify-center p-2.5 rounded-xl transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                            <Icon className="w-5 h-5" />
                                        </a>
                                    );
                                }
                                if (itemLocked) {
                                    return (
                                        <div key={item.name} title={`${item.name} — locked by admin`}
                                            className="relative flex justify-center p-2.5 rounded-xl text-muted-foreground/50 cursor-not-allowed">
                                            <Icon className="w-5 h-5" />
                                            <Lock className="absolute -top-0.5 -right-0.5 w-3 h-3 text-amber-400/80" />
                                        </div>
                                    );
                                }
                                return (
                                    <Link key={item.name} href={item.href!} title={item.name}
                                        className={`flex justify-center p-2.5 rounded-xl transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}>
                                        <Icon className="w-5 h-5" />
                                    </Link>
                                );
                            }

                            if (external) {
                                return (
                                    <a key={item.name} href={item.href!}
                                        target="_blank" rel="noreferrer"
                                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                        <Icon className="w-5 h-5 flex-shrink-0" />
                                        <span className="truncate flex-1">{item.name}</span>
                                        <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                                    </a>
                                );
                            }

                            if (itemLocked) {
                                return (
                                    <div key={item.name} title="Locked by admin"
                                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-muted-foreground/50 cursor-not-allowed">
                                        <Icon className="w-5 h-5 flex-shrink-0" />
                                        <span className="truncate flex-1">{item.name}</span>
                                        <Lock className="w-3.5 h-3.5 flex-shrink-0 text-amber-400/80" />
                                    </div>
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
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden min-w-0">
                <VerifyEmailBanner />
                <main className="flex-1 overflow-y-auto p-4 md:p-8">
                    {children}
                </main>
            </div>
            <Copilot />
        </div>
    );
}
