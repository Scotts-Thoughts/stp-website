import * as htmlToImage from 'html-to-image';
// import FS from './fs';

function downloadBlob(filename: string, blob: Blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(a.href);
    }, 1000);
}


export async function exportElement(root: HTMLElement, filename: string, scale: number = 1) {
    // const fs = FS.create();
    // if (!await fs.isDirEmpty("") && !confirm("Folder is not empty. Continue with the operation?")) return;

    console.time();

    const blob = await htmlToImage.toBlob(root, {
        backgroundColor: "transparent",
        cacheBust: true,
        pixelRatio: scale
    });

    if (blob) {
        // fs.write(filename, blob);
        downloadBlob(filename, blob);
    } else {
        console.error(`Failed to export`);
    } 

    console.timeEnd();
}
