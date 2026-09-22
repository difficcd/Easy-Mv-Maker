import React, { useEffect, useRef, useState } from 'react';

/**
 * A menu that opens from a button and closes on a press anywhere outside it.
 *
 * Returns the open flag, its setter, and a ref for the element that counts as "inside". The
 * outside press is a document-level mousedown, so a click on another menu's button both closes
 * this one and opens that one, which is how menus in a bar are expected to behave.
 *
 * @returns {[boolean, (v: boolean | ((v: boolean) => boolean)) => void, import('react').MutableRefObject<HTMLElement | null>]}
 */
export function useDropdown(): [boolean, React.Dispatch<React.SetStateAction<boolean>>, React.RefObject<any>] {
    const [open, setOpen] = useState(false);
    const ref = useRef<any>(null);
    useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [open]);
    return [open, setOpen, ref];
}
