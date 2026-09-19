// ImageData to and from a data URL, for persistence.

import { makeCanvas } from './canvasFactory.js';

export function imageDataToDataURL(imageData) {
    const c = makeCanvas();
    c.width = imageData.width;
    c.height = imageData.height;
    c.getContext('2d').putImageData(imageData, 0, 0);
    return c.toDataURL('image/png');
}

export function dataURLToImageData(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const c = makeCanvas();
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, c.width, c.height));
        };
        img.onerror = reject;
        img.src = url;
    });
}
