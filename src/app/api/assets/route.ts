import fs from 'fs';
import mime from 'mime';
import path from 'path';
import nullthrows from 'nullthrows';
import fsPromises from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { getLatestUpdateBundlePathForRuntimeVersionAsync, getMetadataAsync } from '@/helpers';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const assetName = searchParams.get('asset');
    const platform = searchParams.get('platform');
    const runtimeVersion = searchParams.get('runtimeVersion');

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
        updateBundlePath = await getLatestUpdateBundlePathForRuntimeVersionAsync(runtimeVersion);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const { metadataJson } = await getMetadataAsync({
        updateBundlePath,
        runtimeVersion
    });

    const assetPath = path.resolve(assetName);
    const assetMetadata = metadataJson.fileMetadata[platform].assets.find(
        (asset: any) => asset.path === assetName.replace(`${updateBundlePath}/`, '')
    );
    const isLaunchAsset = metadataJson.fileMetadata[platform].bundle === assetName.replace(`${updateBundlePath}/`, '');

    if (!fs.existsSync(assetPath)) {
        return NextResponse.json({ error: `Asset "${assetName}" does not exist.` }, { status: 404 });
    }

    try {
        const asset = await fsPromises.readFile(assetPath, null);
        return new NextResponse(asset, {
            status: 200,
            headers: {
                'content-type': isLaunchAsset ? 'application/javascript' : nullthrows(mime.getType(assetMetadata.ext))
            }
        });
    } catch (error) {
        console.log(error);
        NextResponse.json({ error }, { status: 500 });
    }
}
