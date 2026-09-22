import { useCallback, useState } from 'react';

// Which dialog is open, and the state that belongs to one.
//
// Three of them - settings, the tool-key list, and help - plus the tab the settings dialog opens
// on and the action waiting for a key to be pressed at it.
//
// Rebinding is shared on purpose: the settings dialog and the tool-key list both rebind keys, and
// both must clear a rebinding in progress when they close. That was written out twice, the same
// two lines in two places, which is exactly the kind of pair that stays correct until one of them
// gains a third line.

export function useDialogs() {
    const [settings, setSettings] = useState(false);
    const [settingsTab, setSettingsTab] = useState('theme');
    const [toolKeys, setToolKeys] = useState(false);
    const [help, setHelp] = useState(false);
    /** The export-range dialog: start and end, before anything is recorded. */
    const [exportRange, setExportRange] = useState(false);
    /** The id of the action waiting to be rebound, or null. */
    const [rebinding, setRebinding] = useState<string | null>(null);

    /** Open settings on a particular tab. The playback controls open it on 'play'. */
    const openSettings = useCallback((tab?: string | null) => {
        if (tab) setSettingsTab(tab);
        setSettings(true);
    }, []);

    /**
     * Close a key-binding dialog, and abandon any rebinding it was waiting for. Leaving one
     * armed means the next key pressed anywhere is swallowed and assigned to whatever was
     * half-selected when the dialog went away.
     */
    const closeSettings = useCallback(() => { setSettings(false); setRebinding(null); }, []);
    const closeToolKeys = useCallback(() => { setToolKeys(false); setRebinding(null); }, []);

    return {
        settings, setSettings, settingsTab, setSettingsTab,
        toolKeys, setToolKeys, help, setHelp, exportRange, setExportRange, rebinding, setRebinding,
        openSettings, closeSettings, closeToolKeys,
    };
}
