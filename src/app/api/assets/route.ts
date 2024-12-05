import mime from 'mime';
import nullthrows from 'nullthrows';
import { list } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { fetchBufferFromVercelBlob } from '@/helpers/vercel-blob';
import { getLatestUpdateBundlePathForRuntimeVersionAsync, getMetadataAsync } from '@/helpers';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const assetName = searchParams.get('asset');
    const platform = searchParams.get('platform');
    const runtimeVersion = searchParams.get('runtimeVersion');

    const projectId = searchParams.get('id');
    if (!projectId || typeof projectId !== 'string') {
        return NextResponse.json({ error: 'No id provided.' }, { status: 400 });
    }

    const channel = searchParams.get('channel') || '';
    if (['staging', 'production'].includes(channel)) {
        return NextResponse.json({ error: 'No channel provided.' }, { status: 400 });
    }

    if (!assetName || typeof assetName !== 'string') {
        return NextResponse.json({ error: 'No asset name provided.' }, { status: 400 });
    }

    if (platform !== 'ios' && platform !== 'android') {
        return NextResponse.json({ error: 'No platform provided. Expected "ios" or "android".' }, { status: 400 });
    }

    if (!runtimeVersion || typeof runtimeVersion !== 'string') {
        return NextResponse.json({ error: 'No runtimeVersion provided.' }, { status: 400 });
    }

    let updateBundlePath: string;
    try {
        updateBundlePath = await getLatestUpdateBundlePathForRuntimeVersionAsync(
            projectId,
            channel,
            platform,
            runtimeVersion
        );
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const { metadataJson } = await getMetadataAsync({
        updateBundlePath,
        runtimeVersion
    });

    // const assetPath = path.resolve(assetName);
    const assetMetadata = metadataJson.fileMetadata[platform].assets.find(
        (asset: any) => asset.path === assetName.replace(`${updateBundlePath}/`, '')
    );
    const isLaunchAsset = metadataJson.fileMetadata[platform].bundle === assetName.replace(`${updateBundlePath}/`, '');

    const { blobs } = await list({ prefix: updateBundlePath });
    if (!blobs.find(blob => blob.pathname === assetName)) {
        return NextResponse.json({ error: `Asset "${assetName}" does not exist.` }, { status: 404 });
    }

    try {
        const asset = await fetchBufferFromVercelBlob(assetName);
        return new NextResponse(asset, {
            status: 200,
            headers: {
                'content-type': isLaunchAsset ? 'application/javascript' : nullthrows(mime.getType(assetMetadata.ext))
            }
        });
    } catch (error) {
        console.log(error);
        return NextResponse.json({ error }, { status: 500 });
    }
}
