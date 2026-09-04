// Handing a finished file to the browser.
//
// Written three times - the project save's fallback, the frame/GIF export and the screen
// recording - and the three had drifted into three different levels of correctness:
//
//   export      appended the anchor, clicked, removed it, revoked the URL after ten seconds
//   save        clicked a detached anchor and never revoked
//   recording   appended and removed, but never revoked
//
// So two of the three leaked: an object URL pins the whole Blob until it is revoked or the page
// goes, and the two that leaked were the two carrying the largest payloads - the entire project
// JSON and the entire recorded video.
//
// The anchor is put in the document rather than clicked detached because that is what the export
// path had learnt to do; a detached anchor works in current browsers but has not always.

/**
 * Save a Blob to the user's downloads as `name`.
 *
 * The revoke is deferred rather than immediate: the click only *starts* the download, and
 * revoking the URL while the browser is still reading from it cancels it. Ten seconds is what
 * the export path settled on and it has not been reported as too short.
 *
 * @param {Blob} blob
 * @param {string} name file name offered to the browser
 * @returns {void}
 */
export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
