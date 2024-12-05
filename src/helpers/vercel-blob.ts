import { head } from '@vercel/blob';

async function fetchFileFromVercelBlob(filePath: string) {
    const { url } = await head(filePath);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    return response;
}

export async function fetchJSONFromVercelBlob(filePath: string) {
    const response = await fetchFileFromVercelBlob(filePath);
    const data = await response.json();
    return data;
}

export async function fetchBufferFromVercelBlob(filePath: string) {
    const response = await fetchFileFromVercelBlob(filePath);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer;
}
