export function connectionStateColor(state: string): string {
    switch (state) {
        case 'connected':
            return 'green';
        case 'connecting':
            return 'orange';
        default:
            return 'red';
    }
}

export function largestSizeUnit(size: number): string {
    const base = 1000;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(size) / Math.log(base));
    return sizes[i];
}

export function formatBytes(bytes: number, size: string | undefined = undefined, decimals = 2): string {
    const base = 1000;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

    switch (size) {
        case 'B':
            return bytes + ' B';
        case 'KB':
            return (bytes / base).toFixed(decimals) + ' KB';
        case 'MB':
            return (bytes / Math.pow(base, 2)).toFixed(decimals) + ' MB';
        case 'GB':
            return (bytes / Math.pow(base, 3)).toFixed(decimals) + ' GB';
        case 'TB':
            return (bytes / Math.pow(base, 4)).toFixed(decimals) + ' TB';
        default:
            if (bytes === 0) return '0 B';
            const i = Math.floor(Math.log(bytes) / Math.log(base));
            return parseFloat((bytes / Math.pow(base, i)).toFixed(decimals)) + ' ' + sizes[i];
    }
}

export function saveBlob(blob: Blob, filename: string): void {
    const objectURL = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectURL;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectURL);
}

export function formatDownloadProgress(current: number, total: number): string {
    return `${formatBytes(current)} / ${formatBytes(total)} (${Math.round(current / total * 100)}%)`;
}
