"use client";

// Floating save bar for admin editors.
//
// Long admin forms scroll well past their Save button, so it's easy to
// change something, wander off, and lose it. This slides up from the
// bottom the moment anything is dirty, follows the page, and takes
// Ctrl/Cmd+S. It also guards the browser's own navigation, because a
// half-edited plan is worth more than a tidy tab close.

import { useEffect } from "react";
import { Loader2, Save, RotateCcw } from "lucide-react";

export default function UnsavedChangesBar({
    dirty,
    saving,
    onSave,
    onDiscard,
    label = 'Unsaved changes',
    savingLabel = 'Saving…',
    disabled = false,
    disabledReason,
}: {
    dirty: boolean;
    saving?: boolean;
    onSave: () => void;
    /** Omit to hide the discard button (nothing to revert to). */
    onDiscard?: () => void;
    label?: string;
    savingLabel?: string;
    /** Blocks saving — e.g. a required field is still empty. */
    disabled?: boolean;
    disabledReason?: string;
}) {
    // Ctrl/Cmd+S saves instead of opening the browser's save dialog.
    // Bound whenever there's something to save, so it works no matter
    // where focus happens to be — including inside a text field, which
    // is exactly where someone finishing an edit usually is.
    useEffect(() => {
        if (!dirty) return;
        const onKey = (e: KeyboardEvent) => {
            if (!(e.key === 's' || e.key === 'S')) return;
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            if (!saving && !disabled) onSave();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [dirty, saving, disabled, onSave]);

    // Native "leave site?" prompt. The browser ignores custom text, so
    // the point is only to make the tab-close survivable.
    useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [dirty]);

    if (!dirty) return null;

    return (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center pointer-events-none px-4">
            <div className="pointer-events-auto flex items-center gap-3 bg-card/95 backdrop-blur border border-border rounded-2xl shadow-2xl pl-4 pr-2 py-2 animate-in slide-in-from-bottom-4 fade-in duration-200">
                <span className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                    <span className="font-medium">{saving ? savingLabel : label}</span>
                </span>

                {disabled && disabledReason && (
                    <span className="text-[11px] text-amber-400 max-w-[200px]">{disabledReason}</span>
                )}

                <div className="flex items-center gap-1.5">
                    {onDiscard && (
                        <button onClick={onDiscard} disabled={saving}
                            title="Discard changes"
                            className="px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50 flex items-center gap-1.5">
                            <RotateCcw className="w-3.5 h-3.5" />
                            Discard
                        </button>
                    )}
                    <button onClick={onSave} disabled={!!saving || disabled}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-4 py-1.5 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save
                        <kbd className="hidden sm:inline text-[10px] font-mono opacity-60 border border-current/30 rounded px-1">
                            ⌘S
                        </kbd>
                    </button>
                </div>
            </div>
        </div>
    );
}
